import { db } from '@shared/lib/db/db.js';
import { sql } from 'drizzle-orm';
import { Queue, Worker, Job } from 'bullmq';
import { hasRedis, redisConnection } from './redis-config.js';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';

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
 */
export async function pullLeadsForMailbox(campaignId: string, integrationId: string, limit: number = 50) {
  if (!db) throw new Error("DB not available");

  // Atomic locked update
  const result = await db.execute(sql`
    UPDATE campaign_leads
    SET 
      status = 'processing', 
      integration_id = ${integrationId}, 
      updated_at = NOW()
    WHERE id IN (
      SELECT id FROM campaign_leads 
      WHERE campaign_id = ${campaignId} 
        AND status = 'pending' 
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
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
      
      const pulledLeads = await pullLeadsForMailbox(campaignId, integrationId, batchSize);
      
      if (pulledLeads.length === 0) {
        console.log(`[ConsumerEngine] No pending leads left for campaign ${campaignId}. Mailbox ${integrationId} goes idle.`);
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
        await logJobPending?.(jobKey, 'campaign:send-batch', campaignId, userId, integrationId, null, null, jobData as Record<string, any>, 0).catch(() => {});
        await campaignQueue.add(jobKey, jobData, { jobId: jobKey, priority: 2, removeOnComplete: true, removeOnFail: { count: 1000 } });
      }

      // Broadcast update
      wsSync.broadcastToUser(userId, { type: 'campaign_stats_updated', payload: {
        campaignId,
        pulled: pulledLeads.length,
        integrationId
      }});

      return { status: 'processing', count: pulledLeads.length };
    },
    {
      connection: redisConnection as any,
      concurrency: 200, // High concurrency for 500+ mailbox fleet
      limiter: {
        max: 500,
        duration: 1000 // 500 pulls per second max
      }
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`[ConsumerEngine] Job ${job?.id} failed:`, err);
  });

  console.log('[ConsumerEngine] 🚜 Autonomous Lead Distribution Consumer Worker Started');
};
