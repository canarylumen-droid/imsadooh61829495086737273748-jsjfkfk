import { db } from '@shared/lib/db/db.js';
import { integrations, bounceTracker, domainVerifications } from '@audnix/shared';
import { eq, and, sql, gte, desc } from 'drizzle-orm';
import { decrypt } from '@shared/lib/crypto/encryption.js';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';
import { pubsubService } from '@shared/lib/realtime/pubsub-service.js';
import { promises as dns } from 'dns';

// No local checkDNSBL needed, we use the results from verifyDomainDns in the database

/**
 * Calculates a 0-100 reputation score mapping bounces to penalty weights
 * and updates the mailbox / integration
 */
export async function calculateReputationScore(integrationId: string): Promise<number> {
  const mailboxMatch = await db.select().from(integrations).where(eq(integrations.id, integrationId));
  if (mailboxMatch.length === 0) return 100;
  const mailbox = mailboxMatch[0];

  let score = 100;

  // 1. Check bounces in last 14 days (Extended window for smoothing)
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  const recentBounces = await db.select().from(bounceTracker)
    .where(
      and(
        eq(bounceTracker.integrationId, integrationId),
        gte(bounceTracker.createdAt, fourteenDaysAgo)
      )
    );

  // Time-Weighted Decay: Bounces from today count more than bounces from 13 days ago
  let weightedBounceScore = 0;
  let hardBounces = 0;
  let softBounces = 0;
  let spamComplaints = 0;

  for (const bounce of recentBounces) {
    const daysOld = (Date.now() - new Date(bounce.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    const weight = Math.max(0.2, 1 - (daysOld / 14)); // Linear decay from 1.0 to 0.2
    
    if (bounce.bounceType === 'hard') {
      weightedBounceScore += (7 * weight);
      hardBounces++;
    } else if (bounce.bounceType === 'soft') {
      weightedBounceScore += (3 * weight);
      softBounces++;
    } else if (bounce.bounceType === 'spam') {
      weightedBounceScore += (25 * weight);
      spamComplaints++;
    }
  }

  // RECOVERY LOGIC: Check if mailbox was healthy recently
  const lastBounce = recentBounces.length > 0 
    ? Math.max(...recentBounces.map((b: any) => new Date(b.createdAt).getTime()))
    : 0;
  
  const hoursSinceLastBounce = lastBounce > 0 
    ? (Date.now() - lastBounce) / (1000 * 60 * 60)
    : 336; // Max 14 days

  // Apply Weighted Penalty
  score -= Number(weightedBounceScore.toFixed(2));

  // 1.5 DNS Health Check Penalty (Unified Source of Truth)
  let domain = '';
  try {
    const meta = JSON.parse(decrypt(mailbox.encryptedMeta));
    const emailStr = meta.user || meta.email || (mailbox as any).email || '';
    if (emailStr && emailStr.includes('@')) {
      domain = emailStr.split('@')[1];
    }
  } catch (e) {
    console.warn(`[Reputation Monitor] Could not decrypt meta for mailbox ${mailbox.id}`);
  }

  if (domain) {
    const [latestDns] = await db.select()
      .from(domainVerifications)
      .where(eq(domainVerifications.domain, domain))
      .orderBy(desc(domainVerifications.createdAt))
      .limit(1);

    if (latestDns) {
      const result = latestDns.verificationResult as any;
      if (result) {
        if (result.blacklist?.isBlacklisted) {
          score -= 60; // Fatal hit
          console.log(`⚠️ [Reputation Monitor] Mailbox ${mailbox.id} penalty: Domain/IP is Blacklisted (-60)`);
        }
        if (!result.spf?.found || !result.spf?.valid) {
          score -= 40; // Critical industry standard
          console.log(`⚠️ [Reputation Monitor] Mailbox ${mailbox.id} penalty: FAILED SPF (-40)`);
        }
        if (!result.dkim?.found || !result.dkim?.valid) {
          score -= 45; // Critical industry standard (DKIM is now primary for Google/Yahoo)
          console.log(`⚠️ [Reputation Monitor] Mailbox ${mailbox.id} penalty: FAILED DKIM (-45)`);
        }
        if (!result.dmarc?.found || !result.dmarc?.valid) {
          score -= 30; // 2024 compliance requirement
          console.log(`⚠️ [Reputation Monitor] Mailbox ${mailbox.id} penalty: FAILED DMARC (-30)`);
        }
        if (result.ptr && (!result.ptr.found || !result.ptr.valid)) {
          score -= 25; // Critical for B2B deliverability
          console.log(`⚠️ [Reputation Monitor] Mailbox ${mailbox.id} penalty: FAILED PTR (-25)`);
        }
      }
    }
  }

  const { storage } = await import('@shared/lib/storage/storage.js');
  const stats = await storage.getDashboardStats(mailbox.userId, { integrationId });
  
  if (stats.totalMessages > 30 && stats.openRate < 12) {
    const spamPenalty = 40; // Heavy hit
    score -= spamPenalty;
    console.log(`⚠️ [Reputation Monitor] Mailbox ${mailbox.id} penalty: High likelihood of SPAM folder placement (Open Rate: ${stats.openRate.toFixed(2)}%) -> -${spamPenalty}`);
  }

  // 1.7 Bounce Rate Penalty (Dampened for low volume)
  if (stats.totalMessages > 15) {
    const rawBounceRate = (hardBounces / stats.totalMessages) * 100;
    // Industry standard is < 2%. We penalize exponentially after 3%.
    if (rawBounceRate > 3) {
      // Dampening factor: small bounces on low volume are less lethal
      const volumeSmoothing = Math.min(1.0, stats.totalMessages / 50);
      const bouncePenalty = Math.min(60, (Math.pow(rawBounceRate, 1.2) * 2) * volumeSmoothing);
      score -= Number(bouncePenalty.toFixed(2));
      console.log(`⚠️ [Reputation Monitor] Mailbox ${mailbox.id} penalty: Dampened Bounce Rate (${rawBounceRate.toFixed(2)}%) -> -${bouncePenalty.toFixed(2)}`);
    }
  }

  // 1.8 Fast Recovery Boost: Check last 24h performance
  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);
  const last24hBounces = recentBounces.filter((b: any) => new Date(b.createdAt) > oneDayAgo).length;
  
  if (last24hBounces === 0 && stats.openRate > 20 && stats.totalMessages > 5) {
    score += 15; // Fast recovery boost
    console.log(`🚀 [Reputation Monitor] Fast Recovery Boost (+15) for mailbox ${mailbox.id} due to high engagement and 0 bounces.`);
  }

  // Recovery bonus: +2 point per 12 hours of clean sending (max +40)
  const recoveryBonus = Math.min(40, Math.floor(hoursSinceLastBounce / 6));
  score += recoveryBonus;

  if (score < 0) score = 0;
  if (score > 100) score = 100;

  const currentSpamRisk = (100 - score) / 100; // 0.0 to 1.0

  let newDailyLimit = mailbox.dailyLimit || 50;
  let newWarmupStatus = mailbox.warmupStatus || 'active';
  let healthLevel: 'healthy' | 'cautious' | 'poor' | 'critical' = 'healthy';
  let gracefulDailyLimit: number | null = null;
  // 4-TIER PRECISE REPUTATION SYSTEM (Advisory Only - No Pausing)
  const isNewMailbox = (stats.totalMessages ?? 0) < 10;

  if (score < 40) {
    // 🔴 Critical: Reputation below 40% -> Action: Strict Throttle but NOT Paused
    healthLevel = 'poor';
    newWarmupStatus = 'active'; 
    gracefulDailyLimit = isNewMailbox ? null : 10; // Extreme throttle (bypassed if new)
    console.warn(`🔴 [Reputation Monitor] Mailbox ${mailbox.id} is CRITICAL (${score}/100). Throttling to 10/day.`);
  } else if (score < 65) {
    // 🟠 Poor: Reputation below 65% -> 50% Throttling
    healthLevel = 'poor';
    gracefulDailyLimit = isNewMailbox ? null : Math.max(15, Math.floor(newDailyLimit * 0.5));
    console.warn(`🟠 [Reputation Monitor] Mailbox ${mailbox.id} is POOR: Throttling to 50% (${gracefulDailyLimit}) due to reputation dip (${score}/100).`);
  } else if (score < 85) {
    // 🟡 Cautious: Reputation below 85% -> 80% Throttling
    healthLevel = 'cautious';
    gracefulDailyLimit = isNewMailbox ? null : Math.max(25, Math.floor(newDailyLimit * 0.8));
    console.warn(`🟡 [Reputation Monitor] Mailbox ${mailbox.id} is CAUTIOUS: Throttling to 80% (${gracefulDailyLimit}) due to reputation dip (${score}/100).`);
  } else {
    // 🟢 Healthy: Normal operation
    healthLevel = 'healthy';
    if (newDailyLimit < 500 && newWarmupStatus !== 'paused') {
      const increment = Math.max(20, Math.floor(newDailyLimit * 0.15));
      newDailyLimit = Math.min(500, newDailyLimit + increment);
    }
  }

  // Recovery: Ensure warmupStatus remains active if it was accidentally paused
  if (newWarmupStatus === 'paused') {
    newWarmupStatus = 'active';
  }

  await db.update(integrations).set({
    reputationScore: score,
    healthLevel,
    gracefulDailyLimit,
    spamRiskScore: currentSpamRisk,
    warmupStatus: newWarmupStatus as any,
    dailyLimit: newDailyLimit,
    updatedAt: new Date()
  }).where(eq(integrations.id, integrationId));

  // Notify UI
  wsSync.broadcastToUser(mailbox.userId, { 
    type: 'reputation_updated', 
    payload: { integrationId, score, status: newWarmupStatus } 
  });
  wsSync.notifyStatsUpdated(mailbox.userId);

  // Notify System (Real-time Pub/Sub)
  await pubsubService.publishEvent('reputation_changed', {
    integrationId,
    score,
    userId: mailbox.userId,
    status: newWarmupStatus
  });

  return score;
}

/**
 * Triggers an immediate reputation check for a specific integration.
 * Used for real-time events like bounces or manual refreshes.
 */
export async function triggerImmediateReputationCheck(integrationId: string) {
  console.log(`🚀 [Reputation] Triggering immediate real-time check for ${integrationId}`);
  return await calculateReputationScore(integrationId);
}

/**
 * Sweeps all active connected mailboxes natively to re-score
 */
export async function checkReputationForAllMailboxes() {
  const activeMailboxes = await db.select().from(integrations).where(
    sql`provider IN ('gmail', 'outlook', 'custom_email') AND connected = true`
  );

  for (const mailbox of activeMailboxes) {
    try {
      await calculateReputationScore(mailbox.id);
    } catch (e) {
      console.error(`Failed to calculate reputation for ${mailbox.id}`, e);
    }
  }
}






