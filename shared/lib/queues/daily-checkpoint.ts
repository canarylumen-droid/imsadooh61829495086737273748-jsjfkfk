/**
 * Daily Checkpoint Cron — Phase 7
 *
 * Prevents Redis memory bloat and ensures schedule resilience by keeping
 * all future schedules in PostgreSQL and enqueuing only the current day's
 * tasks into BullMQ at 00:00 local time.
 *
 * Rules:
 * 1. Queries `campaign_job_logs` for pending jobs scheduled today.
 * 2. Queries `follow_up_queue` for pending follow-ups scheduled today.
 * 3. Queries `warmup_mailboxes` for today's warmup sends.
 * 4. Enqueues only today's slice into BullMQ (lightweight Redis footprint).
 * 5. If Redis restarts, the next midnight checkpoint restores everything.
 */

import { db } from '@shared/lib/db/db.js';
import { campaignJobLogs, followUpQueue } from '@audnix/shared';
import { eq, and, gte, lt } from 'drizzle-orm';
import { campaignQueue, campaignQueueManager } from './campaign-queue.js';

const CHECKPOINT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

class DailyCheckpoint {
  private interval: NodeJS.Timeout | null = null;
  private isRunning = false;

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[DailyCheckpoint] Starting 24-hour checkpoint daemon...');

    // First run at next midnight, then every 24h
    const msUntilMidnight = this.getMsUntilMidnightLocal();
    setTimeout(() => {
      this.runCheckpoint().catch(console.error);
      this.interval = setInterval(() => this.runCheckpoint().catch(console.error), CHECKPOINT_INTERVAL_MS);
    }, msUntilMidnight);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isRunning = false;
    console.log('[DailyCheckpoint] Stopped.');
  }

  async runCheckpoint(): Promise<{
    campaignJobsEnqueued: number;
    followUpsEnqueued: number;
    warmupEnqueued: number;
  }> {
    if (!db) {
      console.warn('[DailyCheckpoint] DB unavailable — skipping checkpoint.');
      return { campaignJobsEnqueued: 0, followUpsEnqueued: 0, warmupEnqueued: 0 };
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    console.log(`[DailyCheckpoint] 🌙 Running midnight checkpoint for ${todayStart.toISOString().slice(0, 10)}...`);

    let campaignJobsEnqueued = 0;
    let followUpsEnqueued = 0;
    let warmupEnqueued = 0;

    try {
      // ── 1. CAMPAIGN JOB LOGS (initial send-batches + follow-ups) ──
      const pendingJobs = await db
        .select()
        .from(campaignJobLogs)
        .where(
          and(
            eq(campaignJobLogs.status, 'pending'),
            gte(campaignJobLogs.scheduledAt, todayStart),
            lt(campaignJobLogs.scheduledAt, todayEnd)
          )
        );

      for (const job of pendingJobs) {
        if (!campaignQueue) break;
        const jobData = job.jobData as any;
        if (!jobData) continue;

        const delayMs = Math.max(0, new Date(job.scheduledAt).getTime() - Date.now());
        await campaignQueue.add(job.jobBullmqId, jobData, {
          delay: delayMs,
          jobId: job.jobBullmqId,
          priority: job.jobType === 'campaign:follow-up' ? 1 : 2,
          removeOnComplete: true,
          removeOnFail: { count: 1000 },
        });
        campaignJobsEnqueued++;
      }

      // ── 2. FOLLOW-UP QUEUE (legacy standalone follow-ups) ──
      const pendingFollowUps = await db
        .select()
        .from(followUpQueue)
        .where(
          and(
            eq(followUpQueue.status, 'pending'),
            gte(followUpQueue.scheduledAt, todayStart),
            lt(followUpQueue.scheduledAt, todayEnd)
          )
        );

      for (const fu of pendingFollowUps) {
        const context = fu.context as any;
        if (!context?.campaignId || !context?.campaignLeadId) continue;

        await campaignQueueManager.scheduleFollowUp(
          context.campaignId,
          fu.userId,
          context.campaignLeadId,
          context.integrationId,
          context.stepIndex || 0,
          Math.max(0, new Date(fu.scheduledAt!).getTime() - Date.now())
        );
        followUpsEnqueued++;
      }

      // ── 3. WARMUP SCHEDULE (handled by warmup scheduler, just log) ──
      const { warmupScheduler } = await import('@services/warmup-service/src/workers/scheduler-worker.js').catch(() => ({
        warmupScheduler: { start: () => {} } as any
      }));
      // Warmup scheduler already runs its own daily reset at midnight
      // via resetDailyCounters(). No extra enqueue needed.
      warmupEnqueued = 0;

      console.log(
        `[DailyCheckpoint] ✅ Checkpoint complete. Enqueued today: ${campaignJobsEnqueued} campaign jobs, ${followUpsEnqueued} follow-ups, ${warmupEnqueued} warmup.`
      );

      return { campaignJobsEnqueued, followUpsEnqueued, warmupEnqueued };
    } catch (err: any) {
      console.error('[DailyCheckpoint] Checkpoint failed:', err.message);
      return { campaignJobsEnqueued: 0, followUpsEnqueued: 0, warmupEnqueued: 0 };
    }
  }

  private getMsUntilMidnightLocal(): number {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    return midnight.getTime() - now.getTime();
  }
}

export const dailyCheckpoint = new DailyCheckpoint();
