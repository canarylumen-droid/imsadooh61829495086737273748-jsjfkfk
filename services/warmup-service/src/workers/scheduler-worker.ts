/**
 * Scheduler Worker
 * 24/7 loop: enrollment, pool health, thread creation, spam rescue, daily reset.
 */

import { db } from '../db/warmup-db.js';
import { eq, and, or, sql, isNotNull, inArray } from 'drizzle-orm';
import { warmupMailboxes, warmupThreads, integrations } from '@audnix/shared';
import { WARMUP_CONFIG } from '../config/warmup-config.js';
import { enrollmentEngine } from '../engine/enrollment-engine.js';
import { poolHealthMonitor } from '../engine/pool-health-monitor.js';
import { domainClusterEngine } from '../engine/domain-cluster.js';
import { anchorEngine } from '../engine/anchor-engine.js';
import { seedFleetManager } from '../engine/seed-fleet-manager.js';
import { pairingEngine } from '../lib/pairing-engine.js';
import { threadManager } from '../lib/thread-manager.js';
import { warmupInboundQueue } from '../queues/warmup-queues.js';
import { reputationRecovery } from '../engine/reputation-recovery.js';

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

    // Daily at 00:00 UTC: reset counters
    const msUntilMidnight = this.getMsUntilMidnightUTC();
    setTimeout(() => {
      this.resetDailyCounters();
      this.scheduleNextReset();
    }, msUntilMidnight);

    // [CRITICAL] On startup, reset any counters that weren't reset since last midnight
    // (handles server restarts, crashes, or deploys that miss the midnight window)
    await this.resetDailyCountersIfStale();

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

    const uniqueIds = [...new Set(integrationIds)];
    const limits = uniqueIds.length > 0
      ? await db
          .select({ id: integrations.id, warmupLimit: integrations.warmupLimit })
          .from(integrations)
          .where(inArray(integrations.id, uniqueIds))
      : [];
    const limitMap = new Map(limits.map(l => [l.id, l.warmupLimit ?? WARMUP_CONFIG.DAILY_SENT_LIMIT]));

    for (const mb of allMailboxes) {
      const isSeed = mb.anchorRole === 'seed';
      let dynamicLimit = mb.dailyLimit ?? (isSeed ? WARMUP_CONFIG.SEED_DAILY_LIMIT : WARMUP_CONFIG.DAILY_SENT_LIMIT);
      if (!isSeed && mb.integrationId) {
        dynamicLimit = mb.dailyLimit ?? limitMap.get(mb.integrationId) ?? WARMUP_CONFIG.DAILY_SENT_LIMIT;
      }

      // Check if mailbox has too many active threads
      const activeThreadCount = (mb.activeThreadIds || []).length;
      const maxThreads = reputationRecovery.getMaxThreadsForMailbox(mb);
      if (activeThreadCount >= maxThreads) continue;

      // Apply reputation recovery boost: if IP is dead/repairing, increase warmup volume
      const effectiveDynamicLimit = reputationRecovery.getEffectiveLimit(mb, dynamicLimit);

      // Check daily sent cap against dynamic warmup limit
      if (mb.dailySentCount >= effectiveDynamicLimit) {
        // Don't pause recovery mailboxes — let them keep warming
        if (!reputationRecovery.isInRecovery(mb)) {
          await db
            .update(warmupMailboxes)
            .set({ status: 'paused', pauseReason: 'daily_limit_reached' })
            .where(eq(warmupMailboxes.id, mb.id));
        }
        continue;
      }

      // Check daily received cap (same limit for symmetry)
      if (mb.dailyReceivedCount >= effectiveDynamicLimit) {
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

      // Find partner
      const partner = await pairingEngine.findPartner(mb);
      if (!partner) continue;

      const recipient = await db
        .select()
        .from(warmupMailboxes)
        .where(eq(warmupMailboxes.id, partner.mailboxId))
        .limit(1);

      if (!recipient[0] || recipient[0].status !== 'active') continue;

      const recipientLimit = recipient[0].dailyLimit ?? limitMap.get(recipient[0].integrationId ?? '') ?? WARMUP_CONFIG.DAILY_SENT_LIMIT;
      const effectiveRecipientLimit = reputationRecovery.getEffectiveLimit(recipient[0], recipientLimit);
      if (
        recipient[0].dailySentCount >= effectiveRecipientLimit ||
        recipient[0].dailyReceivedCount >= effectiveRecipientLimit
      ) {
        continue;
      }

      // Create thread
      const thread = await threadManager.createThread(mb, recipient[0]);

      // Queue first outbound job
      const { warmupOutboundQueue } = await import('../queues/warmup-queues.js');
      const sendDelay = this.randomBetween(
        WARMUP_CONFIG.MIN_SEND_DELAY_SECONDS,
        WARMUP_CONFIG.MAX_SEND_DELAY_SECONDS
      );

      await warmupOutboundQueue.add(
        'send-first',
        { threadId: thread.id },
        {
          delay: sendDelay * 1000,
          jobId: `warmup-send-first:${thread.id}`,
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
          jobId: `warmup-inbox-sweep:${mb.id}`,
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
