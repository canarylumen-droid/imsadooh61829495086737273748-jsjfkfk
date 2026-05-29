import { db } from '@shared/lib/db/db.js';
import { campaignJobLogs, outreachCampaigns } from '@audnix/shared';
import { eq, and, inArray, lte, lt } from 'drizzle-orm';

const STALE_THRESHOLD_MS   = 60 * 60 * 1000; // 1 hour
const MAX_REQUEUE_ATTEMPTS = 3;
const SWEEP_LIMIT          = 500;            // max rows per sweep

/**
 * Autonomous self-healing sweep.
 * Finds campaign jobs that are stuck in 'pending' or 'processing' for more than
 * 1 hour, verifies each one against BullMQ, and re-queues any that are missing.
 *
 * This is the "zero-manual-touch" recovery mechanism for Redis crashes, pod
 * restarts, and network blips that cause BullMQ to lose a job before it runs.
 */
export async function runJobWatchdog(): Promise<void> {
  if (!db) return;

  console.log('[JobWatchdog] 🔍 Starting hourly self-healing sweep...');

  const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS);

  const stuckJobs = await db
    .select()
    .from(campaignJobLogs)
    .where(
      and(
        inArray(campaignJobLogs.status, ['pending', 'processing']),
        lte(campaignJobLogs.scheduledAt, staleThreshold),
        lt(campaignJobLogs.attemptCount, MAX_REQUEUE_ATTEMPTS)
      )
    )
    .limit(SWEEP_LIMIT);

  if (stuckJobs.length === 0) {
    console.log('[JobWatchdog] ✅ No stuck jobs found.');
    return;
  }

  console.log(`[JobWatchdog] ⚠️  Found ${stuckJobs.length} potentially stuck job(s). Verifying against BullMQ...`);

  // Lazy-import to avoid circular dependency (campaign-queue imports db, not watchdog)
  const { campaignQueue } = await import('./campaign-queue.js').catch(() => ({ campaignQueue: null as any }));
  if (!campaignQueue) {
    console.warn('[JobWatchdog] Redis / campaignQueue unavailable — deferring re-queue to next sweep.');
    return;
  }

  let requeued = 0;
  let healthy  = 0;
  let skipped  = 0;

  for (const jobLog of stuckJobs) {
    try {
      // 1. Skip if campaign is no longer active — job is orphaned, not stuck
      const [campaign] = await db
        .select({ status: outreachCampaigns.status })
        .from(outreachCampaigns)
        .where(eq(outreachCampaigns.id, jobLog.campaignId))
        .limit(1);

      if (!campaign || campaign.status !== 'active') {
        await db
          .update(campaignJobLogs)
          .set({ status: 'skipped', updatedAt: new Date() })
          .where(eq(campaignJobLogs.jobBullmqId, jobLog.jobBullmqId));
        skipped++;
        continue;
      }

      // 2. Check if the job is actually alive in BullMQ right now
      const liveJob = await campaignQueue.getJob(jobLog.jobBullmqId);
      if (liveJob) {
        const state = await liveJob.getState();
        if (state === 'delayed' || state === 'waiting' || state === 'active') {
          // Alive — bump updatedAt so this row won't be re-checked for another hour
          await db
            .update(campaignJobLogs)
            .set({ updatedAt: new Date() })
            .where(eq(campaignJobLogs.jobBullmqId, jobLog.jobBullmqId));
          healthy++;
          continue;
        }
        if (state === 'failed') {
          // BullMQ already exhausted all retries — mirror terminal state to PG
          const failedReason = (liveJob as any).failedReason || 'BullMQ terminal failure';
          await db
            .update(campaignJobLogs)
            .set({ status: 'failed', lastError: failedReason.substring(0, 500), updatedAt: new Date() })
            .where(eq(campaignJobLogs.jobBullmqId, jobLog.jobBullmqId));
          skipped++;
          continue;
        }
      }

      // 3. Job is MISSING from BullMQ — re-queue it
      console.log(
        `[JobWatchdog] 🔁 Re-queuing: ${jobLog.jobBullmqId}` +
        ` (type: ${jobLog.jobType}, attempt: ${jobLog.attemptCount + 1}/${MAX_REQUEUE_ATTEMPTS})`
      );

      const jobData = jobLog.jobData as Record<string, any>;
      const isFollowUp  = jobLog.jobType === 'campaign:follow-up';
      const isSendBatch = jobLog.jobType === 'campaign:send-batch';

      await campaignQueue.add(
        jobLog.jobBullmqId,
        jobData,
        {
          jobId:           jobLog.jobBullmqId,
          delay:           isSendBatch ? 5000 : 0,
          priority:        isFollowUp ? 1 : 2,
          attempts:        3,
          removeOnComplete: true,
          removeOnFail:    { count: 1000 },
        }
      );

      // 4. Mark as 're_queued' and increment the attempt counter
      await db
        .update(campaignJobLogs)
        .set({
          status:       're_queued',
          attemptCount: jobLog.attemptCount + 1,
          updatedAt:    new Date(),
        })
        .where(eq(campaignJobLogs.jobBullmqId, jobLog.jobBullmqId));

      requeued++;
    } catch (err: any) {
      console.error(`[JobWatchdog] Error processing ${jobLog.jobBullmqId}:`, err.message);
    }
  }

  console.log(
    `[JobWatchdog] ✅ Sweep complete — re-queued: ${requeued}, healthy: ${healthy}, skipped: ${skipped}`
  );
}

/**
 * Start the autonomous watchdog on a 1-hour interval.
 * Delays the first sweep by 5 minutes to let the service warm up.
 */
export function startJobWatchdog(): void {
  const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

  console.log('[JobWatchdog] 🐕 Self-healing watchdog armed (sweep every 1h, first in 5m)');

  setTimeout(() => {
    runJobWatchdog().catch(err =>
      console.error('[JobWatchdog] Initial sweep failed:', err.message)
    );
    setInterval(() => {
      runJobWatchdog().catch(err =>
        console.error('[JobWatchdog] Hourly sweep failed:', err.message)
      );
    }, INTERVAL_MS);
  }, 5 * 60 * 1000);
}
