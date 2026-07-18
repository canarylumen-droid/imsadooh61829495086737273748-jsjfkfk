import { Router, Request, Response } from 'express';
import { storage } from '@shared/lib/storage/storage.js';
import { requireAuthOrApiKey } from '../middleware/auth.js';
import { getAIStatus } from "@services/brain-worker/src/ai-lib/core/ai-service.js";
import { learnUserStyle } from "@services/brain-worker/src/ai-lib/context/personality-learner.js";
import type { Lead, Message } from '@audnix/shared';
import { InstagramOAuth } from '@services/api-gateway/src/oauth/instagram.js';
import { decrypt } from '@shared/lib/crypto/encryption.js';
import dns from 'dns';
import { promisify } from 'util';
import { LRUCache } from 'lru-cache';
import { uploadAvatar, uploadToSupabase } from '@shared/lib/storage/file-upload.js';
import path from 'path';
import { promises as fs } from 'fs';

const resolveMx = promisify(dns.resolveMx);
const resolveTxt = promisify(dns.resolveTxt);

// In-memory cache for dashboard stats (5s)
const statsCache = new LRUCache<string, any>({ 
  max: 500,
  ttl: 1000 * 0.5 // 500ms — near-real-time, prevents stampede on rapid refetches
});

/**
 * Invalidate the dashboard stats cache for a specific user.
 * Call this when leads, conversions, or messages are updated.
 */
export function invalidateStatsCache(userId: string) {
  // Delete both specific integration caches and the 'all' cache
  const keysToDelete = Array.from(statsCache.keys()).filter(k => k.startsWith(`${userId}:`));
  keysToDelete.forEach(k => statsCache.delete(k));
  console.log(`[Cache] Invalidated dashboard stats for user ${userId} (${keysToDelete.length} keys)`);
}


const router = Router();

router.get('/', requireAuthOrApiKey, async (req: Request, res: Response) => {
  const userId = req.session?.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ status: 'ok', userId, message: 'Dashboard API is operational' });
});

/**
 * POST /api/dns/verify
 * Force a DNS/reputation check for a domain
 */
router.post('/dns/verify', requireAuthOrApiKey, async (req: Request, res: Response) => {
  try {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const { domain } = req.body;
    if (!domain) return res.status(400).json({ error: 'Domain is required' });

    console.log(`[DNS Verify] Force check for ${domain} (User: ${userId})`);

    let overallStatus = 'verified';

    // Rust-backed DNS (async)
    if (process.env.ENABLE_RUST_DNS === 'true') {
      try {
        const { enqueueDnsVerification } = await import('@shared/lib/queues/dns-verify-queue.js');
        enqueueDnsVerification(`dns_${userId}_${domain}`, userId, domain, undefined);
        overallStatus = 'pending_rust';
      } catch (e) {
        console.warn('[DNS] Rust enqueue failed, falling back:', e);
      }
    }

    // Node.js fallback (always runs for immediate response)
    const { verifyDomainDns } = await import('@services/email-service/src/email/dns-verification.js');
    const result = await verifyDomainDns(domain, undefined, true);

    await storage.createDomainVerification(userId, {
      domain,
      verificationResult: result
    });

    statsCache.delete(userId);

    // Trigger real-time sync if connected
    try {
      const { imapIdleManager } = await import('@services/email-service/src/email/imap-idle-manager.js');
      imapIdleManager.syncConnections();
    } catch (e) { /* ignore import errors in some envs */ }

    // Notify UI to refresh health scores
    const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
    wsSync.notifyStatsUpdated(userId);

    res.json({
      success: true,
      domain,
      status: overallStatus === 'pending_rust' ? result.overallStatus : result.overallStatus,
      message: 'Domain reputation and DNS records verification completed.'
    });

    // Real-time synchronization: Recalculate reputation for all mailboxes on this domain
    try {
      const { calculateReputationScore } = await import('@services/email-service/src/email/reputation-monitor.js');
      const allInts = await storage.getIntegrations(userId);
      for (const integration of allInts) {
        try {
          const meta = JSON.parse(decrypt(integration.encryptedMeta));
          const email = meta.user || meta.email || (integration as any).email || '';
          if (email.endsWith(`@${domain}`)) {
            console.log(`[DNS Sync] Recalculating reputation for ${integration.id} (${email})`);
            await calculateReputationScore(integration.id);
          }
        } catch (e) { /* ignore individual decryption errors */ }
      }
    } catch (e) {
      console.warn('[DNS Sync] Failed to trigger reputation recalculation:', e);
    }
  } catch (error) {
    console.error('DNS Verification Error:', error);
    res.status(500).json({ error: 'Failed to verify DNS' });
  }
});


/**
 * GET /api/dashboard/stats
 * Get current period stats for dashboard
 */
router.get('/stats', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { integrationId } = req.query;
    const cacheKey = `${userId}:${integrationId || 'all'}`;
    const cached = statsCache.get(cacheKey); // Use .get for NodeCache

    if (cached) { // NodeCache handles expiration internally
      res.json(cached);
      return;
    }

    const user = await storage.getUserById(userId);
    const stats = await storage.getDashboardStats(userId, {
      integrationId: integrationId as string
    });

    // Real-time Engine Status & Synchronization
    const integrations = await storage.getIntegrations(userId);
    const monitors = await storage.getVideoMonitors(userId);

    // Get recent bounces - Handle potential column mapping issues
    let recentBounces = [];
    try {
      recentBounces = await storage.getRecentBounces(userId, 168); // Last 7 days
    } catch (bounceError) {
      console.warn('⚠️ Failed to fetch recent bounces, using empty list:', bounceError);
    }

    // ── Real-Time DNS Verification ──────────────────────────────────────────
    let domainVerifications = await storage.getDomainVerifications(userId, 5);
    const emailedDomains = new Set(
      integrations
        .filter((i: any) => ['gmail', 'outlook', 'custom_email'].includes(i.provider) && i.connected)
        .map((i: any) => {
          try {
            const meta = typeof i.encryptedMeta === 'string' ? JSON.parse(decrypt(i.encryptedMeta)) : (i.metadata || {});
            const email = meta.user || meta.email || (i as any).email || '';
            return email.includes('@') ? email.split('@')[1] : null;
          } catch { return null; }
        })
        .filter(Boolean)
    );

    // If no cached verifications exist, or they're > 1 hour old, do a real-time check
    const newestVer = domainVerifications.length > 0 ? domainVerifications[0] : null;
    const verAge = newestVer ? Date.now() - new Date(newestVer.created_at || newestVer.createdAt).getTime() : Infinity;
    if (emailedDomains.size > 0 && (domainVerifications.length === 0 || verAge > 3600000)) {
      // ── Rust-backed DNS (async, if enabled) ────────────────────────
      if (process.env.ENABLE_RUST_DNS === 'true') {
        try {
          const { enqueueDnsVerification } = await import('@shared/lib/queues/dns-verify-queue.js');
          for (const domain of emailedDomains) {
            enqueueDnsVerification(`dns_${userId}_${domain}`, userId, domain, undefined);
          }
        } catch (e) {
          console.warn('[DNS] Failed to enqueue Rust DNS job:', e);
        }
      }

      // ── Node.js fallback ───────────────────────────────────────────
      (async () => {
        try {
          const { verifyDomainDns } = await import('@services/email-service/src/email/dns-verification.js');
          for (const domain of emailedDomains) {
            const result = await verifyDomainDns(domain, undefined, true);
            await storage.createDomainVerification(userId, { domain, verificationResult: result });
            // Push real-time update to the UI
            try {
              const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
              wsSync.notifyDnsVerified(userId, {
                domain,
                score: result.overallScore,
                spf: result.spf?.valid ?? false,
                dkim: result.dkim?.valid ?? false,
                dmarc: result.dmarc?.valid ?? false,
                mx: result.mx?.found ?? false,
                blacklist: result.blacklist?.isBlacklisted ?? false,
              });
              wsSync.notifyStatsUpdated(userId);
            } catch {}
          }
          // Refresh domainVerifications for this response
          domainVerifications = await storage.getDomainVerifications(userId, 5);
        } catch (e) {
          console.warn('[DNS] Real-time verification failed:', e);
        }
      })();
    }

    // Calculate most recent sync time from all integrations
    let lastSyncTimestamp = integrations.reduce((latest, current) => {
      if (!current.lastSync) return latest;
      const currentSync = new Date(current.lastSync).getTime();
      return currentSync > latest ? currentSync : latest;
    }, 0);

    const isAutonomousMode = (user?.config as any)?.autonomousMode !== false;
    // When in autonomous mode, IMAP connections are real-time via IDLE.
    // If the last sync is more than 5 min old, use current time to show "Real-time"
    if (isAutonomousMode && lastSyncTimestamp > 0 && (Date.now() - lastSyncTimestamp) > 5 * 60 * 1000) {
      lastSyncTimestamp = Date.now();
    }
    const engineStatus = isAutonomousMode ? "Autonomous" : "Paused";

    // Reputation is now 100% managed by ReputationMonitor via the database.
    // Each integration stores its own live reputation_score.
    const hardBounces = recentBounces.filter(b => b.bounceType === 'hard').length;
    const softBounces = recentBounces.filter(b => b.bounceType === 'soft').length;
    const spamBounces = recentBounces.filter(b => b.bounceType === 'spam').length;
    let reputationScore: number | null = null;
    let globalBounceRate: number | null = null;

    // 7-Day Reputation Trend — built from actual reputation scores and bounce data
    const trendData: Array<{ date: string; score: number; bounces: number }> = [];
    
    // Get all integrations with reputation scores
    const emailIntegrations = integrations.filter(i => 
      ['gmail', 'outlook', 'custom_email'].includes(i.provider) && i.connected
    );
    
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      
      // Count bounces for this day
      const dayBounces = recentBounces.filter(b => b.timestamp.toISOString().split('T')[0] === dateStr);
      
      // Calculate average reputation score across integrations
      // Use actual scores if available, otherwise calculate from bounce rate
      let dayScore = 100; // Default to perfect if no data
      if (emailIntegrations.length > 0) {
        const scores = emailIntegrations
          .map(i => i.reputationScore)
          .filter(s => s !== null && s !== undefined);
        
        if (scores.length > 0) {
          // Use actual reputation scores
          dayScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
        } else {
          // Calculate from bounce rate: 100 - (bounces * 10)
          const totalSent = (stats as any).totalSent || 1;
          const bounceRate = dayBounces.length / totalSent;
          dayScore = Math.max(0, Math.min(100, 100 - (bounceRate * 500)));
        }
      }
      
      trendData.push({
        date: dateStr.substring(5), // MM-DD
        score: Math.round(dayScore),
        bounces: dayBounces.length
      });
    }

    if (integrationId) {
      const activeInt = integrations.find(i => i.id === integrationId);
      reputationScore = activeInt?.reputationScore !== undefined ? activeInt.reputationScore : null;
      globalBounceRate = stats.globalBounceRate;
    } else {
      // Average reputation score across all connected email mailboxes
      const emailInts = integrations.filter(i => ['gmail', 'outlook', 'custom_email'].includes(i.provider) && i.connected);
      if (emailInts.length > 0) {
        const scoredInts = emailInts.filter(i => i.reputationScore !== null && i.reputationScore !== undefined);
        if (scoredInts.length > 0) {
          reputationScore = scoredInts.reduce((sum, i) => sum + (i.reputationScore || 0), 0) / scoredInts.length;
        }
      }
      globalBounceRate = stats.globalBounceRate;
    }

    // Filter verifications to the selected mailbox domain if provided
    let activeVerifications = domainVerifications;
    if (integrationId) {
       const activeIntegration = integrations.find(i => i.id === integrationId);
       if (activeIntegration) {
          try {
             const meta = JSON.parse(decrypt(activeIntegration.encryptedMeta));
             const email = meta.user || meta.email || (activeIntegration.provider === 'custom_email' ? (activeIntegration as any).email : '');
             if (email && email.includes('@')) {
                 const d = email.split('@')[1];
                 activeVerifications = activeVerifications.filter(v => v.domain === d);
             }
           } catch(e) { console.warn('[Dashboard] Failed to parse encrypted meta for verification filter:', (e as Error)?.message); }
        }
     }

    // Deduplicate verifications by domain to only keep the latest check per domain
    const uniqueVerifications = new Map();
    for (const v of activeVerifications) {
      if (!uniqueVerifications.has(v.domain)) {
        uniqueVerifications.set(v.domain, v);
      }
    }
    activeVerifications = Array.from(uniqueVerifications.values());

    const unverifiedDomains = activeVerifications.filter(v => {
      const result = v.verification_result as any;
      return result && result.overallStatus !== 'excellent' && result.overallStatus !== 'good';
    }).length;

    const disconnectedIntegrations = integrations.filter(i => !i.connected).length;

    // [NEW] Workspace Benchmarks (Global Comparison)
    const { db } = await import('@shared/lib/db/db.js');
    const { leads: leadsSchema, messages: msgSchema } = await import('@audnix/shared');
    const { sql: dSql, eq: dEq, and: dAnd, gt: dGt } = await import('drizzle-orm');

    // Phase 7 Fix: Use SQL aggregation for average lead score to avoid OOM
    const [scoreResult] = await db.select({
      avgScore: dSql<number>`AVG(COALESCE(${leadsSchema.score}, 0))`
    })
    .from(leadsSchema)
    .where(dEq(leadsSchema.userId, userId));
    
    const globalAvgScore = scoreResult?.avgScore != null ? Number(scoreResult.avgScore) : null;

    // Get user's own open rate for benchmark (prevents cross-user data leakage)
    const [globalMsgStats] = await db.select({
      totalSent: dSql<number>`count(*) filter (where direction = 'outbound')`,
      opened: dSql<number>`count(*) filter (where direction = 'outbound' and opened_at is not null)`,
      replied: dSql<number>`count(*) filter (where direction = 'inbound')`
    })
    .from(msgSchema)
    .where(
      dAnd(
        dEq(msgSchema.userId, userId),
        dSql`(${msgSchema.isWarmup} IS NULL OR ${msgSchema.isWarmup} = false)`
      )
    );

    const globalOpenRate = Number(globalMsgStats?.totalSent || 0) > 0
      ? Number(((Number(globalMsgStats?.opened || 0) / Number(globalMsgStats?.totalSent || 0)) * 100).toFixed(2))
      : null; // No data: don't fabricate a benchmark
    // Use the most recent DNS verification score as domainHealth (real %)
    const latestDnsScore = activeVerifications.length > 0
      ? ((activeVerifications[0].verification_result as any)?.overallScore ?? null)
      : null;
    const domainHealth = latestDnsScore !== null ? Number(Number(latestDnsScore).toFixed(2)) : null;

    // Map verification results nicely
    const mappedVerifications = activeVerifications.map(v => {
       const result = v.verification_result as any;
       // Remove weird 'unknown' if it's actually partially okay, or keep if completely unknown
       if (result && !result.overallStatus && (result.spf?.found || result.dkim?.found || result.dmarc?.found)) {
          result.overallStatus = 'fair'; // Adjust logic so partials don't show as error entirely
       }
       return {
          ...v,
          result
       }
    });

    // Fetch recent AI Action Logs for the dashboard
    const { aiActionLogs: aiActionSchema } = await import('@audnix/shared');
    const { desc: dDesc } = await import('drizzle-orm');
    
    const aiLogs = await db.select({
      id: aiActionSchema.id,
      actionType: aiActionSchema.actionType,
      decision: aiActionSchema.decision,
      intentScore: aiActionSchema.intentScore,
      confidence: aiActionSchema.confidence,
      reasoning: aiActionSchema.reasoning,
      createdAt: aiActionSchema.createdAt,
      leadName: leadsSchema.name
    })
    .from(aiActionSchema)
    .leftJoin(leadsSchema, dEq(aiActionSchema.leadId, leadsSchema.id))
    .where(dEq(aiActionSchema.userId, userId))
    .orderBy(dDesc(aiActionSchema.createdAt))
    .limit(10);

    // Aggregate DNS results for the UI
    const dnsStatus = {
        spf: mappedVerifications.some(v => v.result?.spf?.valid),
        dkim: mappedVerifications.some(v => v.result?.dkim?.valid),
        dmarc: mappedVerifications.some(v => v.result?.dmarc?.valid),
        mx: mappedVerifications.some(v => v.result?.mx?.found),
        blacklist: mappedVerifications.some(v => v.result?.blacklist?.isBlacklisted)
    };

    // Per-mailbox analytics
    const { emailTracking: emailTrackingSchema, bounceTracker: bounceTrackerSchema } = await import('@audnix/shared');
    const { emailMessages: emailMessagesSchema } = await import('@audnix/shared');
    const perMailboxStats = await Promise.all(
      integrations.map(async (int: any) => {
        const [sent] = await db.select({ count: dSql<number>`count(*)::int` })
          .from(emailTrackingSchema)
          .where(dAnd(dEq(emailTrackingSchema.integrationId, int.id), dSql`${emailTrackingSchema.createdAt} > NOW() - INTERVAL '14 days'`));
        const [opened] = await db.select({ count: dSql<number>`count(*)::int` })
          .from(emailTrackingSchema)
          .where(dAnd(dEq(emailTrackingSchema.integrationId, int.id), dGt(emailTrackingSchema.openCount, 0), dSql`${emailTrackingSchema.createdAt} > NOW() - INTERVAL '14 days'`));
        const [clicked] = await db.select({ count: dSql<number>`count(*)::int` })
          .from(emailTrackingSchema)
          .where(dAnd(dEq(emailTrackingSchema.integrationId, int.id), dGt(emailTrackingSchema.clickCount, 0), dSql`${emailTrackingSchema.createdAt} > NOW() - INTERVAL '14 days'`));
        // Replies = inbound messages to this mailbox (most important metric)
        const [replies] = await db.select({ count: dSql<number>`count(*)::int` })
          .from(emailMessagesSchema)
          .where(dAnd(dEq(emailMessagesSchema.integrationId, int.id), dEq(emailMessagesSchema.direction, 'inbound'), dSql`${emailMessagesSchema.createdAt} > NOW() - INTERVAL '14 days'`));
        // Inbox placement stats
        const [inboxPlaced] = await db.select({ count: dSql<number>`count(*)::int` })
          .from(emailTrackingSchema)
          .where(dAnd(dEq(emailTrackingSchema.integrationId, int.id), dEq(emailTrackingSchema.placement, 'inbox'), dSql`${emailTrackingSchema.createdAt} > NOW() - INTERVAL '14 days'`));
        const [spamPlaced] = await db.select({ count: dSql<number>`count(*)::int` })
          .from(emailTrackingSchema)
          .where(dAnd(dEq(emailTrackingSchema.integrationId, int.id), dEq(emailTrackingSchema.placement, 'spam'), dSql`${emailTrackingSchema.createdAt} > NOW() - INTERVAL '14 days'`));
        // Spam complaints = recipient clicked "Report Spam" (feedback loop) OR server bounced as spam
        const [spamComplaints] = await db.select({ count: dSql<number>`count(*)::int` })
          .from(bounceTrackerSchema)
          .where(dAnd(dEq(bounceTrackerSchema.integrationId, int.id), dEq(bounceTrackerSchema.bounceType, 'spam'), dSql`${bounceTrackerSchema.createdAt} > NOW() - INTERVAL '14 days'`));
        // Hard bounces = permanent failure (invalid address, domain doesn't exist)
        const [hardBounces] = await db.select({ count: dSql<number>`count(*)::int` })
          .from(bounceTrackerSchema)
          .where(dAnd(dEq(bounceTrackerSchema.integrationId, int.id), dEq(bounceTrackerSchema.bounceType, 'hard'), dSql`${bounceTrackerSchema.createdAt} > NOW() - INTERVAL '14 days'`));
        // Soft bounces = temporary failure (mailbox full, server down)
        const [softBounces] = await db.select({ count: dSql<number>`count(*)::int` })
          .from(bounceTrackerSchema)
          .where(dAnd(dEq(bounceTrackerSchema.integrationId, int.id), dEq(bounceTrackerSchema.bounceType, 'soft'), dSql`${bounceTrackerSchema.createdAt} > NOW() - INTERVAL '14 days'`));
        const totalSent = sent?.count || 0;
        const totalBounces = (hardBounces?.count || 0) + (softBounces?.count || 0) + (spamComplaints?.count || 0);
        return {
          integrationId: int.id,
          provider: int.provider,
          accountType: int.accountType,
          connected: int.connected,
          sent: totalSent,
          opened: opened?.count || 0,
          clicked: clicked?.count || 0,
          replies: replies?.count || 0,
          // Inbox placement
          inboxPlaced: inboxPlaced?.count || 0,
          spamPlaced: spamPlaced?.count || 0,
          unknownPlacement: Math.max(0, totalSent - (inboxPlaced?.count || 0) - (spamPlaced?.count || 0)),
          // Breakdown of delivery issues
          hardBounces: hardBounces?.count || 0,
          softBounces: softBounces?.count || 0,
          spamComplaints: spamComplaints?.count || 0,
          totalBounces,
          // Rates
          openRate: totalSent > 0 ? Number(((opened?.count || 0) / totalSent * 100).toFixed(1)) : 0,
          clickRate: totalSent > 0 ? Number(((clicked?.count || 0) / totalSent * 100).toFixed(1)) : 0,
          replyRate: totalSent > 0 ? Number(((replies?.count || 0) / totalSent * 100).toFixed(1)) : 0,
          bounceRate: totalSent > 0 ? Number((totalBounces / totalSent * 100).toFixed(1)) : 0,
          spamComplaintRate: totalSent > 0 ? Number(((spamComplaints?.count || 0) / totalSent * 100).toFixed(1)) : 0,
          // Inbox placement rates
          inboxPlacementRate: totalSent > 0 ? Number(((inboxPlaced?.count || 0) / totalSent * 100).toFixed(1)) : 0,
          spamPlacementRate: totalSent > 0 ? Number(((spamPlaced?.count || 0) / totalSent * 100).toFixed(1)) : 0,
          // Deliverability estimate (sent - bounces - complaints)
          delivered: Math.max(0, totalSent - totalBounces),
          deliverabilityRate: totalSent > 0 ? Number(((Math.max(0, totalSent - totalBounces) / totalSent) * 100).toFixed(1)) : 0,
        };
      })
    );

    const responseData = {
      ...stats,
      domainHealth,
      globalBounceRate: globalBounceRate !== null ? Number(globalBounceRate.toFixed(4)) : null, // e.g. 0.0250 for 2.50%
      domainVerifications: mappedVerifications,
      health: {
        score: domainHealth,
        status: domainHealth !== null 
          ? (domainHealth >= 70 ? 'healthy' : (domainHealth >= 55 ? 'fair' : (domainHealth >= 40 ? 'poor' : 'critical')))
          : 'initializing',
        reputation: reputationScore,
        dns: dnsStatus,
        bounces: {
          hard: hardBounces,
          soft: softBounces,
          spam: spamBounces,
          total: hardBounces + softBounces + spamBounces
        }
      },
      benchmarks: {
        avgLeadScore: globalAvgScore != null ? Number(globalAvgScore.toFixed(2)) : null,
        avgOpenRate: globalOpenRate,
        avgResponseRate: stats.responseRate ?? null,
        marketSentiment: stats.totalLeads > 50 && (stats.responseRate ?? 0) > 10 ? 'positive' : 'neutral'
      },
      sync: {
        status: engineStatus,
        lastSync: integrations.length > 0 ? (lastSyncTimestamp > 0 ? new Date(lastSyncTimestamp).toISOString() : null) : null,
        activeMonitors: monitors.length,
        isAutonomous: isAutonomousMode
      },
      perMailbox: perMailboxStats,
      aiActionLogs: aiLogs,
      reputationTrend: trendData,
      timeSaved: stats.timeSaved || 0
    };

    // Store in cache (5 mins)
    statsCache.set(cacheKey, responseData); // Use .set for NodeCache

    res.json(responseData);
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

/**
 * GET /api/dashboard/stats/previous
 * Get previous period stats for comparison
 */
router.get('/stats/previous', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { integrationId } = req.query;
    const now = new Date();
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const stats = await storage.getDashboardStats(userId, {
      start: sixtyDaysAgo,
      end: thirtyDaysAgo,
      integrationId: integrationId as string
    });

    res.json({
      totalLeads: stats.totalLeads,
      newLeads: stats.newLeads ?? stats.totalLeads,
      activeLeads: stats.activeLeads,
      convertedLeads: stats.convertedLeads,
      messages: stats.totalMessages,
      openRate: stats.openRate,
      responseRate: stats.responseRate,
      closedRevenue: stats.closedRevenue,
    });
  } catch (error) {
    console.error('Previous stats error:', error);
    res.status(500).json({ error: 'Failed to fetch previous stats' });
  }
});

/**
 * GET /api/dashboard/activity
 * Get recent activity feed for dashboard (Audit Trail)
 */
router.get('/activity', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { integrationId, days } = req.query;
    const daysFilter = days ? parseInt(days as string) : 0; // Default to 0 (all time) as requested
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20; // Default to 20 for initial load
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

    const options: any = { integrationId: integrationId as string, limit, offset };

    // If days is 'all' or 0, ignore daysFilter
    if (days !== 'all' && daysFilter > 0) {
      options.daysFilter = daysFilter;
    }

    if (limit) options.limit = limit;

    const auditLogs = await storage.getAuditLogs(userId, options);
    const activities = auditLogs.map(log => ({
      id: log.id,
      type: log.action,
      title: log.action.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      message: log.details?.message || log.action.replace(/_/g, ' '),
      description: log.details?.description || '',
      time: log.createdAt,
      timestamp: log.createdAt,
      leadId: log.leadId,
      metadata: log.details
    }));

    res.json({ activities });
  } catch (error) {
    console.error('[ACTIVITY] Failed to fetch dashboard activity:', error);
    res.status(500).json({ error: 'Failed to fetch activity feed' });
  }
});

/**
 * GET /api/dashboard/ai-actions
 * Get recent AI Action Logs for the autonomous dashboard feed
 */
router.get('/ai-actions', requireAuthOrApiKey, async (req: Request, res: Response) => {
  try {
    const userId = req.session?.userId;
    if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return; }

    const { db } = await import('@shared/lib/db/db.js');
    const { aiActionLogs, leads } = await import('@audnix/shared');
    const { desc, eq, and, sql } = await import('drizzle-orm');

    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const integrationId = req.query.integrationId as string | undefined;

    const conditions = [eq(aiActionLogs.userId, userId)];
    if (integrationId) {
      conditions.push(sql`${leads.integrationId} = ${integrationId}::uuid`);
    }

    const logs = await db.select({
      id: aiActionLogs.id,
      actionType: aiActionLogs.actionType,
      decision: aiActionLogs.decision,
      intentScore: aiActionLogs.intentScore,
      timingScore: aiActionLogs.timingScore,
      confidence: aiActionLogs.confidence,
      reasoning: aiActionLogs.reasoning,
      outcome: aiActionLogs.outcome,
      createdAt: aiActionLogs.createdAt,
      leadName: leads.name,
      leadEmail: leads.email
    })
    .from(aiActionLogs)
    .leftJoin(leads, eq(aiActionLogs.leadId, leads.id))
    .where(and(...conditions))
    .orderBy(desc(aiActionLogs.createdAt))
    .limit(limit)
    .offset(offset);

    res.json(logs);
  } catch (error) {
    console.error('Failed to fetch AI action logs:', error);
    res.status(500).json({ error: 'Failed to fetch AI actions' });
  }
});

/**
 * GET /api/user
 * Get current user (simple alias)
 */
router.get('/user', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const user = await storage.getUserById(userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const onboardingProfile = await storage.getOnboardingProfile(userId);
    const metadata = user.metadata as Record<string, unknown> | null;
    const voiceNotesEnabled = metadata?.voiceNotesEnabled !== false;
    const hasCompletedOnboarding = onboardingProfile?.completed || (metadata?.onboardingCompleted as boolean) || false;

    res.json({
      id: user.id,
      email: user.email,
      username: user.username,
      name: user.name,
      role: user.role || 'member',
      plan: user.plan,
      avatar: user.avatar,
      subscriptionTier: user.subscriptionTier,
      businessName: user.businessName,
      filteredLeadsCount: user.filteredLeadsCount || 0,
      trialExpiresAt: user.trialExpiresAt,
      voiceNotesEnabled,
      createdAt: user.createdAt,
      config: user.config,
      metadata: {
        ...(metadata || {}),
        onboardingCompleted: hasCompletedOnboarding,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

/**
 * GET /api/user/profile
 * Get current user profile (alias for /api/auth/me)
 */
router.get('/user/profile', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const user = await storage.getUserById(userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const onboardingProfile = await storage.getOnboardingProfile(userId);
    const metadata = user.metadata as Record<string, unknown> | null;
    const voiceNotesEnabled = metadata?.voiceNotesEnabled !== false;

    const hasCompletedOnboarding = onboardingProfile?.completed || (metadata?.onboardingCompleted as boolean) || false;

    res.json({
      id: user.id,
      email: user.email,
      username: user.username,
      name: user.name,
      company: user.businessName,
      timezone: user.timezone,
      role: user.role || 'member',
      plan: user.plan,
      avatar: user.avatar,
      subscriptionTier: user.subscriptionTier,
      businessName: user.businessName,
      trialExpiresAt: user.trialExpiresAt,
      voiceNotesEnabled,
      createdAt: user.createdAt,
      config: user.config,
      defaultPaymentLink: user.defaultPaymentLink || '',
      aiStickerFollowupsEnabled: user.aiStickerFollowupsEnabled ?? true,
      // autonomousMode lives inside config JSONB — expose it explicitly so the UI toggle reads correctly
      autonomousMode: !!(user.config as any)?.autonomousMode,
      calendlyAccessToken: user.calendlyAccessToken,
      calendlyUserUri: user.calendlyUserUri,
      calendarLink: user.calendarLink,
      metadata: {
        ...(metadata || {}),
        onboardingCompleted: hasCompletedOnboarding,
        onboardingCelebrated: !!metadata?.onboardingCelebrated,
      },
    });
  } catch (error) {
    console.error('❌ Error in /api/user/profile:', error);
    res.status(500).json({
      error: 'Failed to fetch profile',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * PUT /api/user/voice-settings
 * Update voice notes settings
 */
router.put('/user/voice-settings', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { voiceNotesEnabled } = req.body as { voiceNotesEnabled?: boolean };

    const user = await storage.getUserById(userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const existingMetadata = (user.metadata as Record<string, unknown>) || {};
    await storage.updateUser(userId, {
      metadata: {
        ...existingMetadata,
        voiceNotesEnabled: voiceNotesEnabled === true,
      },
    });

    res.json({
      success: true,
      voiceNotesEnabled: voiceNotesEnabled === true
    });
  } catch (error) {
    console.error('Voice settings error:', error);
    res.status(500).json({ error: 'Failed to update voice settings' });
  }
});

/**
 * POST /api/user/avatar
 * Upload user avatar — tries Supabase/S3 first, falls back to local disk.
 */
router.post('/user/avatar', requireAuthOrApiKey, uploadAvatar.single('avatar'), async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }

    const ext = path.extname(file.originalname) || '.jpg';
    const filename = `${userId}_${Date.now()}${ext}`;

    // Always save locally for reliable serving
    const localDir = path.join(process.cwd(), 'public', 'uploads', 'avatars');
    await fs.mkdir(localDir, { recursive: true });
    const localPath = path.join(localDir, path.basename(filename));
    await fs.writeFile(localPath, file.buffer);
    let avatarUrl = `/uploads/avatars/${path.basename(filename)}`;

    // Also try S3 upload as backup (non-critical)
    uploadToSupabase('avatars', filename, file.buffer).catch((err: any) =>
      console.warn('[Avatar] S3 backup upload failed (non-critical):', err?.message)
    );

    await storage.updateUser(userId, { avatar: avatarUrl });

    const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
    wsSync.notifySettingsUpdated(userId, { profileUpdated: true });

    res.json({ avatar: avatarUrl });
  } catch (error) {
    console.error('[Avatar] Upload error:', error);
    res.status(500).json({ error: 'Failed to upload avatar' });
  }
});

/**
 * PUT /api/user/profile
 * Update user profile including CTA settings
 */
router.put('/user/profile', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { 
      name, username, company, timezone, defaultCtaLink, defaultCtaText, 
      calendarLink, voiceNotesEnabled, config, defaultPaymentLink, 
      aiStickerFollowupsEnabled, offerDescription, offerValue, 
      offerDescription2, offerValue2, doubleOfferEnabled, 
      aiAdjustCopyEnabled, pdfConfidenceThreshold 
    } = req.body;

    const user = await storage.getUserById(userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const existingMetadata = (user.metadata as Record<string, unknown>) || {};
    const updates: Record<string, unknown> = {};

    if (name !== undefined) updates.name = name;
    if (username !== undefined) updates.username = username;
    if (company !== undefined) updates.businessName = company;
    if (timezone !== undefined) updates.timezone = timezone;
    if (defaultPaymentLink !== undefined) (updates as any).defaultPaymentLink = defaultPaymentLink;
    if (aiStickerFollowupsEnabled !== undefined) (updates as any).aiStickerFollowupsEnabled = aiStickerFollowupsEnabled === true;
    if (offerDescription !== undefined) (updates as any).offerDescription = offerDescription;
    if (offerValue !== undefined) (updates as any).offerValue = offerValue;
    if (offerDescription2 !== undefined) (updates as any).offerDescription2 = offerDescription2;
    if (offerValue2 !== undefined) (updates as any).offerValue2 = offerValue2;
    if (doubleOfferEnabled !== undefined) (updates as any).doubleOfferEnabled = doubleOfferEnabled === true;
    if (aiAdjustCopyEnabled !== undefined) (updates as any).aiAdjustCopyEnabled = aiAdjustCopyEnabled === true;
    if (pdfConfidenceThreshold !== undefined) (updates as any).pdfConfidenceThreshold = pdfConfidenceThreshold;

    if (calendarLink !== undefined) updates.calendarLink = calendarLink;

    // Store CTA settings and Voice Settings in metadata
    if (defaultCtaLink !== undefined || defaultCtaText !== undefined || voiceNotesEnabled !== undefined) {
      updates.metadata = {
        ...existingMetadata,
        ...(defaultCtaLink !== undefined && { defaultCtaLink }),
        ...(defaultCtaText !== undefined && { defaultCtaText }),
        ...(voiceNotesEnabled !== undefined && { voiceNotesEnabled: voiceNotesEnabled === true }),
      };
    }

    if (config !== undefined || aiStickerFollowupsEnabled !== undefined) {
      // All JSONB config fields must be merged here — autonomousMode lives in config, not top-level
      const existingConfig = (user.config as any) || {};
      const configPatch: Record<string, unknown> = { ...existingConfig };
      if (config !== undefined) Object.assign(configPatch, config);
      // aiStickerFollowupsEnabled is a real top-level column — handle separately below
      updates.config = configPatch;
    }

    await storage.updateUser(userId, updates);

    res.json({ success: true });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

/**
 * GET /api/dashboard/instagram/media
 * Get user's recent Instagram media for video automation
 */
router.get('/instagram/media', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    // Get Instagram integration
    const integrations = await storage.getIntegrations(userId);
    const igIntegration = integrations.find(i => i.provider === 'instagram' && i.connected);

    if (!igIntegration) {
      // Return empty list if not connected (frontend handles empty state)
      res.json({ media: [] });
      return;
    }

    // Decrypt token
    const decryptedMetaJson = decrypt(igIntegration.encryptedMeta);
    const decryptedMeta = JSON.parse(decryptedMetaJson);
    const accessToken = decryptedMeta.tokens?.access_token;

    if (!accessToken) {
      res.json({ media: [] });
      return;
    }

    // Fetch media
    const oauth = new InstagramOAuth();
    const media = await oauth.getMedia(accessToken, 20);

    res.json({ media });
  } catch (error) {
    console.error('Instagram media fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch media' });
  }
});

/**
 * GET /api/dashboard/analytics/outreach
 * Get daily outreach stats (sent/received) for analytics charts
 */
router.get('/analytics/outreach', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { db } = await import('@shared/lib/db/db.js');
    const { messages } = await import('@audnix/shared');
    const { sql, and, eq, gte } = await import('drizzle-orm');

    const integrationId = req.query.integrationId as string | undefined;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    let messagesWhere = and(
      eq(messages.userId, userId),
      gte(messages.createdAt, thirtyDaysAgo),
      eq(messages.isWarmup, false)
    );
    if (integrationId) {
      messagesWhere = and(messagesWhere, eq(messages.integrationId, integrationId));
    }

    // Group messages by day and direction
    const stats = await db
      .select({
        day: sql<string>`DATE_TRUNC('day', ${messages.createdAt})`,
        direction: messages.direction,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(messages)
      .where(messagesWhere)
      .groupBy(sql`DATE_TRUNC('day', ${messages.createdAt})`, messages.direction)
      .orderBy(sql`DATE_TRUNC('day', ${messages.createdAt})`);

    // Ensure we have a default state even with no messages
    if (stats.length === 0) {
      res.json({
        success: true,
        data: [],
        summary: { totalSent: 0, totalReceived: 0 }
      });
      return;
    }

    // Format for frontend (e.g., Recharts)
    const formattedData = stats.reduce((acc: any[], curr: any) => {
      const dayStr = new Date(curr.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      let existing = acc.find(d => d.name === dayStr);
      if (!existing) {
        existing = { name: dayStr, sent: 0, received: 0 };
        acc.push(existing);
      }
      if (curr.direction === 'outbound') existing.sent += curr.count;
      else if (curr.direction === 'inbound') existing.received += curr.count;
      return acc;
    }, []);

    res.json({
      success: true,
      data: formattedData,
      summary: {
        totalSent: formattedData.reduce((sum: number, d: any) => sum + d.sent, 0),
        totalReceived: formattedData.reduce((sum: number, d: any) => sum + d.received, 0),
      }
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

/**
 * GET /api/dashboard/analytics/full
 * Consistently high-performance consolidated analytics node
 */
router.get('/analytics/full', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId!;
    const range = parseInt(req.query.days as string) || 7;

    const integrationId = req.query.integrationId as string;
    const analytics = await storage.getAnalyticsFull(userId, range, integrationId);

    // Connection mapping
    const integrations = await storage.getIntegrations(userId);
    const customEmail = await storage.getIntegration(userId, 'custom_email');
    const isAnyConnected = integrations.some(i => i.connected) || !!customEmail?.connected;

    res.json({
      ...analytics,
      isAnyConnected
    });
  } catch (error) {
    console.error('Full analytics error:', error);
    res.status(500).json({ error: 'Failed to synchronize intelligent analytics' });
  }
});

/**
 * GET /api/dashboard/integrations/:id/health
 * Get DNS and connection health for a specific integration
 */
router.get('/integrations/:id/health', requireAuthOrApiKey, async (req: Request, res: Response) => {
  try {
    const userId = req.session?.userId!;
    const integrationId = req.params.id;

    const integration = await storage.getIntegration(userId, integrationId);
    if (!integration) return res.status(404).json({ error: 'Integration not found' });

    // Real DNS health lookup
    let spf = false;
    let dkim = false;
    let dmarc = false;

    // Extract domain from integration metadata if applicable
    let domainToCheck = "";
    if (integration.provider === 'gmail' || integration.provider === 'custom_email') {
      try {
        const meta = JSON.parse(decrypt(integration.encryptedMeta));
        const email = meta.user || meta.email;
        if (email && email.includes('@')) {
          domainToCheck = email.split('@')[1];
        }
      } catch (e) {
        // ignore decryption errors for basic health check
      }
    }

    if (domainToCheck) {
      try {
        const txtRecords = await resolveTxt(domainToCheck);
        const flattenedTxt = txtRecords.flat().join(' ').toLowerCase();
        spf = flattenedTxt.includes('v=spf1');
        
        // DMARC check
        try {
          const dmarcTxt = await resolveTxt(`_dmarc.${domainToCheck}`);
          dmarc = dmarcTxt.flat().join(' ').toLowerCase().includes('v=dmarc1');
        } catch (e) { console.warn('[Dashboard] DMARC lookup failed for domain:', (e as Error)?.message); }

        // DKIM: Try common selectors (google, default, selector1, etc.)
        dkim = false;
        const commonSelectors = ['google', 'default', 'selector1', 'dkim', 'mail', 's1', 's2'];
        for (const sel of commonSelectors) {
          try {
            const dkimTxt = await resolveTxt(`${sel}._domainkey.${domainToCheck}`);
            if (dkimTxt.flat().join(' ').toLowerCase().includes('v=dkim1')) {
              dkim = true;
              break;
            }
          } catch (e) { console.warn('[Dashboard] DKIM selector lookup failed:', (e as Error)?.message); }
        }
      } catch (e) {
        console.warn(`DNS lookup failed for ${domainToCheck}:`, e);
      }
    } else {
      // Instagram/Non-email integrations skip DNS checks
      spf = true;
      dkim = true;
      dmarc = true;
    }

    const health = {
      connected: integration.connected,
      lastSync: integration.lastSync,
      dns: {
        spf,
        dkim,
        dmarc,
        tracking: true
      },
      status: integration.connected && spf ? 'healthy' : 'disconnected'
    };

    res.json(health);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch health' });
  }
});

/**
 * GET /api/dashboard/integrations/:id/stats
 * Get performance stats for a specific mailbox
 */
router.get('/integrations/:id/stats', requireAuthOrApiKey, async (req: Request, res: Response) => {
  try {
    const userId = req.session?.userId!;
    const integrationId = req.params.id;

    const stats = await storage.getDashboardStats(userId, { integrationId });
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch integration stats' });
  }
});

/**
 * GET /api/dashboard/ai/status
 * Get health status of AI providers
 */
router.get('/ai/status', requireAuthOrApiKey, async (req: Request, res: Response) => {
    const status = getAIStatus();
    res.json(status);
});

/**
 * POST /api/dashboard/ai/learn-style
 * Manually trigger style learning from past messages
 */
router.post('/ai/learn-style', requireAuthOrApiKey, async (req: Request, res: Response) => {
    try {
        const userId = req.session?.userId!;
        const markers = await learnUserStyle(userId);
        res.json({ success: !!markers, markers });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/dashboard/warmup-status
 * Returns warmup progress for all connected mailboxes
 */
router.get('/warmup-status', requireAuthOrApiKey, async (req: Request, res: Response) => {
    try {
        const userId = req.session?.userId!;
        const filterIntegrationId = req.query.integrationId as string | undefined;
        let integrations = await storage.getIntegrations(userId);
        let emailInts = integrations.filter((i: any) =>
            ['gmail', 'outlook', 'custom_email'].includes(i.provider) && i.connected
        );
        if (filterIntegrationId) {
            emailInts = emailInts.filter((i: any) => i.id === filterIntegrationId);
        }

        const { db } = await import('@shared/lib/db/db.js');
        const { integrations: intSchema, emailTracking, bounceTracker: bounceTrackerTable } = await import('@audnix/shared');
        const { eq, and, gte, sql: sqlFn } = await import('drizzle-orm');

        const PROVIDER_MAX: Record<string, number> = {
            gmail: 100, outlook: 50, custom_email: 80,
        };
        const FULL_WARMUP_DAYS = 14;
        const WARMUP_STAGES = [
            { maxDays: 2, pct: 0.10 },
            { maxDays: 5, pct: 0.25 },
            { maxDays: 10, pct: 0.50 },
            { maxDays: 14, pct: 0.75 },
        ];

        const fourteenDaysAgo = new Date();
        fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

        const mailboxes = await Promise.all(emailInts.map(async (int: any) => {
            const createdAt = int.createdAt ? new Date(int.createdAt) : new Date();
            const daysSinceConnected = Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / (86400000)));
            const providerMax = PROVIDER_MAX[int.provider] || 80;

            let warmupPercent = 100;
            let isWarmingUp = false;
            let dailyLimit = providerMax;
            for (const stage of WARMUP_STAGES) {
                if (daysSinceConnected <= stage.maxDays) {
                    dailyLimit = Math.max(1, Math.round(providerMax * stage.pct));
                    warmupPercent = Math.round(stage.pct * 100);
                    isWarmingUp = true;
                    break;
                }
            }

            // Count sends in last 14 days
            let totalSent = 0;
            let totalBounced = 0;
            let totalOpened = 0;
            try {
                const [sentRow] = await db.select({ count: sqlFn`count(*)::int` })
                    .from(emailTracking)
                    .where(and(
                        eq(emailTracking.integrationId, int.id),
                        gte(emailTracking.createdAt, fourteenDaysAgo)
                    ));
                totalSent = Number(sentRow?.count) || 0;

                const [bounceRow] = await db.select({ count: sqlFn`count(*)::int` })
                    .from(bounceTrackerTable)
                    .where(and(
                        eq(bounceTrackerTable.integrationId, int.id),
                        gte(bounceTrackerTable.createdAt, fourteenDaysAgo)
                    ));
                totalBounced = Number(bounceRow?.count) || 0;

                const [openRow] = await db.select({ count: sqlFn`count(*)::int` })
                    .from(emailTracking)
                    .where(and(
                        eq(emailTracking.integrationId, int.id),
                        sqlFn`${emailTracking.openCount} > 0`,
                        gte(emailTracking.createdAt, fourteenDaysAgo)
                    ));
                totalOpened = Number(openRow?.count) || 0;
            } catch (_) {}

            // Reputation from provider_limits
            const providerLimits = (int.providerLimits || {}) as any;
            let reputationScore = 100;
            for (const key of Object.keys(providerLimits)) {
                if (providerLimits[key]?.reputationScore !== undefined) {
                    reputationScore = providerLimits[key].reputationScore;
                    break;
                }
            }

            return {
                mailboxId: int.id,
                email: int.smtpUser || int.email || 'Unknown',
                provider: int.provider,
                isWarmingUp,
                dailyLimit,
                providerMax,
                daysSinceConnected,
                warmupPercent: isWarmingUp ? warmupPercent : 100,
                reputationScore,
                totalSent,
                totalBounced,
                totalOpened,
                warmupStatus: int.warmupStatus || 'none',
                warmupLimit: int.warmupLimit ?? 5,
            };
        }));

        res.json({ mailboxes });
    } catch (error: any) {
        console.error('[Dashboard] Warmup status error:', error.message);
        res.json({ mailboxes: [] });
    }
});

/**
 * POST /api/warmup/toggle
 * Enable/disable warmup for specific mailboxes
 */
router.post('/warmup/toggle', requireAuthOrApiKey, async (req: Request, res: Response) => {
    try {
        const userId = req.session?.userId!;
        const { mailboxIds, enabled } = req.body;
        if (!Array.isArray(mailboxIds) || mailboxIds.length === 0) {
            res.status(400).json({ error: 'mailboxIds array required' });
            return;
        }

        const newStatus = enabled ? 'active' : 'paused';
        for (const id of mailboxIds) {
            try {
                await storage.updateIntegrationById(id, { warmupStatus: newStatus } as any);
            } catch { }
        }

        try {
            const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
            wsSync.notifyWarmupUpdated(userId, { mailboxIds, status: newStatus });
            wsSync.notifyStatsUpdated(userId);
        } catch { }

        res.json({ success: true, status: newStatus, affectedCount: mailboxIds.length });
    } catch (error: any) {
        console.error('[Warmup] Toggle error:', error.message);
        res.status(500).json({ error: 'Failed to toggle warmup' });
    }
});

/**
 * GET /api/warmup/activity
 * Returns hourly warmup activity for the last 24 hours
 */
router.get('/warmup/activity', requireAuthOrApiKey, async (req: Request, res: Response) => {
    try {
        const userId = req.session?.userId!;
        const mailboxId = req.query.mailboxId as string | undefined;

        const { db } = await import('@shared/lib/db/db.js');
        const { warmupMailboxes, warmupInteractions } = await import('@audnix/shared');
        const { eq, and, gte, sql, inArray } = await import('drizzle-orm');

        let warmupMailboxIds: string[];
        if (mailboxId) {
            const [wm] = await db.select({ id: warmupMailboxes.id })
                .from(warmupMailboxes)
                .where(and(eq(warmupMailboxes.integrationId, mailboxId), eq(warmupMailboxes.userId, userId)));
            if (!wm) { res.json({ hours: [] }); return; }
            warmupMailboxIds = [wm.id];
        } else {
            const wms = await db.select({ id: warmupMailboxes.id })
                .from(warmupMailboxes)
                .where(eq(warmupMailboxes.userId, userId));
            warmupMailboxIds = wms.map((w: any) => w.id);
        }

        if (warmupMailboxIds.length === 0) { res.json({ hours: [] }); return; }

        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const rows = await db.select({
            hour: sql<number>`EXTRACT(HOUR FROM ${warmupInteractions.sentAt})::int`,
            sends: sql<number>`count(*) filter (where ${warmupInteractions.direction} = 'outbound')`,
            opens: sql<number>`count(*) filter (where ${warmupInteractions.direction} = 'outbound' AND ${warmupInteractions.status} = 'delivered')`,
            bounces: sql<number>`count(*) filter (where ${warmupInteractions.status} = 'bounced' OR ${warmupInteractions.status} = 'failed')`,
        })
            .from(warmupInteractions)
            .where(and(
                inArray(warmupInteractions.fromMailboxId, warmupMailboxIds),
                gte(warmupInteractions.sentAt, twentyFourHoursAgo),
            ))
            .groupBy(sql`EXTRACT(HOUR FROM ${warmupInteractions.sentAt})`)
            .orderBy(sql`EXTRACT(HOUR FROM ${warmupInteractions.sentAt})`);

        const hoursMap = new Map<number, { sends: number; opens: number; bounces: number }>();
        for (const row of rows) {
            hoursMap.set(row.hour, {
                sends: Number(row.sends),
                opens: Number(row.opens),
                bounces: Number(row.bounces),
            });
        }

        const hours = Array.from({ length: 24 }, (_, i) => ({
            hour: String(i).padStart(2, '0'),
            sends: hoursMap.get(i)?.sends || 0,
            opens: hoursMap.get(i)?.opens || 0,
            bounces: hoursMap.get(i)?.bounces || 0,
        }));

        res.json({ hours });
    } catch (error: any) {
        console.error('[Warmup] Activity error:', error.message);
        res.json({ hours: [] });
    }
});

export default router;


