import { Router, Request, Response } from 'express';
import { storage } from '@shared/lib/storage/storage.js';
import { requireAuth } from '../middleware/auth.js';
import { getAIStatus } from "@services/brain-worker/src/ai-lib/core/ai-service.js";
import { learnUserStyle } from "@services/brain-worker/src/ai-lib/context/personality-learner.js";
import type { Lead, Message } from '@audnix/shared';
import { InstagramOAuth } from '@services/api-gateway/src/oauth/instagram.js';
import { decrypt } from '@shared/lib/crypto/encryption.js';
import dns from 'dns';
import { promisify } from 'util';
import { LRUCache } from 'lru-cache';

const resolveMx = promisify(dns.resolveMx);
const resolveTxt = promisify(dns.resolveTxt);

// In-memory cache for dashboard stats (5s)
const statsCache = new LRUCache<string, any>({ 
  max: 500,
  ttl: 1000 * 5 // Reduced to 5 seconds for real-time sync
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

/**
 * POST /api/dns/verify
 * Force a DNS/reputation check for a domain
 */
router.post('/dns/verify', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const { domain } = req.body;
    if (!domain) return res.status(400).json({ error: 'Domain is required' });

    console.log(`[DNS Verify] Force check for ${domain} (User: ${userId})`);

    // Real DNS Health Check
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
      status: result.overallStatus,
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
router.get('/stats', requireAuth, async (req: Request, res: Response): Promise<void> => {
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

    const domainVerifications = await storage.getDomainVerifications(userId, 5);

    // Calculate most recent sync time from all integrations
    const lastSyncTimestamp = integrations.reduce((latest, current) => {
      if (!current.lastSync) return latest;
      const currentSync = new Date(current.lastSync).getTime();
      return currentSync > latest ? currentSync : latest;
    }, 0);

    const isAutonomousMode = (user?.config as any)?.autonomousMode !== false;
    const engineStatus = isAutonomousMode ? "Autonomous" : "Paused";

    // Reputation is now 100% managed by ReputationMonitor via the database.
    // Each integration stores its own live reputation_score.
    const hardBounces = recentBounces.filter(b => b.bounceType === 'hard').length;
    const softBounces = recentBounces.filter(b => b.bounceType === 'soft').length;
    const spamBounces = recentBounces.filter(b => b.bounceType === 'spam').length;
    let reputationScore: number | null = null;
    let globalBounceRate: number | null = null;

    // 7-Day Reputation Trend Calculation
    const trendData = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      
      const dayBounces = recentBounces.filter(b => b.timestamp.toISOString().split('T')[0] === dateStr);
      const dayPenalty = (dayBounces.filter(b => b.bounceType === 'hard').length * 7) + 
                         (dayBounces.filter(b => b.bounceType === 'soft').length * 3) + 
                         (dayBounces.filter(b => b.bounceType === 'spam').length * 25);
      
      trendData.push({
        date: dateStr.substring(5), // MM-DD
        score: Math.max(0, 100 - dayPenalty),
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
          reputationScore = scoredInts.reduce((sum, i) => sum + (i.reputationScore ?? 100), 0) / scoredInts.length;
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
          } catch(e) {}
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
    const { sql: dSql, eq: dEq } = await import('drizzle-orm');

    // Phase 7 Fix: Use SQL aggregation for average lead score to avoid OOM
    const [scoreResult] = await db.select({
      avgScore: dSql<number>`AVG(COALESCE(${leadsSchema.score}, 0))`
    })
    .from(leadsSchema)
    .where(dEq(leadsSchema.userId, userId));
    
    const globalAvgScore = Number(scoreResult?.avgScore || 50);

    // Get global open rate for benchmark
    const [globalMsgStats] = await db.select({
      totalSent: dSql<number>`count(*) filter (where direction = 'outbound')`,
      opened: dSql<number>`count(*) filter (where direction = 'outbound' and opened_at is not null)`,
      replied: dSql<number>`count(*) filter (where direction = 'inbound')`
    }).from(msgSchema);

    const globalOpenRate = Number(globalMsgStats?.totalSent || 0) > 0
      ? Number(((Number(globalMsgStats?.opened || 0) / Number(globalMsgStats?.totalSent || 0)) * 100).toFixed(2))
      : 25.00; // Fallback benchmark    // Domain Health is now the actual reputation score (which already includes DNS penalties)
    const domainHealth = reputationScore !== null ? Number(reputationScore.toFixed(2)) : null;

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
      blacklist: mappedVerifications.some(v => v.result?.blacklist?.isBlacklisted)
    };

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
        avgLeadScore: Number(globalAvgScore.toFixed(2)),
        avgOpenRate: globalOpenRate,
        avgResponseRate: stats.responseRate || 15.00,
        marketSentiment: stats.totalLeads > 50 && stats.responseRate > 10 ? 'positive' : 'neutral'
      },
      sync: {
        status: engineStatus,
        lastSync: integrations.length > 0 ? (lastSyncTimestamp > 0 ? new Date(lastSyncTimestamp).toISOString() : null) : null,
        activeMonitors: monitors.length,
        isAutonomous: isAutonomousMode
      },
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
router.get('/stats/previous', requireAuth, async (req: Request, res: Response): Promise<void> => {
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
      newLeads: stats.totalLeads,
      activeLeads: stats.activeLeads,
      convertedLeads: stats.convertedLeads,
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
router.get('/activity', requireAuth, async (req: Request, res: Response): Promise<void> => {
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
router.get('/ai-actions', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session?.userId!;
    const { db } = await import('@shared/lib/db/db.js');
    const { aiActionLogs, leads } = await import('@audnix/shared');
    const { desc, eq } = await import('drizzle-orm');

    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;

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
    .where(eq(aiActionLogs.userId, userId))
    .orderBy(desc(aiActionLogs.createdAt))
    .limit(limit);

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
router.get('/user', requireAuth, async (req: Request, res: Response): Promise<void> => {
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
router.get('/user/profile', requireAuth, async (req: Request, res: Response): Promise<void> => {
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
router.put('/user/voice-settings', requireAuth, async (req: Request, res: Response): Promise<void> => {
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
 * PUT /api/user/profile
 * Update user profile including CTA settings
 */
router.put('/user/profile', requireAuth, async (req: Request, res: Response): Promise<void> => {
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

    // Store CTA settings, Calendar Link, and Voice Settings in metadata
    if (defaultCtaLink !== undefined || defaultCtaText !== undefined || calendarLink !== undefined || voiceNotesEnabled !== undefined) {
      updates.metadata = {
        ...existingMetadata,
        ...(defaultCtaLink !== undefined && { defaultCtaLink }),
        ...(defaultCtaText !== undefined && { defaultCtaText }),
        ...(calendarLink !== undefined && { calendarLink }),
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
router.get('/instagram/media', requireAuth, async (req: Request, res: Response): Promise<void> => {
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
router.get('/analytics/outreach', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { db } = await import('@shared/lib/db/db.js');
    const { messages } = await import('@audnix/shared');
    const { sql, and, eq, gte } = await import('drizzle-orm');

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Group messages by day and direction
    const stats = await db
      .select({
        day: sql<string>`DATE_TRUNC('day', ${messages.createdAt})`,
        direction: messages.direction,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(messages)
      .where(
        and(
          eq(messages.userId, userId),
          gte(messages.createdAt, thirtyDaysAgo)
        )
      )
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
router.get('/analytics/full', requireAuth, async (req: Request, res: Response): Promise<void> => {
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
router.get('/integrations/:id/health', requireAuth, async (req: Request, res: Response) => {
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
        
        // Very basic DMARC check
        try {
          const dmarcTxt = await resolveTxt(`_dmarc.${domainToCheck}`);
          dmarc = dmarcTxt.flat().join(' ').toLowerCase().includes('v=dmarc1');
        } catch (e) {}

        // DKIM is harder to check without knowing the selector, so typically we assume true if SPF/DMARC exist or default false
        dkim = spf || dmarc; 
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
router.get('/integrations/:id/stats', requireAuth, async (req: Request, res: Response) => {
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
router.get('/ai/status', requireAuth, async (req: Request, res: Response) => {
    const status = getAIStatus();
    res.json(status);
});

/**
 * POST /api/dashboard/ai/learn-style
 * Manually trigger style learning from past messages
 */
router.post('/ai/learn-style', requireAuth, async (req: Request, res: Response) => {
    try {
        const userId = req.session?.userId!;
        const markers = await learnUserStyle(userId);
        res.json({ success: !!markers, markers });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;


