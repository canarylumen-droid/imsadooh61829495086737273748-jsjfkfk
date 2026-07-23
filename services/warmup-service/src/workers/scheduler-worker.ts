/**
 * Scheduler Worker
 * 24/7 loop: enrollment, pool health, thread creation, spam rescue, daily reset.
 */

import crypto from 'crypto';
import { db } from '../db/warmup-db.js';
import { eq, and, or, sql, isNotNull, inArray } from 'drizzle-orm';
import { warmupMailboxes, warmupThreads, warmupInteractions, integrations } from '@audnix/shared';
import { WARMUP_CONFIG, getRampLimit } from '../config/warmup-config.js';
import { enrollmentEngine } from '../engine/enrollment-engine.js';
import { poolHealthMonitor } from '../engine/pool-health-monitor.js';
import { domainClusterEngine } from '../engine/domain-cluster.js';
import { anchorEngine } from '../engine/anchor-engine.js';
import { seedFleetManager } from '../engine/seed-fleet-manager.js';
import { pairingEngine } from '../lib/pairing-engine.js';
import { threadManager } from '../lib/thread-manager.js';
import { warmupInboundQueue } from '../queues/warmup-queues.js';
import { reputationRecovery } from '../engine/reputation-recovery.js';
import { scanAllActiveSentFolders } from '../lib/sent-folder-scanner.js';

export class WarmupScheduler {
  private intervals: NodeJS.Timeout[] = [];
  private isRunning = false;

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    console.log('[Warmup][Scheduler] Starting 24/7 scheduler...');

    // Every 5 min: enrollment scan
    this.intervals.push(
      setInterval(() => enrollmentEngine.scan(), WARMUP_CONFIG.ENROLLMENT_SCAN_INTERVAL_MS)
    );

    // Every 5 min: pool health monitor
    this.intervals.push(
      setInterval(
        () => poolHealthMonitor.evaluate(),
        WARMUP_CONFIG.POOL_HEALTH_INTERVAL_MS
      )
    );

    // Every 5 min: domain cluster scan
    this.intervals.push(
      setInterval(
        () => domainClusterEngine.scanAndCluster(),
        WARMUP_CONFIG.DOMAIN_CLUSTER_SCAN_INTERVAL_MS
      )
    );

    // Every 10 min: anchor rebalancing
    this.intervals.push(
      setInterval(
        () => anchorEngine.rebalanceAll(),
        WARMUP_CONFIG.ANCHOR_REBALANCE_INTERVAL_MS
      )
    );

    // Every 5 min: reputation recovery scan — detects dead IPs and boosts warmup
    this.intervals.push(
      setInterval(
        () => reputationRecovery.evaluateAll(),
        WARMUP_CONFIG.RECOVERY_SCAN_INTERVAL_MS
      )
    );

    // Every 30 min: spam rescue sweep
    this.intervals.push(
      setInterval(() => {
        warmupInboundQueue.add('spam-rescue', {}, { delay: 0 });
      }, WARMUP_CONFIG.SPAM_RESCUE_INTERVAL_MS)
    );

    // Every 1 min: thread creation scheduler
    this.intervals.push(
      setInterval(() => this.scheduleNewThreads(), WARMUP_CONFIG.THREAD_SCHEDULER_INTERVAL_MS)
    );

    // Every 2 min: inbox sweep for all active mailboxes
    this.intervals.push(
      setInterval(() => this.scheduleInboxSweeps(), WARMUP_CONFIG.INBOX_SWEEP_INTERVAL_MS)
    );

    // Every 60 min: sent folder scan to refresh user subjects/templates
    this.intervals.push(
      setInterval(() => {
        scanAllActiveSentFolders().catch((err: any) =>
          console.warn('[Warmup][Scheduler] Sent folder scan failed:', err.message)
        );
      }, 60 * 60 * 1000)
    );

    // Daily at 00:00 UTC: reset counters
    const msUntilMidnight = this.getMsUntilMidnightUTC();
    setTimeout(() => {
      this.resetDailyCounters();
      this.scheduleNextReset();
    }, msUntilMidnight);

    // [CRITICAL] On startup, reset any counters that weren't reset since last midnight
    // (handles server restarts, crashes, or deploys that miss the midnight window)
    await this.resetDailyCountersIfStale();

    // [CRITICAL] On startup, unpause all mailboxes that were auto-paused (not user-paused).
    // Post-restart evaluation scans will re-pause any that should still be paused.
    // This prevents warmup from staying stuck in 'paused' after a deploy/crash.
    await this.startupUnpause();

    // Run one-off initial scans
    enrollmentEngine.scan();
    domainClusterEngine.scanAndCluster();
    anchorEngine.rebalanceAll();
    poolHealthMonitor.evaluate();
    reputationRecovery.evaluateAll();
  }

  private scheduleNextReset() {
    const msUntilMidnight = this.getMsUntilMidnightUTC();
    setTimeout(() => {
      this.resetDailyCounters();
      this.scheduleNextReset();
    }, msUntilMidnight);
  }

  stop() {
    this.isRunning = false;
    for (const interval of this.intervals) {
      clearInterval(interval);
    }
    this.intervals = [];
    console.log('[Warmup][Scheduler] Stopped.');
  }

  private async scheduleNewThreads() {
    const BATCH_SIZE = 100;
    let offset = 0;

    const integrationIds: string[] = [];
    const allMailboxes: Array<typeof warmupMailboxes.$inferSelect> = [];

    while (true) {
      const batch = await db
        .select()
        .from(warmupMailboxes)
        .where(eq(warmupMailboxes.status, 'active'))
        .limit(BATCH_SIZE)
        .offset(offset);

      if (batch.length === 0) break;
      allMailboxes.push(...batch);
      for (const mb of batch) {
        if (mb.integrationId) integrationIds.push(mb.integrationId);
      }
      offset += BATCH_SIZE;

      if (allMailboxes.length >= 1000) {
        console.log(`[Warmup][Scheduler] Found ${allMailboxes.length}+ active mailboxes — processing in batches of ${BATCH_SIZE}`);
      }
    }

    if (allMailboxes.length === 0) return;

    const uniqueIntegrationIds = [...new Set(integrationIds)];

    // Batch fetch integration -> userId mapping and active campaign send volumes
    const integrationUsers = uniqueIntegrationIds.length > 0
      ? await db
          .select({ id: integrations.id, userId: integrations.userId, warmupLimit: integrations.warmupLimit })
          .from(integrations)
          .where(inArray(integrations.id, uniqueIntegrationIds))
      : [];
    const integrationMap = new Map(integrationUsers.map(i => [i.id, { userId: i.userId, warmupLimit: i.warmupLimit ?? WARMUP_CONFIG.DAILY_SENT_LIMIT }]));
    const userIds = [...new Set(integrationUsers.map(i => i.userId).filter(Boolean))] as string[];

    // Query active campaign daily send volumes per user
    const campaignVolumes = userIds.length > 0
      ? await db.execute(sql`
          SELECT u.id AS user_id, COALESCE(SUM((c.config->>'dailyLimit')::int), 0) AS total_daily
          FROM users u
          JOIN outreach_campaigns c ON c.user_id = u.id AND c.status = 'active'
          WHERE u.id = ANY(ARRAY[${sql.join(userIds.map(id => sql`${id}::uuid`), sql`, `)}])
          GROUP BY u.id
        `)
      : { rows: [] };
    const campaignVolumeMap = new Map((campaignVolumes.rows as any[]).map((r: any) => [r.user_id, parseInt(r.total_daily) || 0]));

    const now = new Date();
    const currentHour = now.getUTCHours();

    for (const mb of allMailboxes) {
      const isSeed = mb.anchorRole === 'seed';

      // ── CAP LIMIT RESOLUTION ─────────────────────────────────────────
      // Resolve the mailbox's cap limit from warmupMailboxes.dailyLimit, 
      // integrations.warmupLimit, or the default DAILY_SENT_LIMIT.
      // capLimit = the user's configured mailbox cap (default 50 from integrations.dailyLimit).
      let capLimit = 50; // Default cap
      if (!isSeed && mb.integrationId) {
        const intInfo = integrationMap.get(mb.integrationId);
        if (intInfo) {
          capLimit = intInfo.warmupLimit ?? 50;
        }
        // Override with warmupMailboxes.dailyLimit if explicitly set
        if (mb.dailyLimit && mb.dailyLimit > 0) {
          capLimit = mb.dailyLimit;
        }
      }

      // ── DYNAMIC LIMIT CALCULATION ────────────────────────────────────
      // Rule: When NO campaign active → 20-25% of cap (max 15/day).
      //       When campaign active → 20% of cap (coexistence).
      //       NEVER exceed 15/day.
      //       Minimum 3/day to maintain deliverability.
      let dynamicLimit = isSeed
        ? WARMUP_CONFIG.SEED_DAILY_LIMIT
        : Math.min(
            Math.max(WARMUP_CONFIG.MIN_WARMUP_PER_DAY, Math.round(capLimit * WARMUP_CONFIG.WARMUP_CAP_PERCENT)),
            WARMUP_CONFIG.DAILY_SENT_LIMIT
          );

      if (!isSeed && mb.integrationId) {
        const info = integrationMap.get(mb.integrationId);
        const campaignDaily = campaignVolumeMap.get(info?.userId ?? '') ?? 0;
        if (campaignDaily > 0) {
          // When campaign active: 20% of cap, still capped at 15
          dynamicLimit = Math.min(
            Math.max(WARMUP_CONFIG.MIN_WARMUP_PER_DAY, Math.round(capLimit * 0.20)),
            WARMUP_CONFIG.DAILY_SENT_LIMIT
          );
        }
      }

      // Apply ramp schedule for non-seed mailboxes (gradual volume increase)
      if (!isSeed) {
        dynamicLimit = getRampLimit(mb.createdAt, dynamicLimit);
      }

      // ── HOURLY RATE LIMIT CHECK ──────────────────────────────────────
      // Max 1 warmup email per mailbox per hour.
      // Check how many warmup sends happened this hour.
      const thisHourStart = new Date(now);
      thisHourStart.setUTCMinutes(0, 0, 0);
      const hourlyCount = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(warmupInteractions)
        .where(
          and(
            eq(warmupInteractions.fromMailboxId, mb.id),
            sql`sent_at >= ${thisHourStart.toISOString()}::timestamp`
          )
        )
        .limit(1);

      if (Number(hourlyCount[0]?.count ?? 0) >= WARMUP_CONFIG.MAX_WARMUP_PER_HOUR) continue;

      // ── SEND WINDOW DISTRIBUTION ────────────────────────────────────
      // Spread sends across the day by assigning each mailbox 2-3 send
      // windows. Based on hash of mailbox ID, picks windows every 8-12h.
      const mailboxBase = parseInt(mb.id.slice(-2), 16);
      const windows = mailboxBase % 2 === 0
        ? [0, 8, 16]   // windows at hours 0, 8, 16
        : [4, 12, 20];  // windows at hours 4, 12, 20
      if (!windows.includes(currentHour)) continue;

      // Check thread cap
      const activeThreadCount = (mb.activeThreadIds || []).length;
      const maxThreads = reputationRecovery.getMaxThreadsForMailbox(mb);
      if (activeThreadCount >= maxThreads) continue;

      // Apply reputation recovery boost
      const effectiveDynamicLimit = reputationRecovery.getEffectiveLimit(mb, dynamicLimit);

      // Check daily sent cap
      if (mb.dailySentCount >= effectiveDynamicLimit) {
        if (isSeed) continue;
        if (!reputationRecovery.isInRecovery(mb)) {
          await db
            .update(warmupMailboxes)
            .set({ status: 'paused', pauseReason: 'daily_limit_reached' })
            .where(eq(warmupMailboxes.id, mb.id));
        }
        continue;
      }

      // Check daily received cap
      if (mb.dailyReceivedCount >= effectiveDynamicLimit) {
        if (isSeed) continue;
        await db
          .update(warmupMailboxes)
          .set({ status: 'paused', pauseReason: 'daily_received_limit_reached' })
          .where(eq(warmupMailboxes.id, mb.id));
        continue;
      }

      // Check last thread creation time (4-12h interval)
      const lastThread = await db
        .select()
        .from(warmupThreads)
        .where(
          sql`(${warmupThreads.senderMailboxId} = ${mb.id} OR ${warmupThreads.recipientMailboxId} = ${mb.id})`
        )
        .orderBy(sql`${warmupThreads.createdAt} DESC`)
        .limit(1);

      const hoursSinceLastThread = lastThread[0]
        ? (Date.now() - new Date(lastThread[0].createdAt).getTime()) /
          (1000 * 60 * 60)
        : 999;

      const requiredInterval = this.randomBetween(
        WARMUP_CONFIG.MIN_THREAD_INTERVAL_HOURS,
        WARMUP_CONFIG.MAX_THREAD_INTERVAL_HOURS
      );

      if (hoursSinceLastThread < requiredInterval) continue;

      // 10-min gap from campaign sends
      if (mb.integrationId) {
        const recentCampaign = await db.execute(sql`
          SELECT 1 FROM campaign_emails
          WHERE integration_id = ${mb.integrationId}::uuid
            AND status IN ('sent','delivered')
            AND sent_at > NOW() - INTERVAL '10 minutes'
          LIMIT 1
        `);
        if ((recentCampaign.rows as any[]).length > 0) continue;
      }

      // ── SEED BALANCING ────────────────────────────────────────────────
      // Prevent all seeds from sending to all targets at once.
      // Distribute across time by staggering based on seed-target pair hash.
      const partner = await pairingEngine.findPartner(mb);
      if (!partner) continue;

      const recipient = await db
        .select()
        .from(warmupMailboxes)
        .where(eq(warmupMailboxes.id, partner.mailboxId))
        .limit(1);

      if (!recipient[0] || recipient[0].status !== 'active') continue;

      const recipientLimit = Math.min(
        Math.max(WARMUP_CONFIG.MIN_WARMUP_PER_DAY, Math.round((recipient[0].dailyLimit ?? 50) * 0.25)),
        WARMUP_CONFIG.DAILY_SENT_LIMIT
      );
      const effectiveRecipientLimit = reputationRecovery.getEffectiveLimit(recipient[0], recipientLimit);
      if (
        recipient[0].dailySentCount >= effectiveRecipientLimit ||
        recipient[0].dailyReceivedCount >= effectiveRecipientLimit
      ) {
        continue;
      }

      // Seed pair hash for staggered timing (prevents Gmail flagging)
      const pairHash = parseInt(
        crypto.createHash('md5').update(`${mb.id}-${recipient[0].id}`).digest('hex').slice(0, 8),
        16
      );
      const pairStaggerMinutes = pairHash % WARMUP_CONFIG.PER_THREAD_STAGGER_MAX_MINUTES;

      // Create thread
      const thread = await threadManager.createThread(mb, recipient[0]);

      // Queue first outbound job with seed-balanced stagger + per-mailbox hour slot
      const { warmupOutboundQueue } = await import('../queues/warmup-queues.js');
      const threadStagger = pairStaggerMinutes * 60 * 1000;
      const sendDelay = this.randomBetween(
        WARMUP_CONFIG.MIN_SEND_DELAY_SECONDS,
        WARMUP_CONFIG.MAX_SEND_DELAY_SECONDS
      );

      await warmupOutboundQueue.add(
        'send-first',
        { threadId: thread.id },
        {
          delay: threadStagger + sendDelay * 1000,
          jobId: `warmup-send-first-${thread.id}`,
          removeOnComplete: true,
          removeOnFail: 100,
        }
      );
    }
  }

  private async scheduleInboxSweeps() {
    const activeMailboxes = await db
      .select()
      .from(warmupMailboxes)
      .where(eq(warmupMailboxes.status, 'active'));

    for (const mb of activeMailboxes) {
      await warmupInboundQueue.add(
        'inbox-sweep',
        { mailboxId: mb.id },
        {
          delay: 0,
          jobId: `warmup-inbox-sweep-${mb.id}`,
          removeOnComplete: true,
          removeOnFail: 100,
        }
      );
    }
  }

  private async resetDailyCountersIfStale() {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const stale = await db
      .select({ id: warmupMailboxes.id })
      .from(warmupMailboxes)
      .where(sql`${warmupMailboxes.lastResetAt} < ${yesterday}`);

    if (stale.length > 0) {
      console.log(`[Warmup][Scheduler] ${stale.length} mailbox(es) have stale counters — resetting now.`);
      await this.resetDailyCounters();
    }
  }

  private async resetDailyCounters() {
    console.log('[Warmup][Scheduler] Resetting daily counters...');

    await db
      .update(warmupMailboxes)
      .set({
        dailySentCount: 0,
        dailyReceivedCount: 0,
        lastResetAt: new Date(),
      })
      .where(
        or(
          eq(warmupMailboxes.status, 'active'),
          and(
            eq(warmupMailboxes.status, 'paused'),
            eq(warmupMailboxes.pauseReason, 'recovery_mode')
          )
        )
      );

    const resumed = await db
      .update(warmupMailboxes)
      .set({ status: 'active', pauseReason: null })
      .where(
        sql`${warmupMailboxes.pauseReason} IN ('daily_limit_reached', 'daily_received_limit_reached')`
      )
      .returning();

    if (resumed.length > 0) {
      console.log(`[Warmup][Scheduler] Resumed ${resumed.length} mailbox(es) from daily limits`);
    }

    await seedFleetManager.resetSeedDailyCounters();

    // Mark very old stalled threads as error (cleanup)
    // Also catch threads that were never interacted with (lastInteractionAt IS NULL)
    // but were created more than 48 hours ago.
    const stalled = await db
      .update(warmupThreads)
      .set({ status: 'stalled' })
      .where(
        and(
          eq(warmupThreads.status, 'active'),
          sql`(
            ${warmupThreads.lastInteractionAt} < NOW() - INTERVAL '48 hours'
            OR (
              ${warmupThreads.lastInteractionAt} IS NULL
              AND ${warmupThreads.createdAt} < NOW() - INTERVAL '48 hours'
            )
          )`
        )
      )
      .returning();

    if (stalled.length > 0) {
      console.log(`[Warmup][Scheduler] Marked ${stalled.length} old threads as stalled`);
    }
  }

  /**
   * On startup, unpause all mailboxes except those explicitly paused by the user
   * or disconnected. The one-off evaluation scans will re-pause any that should
   * remain paused (recovery_mode, domain_lacks_anchor, etc.).
   */
  private async startupUnpause() {
    const resumed = await db
      .update(warmupMailboxes)
      .set({ status: 'active', pauseReason: null })
      .where(
        and(
          eq(warmupMailboxes.status, 'paused'),
          sql`${warmupMailboxes.pauseReason} IS DISTINCT FROM 'user_paused'`,
          sql`${warmupMailboxes.pauseReason} IS DISTINCT FROM 'integration_disconnected'`
        )
      )
      .returning();

    if (resumed.length > 0) {
      console.log(`[Warmup][Scheduler] Startup: resumed ${resumed.length} mailbox(es) from paused state`);
      // Sync integrations.warmupStatus for the resumed mailboxes
      const ids = resumed.map(r => r.integrationId).filter(Boolean);
      if (ids.length > 0) {
        await db.update(integrations)
          .set({ warmupStatus: 'active' } as any)
          .where(inArray(integrations.id, ids as string[]))
          .catch(() => {});
      }
    }
  }

  private getMsUntilMidnightUTC(): number {
    const now = new Date();
    const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    return midnight.getTime() - now.getTime();
  }

  private randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}

export const warmupScheduler = new WarmupScheduler();
