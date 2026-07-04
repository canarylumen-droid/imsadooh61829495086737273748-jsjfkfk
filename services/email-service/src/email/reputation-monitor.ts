import { db } from '@shared/lib/db/db.js';
import { integrations, bounceTracker, domainVerifications } from '@audnix/shared';
import { eq, and, sql, gte, desc } from 'drizzle-orm';
import { decrypt } from '@shared/lib/crypto/encryption.js';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';
import { pubsubService } from '@shared/lib/realtime/pubsub-service.js';
import { getRedisClient } from '@shared/lib/redis/redis.js';
import { promises as dns } from 'dns';

// No local checkDNSBL needed, we use the results from verifyDomainDns in the database

/**
 * Calculates a 0-100 reputation score mapping bounces to penalty weights
 * and updates the mailbox / integration
 */
export async function calculateReputationScore(integrationId: string): Promise<number> {
  const mailboxMatch = await db.select().from(integrations).where(eq(integrations.id, integrationId));
  if (mailboxMatch.length === 0) return 50;
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
    const emailStr = meta.smtp_user || meta.smtpUser || meta.user || meta.email || mailbox.accountType || (mailbox as any).email || '';
    if (emailStr && emailStr.includes('@')) {
      domain = emailStr.split('@')[1];
    }
  } catch (e) {
    console.warn(`[Reputation Monitor] Could not decrypt meta for mailbox ${mailbox.id}`);
  }

  if (domain) {
    const [latestDns] = await db.select()
      .from(domainVerifications)
      .where(and(eq(domainVerifications.userId, mailbox.userId), eq(domainVerifications.domain, domain)))
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
    // Google Postmaster standard: keep bounce rate < 0.3%. Penalize after 0.5%.
    if (rawBounceRate > 0.5) {
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
  const last24hBounces = recentBounces.filter((b: any) => new Date(b.createdAt) > oneDayAgo);

  if (last24hBounces.length === 0 && stats.openRate > 20 && stats.totalMessages > 5) {
    score += 15; // Fast recovery boost
    console.log(`🚀 [Reputation Monitor] Fast Recovery Boost (+15) for mailbox ${mailbox.id} due to high engagement and 0 bounces.`);
  }

  // Recovery bonus: +2 point per 12 hours of clean sending (max +40)
  const recoveryBonus = Math.min(40, Math.floor(hoursSinceLastBounce / 6));
  score += recoveryBonus;

  if (score < 0) score = 0;
  if (score > 100) score = 100;

  const currentSpamRisk = (100 - score) / 100; // 0.0 to 1.0

  // ── Phase 2: OUTREACH PROTECT — Initial-Only Throttle + Auto-Recovery ──────
  // Follow-ups and replies are NEVER throttled. Only initial cold outreach is.
  // Warmup is increased during reputation repair to accelerate recovery.

  let healthLevel: 'healthy' | 'cautious' | 'poor' | 'critical' = 'healthy';
  let newInitialLimit = mailbox.initialOutreachLimit ?? 50;
  let newWarmupLimit = mailbox.warmupLimit ?? 5;
  const originalLimit = mailbox.originalDailyLimit ?? newInitialLimit;

  // Calculate bounce & spam rates for the last 24h window (reuse existing oneDayAgo / last24hBounces)
  const last24hHardBounces = last24hBounces.filter((b: any) => b.bounceType === 'hard').length;
  const last24hSpam = last24hBounces.filter((b: any) => b.bounceType === 'spam').length;
  const last24hTotal = stats.totalMessages ?? 0; // Approximation for 24h window

  const hardBounceRate24h = last24hTotal > 0 ? (last24hHardBounces / last24hTotal) * 100 : 0;
  const spamRate24h = last24hTotal > 0 ? (last24hSpam / last24hTotal) * 100 : 0;

  const isThrottled = mailbox.throttleUntil && new Date(mailbox.throttleUntil) > new Date();
  const throttleExpired = mailbox.throttleUntil && new Date(mailbox.throttleUntil) <= new Date();

  // 4-TIER REPUTATION SYSTEM (only affects initial outreach, never follow-ups)
  if (score < 40) {
    healthLevel = 'poor';
    if (!isThrottled) {
      // Initial-Only Throttle-Down: -5 initial outreach / +5 warmup repair
      if (!mailbox.originalDailyLimit) {
        await db.update(integrations).set({ originalDailyLimit: newInitialLimit }).where(eq(integrations.id, integrationId));
      }
      newInitialLimit = Math.max(5, newInitialLimit - 5);
      newWarmupLimit = Math.min(10, newWarmupLimit + 5);
      const throttleDays = 3 + Math.floor(Math.random() * 3); // 3–5 days
      const throttleUntil = new Date(Date.now() + throttleDays * 24 * 60 * 60 * 1000);
      await db.update(integrations).set({ throttleUntil, mailboxPauseUntil: throttleUntil, updatedAt: new Date() }).where(eq(integrations.id, integrationId));
      console.warn(`🔴 [Reputation Monitor] Mailbox ${mailbox.id} CRITICAL (${score}/100). Initial outreach → ${newInitialLimit}/day, Warmup → ${newWarmupLimit}/day. Cool-off: ${throttleDays}d.`);
    }
  } else if (score < 65) {
    healthLevel = 'poor';
    if (!isThrottled) {
      if (!mailbox.originalDailyLimit) {
        await db.update(integrations).set({ originalDailyLimit: newInitialLimit }).where(eq(integrations.id, integrationId));
      }
      newInitialLimit = Math.max(10, Math.floor(newInitialLimit * 0.5));
      newWarmupLimit = Math.min(10, newWarmupLimit + 5);
      const throttleDays = 3 + Math.floor(Math.random() * 3);
      const throttleUntil = new Date(Date.now() + throttleDays * 24 * 60 * 60 * 1000);
      await db.update(integrations).set({ throttleUntil, mailboxPauseUntil: throttleUntil, updatedAt: new Date() }).where(eq(integrations.id, integrationId));
      console.warn(`🟠 [Reputation Monitor] Mailbox ${mailbox.id} POOR (${score}/100). Initial outreach → ${newInitialLimit}/day, Warmup → ${newWarmupLimit}/day. Cool-off: ${throttleDays}d.`);
    }
  } else if (score < 85) {
    healthLevel = 'cautious';
    if (!isThrottled) {
      if (!mailbox.originalDailyLimit) {
        await db.update(integrations).set({ originalDailyLimit: newInitialLimit }).where(eq(integrations.id, integrationId));
      }
      newInitialLimit = Math.max(15, Math.floor(newInitialLimit * 0.8));
      newWarmupLimit = Math.min(10, newWarmupLimit + 3);
      const throttleDays = 3 + Math.floor(Math.random() * 2);
      const throttleUntil = new Date(Date.now() + throttleDays * 24 * 60 * 60 * 1000);
      await db.update(integrations).set({ throttleUntil, updatedAt: new Date() }).where(eq(integrations.id, integrationId));
      console.warn(`🟡 [Reputation Monitor] Mailbox ${mailbox.id} CAUTIOUS (${score}/100). Initial outreach → ${newInitialLimit}/day, Warmup → ${newWarmupLimit}/day. Cool-off: ${throttleDays}d.`);
    }
  } else {
    // 🟢 Healthy
    healthLevel = 'healthy';
    if (isThrottled || throttleExpired) {
      // Auto-Recovery: gradually throttle back up (+5 initial / -5 warmup per cycle)
      const nextInitial = Math.min(originalLimit, newInitialLimit + 5);
      const nextWarmup = Math.max(5, newWarmupLimit - 5);
      newInitialLimit = nextInitial;
      newWarmupLimit = nextWarmup;
      if (newInitialLimit >= originalLimit) {
        // Fully recovered — clear throttle state
        await db.update(integrations).set({
          throttleUntil: null,
          originalDailyLimit: null,
          updatedAt: new Date()
        }).where(eq(integrations.id, integrationId));
        console.log(`🟢 [Reputation Monitor] Mailbox ${mailbox.id} FULLY RECOVERED. Initial outreach restored to ${originalLimit}/day.`);
      } else {
        console.log(`🟢 [Reputation Monitor] Mailbox ${mailbox.id} RECOVERING. Initial outreach → ${newInitialLimit}/day, Warmup → ${newWarmupLimit}/day.`);
      }
    } else {
      // Healthy and not throttled — gently grow if under cap
      if (newInitialLimit < originalLimit && newInitialLimit < 50) {
        newInitialLimit = Math.min(50, newInitialLimit + 2);
      }
    }
  }

  // ── Dead IP Revival: dynamic warmup cap ──────────────────────────────────
  // When reputation is healthy, warmup stays conservative (10% of daily cap).
  // When reputation is poor/critical, the cap is raised significantly so warmup
  // can flood the ISP with natural engagement signals and ring the IP back to life.
  // This directly enables the warmup-service reputation-recovery engine.
  const effectiveDailyLimit = mailbox.dailyLimit || 50;
  let warmupCapPct = 0.1;
  if (score < 40) {
    warmupCapPct = 0.6; // critical — aggressive recovery, up to 60%
  } else if (score < 65) {
    warmupCapPct = 0.5; // poor — elevated recovery, up to 50%
  } else if (score < 85) {
    warmupCapPct = 0.3; // cautious — moderate boost, up to 30%
  }
  const maxWarmupPct = Math.max(3, Math.ceil(effectiveDailyLimit * warmupCapPct));
  if (newWarmupLimit > maxWarmupPct) {
    console.log(`📊 [Reputation Monitor] Mailbox ${mailbox.id} warmup capped at ${Math.round(warmupCapPct * 100)}% of daily limit: ${newWarmupLimit} → ${maxWarmupPct}`);
    newWarmupLimit = maxWarmupPct;
  }

  // Enforce safety ceiling: initial + warmup ≤ 150 (raised from 50 to allow recovery)
  // During aggressive recovery, we need headroom for warmup volume
  const safetyCeiling = score < 40 ? 150 : score < 65 ? 100 : 50;
  if (newInitialLimit + newWarmupLimit > safetyCeiling) {
    const overflow = (newInitialLimit + newWarmupLimit) - safetyCeiling;
    newInitialLimit = Math.max(5, newInitialLimit - overflow);
  }

  await db.update(integrations).set({
    reputationScore: score,
    healthLevel,
    spamRiskScore: currentSpamRisk,
    initialOutreachLimit: newInitialLimit,
    warmupLimit: newWarmupLimit,
    dailyLimit: newInitialLimit + newWarmupLimit,
    updatedAt: new Date()
  }).where(eq(integrations.id, integrationId));

  // Update Redis reputation pause flag for KumoMTA Lua hook
  try {
    const redis = await getRedisClient();
    if (redis) {
      if (score < 85) {
        await redis.set(`rep:paused:${integrationId}`, 'true', { EX: 3600 });
      } else {
        await redis.del(`rep:paused:${integrationId}`);
      }
    }
  } catch { /* non-critical */ }

  // Notify UI
  wsSync.broadcastToUser(mailbox.userId, { 
    type: 'reputation_updated', 
    payload: { integrationId, score, initialOutreachLimit: newInitialLimit, warmupLimit: newWarmupLimit } 
  });
  wsSync.notifyStatsUpdated(mailbox.userId);

  // Notify System (Real-time Pub/Sub)
  await pubsubService.publishEvent('reputation_changed', {
    integrationId,
    score,
    userId: mailbox.userId,
    initialOutreachLimit: newInitialLimit,
    warmupLimit: newWarmupLimit
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

export async function resetAllProviderCounters(): Promise<void> {
  const { resetProviderDailyCounters } = await import('./provider-reputation.js');
  await resetProviderDailyCounters();
}






