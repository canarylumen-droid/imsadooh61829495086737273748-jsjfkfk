import { db } from '@shared/lib/db/db.js';
import { sql } from 'drizzle-orm';
import { Queue, Worker, Job } from 'bullmq';
import { createFreshConnection, hasRedis, redisConnection } from './redis-config.js';
import { clusterSync } from '@shared/lib/realtime/redis-pubsub.js';

/**
 * AUTONOMOUS LEAD DISTRIBUTION ENGINE
 * The "Any-Available-Worker" Pattern.
 * Mailboxes (Integration IDs) act as consumers pulling from a global pending pool.
 */

export interface ConsumerJobData {
  type: 'mailbox:pull-leads';
  campaignId: string;
  integrationId: string;
  userId: string;
  batchSize: number;
}

export const consumerQueue = hasRedis ? new Queue<ConsumerJobData>('consumer-distribution-queue', {
  connection: redisConnection as any,
  defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 } }
}) : null;

/**
 * Atomic pull using Postgres FOR UPDATE SKIP LOCKED.
 * Ensures two mailboxes never pull the same lead.
 * Now pulls BOTH 'pending' AND 'queued' leads so returned/failed leads
 * from the pool are not stranded.
 */
export async function pullLeadsForMailbox(campaignId: string, integrationId: string, limit: number = 50) {
  if (!db) throw new Error("DB not available");

  // Get count of active mailboxes for this campaign to calculate fair share
  const mailboxCountResult = await db.execute(sql`
    SELECT COUNT(DISTINCT integration_id) as count FROM campaign_leads 
    WHERE campaign_id = ${campaignId} 
      AND integration_id IS NOT NULL
      AND integration_id != ''
  `);
  const activeMailboxCount = Math.max(1, Number(mailboxCountResult.rows[0]?.count || 1));

  // Also redistribute: if a mailbox has significantly more leads than fair share,
  // release some back to the pool for other mailboxes
  const fairShareCheck = await db.execute(sql`
    SELECT integration_id, COUNT(*) as count FROM campaign_leads 
    WHERE campaign_id = ${campaignId} 
      AND status = 'pending'
      AND integration_id IS NOT NULL
    GROUP BY integration_id
    HAVING COUNT(*) > ${limit * 2}
  `);
  for (const row of fairShareCheck.rows as any[]) {
    // Release excess leads back to unassigned pool
    const excessId = row.integration_id;
    const excessCount = Number(row.count);
    const releaseCount = excessCount - limit;
    await db.execute(sql`
      UPDATE campaign_leads
      SET integration_id = NULL, updated_at = NOW()
      WHERE id IN (
        SELECT id FROM campaign_leads 
        WHERE campaign_id = ${campaignId}
          AND status = 'pending'
          AND integration_id = ${excessId}
        ORDER BY created_at ASC
        LIMIT ${releaseCount}
        FOR UPDATE SKIP LOCKED
      )
    `);
    console.log(`[ConsumerEngine] 🔄 Redistributed ${releaseCount} leads from ${excessId} back to pool`);
  }

  // Calculate fair share: limit should be total unassigned / active mailboxes
  const totalUnassigned = await db.execute(sql`
    SELECT COUNT(*) as count FROM campaign_leads 
    WHERE campaign_id = ${campaignId} 
      AND (status = 'pending' OR status = 'queued')
      AND integration_id IS NULL
  `);
  const unassignedCount = Number(totalUnassigned.rows[0]?.count || 0);
  const fairShare = Math.max(1, Math.ceil(unassignedCount / activeMailboxCount));
  const cappedLimit = Math.min(limit, Math.max(fairShare, Math.ceil(unassignedCount * 0.3)));

  const result = await db.execute(sql`
    UPDATE campaign_leads
    SET 
      status = 'processing', 
      integration_id = ${integrationId}, 
      updated_at = NOW()
    WHERE id IN (
      SELECT id FROM campaign_leads 
      WHERE campaign_id = ${campaignId} 
        AND (status = 'pending' OR status = 'queued')
        AND integration_id IS NULL
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${cappedLimit}
    )
    RETURNING id, lead_id;
  `);

  return result.rows;
}

/**
 * Mailbox Consumer Worker
 * Whenever a mailbox is ready, it queues a job here to pull leads and process them.
 */
export const startConsumerWorker = () => {
  if (!hasRedis) return;

  const worker = new Worker<ConsumerJobData>(
    'consumer-distribution-queue',
    async (job: Job<ConsumerJobData>) => {
      const { campaignId, integrationId, userId, batchSize } = job.data;
      
      console.log(`[ConsumerEngine] Mailbox ${integrationId} requesting ${batchSize} leads for campaign ${campaignId}`);
      
      // Check mailbox health before pulling leads — prevents assigning leads to
      // an unhealthy mailbox that can't actually send them.
      try {
        const { MailboxHealthMonitor } = await import('@shared/lib/monitoring/health-monitor.js');
        const healthState = await MailboxHealthMonitor.checkHealthState(integrationId, userId);
        if (healthState.isHardPaused) {
          console.log(`[ConsumerEngine] ⏸️ Mailbox ${integrationId} is hard-paused — skipping pull, will retry in 5m`);
          const retryJobId = `consumer-pull_${campaignId}_${integrationId}_retry_${Date.now()}`;
          await consumerQueue!.add(retryJobId, job.data, {
            delay: 5 * 60 * 1000,
            priority: 2,
            jobId: retryJobId,
            removeOnComplete: true,
            removeOnFail: { count: 1000 },
          });
          return { status: 'deferred', reason: 'hard_paused' };
        }
      } catch {
        // Health check failed — proceed anyway (fail open)
      }

      const pulledLeads = await pullLeadsForMailbox(campaignId, integrationId, batchSize);
      
      if (pulledLeads.length === 0) {
        // No leads available NOW — check if any leads exist for this campaign
        // that are assigned to other mailboxes or in 'sent' state (pending follow-ups).
        // If so, this mailbox may get leads later. Re-queue with backoff.
        const totalLeads = await db.execute(sql`
          SELECT COUNT(*) as count FROM campaign_leads 
          WHERE campaign_id = ${campaignId}
        `);
        const remaining = await db.execute(sql`
          SELECT COUNT(*) as count FROM campaign_leads 
          WHERE campaign_id = ${campaignId}
            AND (status = 'pending' OR status = 'queued')
            AND integration_id IS NULL
        `);

        if (Number(remaining.rows[0].count) > 0 || Number(totalLeads.rows[0].count) === 0) {
          // Either leads still exist in pool (consumer race — another mailbox got them)
          // or campaign has no leads yet (they may be added later).
          // Re-queue with exponential backoff up to 5 min max.
          const attempt = (job.attemptsMade || 0) + 1;
          const delay = Math.min(attempt * 30_000, 5 * 60_000);
          const retryJobId = `consumer-pull_${campaignId}_${integrationId}_retry_${Date.now()}`;
          console.log(`[ConsumerEngine] ⏳ Mailbox ${integrationId} found 0 leads. Re-queuing in ${Math.round(delay/1000)}s (attempt ${attempt})`);
          await consumerQueue!.add(retryJobId, job.data, {
            delay,
            priority: 2,
            jobId: retryJobId,
            removeOnComplete: true,
            removeOnFail: { count: 1000 },
          });
          return { status: 'retrying', count: 0, nextCheckMs: delay };
        }

        console.log(`[ConsumerEngine] ✅ No pending leads left for campaign ${campaignId}. Mailbox ${integrationId} goes idle.`);
        return { status: 'idle', count: 0 };
      }

      console.log(`[ConsumerEngine] Mailbox ${integrationId} successfully pulled ${pulledLeads.length} leads.`);
      
      // Dispatch pulled leads to the Outreach Engine (campaignQueue)
      const { campaignQueue, logJobPending } = await import('./campaign-queue.js');
      if (campaignQueue) {
        const jobKey = `send-batch_${campaignId}_${integrationId}`;
        const jobData = {
          type: 'campaign:send-batch' as const,
          campaignId,
          userId,
          integrationId,
          dailyLimit: batchSize
        };
        // Write PG heartbeat BEFORE Redis so watchdog catches any Redis crash
        await logJobPending?.(jobKey, 'campaign:send-batch', campaignId, userId, integrationId, null, null, jobData as Record<string, any>, 0).catch(err => console.warn('[ConsumerDistribution] Job logging failed:', err.message));
        await campaignQueue.add(jobKey, jobData, { jobId: jobKey, priority: 2, removeOnComplete: true, removeOnFail: { count: 1000 } });
      }

      // Broadcast update
      await clusterSync.notifyCampaignStatsUpdated(userId, campaignId);

      return { status: 'processing', count: pulledLeads.length };
    },
    {
      connection: createFreshConnection() as any,
      concurrency: 200,
      limiter: {
        max: 500,
        duration: 1000
      }
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`[ConsumerEngine] Job ${job?.id} failed:`, err);
  });

  console.log('[ConsumerEngine] 🚜 Autonomous Lead Distribution Consumer Worker Started');
};
