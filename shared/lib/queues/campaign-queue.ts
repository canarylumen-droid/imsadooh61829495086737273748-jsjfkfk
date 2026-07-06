/**
 * BullMQ Campaign Queue System
 * 
 * Autonomous, per-mailbox campaign processing with:
 * - Independent repeatable jobs per mailbox (concurrent, not serialized)
 * - Delayed follow-up jobs that fire at the exact scheduled time
 * - Auto-reply jobs with human-like random delays (2-4 min)
 * - Real-time KPI stat aggregation via WebSocket
 * - Graceful fallback to setInterval when Redis is unavailable
 */

import { Queue, Worker, Job } from 'bullmq';
import { redisConnection, hasRedis, createFreshConnection } from './redis-config.js';
export { hasRedis, redisConnection };
import { db, withDbRetry } from '@shared/lib/db/db.js';
import {
  outreachCampaigns,
  campaignLeads,
  leads,
  messages,
  campaignEmails,
  integrations,
  pendingPayments,
  users,
  campaignJobLogs,
  jobAttempts,
} from '@audnix/shared';
import { eq, and, or, sql, lte, isNull, isNotNull, ne, asc, gt, desc } from 'drizzle-orm';
import { storage } from '@shared/lib/storage/storage.js';
import { sendEmail } from '../channels/email.js';
import { adjustCopyIfNecessary } from "../ai/copy-adjuster.js";
import { generateExpertOutreach, generateAIReply } from "@services/brain-worker/src/ai-lib/core/conversation-ai.js";
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';
import { decryptToJSON } from '@shared/lib/crypto/encryption.js';
import { mailboxHealthService } from '@services/email-service/src/email/mailbox-health-service.js';
import { warmupService } from '@services/outreach-worker/src/outreach-lib/warmup-service.js';
import { canSendToProvider, recordProviderOutcome } from '@services/email-service/src/email/provider-reputation.js';
import { shouldYieldInitialSends } from '@services/email-service/src/email/mailbox-coordinator.js';
import { getLeadProfile, isWithinLeadPreferredWindow, getOptimalSendProbability } from '../calendar/lead-timezone-intelligence.js';
import { isWeekend, addBusinessDays } from '@shared/lib/utils/validation.js';

// ─── Job Type Definitions ─────────────────────────────────────────────────────

interface SendBatchJobData {
  type: 'campaign:send-batch';
  campaignId: string;
  userId: string;
  integrationId: string; // Each mailbox is independent
  dailyLimit: number;
}

interface FollowUpJobData {
  type: 'campaign:follow-up';
  campaignId: string;
  userId: string;
  campaignLeadId: string;
  integrationId: string;
  stepIndex: number;
}

interface AutoReplyJobData {
  type: 'campaign:auto-reply';
  campaignId: string;
  userId: string;
  campaignLeadId: string;
  integrationId: string;
  leadId: string;
  _jobId?: string; // stored so processAutoReply can update the correct campaignJobLogs row
}

interface AutonomousJobData {
  type: 'autonomous';
  userId: string;
  integrationId?: string;
  isAutonomous?: boolean;
}

interface StatsUpdateJobData {
  type: 'campaign:update-stats';
  campaignId: string;
  userId: string;
}

interface PreCraftJobData {
  type: 'campaign:pre-craft';
  campaignId: string;
  userId: string;
}

interface CleanupPaymentsJobData {
  type: 'system:cleanup-payments';
}

type CampaignJobData = SendBatchJobData | FollowUpJobData | AutoReplyJobData | StatsUpdateJobData | AutonomousJobData | PreCraftJobData | CleanupPaymentsJobData;

// ─── Queue & Worker ───────────────────────────────────────────────────────────

export const campaignQueue = hasRedis ? new Queue<CampaignJobData>('campaign-engine', {
  connection: redisConnection as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 300000, // 5 minutes (5min -> 15min -> 60min backoff for transient issues)
    },
    removeOnComplete: true,   // purge immediately — no accumulation across 50-100K job volumes
    removeOnFail: { count: 1000 },
  },
} as any) : null;

// ─── Campaign Queue Manager ──────────────────────────────────────────────────

export class CampaignQueueManager {
  private fallbackIntervals: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Start all repeatable jobs for a campaign.
   * Called when user clicks "INITIATE DEPLOYMENT" or resumes a paused campaign.
   */
  async startCampaign(campaign: any): Promise<void> {
    if (!campaignQueue) {
      console.log('[CampaignQueue] Redis unavailable — campaign will use setInterval fallback');
      return;
    }
    if (!campaign) {
      console.warn('[CampaignQueue] startCampaign called with null/undefined campaign');
      return;
    }

    const config = campaign.config || {};
    const mailboxIds: string[] = config.mailboxIds || [];
    const mailboxLimits: Record<string, number> = config.mailboxLimits || {};

    if (mailboxIds.length === 0) {
      console.warn(`[CampaignQueue] Campaign ${campaign.id} has no mailboxes assigned`);
      return;
    }

    console.log(`[CampaignQueue] 🚀 Starting campaign "${campaign.name}" with ${mailboxIds.length} mailbox(es)`);

    // Plan-aware default limits for 50k+ lead scalability
    let planDailyDefault = 50;
    try {
      const [userRow] = await db.select({ plan: users.plan, subscriptionTier: users.subscriptionTier })
        .from(users).where(eq(users.id, campaign.userId)).limit(1);
      const tier = (userRow?.subscriptionTier || userRow?.plan || 'starter').toLowerCase();
      if (tier === 'enterprise' || tier === 'pro') planDailyDefault = 500;
      else if (tier === 'starter') planDailyDefault = 200;
    } catch (e) {
      console.warn('[CampaignQueue] Failed to get user plan, using fallback limit of 50:', e);
    }

    // Initial send-batch job for EACH mailbox — addBulk() for 1K mailboxes instead of sequential await loop
    // (sequential add at 5ms/call × 1000 mailboxes = 5s blocked; addBulk is a single Redis pipeline)
    if (campaignQueue) {
      const bulkJobs = mailboxIds.map(mbId => {
        const dailyLimit = mailboxLimits[mbId] || planDailyDefault;
        const jobKey = `send-batch_${campaign.id}_${mbId}`;
        return {
          name: jobKey,
          data: {
            type: 'campaign:send-batch' as const,
            campaignId: campaign.id,
            userId: campaign.userId,
            integrationId: mbId,
            dailyLimit,
          },
          opts: { delay: 5000, priority: 2, jobId: jobKey, removeOnComplete: true, removeOnFail: { count: 1000 } },
        };
      });
      // Write source-of-truth records to PostgreSQL BEFORE adding to BullMQ.
      // If Redis crashes between this write and addBulk, the Watchdog detects
      // 'pending' rows with no live BullMQ job and automatically re-queues them.
      if (db) {
        await withDbRetry(() => db.insert(campaignJobLogs).values(
          bulkJobs.map(j => ({
            jobBullmqId:     (j.opts as any).jobId as string,
            campaignId:      campaign.id,
            userId:          campaign.userId,
            integrationId:   (j.data as any).integrationId,
            campaignLeadId:  null as any,
            jobType:         'campaign:send-batch',
            stepIndex:       null as any,
            status:          'pending' as const,
            jobData:         j.data as Record<string, any>,
            scheduledAt:     new Date(Date.now() + 5000),
            updatedAt:       new Date(),
          }))
        ).onConflictDoUpdate({
          target: campaignJobLogs.jobBullmqId,
          set: { status: 'pending', scheduledAt: new Date(Date.now() + 5000), updatedAt: new Date() },
        })).catch((e: any) =>
          console.warn('[CampaignQueue] PG job log insert failed (non-fatal):', e.message)
        );
      }
      // Write send-batch jobs directly as fallback so EVERY mailbox has a chain
      // even if consumer-distribution is down. The chain starts in 5s.
      try {
        await campaignQueue.addBulk(bulkJobs);
      } catch (err: any) {
        console.error(`[CampaignQueue] Failed to add jobs: ${err.message}`);
      }
    }

    // ── Consumer Distribution (Any-Available-Worker) ──────────────────────
    // Dynamically dispatch consumer pull jobs so mailboxes grab leads from the global pool
    try {
      const { consumerQueue } = await import('./consumer-distribution.js');
      if (consumerQueue) {
        const consumerBulkJobs = mailboxIds.map(mbId => {
          const batchSize = mailboxLimits[mbId] || planDailyDefault;
          const jobKey = `consumer-pull_${campaign.id}_${mbId}`;
          return {
            name: jobKey,
            data: {
              type: 'mailbox:pull-leads' as const,
              campaignId: campaign.id,
              userId: campaign.userId,
              integrationId: mbId,
              batchSize,
            },
            opts: { delay: 5000, priority: 2, jobId: jobKey, removeOnComplete: true, removeOnFail: { count: 1000 } },
          };
        });
        await consumerQueue.addBulk(consumerBulkJobs);
      }
    } catch (err: any) {
      console.warn('[CampaignQueue] Consumer queue unavailable (non-fatal):', err.message);
    }

    // Fallback: setInterval per mailbox when Redis is unavailable
    if (!campaignQueue) {
      for (const mbId of mailboxIds) {
        const dailyLimit = mailboxLimits[mbId] || planDailyDefault;
        const jobKey = `send-batch_${campaign.id}_${mbId}`;
        if (this.fallbackIntervals.has(jobKey)) clearInterval(this.fallbackIntervals.get(jobKey));
        const interval = setInterval(async () => {
          try {
            await processSendBatch({
              type: 'campaign:send-batch',
              campaignId: campaign.id,
              userId: campaign.userId,
              integrationId: mbId,
              dailyLimit,
            });
          } catch (err) {
            console.error(`[CampaignFallback] Batch failed for ${mbId}:`, err);
          }
        }, 300_000);
        this.fallbackIntervals.set(jobKey, interval);
        console.log(`[CampaignFallback] ⚡ Interval started for ${mbId} (5m)`);
      }
    }

    // Schedule a daily PRE-CRAFT job to generate AI copies for the next 24 hours
    const preCraftKey = `pre-craft-${campaign.id}`;
    if (campaignQueue) {
      await campaignQueue.add(preCraftKey, {
        type: 'campaign:pre-craft',
        campaignId: campaign.id,
        userId: campaign.userId
      }, {
        repeat: { pattern: '0 1 * * *' }, // Run daily at 1 AM UTC
        jobId: preCraftKey,
        removeOnComplete: true,
        removeOnFail: { count: 1000 },
      });
    }

    // Trigger initial stats update immediately
    await processStatsUpdate({
      type: 'campaign:update-stats',
      campaignId: campaign.id,
      userId: campaign.userId,
    }).catch((err) => console.warn(`[CampaignQueue] processStatsUpdate failed: ${err.message}`));

    console.log(`[CampaignQueue] ✅ Campaign "${campaign.name}" fully registered`);
  }

  /**
   * Pause a campaign: remove all repeatable jobs but keep delayed follow-ups intact.
   */
  async pauseCampaign(campaignId: string): Promise<void> {
    console.log(`[CampaignQueue] ⏸️  Pausing campaign ${campaignId}`);
    
    // Clear Fallback Intervals
    for (const [key, interval] of this.fallbackIntervals.entries()) {
      if (key.includes(campaignId)) {
        clearInterval(interval);
        this.fallbackIntervals.delete(key);
      }
    }

    if (!campaignQueue) return;
    const repeatableJobs = await campaignQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      if (job.key.includes(campaignId)) {
        await campaignQueue.removeRepeatableByKey(job.key);
      }
    }

    // Clear delayed send-batch jobs for this campaign to prevent duplicates on resume
    const PAGE = 200;
    let offset = 0;
    while (true) {
      const page = await campaignQueue.getDelayed(offset, offset + PAGE - 1);
      if (page.length === 0) break;
      let removed = 0;
      for (const job of page) {
        const matchesCampaign = (job.data as any)?.campaignId === campaignId;
        const isSendBatch = job.name?.startsWith('send-batch_') || (job.data as any)?.type === 'campaign:send-batch';
        if (matchesCampaign && isSendBatch) {
          try {
            await job.remove();
            removed++;
          } catch (err) {
            console.warn(`[CampaignQueue] Could not remove paused send-batch job ${job.id}:`, err);
          }
        }
      }
      offset += PAGE - removed;
      if (page.length < PAGE) break;
    }
  }

  /**
   * Full Redis cleanup after a campaign completes naturally.
   * Removes: repeatable heartbeats, delayed follow-ups/auto-replies, failed job records.
   * This frees Redis RAM immediately rather than waiting for the 24h retention window.
   */
  async completeCampaign(campaignId: string): Promise<void> {
    console.log(`[CampaignQueue] 🧹 Running post-campaign Redis cleanup for ${campaignId}`);

    for (const [key, interval] of this.fallbackIntervals.entries()) {
      if (key.includes(campaignId)) {
        clearInterval(interval);
        this.fallbackIntervals.delete(key);
      }
    }

    if (!campaignQueue) return;

    // 1. Remove repeatable heartbeat jobs (send-batch, pre-craft)
    const repeatableJobs = await campaignQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      if (job.key.includes(campaignId)) {
        await campaignQueue.removeRepeatableByKey(job.key).catch((err) => console.warn(`[CampaignQueue] Failed to remove repeatable job: ${err.message}`));
      }
    }

    // 2. Remove orphaned scheduled follow-up / auto-reply jobs (skip mid-retry ones).
    //    Paginated in batches of 200 to avoid loading 150K+ delayed jobs into memory at once
    //    (50K leads × 3 follow-up steps = 150K jobs × 2KB ≈ 300MB heap spike without pagination).
    //    offset += PAGE - removed accounts for index shift when items are deleted from the sorted set.
    {
      const PAGE = 200;
      let dOffset = 0;
      while (true) {
        const page = await campaignQueue.getDelayed(dOffset, dOffset + PAGE - 1);
        if (page.length === 0) break;
        let removed = 0;
        for (const job of page) {
          const matchesCampaign = (job.data as any)?.campaignId === campaignId;
          const isRetrying      = job.attemptsMade > 0;
          if (!matchesCampaign || isRetrying) continue;
          try {
            await job.remove();
            removed++;
          } catch (err: any) {
            if (err.message?.includes('job scheduler')) {
              try {
                if (job.id) {
                  const parts = job.id.split(':');
                  if (parts.length >= 3 && parts[0] === 'repeat') {
                    await campaignQueue!.removeRepeatableByKey(parts.slice(0, -1).join(':'));
                  } else {
                    await campaignQueue!.removeJobScheduler(job.name);
                  }
                }
              } catch (e) {
                console.warn('[CampaignQueue] Failed to remove paused job (non-fatal):', e);
              }
            }
          }
        }
        dOffset += PAGE - removed;
        if (page.length < PAGE) break;
      }
    }

    // 3. Purge failed job records for this campaign — frees Redis RAM immediately.
    //    Paginated: a 50K campaign can exceed 1000 failed records (getFailed(0,999) would miss them).
    {
      const PAGE = 200;
      let fOffset = 0;
      while (true) {
        const page = await campaignQueue.getFailed(fOffset, fOffset + PAGE - 1);
        if (page.length === 0) break;
        let removed = 0;
        for (const job of page) {
          if ((job.data as any)?.campaignId === campaignId) {
            await job.remove().catch((err) => console.warn(`[CampaignQueue] Failed to remove failed job: ${err.message}`));
            removed++;
          }
        }
        fOffset += PAGE - removed;
        if (page.length < PAGE) break;
      }
    }

    console.log(`[CampaignQueue] ✅ Redis cleanup complete for campaign ${campaignId}`);
  }

  /**
   * Abort a campaign: remove all jobs (repeatable + delayed).
   */
  async abortCampaign(campaignId: string): Promise<void> {
    console.log(`[CampaignQueue] 🛑 Aborting campaign ${campaignId}`);
    
    // Clear fallback intervals
    for (const [key, interval] of this.fallbackIntervals.entries()) {
      if (key.includes(campaignId)) {
        clearInterval(interval);
        this.fallbackIntervals.delete(key);
      }
    }

    if (!campaignQueue) return;

    // Remove repeatable jobs
    const repeatableJobs = await campaignQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
      if (job.key.includes(campaignId)) {
        await campaignQueue.removeRepeatableByKey(job.key);
      }
    }

    // Remove delayed follow-up and auto-reply jobs — paginated to avoid memory spikes.
    // In BullMQ v5, jobs created with `repeat:` are scheduler-owned and cannot be
    // removed via job.remove() — we must use removeJobScheduler() or removeRepeatableByKey() for those.
    {
      const PAGE = 200;
      let offset = 0;
      while (true) {
        const page = await campaignQueue.getDelayed(offset, offset + PAGE - 1);
        if (page.length === 0) break;
        let removed = 0;
        for (const job of page) {
          if ((job.data as any)?.campaignId !== campaignId) continue;
          try {
            await job.remove();
            removed++;
          } catch (err: any) {
            if (err.message?.includes('job scheduler')) {
              try {
                if (job.id) {
                  const parts = job.id.split(':');
                  if (parts.length >= 3 && parts[0] === 'repeat') {
                    await campaignQueue!.removeRepeatableByKey(parts.slice(0, -1).join(':'));
                  } else {
                    await campaignQueue!.removeJobScheduler(job.name);
                  }
                }
              } catch (schedulerErr: any) {
                console.warn(`[CampaignQueue] Could not remove scheduler job ${job.id}:`, schedulerErr.message);
              }
            } else {
              console.warn(`[CampaignQueue] Could not remove delayed job ${job.id}:`, err.message);
            }
          }
        }
        offset += PAGE - removed;
        if (page.length < PAGE) break;
      }
    }
  }

  /**
   * Schedule a follow-up for a specific campaign lead at a specific time.
   * This is a one-shot delayed job, NOT a repeatable.
   */
  async scheduleFollowUp(
    campaignId: string,
    userId: string,
    campaignLeadId: string,
    integrationId: string,
    stepIndex: number,
    delayMs: number
  ): Promise<void> {
    if (campaignQueue) {
      const jobId = `followup-${campaignId}-${campaignLeadId}-step${stepIndex}`;
      // Write PG source-of-truth BEFORE Redis — if Redis crashes mid-add, the Watchdog can recover
      await logJobPending(jobId, 'campaign:follow-up', campaignId, userId, integrationId, campaignLeadId, stepIndex, { type: 'campaign:follow-up', campaignId, userId, campaignLeadId, integrationId, stepIndex }, delayMs).catch((err) => console.warn(`[CampaignQueue] logJobPending (follow-up) failed: ${err.message}`));
      await campaignQueue.add(jobId, {
        type: 'campaign:follow-up',
        campaignId,
        userId,
        campaignLeadId,
        integrationId,
        stepIndex,
      }, {
        delay: delayMs,
        jobId,
        attempts: 5,
        priority: 1,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: true,
        removeOnFail: { count: 1000 },
      });
    } else {
      // [FALLBACK] Local setTimeout
      setTimeout(async () => {
        try {
          await processFollowUp({
            type: 'campaign:follow-up',
            campaignId,
            userId,
            campaignLeadId,
            integrationId,
            stepIndex,
          });
        } catch (err: any) {
          console.error(`[CampaignFallback] Follow-up failed for ${campaignLeadId}:`, err.message);
        }
      }, delayMs);
    }

    console.log(`[CampaignQueue] ⏰ Follow-up step ${stepIndex} scheduled/timeout in ${Math.round(delayMs / 3600000)}h`);
  }

  /**
   * Schedule an auto-reply with a human-like random delay (2-4 minutes).
   * Auto-replies are HIGHEST priority (P0) — they always jump the queue
   * over follow-ups (P1) and cold batch sends (P2).
   */
  async scheduleAutoReply(
    campaignId: string,
    userId: string,
    campaignLeadId: string,
    integrationId: string,
    leadId: string
  ): Promise<void> {
    // Target 2-5 minute window for human-like but high-performance engagement
    const delayMs = Math.floor((2 + Math.random() * 3) * 60 * 1000);

    // Set Redis key so mailboxHasPendingReply() returns true without scanning the queue
    try {
      const { redisConnection } = await import('./redis-config.js');
      if (redisConnection) {
        const ttlSeconds = Math.ceil(delayMs / 1000) + 60; // +60s buffer
        await (redisConnection as any).set(`pending-reply:${integrationId}`, '1', 'EX', ttlSeconds);
      }
    } catch (e) {
      console.warn('[CampaignQueue] Failed to set Redis pending-reply key:', e);
    }

    if (campaignQueue) {
      const bucket = Math.floor(Date.now() / (5 * 60 * 1000)); // 5-min dedup window: collapses rapid re-triggers, allows new replies later
      const jobId = `autoreply-${campaignId}-${campaignLeadId}-${bucket}`;
      const jobData = {
        type: 'campaign:auto-reply' as const,
        campaignId,
        userId,
        campaignLeadId,
        integrationId,
        leadId,
        _jobId: jobId,
      };
      await logJobPending(jobId, 'campaign:auto-reply', campaignId, userId, integrationId, campaignLeadId, null, jobData, delayMs).catch((err) => console.warn(`[CampaignQueue] logJobPending (auto-reply) failed: ${err.message}`));
      await campaignQueue.add(jobId, jobData, {
        delay: delayMs,
        jobId,
        priority: 0,
        removeOnComplete: true,
        removeOnFail: { count: 1000 },
      });
    } else {
      // [FALLBACK] Local setTimeout
      setTimeout(async () => {
        try {
          await processAutoReply({
            type: 'campaign:auto-reply',
            campaignId,
            userId,
            campaignLeadId,
            integrationId,
            leadId,
          });
        } catch (err: any) {
          console.error(`[CampaignFallback] Auto-reply failed:`, err.message);
        }
      }, delayMs);
    }

    console.log(`[CampaignQueue] 💬 Auto-reply scheduled/timeout for mailbox ${integrationId.slice(-8)} in ${Math.round(delayMs / 1000)}s`);
  }

  /**
   * Re-trigger consumer distribution for all mailboxes in a campaign.
   * Called when new leads are added after the campaign has already started.
   * Ensures every mailbox has a chance to pick up the new leads.
   */
  async refreshCampaignMailboxes(campaignId: string, userId: string, mailboxIds: string[], mailboxLimits: Record<string, number> = {}): Promise<void> {
    console.log(`[CampaignQueue] 🔄 Refreshing ${mailboxIds.length} mailbox(es) for campaign ${campaignId}`);

    let planDailyDefault = 50;
    try {
      const [userRow] = await db.select({ plan: users.plan, subscriptionTier: users.subscriptionTier })
        .from(users).where(eq(users.id, userId)).limit(1);
      const tier = (userRow?.subscriptionTier || userRow?.plan || 'starter').toLowerCase();
      if (tier === 'enterprise' || tier === 'pro') planDailyDefault = 500;
      else if (tier === 'starter') planDailyDefault = 200;
    } catch (e) {
      console.warn('[CampaignQueue] Failed to get user plan in refreshMailboxCycle, using fallback:', e);
    }

    if (campaignQueue) {
      const { consumerQueue } = await import('./consumer-distribution.js');
      if (consumerQueue) {
        const bulkJobs = mailboxIds.map(mbId => {
          const batchSize = mailboxLimits[mbId] || planDailyDefault;
          const jobKey = `consumer-pull_${campaignId}_${mbId}_refresh_${Date.now()}`;
          return {
            name: jobKey,
            data: {
              type: 'mailbox:pull-leads' as const,
              campaignId,
              userId,
              integrationId: mbId,
              batchSize,
            },
            opts: { delay: 5000, priority: 2, jobId: jobKey, removeOnComplete: true, removeOnFail: { count: 1000 } },
          };
        });
        await consumerQueue.addBulk(bulkJobs);
      }
    }

    // Also restart any fallback intervals
    if (!campaignQueue) {
      for (const mbId of mailboxIds) {
        const jobKey = `send-batch_${campaignId}_${mbId}`;
        if (this.fallbackIntervals.has(jobKey)) clearInterval(this.fallbackIntervals.get(jobKey));
        const interval = setInterval(async () => {
          try {
            await processSendBatch({
              type: 'campaign:send-batch',
              campaignId,
              userId,
              integrationId: mbId,
              dailyLimit: mailboxLimits[mbId] || planDailyDefault,
            });
          } catch (err) {
            console.error(`[CampaignFallback] Batch failed for ${mbId}:`, err);
          }
        }, 300_000);
        this.fallbackIntervals.set(jobKey, interval);
      }
    }
  }
}

export const campaignQueueManager = new CampaignQueueManager();

// ─── Worker: Process All Campaign Job Types ──────────────────────────────────

async function processCampaignJob(job: Job<CampaignJobData>): Promise<void> {
  const data = job.data;
  const jobId = job.id || 'unknown';
  const jobName = data.type;
  const attemptsMade = (job as any).attemptsMade ?? 0;

  // Log every worker execution attempt — this is the 1M+ scale audit trail
  logJobAttempt(jobId, jobName, 'started', {
    campaignId: (data as any).campaignId,
    userId: (data as any).userId,
    integrationId: (data as any).integrationId,
    campaignLeadId: (data as any).campaignLeadId,
    attemptNumber: attemptsMade + 1,
  }).catch((err) => console.warn(`[CampaignQueue] logJobAttempt (started) failed: ${err.message}`));

  try {
    switch (data.type) {
      case 'campaign:send-batch':
        await processSendBatch(data, jobId);
        break;
      case 'campaign:follow-up':
        await processFollowUp(data);
        break;
      case 'campaign:auto-reply':
        await processAutoReply(data);
        break;
      case 'campaign:update-stats':
        await processStatsUpdate(data);
        break;
      case 'campaign:pre-craft':
        await processPreCraft(data);
        break;
      case 'autonomous':
        try {
          const { outreachEngine } = await import("@services/outreach-worker/workers/outreach-engine.js");
          const { storage } = await import('@shared/lib/storage/storage.js');
          
          let integration = null;
          if (data.integrationId) {
            integration = await storage.getIntegrationById(data.integrationId);
          }
          
          // signature: processUserOutreach(userId, integration, isAutonomousExplicit)
          await outreachEngine.processUserOutreach(data.userId, integration as any, data.isAutonomous);
        } catch (err: any) {
          console.error(`[CampaignWorker] Autonomous outreach failed for user ${data.userId}:`, err.message);
        }
        break;
      case 'system:cleanup-payments':
        await processPaymentCleanup();
        break;
      default:
        console.warn(`[CampaignWorker] Unknown job type: ${(data as any).type}`);
    }

    logJobAttempt(jobId, jobName, 'completed', {
      campaignId: (data as any).campaignId,
      userId: (data as any).userId,
      integrationId: (data as any).integrationId,
      campaignLeadId: (data as any).campaignLeadId,
      attemptNumber: attemptsMade + 1,
    }).catch((err) => console.warn(`[CampaignQueue] logJobAttempt (completed) failed: ${err.message}`));
  } catch (err: any) {
    // Log the failure before re-throwing so BullMQ retry sees it in PG
    logJobAttempt(jobId, jobName, 'failed', {
      campaignId: (data as any).campaignId,
      userId: (data as any).userId,
      integrationId: (data as any).integrationId,
      campaignLeadId: (data as any).campaignLeadId,
      attemptNumber: attemptsMade + 1,
      error: err.message || String(err),
    }).catch((err) => console.warn(`[CampaignQueue] logJobAttempt (failed) failed: ${err.message}`));
    throw err; // Let BullMQ handle retries as configured
  }
}

// ─── Shared Helpers ──────────────────────────────────────────────────────────

// 30-second TTL cache for sent counts to avoid full-table COUNT(*) on every batch
const sentCountCache = new Map<string, { count: number; expiresAt: number }>();
const SENT_COUNT_TTL_MS = 30000;

/**
 * Get the number of outbound emails sent today by this mailbox.
 */
async function getMailboxSentCount(userId: string, integrationId: string): Promise<number> {
  const cacheKey = `${userId}:${integrationId}`;
  const cached = sentCountCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.count;
  }
  const result = await db.execute(sql`
    SELECT COUNT(*) as count FROM messages
    WHERE user_id = ${userId}
    AND direction = 'outbound'
    AND integration_id = ${integrationId}::uuid
    AND created_at >= (NOW() AT TIME ZONE 'UTC')::date::timestamptz
  `);
  const count = Number(result.rows[0].count);
  sentCountCache.set(cacheKey, { count, expiresAt: Date.now() + SENT_COUNT_TTL_MS });
  return count;
}

/**
 * Get the number of INITIAL (step 0) campaign emails sent today by this mailbox.
 * Follow-ups and warmup are excluded so reputation throttling only affects cold outreach.
 */
async function getMailboxInitialSendCount(integrationId: string): Promise<number> {
  const cacheKey = `initial:${integrationId}`;
  const cached = sentCountCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.count;
  }
  const result = await db.execute(sql`
    SELECT COUNT(*) as count FROM campaign_emails
    WHERE integration_id = ${integrationId}::uuid
    AND step_index = 0
    AND status = 'sent'
    AND (is_warmup IS NULL OR is_warmup = false)
    AND sent_at >= (NOW() AT TIME ZONE 'UTC')::date::timestamptz
  `);
  const count = Number(result.rows[0].count);
  sentCountCache.set(cacheKey, { count, expiresAt: Date.now() + SENT_COUNT_TTL_MS });
  return count;
}

/**
 * Check if a pending auto-reply job exists for this specific mailbox.
 * Uses a Redis SET for O(1) lookup instead of scanning all delayed jobs.
 */
export async function mailboxHasPendingReply(integrationId: string): Promise<boolean> {
  if (!campaignQueue) return false;
  try {
    // Fast path: check the Redis SET written by scheduleAutoReply
    const { redisConnection } = await import('./redis-config.js');
    if (redisConnection) {
      const key = `pending-reply:${integrationId}`;
      const val = await (redisConnection as any).get(key);
      return val === '1';
    }
    return false;
  } catch (err) {
    console.error(`[CampaignQueue] mailboxHasPendingReply error:`, err);
    return false;
  }
}

/**
 * Calculate a per-mailbox send interval with jitter.
 * Spreads remaining sends across remaining business hours to avoid bursting.
 *
 * NIGHT WATCH:
 * Between 10 PM and 6 AM, the engine enters "Night Watch" mode.
 * In this mode, intervals are multiplied by 10-15x to ensure
 * extremely low volume (approx 1-2 emails per mailbox per hour).
 */
function calcMailboxInterval(sentToday: number, dailyLimit: number, integration?: any): number {
  let effectiveDailyLimit = dailyLimit;

  // Neural Brain Smart Capping (applied to interval calculation) — plan-aware for 50k+ scale
  if (integration) {
    const tier = (integration.tier || 'starter').toLowerCase();
    if (tier !== 'enterprise') {
      const createdAt = new Date(integration.createdAt || Date.now());
      const isWarmed = (Date.now() - createdAt.getTime()) > (14 * 24 * 60 * 60 * 1000);
      // Plan-aware caps: starter 200, pro 500 (was hard-capped at 60 for all non-enterprise)
      const smartCap = tier === 'pro'
        ? (isWarmed ? 500 : 300)
        : (isWarmed ? 200 : 100);
      effectiveDailyLimit = Math.min(effectiveDailyLimit, smartCap);
    }
  }

  const now = new Date();
  const currentHour = now.getUTCHours(); // UTC time for consistent global behavior
  
  // Detect Night Watch (10 PM to 6 AM UTC)
  const isNightWatch = currentHour >= 22 || currentHour < 6;

  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  const remainingHours = Math.max(0.25, (endOfDay.getTime() - now.getTime()) / (3600 * 1000));

  const remainingSends = Math.max(1, effectiveDailyLimit - sentToday);
  let baseIntervalMs = (remainingHours * 3600 * 1000) / remainingSends;

  // Apply Night Watch multiplier if active
  if (isNightWatch) {
    // Increase delay to at least 45 minutes during night watch
    // (approx 10-11 sends per 8hr night window max)
    const nightDelay = Math.max(baseIntervalMs, 45 * 60_000);
    console.log(`[CampaignWorker] 🌙 Night Watch active (Hour: ${currentHour}): Throttling mailbox to ${Math.round(nightDelay / 60000)}m intervals`);
    baseIntervalMs = nightDelay;
  }

  // Clamp: at least 30s, at most 60 minutes for better 24/7 distribution
  const clamped = Math.min(60 * 60_000, Math.max(30_000, baseIntervalMs));

  // 30–90s micro-delay to perfectly mimic human behavior (not ±15% which can be huge)
  const microDelayMs = 30_000 + Math.floor(Math.random() * 60_000); // 30s–90s
  const intervalMs = Math.round(clamped + microDelayMs);

  console.log(`[CampaignWorker] ⏱️ Hourly plan: ${sentToday}/${effectiveDailyLimit} sent. Next slot in ${Math.round(intervalMs / 60000)}m (${Math.round(microDelayMs / 1000)}s micro-delay)`);
  return intervalMs;
}

/**
 * Reschedule a mailbox's send-batch job so the chain never breaks.
 * One-shot delayed jobs that don't get re-added are dead permanently.
 */
async function rescheduleSendBatch(data: SendBatchJobData, delayMs: number): Promise<void> {
  if (!campaignQueue) {
    console.warn('[CampaignWorker] campaignQueue is null — cannot reschedule send-batch');
    return;
  }
  const { campaignId, integrationId } = data;
  const jobKey = `send-batch_${campaignId}_${integrationId}`;
  // Upsert PG heartbeat BEFORE Redis so watchdog always sees a valid scheduled_at
  await logJobPending(jobKey, 'campaign:send-batch', campaignId, data.userId, integrationId, null, null, data as Record<string, any>, delayMs).catch((err) => console.warn(`[CampaignWorker] logJobPending failed: ${err.message}`));
  try {
    await campaignQueue.add(jobKey, data, { delay: delayMs, jobId: jobKey, priority: 2, removeOnComplete: true, removeOnFail: { count: 1000 } });
  } catch (err: any) {
    console.error(`[CampaignWorker] Failed to reschedule mailbox ${integrationId.slice(-8)}: ${err.message}`);
  }
}

// ─── PostgreSQL Job Lifecycle Helpers (Self-Healing Watchdog) ─────────────────
// Every helper is fire-and-forget (.catch(() => {})) — logging must never crash a worker.

export async function logJobPending(
  jobBullmqId: string,
  jobType: string,
  campaignId: string,
  userId: string,
  integrationId: string | null,
  campaignLeadId: string | null,
  stepIndex: number | null,
  jobData: Record<string, any>,
  scheduledInMs: number
): Promise<void> {
  if (!db) return;
  const scheduledAt = new Date(Date.now() + scheduledInMs);
  await withDbRetry(() => db.insert(campaignJobLogs).values({
    jobBullmqId,
    campaignId,
    userId,
    integrationId,
    campaignLeadId,
    jobType,
    stepIndex,
    status: 'pending',
    jobData,
    scheduledAt,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: campaignJobLogs.jobBullmqId,
    set: { status: 'pending', scheduledAt, jobData, updatedAt: new Date() },
  }));
}

async function markJobProcessing(jobBullmqId: string): Promise<void> {
  if (!db) return;
  await withDbRetry(() => db.update(campaignJobLogs)
    .set({ status: 'processing', updatedAt: new Date() })
    .where(and(eq(campaignJobLogs.jobBullmqId, jobBullmqId), ne(campaignJobLogs.status, 'sent'))));
}

async function markJobSent(jobBullmqId: string): Promise<void> {
  if (!db) return;
  await withDbRetry(() => db.update(campaignJobLogs)
    .set({ status: 'sent', processedAt: new Date(), updatedAt: new Date() })
    .where(eq(campaignJobLogs.jobBullmqId, jobBullmqId)));
}

async function markJobFailed(jobBullmqId: string, error: string): Promise<void> {
  if (!db) return;
  await withDbRetry(() => db.update(campaignJobLogs)
    .set({ status: 'failed', lastError: error.substring(0, 500), updatedAt: new Date() })
    .where(eq(campaignJobLogs.jobBullmqId, jobBullmqId)));
}

// ─── Per-Attempt Audit Trail (1M+ Scale) ─────────────────────────────────────
// Writes a row to job_attempts at worker entry, success, and failure.
// Fire-and-forget (.catch(() => {})) — logging must never crash a worker.
async function logJobAttempt(
  jobId: string,
  jobName: string,
  status: 'started' | 'completed' | 'failed' | 'duplicate_skipped',
  opts: {
    campaignId?: string;
    userId?: string;
    integrationId?: string | null;
    campaignLeadId?: string | null;
    attemptNumber?: number;
    error?: string;
    metadata?: Record<string, any>;
  } = {}
): Promise<void> {
  if (!db) return;
  try {
    await withDbRetry(() => db!.insert(jobAttempts).values({
      jobId,
      jobName,
      campaignId: opts.campaignId || null,
      userId: opts.userId || null,
      integrationId: opts.integrationId || null,
      campaignLeadId: opts.campaignLeadId || null,
      attemptNumber: opts.attemptNumber || 1,
      status,
      error: opts.error || null,
      workerId: process.env.HOSTNAME || process.env.RAILWAY_REPLICA_ID || 'unknown',
      metadata: opts.metadata || {},
      updatedAt: new Date(),
    }));
  } catch (e: any) {
    console.warn('[CampaignWorker] logJobAttempt failed (non-fatal):', e.message);
  }
}

// ─── Job Processors ──────────────────────────────────────────────────────────

/**
 * Process a batch of sends for a single mailbox within a campaign.
 * This runs independently per mailbox — multiple mailboxes process concurrently.
 * 
 * FAULT TOLERANCE:
 * - Checks mailbox health before attempting to send
 * - On SMTP/auth failure: marks mailbox as failed, re-queues the lead
 * - System NEVER crashes due to a single mailbox failure
 * - Also picks up 'queued' leads (returned from failed mailboxes)
 */
async function processSendBatch(data: SendBatchJobData, jobId?: string): Promise<void> {
  if (!db) return;

  const { campaignId, userId, integrationId, dailyLimit } = data;
  // Mark as 'processing' in PG so the Watchdog knows this mailbox chain is active
  await markJobProcessing(`send-batch_${campaignId}_${integrationId}`).catch((err) => console.warn(`[CampaignWorker] markJobProcessing failed: ${err.message}`));

  // 1. Verify campaign is still active
  const [campaign] = await db.select().from(outreachCampaigns)
    .where(and(
      eq(outreachCampaigns.id, campaignId),
      eq(outreachCampaigns.userId, userId),
      eq(outreachCampaigns.status, 'active')
    ));

  if (!campaign) {
    // Campaign was paused/aborted while job was in queue — skip silently
    return;
  }

  // Respect weekend exclusion flag
  if (campaign.excludeWeekends && isWeekend()) {
    console.log(`[CampaignWorker] 🌙 Weekend — skipping send batch for ${integrationId.slice(-8)} (excludeWeekends enabled)`);
    await rescheduleSendBatch(data, 24 * 60 * 60 * 1000);
    return;
  }

  // 3. FAULT TOLERANCE: Check mailbox health (Smart Recovery aware)
  const { MailboxHealthMonitor } = await import('@shared/lib/monitoring/health-monitor.js');
  const healthState = await MailboxHealthMonitor.checkHealthState(integrationId, userId);
  
  if (healthState.isHardPaused) {
    // We removed the console.log here to prevent endless log spam every 5 minutes when a mailbox is dead.
    await rescheduleSendBatch(data, 30 * 60 * 1000);
    return;
  }

  const isSoftPaused = !healthState.canSendInitial && healthState.canSendFollowUp;
  if (isSoftPaused) {
    console.log(`[CampaignWorker] ⚠️ Mailbox ${integrationId.slice(-8)} is soft paused. Throttling down to follow-ups ONLY.`);
  }

  // 4. Check INITIAL OUTREACH budget only (follow-ups are NEVER throttled by this)
  const initialSentToday = await getMailboxInitialSendCount(integrationId);

  // Refetch current integration to get latest reputation-adjusted limits
  const currentIntegration = await storage.getIntegrationById(integrationId);
  let effectiveLimit = dailyLimit;

  if (currentIntegration) {
    // Phase 2: OUTREACH PROTECT — use initialOutreachLimit for cold sends
    const reputationLimit = (currentIntegration as any).initialOutreachLimit ?? dailyLimit;
    effectiveLimit = Math.min(effectiveLimit, reputationLimit);

    // Warmup cap still applies during ramp phase
    const warmup = warmupService.getWarmupStatus(currentIntegration as any, effectiveLimit);
    if (warmup.isWarmingUp && warmup.dailyLimit < effectiveLimit) {
      effectiveLimit = warmup.dailyLimit;
    }

    // Neural Brain Smart Capping — plan-aware for 50k+ scale
    const tier = ((currentIntegration as any).tier || 'starter').toLowerCase();
    const isEnterprise = tier === 'enterprise';
    if (!isEnterprise) {
      const createdAt = new Date((currentIntegration as any).createdAt || Date.now());
      const isWarmed = (Date.now() - createdAt.getTime()) > (14 * 24 * 60 * 60 * 1000);
      const smartCap = tier === 'pro'
        ? (isWarmed ? 500 : 300)
        : (isWarmed ? 200 : 100); // was 45-60 for all non-enterprise
      effectiveLimit = Math.min(effectiveLimit, smartCap);
    }
  }

  if (initialSentToday >= effectiveLimit) {
    await rescheduleSendBatch(data, 60 * 60 * 1000);
    return;
  }

  const mailboxStatus = shouldYieldInitialSends(integrationId);
  if (mailboxStatus.yield) {
    console.log(`[CampaignWorker] ⏸️ Yielding initial sends for ${integrationId.slice(-8)} — ${mailboxStatus.reason}`);
    await rescheduleSendBatch(data, 5 * 60 * 1000);
    return;
  }

  // Keep total sent count for interval/spacing calculations (follow-ups + warmup + initial)
  const sentToday = await getMailboxSentCount(userId, integrationId);

  // --- LEVEL 20: AUTONOMOUS SALES PRIORITY PAUSE ---
  // If there is ANY checkout link pending dispatch, we hard-pause standard campaigns.
  // This protects daily sending limits from clashing with highly valuable payment links.
  const activeCheckouts = await db.select({ id: pendingPayments.id })
    .from(pendingPayments)
    .where(
      and(
        eq(pendingPayments.userId, userId),
        eq(pendingPayments.status, 'pending'),
        or(
          isNull(pendingPayments.expiresAt),
          gt(pendingPayments.expiresAt, new Date())
        )
      )
    ).limit(1);

  if (activeCheckouts.length > 0) {
    // console.log(`[Priority Schedule] Yielding campaign batch for ${userId}. Active checkout detected.`);
    await rescheduleSendBatch(data, 30 * 60 * 1000);
    return;
  }

  // 4b. REPLY GATE: If a pending auto-reply job exists for this mailbox,
  // hold off on batch sending so the reply lands first (avoids double-send collision).
  // The auto-reply itself has P0 priority and fires in 2-4 min — we wait for it.
  const replyPending = await mailboxHasPendingReply(integrationId);
  if (replyPending) {
    console.log(`[CampaignWorker] ⏳ Reply pending on mailbox ${integrationId.slice(-8)} — batch yielding`);
    await rescheduleSendBatch(data, 10 * 60 * 1000);
    return; // send-batch is one-shot, must be explicitly re-added
  }

  // 5. Dynamic cooldown: spread remaining sends evenly across remaining business hours
  const lastSentResult = await db.execute(sql`
    SELECT created_at FROM messages
    WHERE user_id = ${userId}
    AND direction = 'outbound'
    AND (metadata->>'integrationId' = ${integrationId} OR metadata->>'integration_id' = ${integrationId})
    ORDER BY created_at DESC LIMIT 1
  `);

  if (lastSentResult.rows.length > 0) {
    const lastSentAt = new Date(lastSentResult.rows[0].created_at as string).getTime();
    // Dynamically compute minimum spacing based on remaining budget & business time
    const minDelayMs = calcMailboxInterval(sentToday, dailyLimit, currentIntegration);
    if (Date.now() - lastSentAt < minDelayMs) {
      await rescheduleSendBatch(data, minDelayMs - (Date.now() - lastSentAt));
      return;
    }
  }

  // 6. Pick the next pending or queued lead assigned to this mailbox
  //    Also pick up 'queued' leads that have been returned to the pool
  const nextLeadResult = await db.select({
    campaignLead: campaignLeads,
    lead: leads
  })
    .from(campaignLeads)
    .innerJoin(leads, eq(campaignLeads.leadId, leads.id))
    .where(
      and(
        eq(campaignLeads.campaignId, campaignId),
        eq(leads.userId, userId), // MULTI-TENANT ENFORCEMENT
        or(
          // Leads assigned to this mailbox
          and(
            eq(campaignLeads.integrationId, integrationId),
            or(eq(campaignLeads.status, 'pending'), eq(campaignLeads.status, 'queued'), eq(campaignLeads.status, 'processing'))
          ),
          // Leads in pool (no mailbox assigned) — any healthy mailbox can pick them up
          and(
            isNull(campaignLeads.integrationId),
            eq(campaignLeads.status, 'queued'),
            sql`COALESCE((${campaignLeads.metadata}->>'routingPending')::boolean, false) = false`
          )
        ),
        or(isNull(campaignLeads.nextActionAt), lte(campaignLeads.nextActionAt, new Date())),
        eq(leads.aiPaused, false),
        ne(leads.status, 'replied'),
        ne(leads.status, 'warm'),
        ne(leads.status, 'qualified'),
        ne(leads.status, 'booked'),
        ne(leads.status, 'converted'),
        ne(leads.status, 'not_interested'),
        // SOFT PAUSE GATE: If soft paused, only fetch leads that are already in a follow-up sequence
        isSoftPaused ? gt(campaignLeads.currentStep, 0) : undefined
      )
    )
    .orderBy(campaignLeads.nextActionAt)
    .limit(50); // Fetch up to 50 for high-volume throughput (was 5)

  if (nextLeadResult.length === 0) {
    // Precise Scheduling: Find the soonest lead in the future for this mailbox
    const soonestLeadResult = await db.select({ nextActionAt: campaignLeads.nextActionAt })
      .from(campaignLeads)
      .where(and(
        eq(campaignLeads.campaignId, campaignId),
        eq(campaignLeads.integrationId, integrationId),
        or(eq(campaignLeads.status, 'pending'), eq(campaignLeads.status, 'queued'), eq(campaignLeads.status, 'processing')),
        gt(campaignLeads.nextActionAt, new Date())
      ))
      .orderBy(campaignLeads.nextActionAt)
      .limit(1);

    if (soonestLeadResult.length > 0 && campaignQueue) {
      const delay = Math.max(60000, new Date(soonestLeadResult[0].nextActionAt!).getTime() - Date.now());
      const jobKey = `send-batch_${campaignId}_${integrationId}`;
      await campaignQueue.add(jobKey, data, { delay, jobId: jobKey, priority: 2, removeOnComplete: true, removeOnFail: { count: 1000 } }).catch((e: any) => {
        console.warn(`[CampaignWorker] ⚠️ Failed to reschedule mailbox (no-leads path): ${e.message}`);
      });
      console.log(`[CampaignQueue] 😴 No leads ready. Rescheduling mailbox ${integrationId.slice(-8)} in ${Math.round(delay/60000)}m`);
    } else {
      const routingPending = await db.select({ id: campaignLeads.id })
        .from(campaignLeads)
        .where(and(
          eq(campaignLeads.campaignId, campaignId),
          eq(campaignLeads.status, 'queued'),
          isNull(campaignLeads.integrationId),
          sql`COALESCE((${campaignLeads.metadata}->>'routingPending')::boolean, false) = true`
        ))
        .limit(1);

      if (routingPending.length > 0 && campaignQueue) {
        const jobKey = `send-batch_${campaignId}_${integrationId}`;
        await campaignQueue.add(jobKey, data, { delay: 60_000, jobId: jobKey, priority: 2, removeOnComplete: true, removeOnFail: { count: 1000 } }).catch((e: any) => {
          console.warn(`[CampaignWorker] ⚠️ Failed to reschedule mailbox (routing path): ${e.message}`);
        });
        console.log(`[CampaignQueue] ⏳ Waiting for smart routing. Retrying mailbox ${integrationId.slice(-8)} in 1m`);
        return;
      }

      // CAMPAIGN DURATION CHECK: Auto-complete if campaign has exceeded its configured duration
      const campaignCreatedAt = campaign.createdAt ? new Date(campaign.createdAt).getTime() : 0;
      const durationDays = (campaign.config as any)?.targetDays || (campaign.config as any)?.durationDays || 0;
      if (durationDays > 0) {
        const expiryTime = campaignCreatedAt + (durationDays * 24 * 60 * 60 * 1000);
        if (Date.now() > expiryTime) {
          console.log(`[CampaignWorker] ⏰ Campaign ${campaignId} has exceeded its ${durationDays}-day duration. Auto-completing.`);
          await withDbRetry(() => db.update(outreachCampaigns)
            .set({ status: 'completed' })
            .where(eq(outreachCampaigns.id, campaignId)));
          await campaignQueueManager.completeCampaign(campaignId);
          return;
        }
      }

      // BUG X8 FIX: Check if the entire campaign is terminal.
      // IMPORTANT: also check 'sent' — leads in 'sent' status are awaiting follow-up steps.
      // Without this, a 50K campaign completes prematurely (all initial emails sent → no more
      // 'pending'/'queued') and completeCampaign() wipes all 150K scheduled follow-up jobs.
      const pendingLeads = await db.select({ id: campaignLeads.id })
        .from(campaignLeads)
        .where(and(
          eq(campaignLeads.campaignId, campaignId),
          or(
            eq(campaignLeads.status, 'pending'),
            eq(campaignLeads.status, 'queued'),
            and(
              eq(campaignLeads.status, 'sent'),
              isNotNull(campaignLeads.nextActionAt)
            )
          )
        ))
        .limit(1);

      if (pendingLeads.length === 0) {
        console.log(`[CampaignWorker] 🎉 Campaign ${campaignId} has no more pending leads. Marking as completed.`);
        await withDbRetry(() => db.update(outreachCampaigns)
          .set({ status: 'completed' })
          .where(eq(outreachCampaigns.id, campaignId)));
        
        // Full Redis cleanup: removes heartbeat jobs + delayed follow-ups + failed records
        await campaignQueueManager.completeCampaign(campaignId);
      } else {
        // Campaign still has leads but none available for this mailbox right now.
        // Reschedule in 5 minutes so the mailbox doesn't die while others process.
        await rescheduleSendBatch(data, 5 * 60 * 1000);
      }
    }
    return;
  }

  // BUG #10 FIX: Iterate up to 5 leads so a timezone-gated lead
  // doesn't stall the entire mailbox queue.
  let didSend = false;
  let batchSentCount = 0;
  for (const row of nextLeadResult) {
    // Mid-batch budget check: re-check daily limit after each send
    if (batchSentCount > 0) {
      const updatedSentToday = await getMailboxSentCount(userId, integrationId);
      if (updatedSentToday >= effectiveLimit) {
        console.log(`[CampaignWorker] ⏸️ Mid-batch budget hit (${updatedSentToday}/${effectiveLimit}) — rescheduling remaining leads.`);
        // Release remaining leads back to queue for next cycle
        break;
      }
    }
    const leadEntry = (row as any).campaignLead;
    const lead = (row as any).lead;

    if (!lead?.email) continue;

    // Atomically claim the lead for this mailbox.
    // Using RETURNING to detect if another mailbox worker already claimed this pool lead.
    // Without this, 1K concurrent mailboxes can all read the same null-integrationId lead
    // and send to the same recipient multiple times.
    if (!leadEntry.integrationId || leadEntry.status === 'queued') {
      const claimed = await withDbRetry(() => db.update(campaignLeads)
        .set({ integrationId, status: 'pending' })
        .where(and(
          eq(campaignLeads.id, leadEntry.id),
          or(isNull(campaignLeads.integrationId), eq(campaignLeads.integrationId, integrationId)),
          or(eq(campaignLeads.status, 'pending'), eq(campaignLeads.status, 'queued'))
        ))
        .returning({ id: campaignLeads.id }));

      if (claimed.length === 0) {
        continue; // Another mailbox worker claimed this lead first — skip it
      }
    }

    // --- PHASE 50: INTELLIGENT SCHEDULING GATE ---
    const tzProfile = await getLeadProfile(lead.id);
    const isActivelyEngaged = lead.status === 'replied' || lead.status === 'warm';
    
    if (tzProfile && !isActivelyEngaged) {
      const probability = await getOptimalSendProbability(new Date(), tzProfile, userId);
      
      if (probability === 0) {
        console.log(`[CampaignWorker] 😴 Lead ${lead.id.slice(-8)} is outside business window. Rescheduling.`);
        const nextCheck = new Date(Date.now() + 60 * 60 * 1000);
        await withDbRetry(() => db.update(campaignLeads)
          .set({ nextActionAt: nextCheck, status: 'queued' })
          .where(eq(campaignLeads.id, leadEntry.id)));
        continue; 
      }

      const diceRoll = Math.random();
      if (diceRoll > probability) {
        console.log(`[CampaignWorker] 🎲 Dice roll (${diceRoll.toFixed(2)}) > Prob (${probability}) for lead ${lead.id.slice(-8)}. Yielding.`);
        const retryAt = new Date(Date.now() + (15 + Math.random() * 15) * 60 * 1000);
        await withDbRetry(() => db.update(campaignLeads)
          .set({ nextActionAt: retryAt, status: 'queued' })
          .where(eq(campaignLeads.id, leadEntry.id)));
        continue;
      }
    }

    // --- MID-BATCH COLLISION CHECK ---
    // If an auto-reply appeared while we were iterating leads, yield so the reply lands first.
    if (await mailboxHasPendingReply(integrationId)) {
      console.log(`[CampaignWorker] ⚠️ Auto-reply appeared mid-batch for ${integrationId.slice(-8)}. Yielding remaining sends.`);
      await rescheduleSendBatch(data, 5 * 60 * 1000);
      break;
    }

    // 7. FAULT-TOLERANT SEND
    // All operations — delivery, stats, follow-up scheduling, mailbox reschedule —
    // must succeed or fail atomically. If follow-up scheduling crashes, the lead
    // stays retryable instead of appearing "sent" with a missing follow-up.
    try {
      // ── PG-LEVEL IDEMPOTENCY GUARD ────────────────────────────────────────
      // This takes precedence over Redis locks. If campaignEmails already has a
      // record for this lead + step, the email was sent. Skip delivery but still
      // run post-send scheduling so a previous crash-after-send doesn't orphan
      // the follow-up or mailbox reschedule.
      const alreadySent = await db.select({ id: campaignEmails.id })
        .from(campaignEmails)
        .where(and(
          eq(campaignEmails.campaignId, campaign.id),
          eq(campaignEmails.leadId, lead.id),
          eq(campaignEmails.stepIndex, leadEntry.currentStep)
        ))
        .limit(1);
      if (alreadySent.length > 0) {
        console.log(`[CampaignWorker] ⚡ PG idempotency: lead ${lead.id} step ${leadEntry.currentStep} already sent — skipping delivery.`);
        logJobAttempt(
          jobId || `send-batch_${campaignId}_${lead.id}_${leadEntry.currentStep}`,
          'campaign:send-batch',
          'duplicate_skipped',
          {
            campaignId,
            userId,
            integrationId,
            campaignLeadId: leadEntry.id,
            metadata: { reason: 'campaignEmails already exists', leadId: lead.id, stepIndex: leadEntry.currentStep }
          }
        ).catch((err) => console.warn(`[CampaignWorker] logJobAttempt (duplicate_skipped) failed: ${err.message}`));
      } else {
        if (lead.channel === 'instagram') {
          await deliverCampaignInstagram(userId, campaign, lead, leadEntry, integrationId);
        } else {
          const providerCheck = await canSendToProvider(
            integrationId, lead.email,
            false,
            currentIntegration ? { providerLimits: (currentIntegration as any).providerLimits, initialOutreachLimit: (currentIntegration as any).initialOutreachLimit } : undefined
          );
          if (!providerCheck.allowed) {
            console.log(`[CampaignWorker] ⏸️ ${providerCheck.reason} — skipping ${lead.email}, other providers unaffected`);
            await withDbRetry(() => db.update(campaignLeads)
              .set({ nextActionAt: new Date(Date.now() + 3600000), status: 'queued' })
              .where(eq(campaignLeads.id, leadEntry.id)));
            continue;
          }
          await deliverCampaignEmail(userId, campaign, lead, leadEntry, integrationId);
          recordProviderOutcome(integrationId, lead.email, 'sent').catch((err: any) => {
            console.warn(`[CampaignWorker] ⚠️ Failed to record provider outcome: ${err.message}`);
          });
        }
      }

      await resetCampaignFailureCount(campaignId);
      await withDbRetry(() => db!.update(integrations).set({ failureCount: 0 }).where(eq(integrations.id, integrationId)));

      // Debounced stats update: bucket by 30s window so at most one runs per 30s per campaign
      if (campaignQueue) {
        const bucket = Math.floor(Date.now() / 30000);
        await campaignQueue.add(
          `stats-${campaignId}`,
          { type: 'campaign:update-stats', campaignId, userId },
          { jobId: `stats-${campaignId}-${bucket}`, delay: 3000, priority: 3, removeOnComplete: true, removeOnFail: { count: 1000 } }
        ).catch((err) => console.warn(`[CampaignWorker] Failed to queue stats update: ${err.message}`));
      } else {
        await processStatsUpdate({ type: 'campaign:update-stats', campaignId, userId }).catch((err) => console.warn(`[CampaignWorker] processStatsUpdate (inline) failed: ${err.message}`));
      }

      // Schedule follow-up if there's a next step
      const followupsArr = (campaign.template as any)?.followups || [];
      const nextStep = leadEntry.currentStep + 1;
      if (nextStep <= followupsArr.length) {
        const delayDays = followupsArr[nextStep - 1]?.delayDays || 3;
        let delayMs = delayDays * 24 * 60 * 60 * 1000;
        const initialSentAt = leadEntry.metadata?.initialSentAt;
        if (initialSentAt) {
          const targetDate = new Date(initialSentAt);
          if (campaign.excludeWeekends) {
            const bizDate = addBusinessDays(targetDate, delayDays);
            delayMs = Math.max(60000, bizDate.getTime() - Date.now());
          } else {
            targetDate.setDate(targetDate.getDate() + delayDays);
            delayMs = Math.max(60000, targetDate.getTime() - Date.now());
          }
        }
        await campaignQueueManager.scheduleFollowUp(campaignId, userId, leadEntry.id, integrationId, nextStep, delayMs);
      }

      wsSync.notifyLeadsUpdated(userId, { leadId: lead.id, action: 'campaign_sent' });

      // Reschedule the mailbox for the next send
      if (campaignQueue) {
        const jobKey = `send-batch_${campaignId}_${integrationId}`;
        const totalSent = sentToday + batchSentCount;
        const nextDelay = calcMailboxInterval(totalSent, dailyLimit, currentIntegration);
        await campaignQueue.add(jobKey, data, { delay: nextDelay, jobId: jobKey, priority: 2, removeOnComplete: true, removeOnFail: { count: 1000 } }).catch((e: any) => {
          console.warn(`[CampaignWorker] ⚠️ Failed to reschedule mailbox (post-send path): ${e.message}`);
        });
        console.log(`[CampaignWorker] 🎯 Sent lead (${batchSentCount} in batch). Rescheduling mailbox ${integrationId.slice(-8)} in ${Math.round(nextDelay/60000)}m`);
      }

      didSend = true;
      batchSentCount++;
      // Continue to next lead instead of breaking — skip failed leads and keep going
      continue;

    } catch (sendError: any) {
      const errorMsg = sendError.message || 'Unknown send error';
      console.error(`[CampaignWorker] ❌ Send failed for ${lead.email} via ${integrationId}: ${errorMsg}`);

      const isTransient = mailboxHealthService.isTransientNetworkError(errorMsg);
      const metadata = { ...(leadEntry.metadata as Record<string, any> || {}) };
      const failCount = (metadata.failCount || 0) + 1;
      metadata.failCount = failCount;
      metadata.lastError = errorMsg;

      if (failCount >= 3) {
        await withDbRetry(() => db.update(campaignLeads)
          .set({ status: 'failed', error: `Max failures (3): ${errorMsg}`, metadata })
          .where(eq(campaignLeads.id, leadEntry.id)));
        continue;
      }

      if (isTransient || mailboxHealthService.isMailboxError(errorMsg)) {
        if (!isTransient) {
          const integration = await storage.getIntegrationById(integrationId);
          if (integration) await mailboxHealthService.handleMailboxFailure(integration, errorMsg);
        }
        await withDbRetry(() => db.update(campaignLeads)
          .set({ integrationId: null, status: 'queued', error: errorMsg, metadata })
          .where(eq(campaignLeads.id, leadEntry.id)));
      } else {
        await withDbRetry(() => db.update(campaignLeads)
          .set({ status: 'failed', error: errorMsg, metadata })
          .where(eq(campaignLeads.id, leadEntry.id)));
      }
      continue;
    }
  }

  // If the loop completed without sending (all leads claimed by others,
  // timezone-gated, or all sends failed), reschedule so the mailbox stays alive.
  if (!didSend) {
    await rescheduleSendBatch(data, 60_000);
  }
}

/**
 * Process a scheduled follow-up for a specific campaign lead.
 */
async function processFollowUp(data: FollowUpJobData): Promise<void> {
  if (!db) return;

  const { campaignId, userId, campaignLeadId, integrationId, stepIndex } = data;
  const followupJobId = `followup-${campaignId}-${campaignLeadId}-step${stepIndex}`;

  // PG idempotency: skip if already sent — prevents duplicate send when the Watchdog re-queues this job
  if (db) {
    const [existing] = await db.select({ status: campaignJobLogs.status })
      .from(campaignJobLogs)
      .where(eq(campaignJobLogs.jobBullmqId, followupJobId))
      .limit(1);
    if (existing?.status === 'sent') {
      console.log(`[CampaignWorker] ⚡ Idempotency: ${followupJobId} already sent — skipping.`);
      return;
    }
    await markJobProcessing(followupJobId).catch((err) => console.warn(`[CampaignWorker] markJobProcessing (follow-up) failed: ${err.message}`));
  }

  // 1. Verify campaign is still active
  const [campaign] = await db.select().from(outreachCampaigns)
    .where(and(eq(outreachCampaigns.id, campaignId), eq(outreachCampaigns.status, 'active')));

  if (!campaign) return;

  // 2. Get the campaign lead entry
  const [leadEntry] = await db.select().from(campaignLeads)
    .where(eq(campaignLeads.id, campaignLeadId));

  if (!leadEntry || leadEntry.status === 'aborted' || leadEntry.status === 'replied') return;

  // 3. Get lead details
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadEntry.leadId));
  if (!lead?.email || lead.aiPaused) return;

  // --- SOFT/HARD PAUSE GATE: Enforce Follow-Up Throttling ---
  const { MailboxHealthMonitor } = await import('@shared/lib/monitoring/health-monitor.js');
  const healthState = await MailboxHealthMonitor.checkHealthState(integrationId, userId);
  
  if (!healthState.canSendFollowUp) {
    console.log(`[CampaignWorker] 🛑 Mailbox ${integrationId.slice(-8)} is hard paused. Yielding follow-up for ${lead.id.slice(-8)}.`);
    await campaignQueueManager.scheduleFollowUp(
      campaignId, userId, campaignLeadId, integrationId, stepIndex,
      30 * 60 * 1000 // Retry in 30 minutes (pushes back until pause expires)
    );
    return;
  }

  // --- PHASE 50: TIMEZONE INTELLIGENCE GATE (FOLLOW-UP) ---
  const tzProfile = await getLeadProfile(lead.id);
  const isActivelyEngaged = lead.status === 'replied' || lead.status === 'warm';

  if (tzProfile && !isActivelyEngaged) {
    const probability = await getOptimalSendProbability(new Date(), tzProfile, userId);
    if (probability === 0) {
      console.log(`[CampaignWorker] 😴 Follow-up for ${lead.id.slice(-8)} outside window. Delaying 1hr.`);
      await campaignQueueManager.scheduleFollowUp(
        campaignId,
        userId,
        campaignLeadId,
        integrationId,
        stepIndex,
        60 * 60 * 1000 // 1 hour jitter
      );
      return;
    }
  }

  // --- REPLY GATE: Follow-ups must yield to any pending auto-reply ---
  const replyPending = await mailboxHasPendingReply(integrationId);
  if (replyPending) {
    console.log(`[CampaignWorker] ⏳ Reply pending — delaying follow-up for ${lead.id.slice(-8)} by 10 min.`);
    await campaignQueueManager.scheduleFollowUp(
      campaignId, userId, campaignLeadId, integrationId, stepIndex,
      10 * 60 * 1000 // retry in 10 minutes
    );
    return;
  }

  // 4. Check if the lead has replied, expressed interest, or unsubscribed since the follow-up was scheduled.
  //    'warm' and 'qualified' are hand-off states — the human team takes over, AI MUST NOT send.
  if (
    lead.status === 'replied' ||
    lead.status === 'warm' ||
    lead.status === 'qualified' ||
    lead.status === 'converted' ||
    lead.status === 'booked' ||
    lead.status === 'unsubscribed'
  ) {
    console.log(`[CampaignWorker] 🛑 Follow-up aborted for lead ${lead.id.slice(-8)} — status is '${lead.status}' (hand-off or unsubscribed)`);
    return;
  }

  // 5. Check unified daily budget (Max Capacity)
  const sentToday = await getMailboxSentCount(userId, integrationId);

  // Refetch current integration for Neural Brain limits
  const currentIntegration = await storage.getIntegrationById(integrationId);
  
  // Pull limits from campaign config or mailbox metadata
  const config = (campaign.config as any) || {};
  const mailboxLimits: Record<string, number> = config.mailboxLimits || {};
  const baseLimit = mailboxLimits[integrationId] || 50;

  // Neural Brain Smart Capping (Applied to follow-ups too) — plan-aware for 50k+ scale
  let effectiveHardLimit = baseLimit;
  if (currentIntegration) {
    const tier = ((currentIntegration as any).tier || 'starter').toLowerCase();
    const isEnterprise = tier === 'enterprise';
    if (!isEnterprise) {
      const createdAt = new Date((currentIntegration as any).createdAt || Date.now());
      const isWarmed = (Date.now() - createdAt.getTime()) > (14 * 24 * 60 * 60 * 1000);
      const smartCap = tier === 'pro'
        ? (isWarmed ? 500 : 300)
        : (isWarmed ? 200 : 100); // was 45-60 for all non-enterprise
      effectiveHardLimit = Math.min(baseLimit, smartCap);
    }
  }

  // Max multiplier for flexibility
  const isSmtp = (currentIntegration?.provider as any) === 'smtp' || currentIntegration?.provider === 'custom_email';
  const defaultCeiling = isSmtp ? 500 : 100;
  const maxMultipliers = config.mailboxMaxMultipliers || {};
  const maxMultiplier = maxMultipliers[integrationId] || config.maxDailyMultiplier || (isSmtp ? 10 : 7);
  const hardCeiling = config.totalDailyLimit || (effectiveHardLimit * maxMultiplier) || defaultCeiling;

  // Follow-ups share the daily limit with initial sends (total cap applies)
  if (sentToday >= hardCeiling) {
    console.log(`[CampaignWorker] ⏸️ Follow-up deferred — total daily cap hit (${sentToday}/${hardCeiling}) for ${lead.email}`);
    await campaignQueueManager.scheduleFollowUp(campaignId, userId, campaignLeadId, integrationId, stepIndex, 3600000);
    return;
  }

  // 6. Deliver the follow-up email
  try {
    // ── PG-LEVEL IDEMPOTENCY GUARD ─────────────────────────────────────────
    const alreadySent = await db.select({ id: campaignEmails.id })
      .from(campaignEmails)
      .where(and(
        eq(campaignEmails.campaignId, campaign.id),
        eq(campaignEmails.leadId, lead.id),
        eq(campaignEmails.stepIndex, stepIndex)
      ))
      .limit(1);
    if (alreadySent.length > 0) {
      console.log(`[CampaignWorker] ⚡ PG idempotency: follow-up ${followupJobId} already sent — skipping delivery.`);
    } else {
      await deliverCampaignEmail(userId, campaign, lead, { ...leadEntry, currentStep: stepIndex }, integrationId);
    }

    // 7. Schedule NEXT follow-up step if there are more
    const followupsArr = (campaign.template as any)?.followups || [];
    const nextStep = stepIndex + 1;
    if (nextStep <= followupsArr.length) {
      const delayDays = followupsArr[nextStep - 1]?.delayDays || 3;
      let delayMs = delayDays * 24 * 60 * 60 * 1000;

      // Relative scheduling with weekend awareness
      const initialSentAt = leadEntry.metadata?.initialSentAt;
      if (initialSentAt) {
        let targetDate = new Date(initialSentAt);
        if (campaign.excludeWeekends) {
          // Use business days to skip weekends
          targetDate = addBusinessDays(targetDate, delayDays);
        } else {
          targetDate.setDate(targetDate.getDate() + delayDays);
        }
        delayMs = Math.max(60000, targetDate.getTime() - Date.now());
      } else if (campaign.excludeWeekends) {
        // If no initial sent date, calculate from now with business days
        const targetDate = addBusinessDays(new Date(), delayDays);
        delayMs = Math.max(60000, targetDate.getTime() - Date.now());
      }

      // .catch() prevents a duplicate deterministic jobId from crashing the worker
      await campaignQueueManager.scheduleFollowUp(
        campaignId, userId, campaignLeadId, integrationId, nextStep,
        delayMs
      ).catch((e: any) => {
        console.warn(`[CampaignWorker] Follow-up schedule duplicate (harmless): ${e.message}`);
      });
    }

    // 8. Real-time KPI push
    await markJobSent(followupJobId).catch((err) => console.warn(`[CampaignWorker] markJobSent (follow-up) failed: ${err.message}`));
    wsSync.notifyLeadsUpdated(userId, { leadId: lead.id, action: 'followup_sent' });
    await processStatsUpdate({ type: 'campaign:update-stats', campaignId, userId }).catch((err) => console.warn(`[CampaignWorker] processStatsUpdate (follow-up) failed: ${err.message}`));
  } catch (err: any) {
    const errorMsg = err.message || 'Follow-up send failed';
    console.error(`[CampaignWorker] ❌ Follow-up failed for ${lead.email}: ${errorMsg}`);

    // Phase 19: Circuit Breaker for follow-ups
    const metadata = { ...(leadEntry.metadata as Record<string, any> || {}) };
    const failCount = (metadata.failCount || 0) + 1;
    metadata.failCount = failCount;

    if (failCount >= 3) {
      console.error(`[CampaignWorker] 🛑 Follow-up reached max failure (3) for ${lead.email}. Killing lead.`);
      await withDbRetry(() => db.update(campaignLeads)
        .set({ status: 'failed', error: `Max follow-up failures: ${errorMsg}`, metadata })
        .where(eq(campaignLeads.id, leadEntry.id)));
      await markJobFailed(followupJobId, `Max follow-up failures: ${errorMsg}`).catch((err) => console.warn(`[CampaignWorker] markJobFailed failed: ${err.message}`));
      return;
    }

    // Re-queue for another attempt in 1 hour
    await withDbRetry(() => db.update(campaignLeads)
      .set({ metadata })
      .where(eq(campaignLeads.id, leadEntry.id)));

    await campaignQueueManager.scheduleFollowUp(
      campaignId, userId, campaignLeadId, integrationId, stepIndex,
      1 * 60 * 60 * 1000
    );
  }
}

/**
 * Process an auto-reply to a lead who responded to a campaign email.
 */
async function processAutoReply(data: AutoReplyJobData): Promise<void> {
  if (!db) return;

  const { campaignId, userId, campaignLeadId, integrationId, leadId } = data;
  const autoreplyJobId = data._jobId || `autoreply-${campaignId}-${campaignLeadId}-unknown`;
  await markJobProcessing(autoreplyJobId).catch((err) => console.warn(`[CampaignWorker] markJobProcessing (auto-reply) failed: ${err.message}`));

  // 2. Fetch campaign and verify status
  const [campaign] = await db.select().from(outreachCampaigns).where(eq(outreachCampaigns.id, campaignId));
  if (!campaign || campaign.status === 'aborted' || campaign.status === 'paused') return;

  // 3. Get lead details
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
  if (!lead?.email || lead.aiPaused) return;

  const [leadEntry] = await db.select().from(campaignLeads)
    .where(eq(campaignLeads.id, campaignLeadId));
  if (!leadEntry) return;

  // Dedup: check if an auto-reply was already sent to this lead for this campaign
  const existingAutoReply = await db.select({ id: messages.id })
    .from(messages)
    .where(and(
      eq(messages.leadId, leadId),
      eq(messages.userId, userId),
      eq(messages.direction, 'outbound'),
      sql`metadata->>'step' = 'auto-reply'`,
      sql`metadata->>'campaignId' = ${campaignId}`
    ))
    .limit(1);
  if (existingAutoReply.length > 0) {
    console.log(`[CampaignWorker] ⚡ Auto-reply already sent to lead ${leadId} for campaign ${campaignId} — skipping.`);
    return;
  }

  // Auto-replies NEVER check daily limits — they are responses to incoming messages
  let body: string;
  let subject: string;

  const hasAutoReplyTemplate = !!((campaign.template as any)?.autoReply?.body || (campaign.template as any)?.autoReplyBody);

  if (hasAutoReplyTemplate) {
    // Use the campaign's auto-reply template
    body = (campaign.template as any).autoReply?.body || (campaign.template as any).autoReplyBody;
    subject = (campaign.template as any)?.initial?.subject || (campaign.template as any)?.subject || 'Re: ';
    subject = subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`;

    // Variable replacement
    const firstName = lead.name?.trim().split(' ')[0] || 'there';
    const lastName = lead.name?.trim().split(' ').slice(1).join(' ') || 'there';
    const fullName = lead.name?.trim() || firstName;
    const company = (lead as any).company?.trim() || 'your company';
    const meta = (lead as any).metadata || {};
    const city = meta.city || (lead as any).city || '';
    const industry = meta.industry || '';
    const niche = meta.niche || '';
    const website = meta.website || '';
    body = body
      .replace(/{{firstName}}/g, firstName)
      .replace(/{{lastName}}/g, lastName)
      .replace(/{{name}}/g, fullName)
      .replace(/{{lead_name}}/g, fullName)
      .replace(/{{company}}/g, company)
      .replace(/{{business_name}}/g, company)
      .replace(/{{city}}/g, city)
      .replace(/{{industry}}/g, industry)
      .replace(/{{niche}}/g, niche)
      .replace(/{{website}}/g, website);
  } else {
    // No auto-reply template — use AI to generate a contextual reply
    try {
      const history = await db.select()
        .from(messages)
        .where(and(eq(messages.leadId, lead.id), eq(messages.userId, userId)))
        .orderBy(asc(messages.createdAt));

      const aiResult = await generateAIReply(
        lead as any,
        history as any,
        'email',
        {
          businessName: (lead as any).company || undefined,
          calendarLink: (lead.metadata as any)?.calendarLink || undefined,
        }
      );

      body = aiResult.text;
      subject = (campaign.template as any)?.initial?.subject || (campaign.template as any)?.subject || 'Re: ';
      subject = subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`;
    } catch (aiErr: any) {
      console.warn(`[CampaignWorker] AI auto-reply failed for lead ${lead.id}, using template subject: ${aiErr.message}`);
      subject = (campaign.template as any)?.initial?.subject || (campaign.template as any)?.subject || 'Re: ';
      subject = subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`;
      body = `Hi ${lead.name?.split(' ')[0] || 'there'},\n\nThanks for your message! I'd love to help answer any questions you have.\n\nBest regards`;
    }
  }

  // AI Adjustment Toggle: Check campaign config
  if ((campaign.config as any)?.aiAdjustCopy) {
    try {
      // Check if we've already sent an auto-reply to this lead for this campaign
      const previousAutoReplies = await db.select({ id: messages.id })
        .from(messages)
        .where(and(
          eq(messages.leadId, lead.id),
          eq(messages.userId, userId),
          eq(messages.direction, 'outbound'),
          sql`metadata->>'step' = 'auto-reply'`,
          sql`metadata->>'campaignId' = ${campaignId}`
        ));

      const isSubsequentReply = previousAutoReplies.length > 0;

      const pastEmails = await db.select({ subject: campaignEmails.subject, body: campaignEmails.body, sentAt: campaignEmails.sentAt })
        .from(campaignEmails)
        .where(and(eq(campaignEmails.campaignId, campaign.id), eq(campaignEmails.leadId, lead.id)))
        .orderBy(asc(campaignEmails.stepIndex));

      const adjustment = await adjustCopyIfNecessary({
        userId,
        leadId: lead.id,
        originalBody: body,
        originalSubject: subject,
        isSubsequentReply, // Pass hint to AI for better brainstorming
        sequenceHistory: pastEmails as any
      });
      if (adjustment.adjusted) {
        body = adjustment.body;
      }
    } catch (err) {
      console.warn(`[CampaignWorker] Auto-reply copy adjustment failed, using standard body`);
    }
  }

  const trackingId = Math.random().toString(36).substring(2, 11);

  // --- THREADING LOGIC: always reply to the lead's last message ---
  let inReplyTo: string | undefined = undefined;
  let references: string | undefined = undefined;
  let threadId: string | undefined = undefined;

  try {
    const allMessages = await db.select()
      .from(messages)
      .where(eq(messages.leadId, lead.id))
      .orderBy(asc(messages.createdAt));

    if (allMessages.length > 0) {
      // Use the LAST message (lead's inbound reply) as the inReplyTo target
      const lastMsg = allMessages[allMessages.length - 1];
      const lastMeta = (lastMsg.metadata as any) || {};
      const lastId = lastMsg.externalId || lastMeta.externalId;

      threadId = lastMeta.providerThreadId || lastMeta.threadId;

      if (lastId) {
        inReplyTo = lastId;
        const refs = allMessages
          .map(m => m.externalId || ((m.metadata as any)?.externalId))
          .filter(Boolean)
          .join(' ');
        references = `${lastId}${refs ? ' ' + refs : ''}`;
      }
    }
  } catch (threadErr) {
    console.warn(`[CampaignWorker] Failed to fetch threading headers for auto-reply ${lead.id}:`, threadErr);
  }

  await sendEmail(userId, lead.email, body, subject, {
    isRaw: true,
    isHtml: true,
    trackingId,
    campaignId,
    leadId: lead.id,
    integrationId,
    allowedIntegrationIds: (campaign.config as any)?.mailboxIds,
    isPriorityReply: true, // Auto-replies always have priority
    inReplyTo,
    references,
    threadId,
    replyTo: (campaign.config as any)?.replyTo
  });

  // Record message
  await storage.createMessage({
    userId,
    leadId: lead.id,
    provider: 'email',
    direction: 'outbound',
    subject,
    body,
    trackingId,
    metadata: { 
      campaignId, 
      step: 'auto-reply', 
      integrationId,
      inReplyTo,
      references,
      providerThreadId: threadId
    }
  });

  // Update campaign lead: clear pendingAutoReply flag
  const newMetadata = { ...(leadEntry.metadata as Record<string, any> || {}) };
  delete newMetadata.pendingAutoReply;

  await withDbRetry(() => db.update(campaignLeads)
    .set({
      metadata: newMetadata,
      updatedAt: new Date()
    })
    .where(eq(campaignLeads.id, campaignLeadId)));

  // Stats
  await processStatsUpdate({ type: 'campaign:update-stats', campaignId, userId }).catch((err) => console.warn(`[CampaignWorker] processStatsUpdate (auto-reply) failed: ${err.message}`));

  await markJobSent(autoreplyJobId).catch((err) => console.warn(`[CampaignWorker] markJobSent (auto-reply) failed: ${err.message}`));
  wsSync.notifyLeadsUpdated(userId, { leadId: lead.id, action: 'auto_reply_sent' });
  wsSync.notifyCampaignStatsUpdated(userId, campaignId);
  wsSync.notifyStatsUpdated(userId);

  console.log(`[CampaignWorker] 💬 Auto-reply sent to ${lead.email}`);
}

/**
 * Aggregate and push campaign stats via WebSocket.
 */
async function processStatsUpdate(data: StatsUpdateJobData): Promise<void> {
  if (!db) return;

  const { campaignId, userId } = data;

  // Verify campaign still exists
  const [campaign] = await db.select().from(outreachCampaigns)
    .where(eq(outreachCampaigns.id, campaignId));

  if (!campaign || campaign.status === 'aborted' || campaign.status === 'paused') return;

  // Aggregate live stats
  const leadStats = await db.select({
    status: campaignLeads.status,
    count: sql<number>`count(*)`
  })
    .from(campaignLeads)
    .where(eq(campaignLeads.campaignId, campaignId))
    .groupBy(campaignLeads.status);

  const stats: Record<string, number> = { total: 0, sent: 0, failed: 0, pending: 0, replied: 0, queued: 0, processing: 0, aborted: 0 };

  leadStats.forEach((s: any) => {
    stats.total += Number(s.count);
    if (stats[s.status] !== undefined) stats[s.status] += Number(s.count);
  });

  // Update campaign stats in DB — merge with existing to preserve opened/clicked/consecutive_failures
  const [existingCampaign] = await withDbRetry(() => db.select({ stats: outreachCampaigns.stats })
    .from(outreachCampaigns)
    .where(eq(outreachCampaigns.id, campaignId)));
  const existingStats = (existingCampaign?.stats as any) || {};

  await withDbRetry(() => db.update(outreachCampaigns)
    .set({ 
      stats: {
        total: stats.total || 0,
        sent: stats.sent || 0,
        replied: stats.replied || 0,
        bounced: stats.bounced || 0,
        opened: existingStats.opened || 0,
        clicked: existingStats.clicked || 0,
        consecutive_failures: existingStats.consecutive_failures || 0,
      } as any, 
      updatedAt: new Date() 
    })
    .where(eq(outreachCampaigns.id, campaignId)));

  // X8 Fix: Check if campaign is complete.
  // A campaign is complete when ALL leads have been sent (no pending OR queued leads remain)
  // AND no leads are still in the 'sent' state waiting for a follow-up step.
  const pendingOrQueued = (stats.pending || 0) + (stats.queued || 0) + (stats.processing || 0);

  if (pendingOrQueued === 0 && stats.total > 0 && campaign.status === 'active') {
    // Check if all follow-up sequences are also complete (no leads still waiting for next step)
    const pendingFollowUps = await db.select({ count: sql<number>`count(*)` })
      .from(campaignLeads)
      .where(and(
        eq(campaignLeads.campaignId, campaignId),
        eq(campaignLeads.status, 'sent') // 'sent' means waiting for follow-up
      ));

    if (Number(pendingFollowUps[0]?.count || 0) === 0) {
      await withDbRetry(() => db.update(outreachCampaigns)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(eq(outreachCampaigns.id, campaignId)));

      // TOCTOU race: a follow-up or auto-reply job may have been added to Redis
      // between the check above and this cleanup. A small delay reduces the window.
      await new Promise(r => setTimeout(r, 2000));

      // Full Redis cleanup: removes heartbeat jobs + delayed follow-ups + failed records
      await campaignQueueManager.completeCampaign(campaignId);

      // Notify user via WebSocket + notification
      wsSync.notifyCampaignsUpdated(userId);
      await storage.createNotification({
        userId,
        type: 'system',
        title: '🏁 Campaign Completed',
        message: `Your campaign has finished processing all ${stats.total} leads.`,
        metadata: { campaignId, activityType: 'campaign_completed' }
      }).catch((err) => console.warn(`[CampaignQueue] Notification creation failed: ${err.message}`)); // non-blocking

      console.log(`[CampaignWorker] 🏁 Campaign ${campaignId} completed! (${stats.total} total leads)`);
    }
  }

  // Push to dashboard
  wsSync.notifyCampaignStatsUpdated(userId, campaignId);
  wsSync.notifyStatsUpdated(userId);
}

// ─── Shared Email Delivery Helper ────────────────────────────────────────────

async function deliverCampaignEmail(
  userId: string,
  campaign: any,
  lead: any,
  leadEntry: any,
  integrationId: string
): Promise<void> {
  // Respect weekend exclusion — skip delivery if weekends are excluded and today is a weekend
  if (campaign.excludeWeekends && isWeekend()) {
    console.log(`[CampaignWorker] 🌙 Weekend — skipping delivery for lead ${lead.id.slice(-8)} (excludeWeekends enabled)`);
    return;
  }

  const template = campaign.template as any;
  let subject = template?.initial?.subject || template?.subject || 'Contacting you';
  let body = template?.initial?.body || template?.body;

  // Follow-up logic: use the correct template for the current step
  let variantId = 'standard';
  let isBreakup = false;

  const threadFollowUp = (campaign.config as any)?.threadFollowUp !== false;

  if (leadEntry.currentStep > 0) {
    const followups = (campaign.template as any)?.followups || [];
    const fuConfig = followups[leadEntry.currentStep - 1];
    if (fuConfig) {
      body = fuConfig.body || body;
      const fuSubject = fuConfig.subject || subject;
      subject = threadFollowUp
        ? (fuSubject.toLowerCase().startsWith('re:') ? fuSubject : `Re: ${fuSubject}`)
        : fuSubject;
      isBreakup = fuConfig.isBreakup || false;
    }
  }

  // ── PRE-CRAFTED COPY (check BEFORE any AI call to avoid waste) ───────
  if (leadEntry.metadata?.preCraftedCopy) {
    console.log(`[CampaignWorker] ⚡ Using pre-crafted copy for lead ${lead.id.slice(-8)}`);
    body = leadEntry.metadata.preCraftedCopy;
  }
  // ── AI GENERATION CAP (initial step only, max 200 AI calls/campaign) ─
  else if (leadEntry.currentStep === 0) {
    const stats = (campaign.stats as any) || {};
    const aiCap = (campaign.config as any)?.aiGenerationCap || 200;
    const aiGeneratedCount = stats.aiGeneratedCount || 0;

    if (aiGeneratedCount < aiCap) {
      try {
        if (campaign.aiAutonomousMode) {
          const testResult = await handleAutonomousTesting(campaign, lead, userId);
          subject = testResult.subject;
          body = testResult.body;
          variantId = testResult.variantId;
        } else {
          const aiContent = await generateExpertOutreach(lead, userId);
          subject = aiContent.subject || subject;
          body = aiContent.body || body;
        }
        // Atomic increment of aiGeneratedCount to avoid race conditions
        await withDbRetry(() => db.update(outreachCampaigns)
          .set({
            stats: sql`jsonb_set(COALESCE(stats, '{}'::jsonb), '{aiGeneratedCount}', to_jsonb(COALESCE((stats->>'aiGeneratedCount')::int, 0) + 1))`
          })
          .where(eq(outreachCampaigns.id, campaign.id)));
      } catch (e) {
        console.warn(`[CampaignWorker] AI generation failed, using template fallback:`, e);
      }
    } else {
      console.log(`[CampaignWorker] 🧠 AI cap reached (${aiGeneratedCount}/${aiCap}) for campaign ${campaign.id.slice(-8)}. Using template for lead ${lead.id.slice(-8)}.`);
    }
  }

  // BUG #4/#9 FIX: Hard guard — if body is still empty/undefined, abort with a clear error
  if (!body) {
    throw new Error(`Campaign "${campaign.name}" has no email body for step ${leadEntry.currentStep}. Please edit the campaign template.`);
  }

  // AI Adjustment Toggle: Check campaign config (for follow-ups specifically)
  if (leadEntry.currentStep > 0 && (campaign.config as any)?.aiAdjustCopy) {
    try {
      const pastEmails = await db!.select({ subject: campaignEmails.subject, body: campaignEmails.body, sentAt: campaignEmails.sentAt })
        .from(campaignEmails)
        .where(and(eq(campaignEmails.campaignId, campaign.id), eq(campaignEmails.leadId, lead.id)))
        .orderBy(asc(campaignEmails.stepIndex));

      const totalSteps = ((campaign.template as any)?.followups?.length || 0) + 1;

      const adjustment = await adjustCopyIfNecessary({
        userId,
        leadId: lead.id,
        originalBody: body,
        originalSubject: subject,
        currentStepIndex: leadEntry.currentStep,
        totalSteps,
        sequenceHistory: pastEmails as any,
        isBreakup
      });
      if (adjustment.adjusted) {
        body = adjustment.body;
      }
    } catch (err) {
      console.error(`[CampaignWorker] AI Adjustment failed for follow-up ${lead.id}:`, err);
    }
  }


  // Variable replacement
  const rawLeadName = lead.name?.trim();
  const cleanName = rawLeadName === 'Unknown' ? undefined : rawLeadName;
  const firstName = cleanName?.split(' ')[0] || 'there';
  const lastName = cleanName?.split(' ').slice(1).join(' ') || 'there';
  const fullName = cleanName || firstName;
  const company = (lead as any).company?.trim() || 'your company';
  const meta = (lead as any).metadata || {};
  const city = meta.city || (lead as any).city || '';
  const industry = meta.industry || '';
  const niche = meta.niche || '';
  const website = meta.website || '';
  body = body
    .replace(/{{firstName}}/g, firstName)
    .replace(/{{lastName}}/g, lastName)
    .replace(/{{name}}/g, fullName)
    .replace(/{{lead_name}}/g, fullName)
    .replace(/{{company}}/g, company)
    .replace(/{{business_name}}/g, company)
    .replace(/{{city}}/g, city)
    .replace(/{{industry}}/g, industry)
    .replace(/{{niche}}/g, niche)
    .replace(/{{website}}/g, website);

  subject = subject
    .replace(/{{firstName}}/g, firstName)
    .replace(/{{lastName}}/g, lastName)
    .replace(/{{name}}/g, fullName)
    .replace(/{{lead_name}}/g, fullName)
    .replace(/{{company}}/g, company)
    .replace(/{{business_name}}/g, company)
    .replace(/{{city}}/g, city)
    .replace(/{{industry}}/g, industry)
    .replace(/{{niche}}/g, niche)
    .replace(/{{website}}/g, website);

  // --- PHASE 51: AUTONOMOUS COMPLIANCE GUARD ---
  // Universal SafetyGuard: Catch hallucinations, placeholders, and tone issues in ALL outreach
  try {
    const { SafetyGuard } = await import('@shared/lib/monitoring/safety-guard.js');
    const safetyResult = await SafetyGuard.sanitizeResponse(body, subject);
    body = safetyResult.body;
    subject = safetyResult.subject;

    if (safetyResult.wasFlagged) {
      console.log(`[CampaignWorker] 🛡️ SafetyGuard sanitized outreach for lead ${lead.id}: ${safetyResult.flagReasons?.join(', ')}`);
    }
  } catch (safetyErr) {
    console.warn(`[CampaignWorker] SafetyGuard scan skipped due to error:`, safetyErr);
  }

  // Ensure we always have a professional opt-out to prevent 'marked as spam' blocks
  const lowerBody = body.toLowerCase();
  if (!lowerBody.includes('unsubscribe') && !lowerBody.includes('opt out') && !lowerBody.includes('stop receiving')) {
    const unsubscribeLink = `${process.env.PUBLIC_URL || 'https://audnixai.com'}/api/unsubscribe/${lead.id}`;
    body += `\n\n---\n<p style="color: #666; font-size: 11px;">Don't want to hear from me again? <a href="${unsubscribeLink}">Unsubscribe here</a></p>`;
  }

  const trackingId = Math.random().toString(36).substring(2, 11);

  // ── PRE-SEND IDEMPOTENCY WRITE ─────────────────────────────────────
  // Insert BEFORE sendEmail so two concurrent workers racing past the SELECT
  // guard are blocked at the DB layer by the unique index. We use status='sending'
  // so a crashed worker leaves a recoverable stale record instead of a false 'sent'.
  const insertResult = await withDbRetry(() => db!.insert(campaignEmails)
    .values({
      campaignId: campaign.id,
      leadId: lead.id,
      userId,
      messageId: trackingId,
      subject,
      body,
      stepIndex: leadEntry.currentStep,
      integrationId,
      isWarmup: false,
      status: 'sending',
    })
    .onConflictDoNothing({
      target: [campaignEmails.campaignId, campaignEmails.leadId, campaignEmails.stepIndex],
    })
    .returning({ id: campaignEmails.id }));

  if (insertResult.length === 0) {
    // Conflict — check if it's a stale 'sending' record from a crashed worker
    const [existing] = await db.select({ status: campaignEmails.status, sentAt: campaignEmails.sentAt })
      .from(campaignEmails)
      .where(and(
        eq(campaignEmails.campaignId, campaign.id),
        eq(campaignEmails.leadId, lead.id),
        eq(campaignEmails.stepIndex, leadEntry.currentStep)
      ))
      .limit(1);

    if (existing?.status === 'sent') {
      console.log(`[CampaignWorker] ⚡ PG idempotency: lead ${lead.id} step ${leadEntry.currentStep} already sent by another worker — skipping.`);
      return;
    }

    if (existing?.status === 'sending') {
      const isStale = Date.now() - new Date(existing.sentAt).getTime() > 15 * 60 * 1000;
      if (!isStale) {
        console.log(`[CampaignWorker] ⏳ PG idempotency: lead ${lead.id} step ${leadEntry.currentStep} is actively being sent by another worker — skipping.`);
        return;
      }
      // Stale — delete and continue so this retry can attempt delivery
      console.log(`[CampaignWorker] 🧹 Stale 'sending' record found for lead ${lead.id} step ${leadEntry.currentStep} — cleaning up and retrying.`);
      await withDbRetry(() => db!.delete(campaignEmails)
        .where(and(
          eq(campaignEmails.campaignId, campaign.id),
          eq(campaignEmails.leadId, lead.id),
          eq(campaignEmails.stepIndex, leadEntry.currentStep)
        ))).catch((err) => console.warn(`[CampaignWorker] Failed to delete stale sending record: ${err.message}`));
    } else {
      console.log(`[CampaignWorker] ⚡ PG idempotency: lead ${lead.id} step ${leadEntry.currentStep} already sent by another worker — skipping.`);
      return;
    }
  }

  // Phase 16: Send Guard (Idempotency)
  // Prevents duplicate sends if a job is retried by BullMQ after a partial timeout
  const { acquireLock, releaseLock } = await import('@shared/lib/redis/redis.js');
  const lockKey = `send_guard:${campaign.id}:${lead.id}:${leadEntry.currentStep}`;
  // BUG #3 FIX: Pass failOpen:true so sends proceed when Redis is unavailable.
  // Without this, a Redis outage silently aborts every single outreach job.
  const hasLock = await acquireLock(lockKey, 300, true);

  if (!hasLock) {
    console.warn(`[CampaignWorker] 🛡️ Send Guard triggered for campaign ${campaign.id}, lead ${lead.id}. Already sending...`);
    return;
  }

  // ── CROSS-CAMPAIGN SEND DEDUP ──────────────────────────────────────
  // Prevent a lead from receiving emails from multiple campaigns within 1 hour.
  // Uses Redis for speed, falls back to PG for reliability.
  let alreadySent = false;
  try {
    const { getRedisClient } = await import('@shared/lib/redis/redis.js');
    const redisClient = await getRedisClient();
    if (redisClient) {
      const lastSendKey = `lead:last_email:${lead.id}`;
      alreadySent = !!(await redisClient.get(lastSendKey));
    }
  } catch {
    // Redis unavailable - fall through to PG check
  }

  // PG fallback for cross-campaign dedup (when Redis is unavailable)
  if (!alreadySent) {
    try {
      const pgDedup = await db.execute(sql`
        SELECT 1 FROM campaign_emails
        WHERE lead_id = ${lead.id}::uuid
        AND campaign_id != ${campaign.id}::uuid
        AND status = 'sent'
        AND sent_at >= NOW() - INTERVAL '1 hour'
        LIMIT 1
      `);
      alreadySent = pgDedup.rows.length > 0;
    } catch (err) {
      console.warn(`[CampaignQueue] Cross-campaign dedup PG check failed:`, err);
    }
  }

  if (alreadySent) {
    console.warn(`[CampaignWorker] Cross-campaign dedup: lead ${lead.id} already emailed within last hour. Skipping campaign ${campaign.id}.`);
    await releaseLock(lockKey);
    return;
  }

  // --- THREADING LOGIC: reference the initial email when threadFollowUp is enabled ---
  let inReplyTo: string | undefined = undefined;
  let references: string | undefined = undefined;
  let threadId: string | undefined = undefined;

  let emailSent = false;
  try {
    // Determine if this is a priority reply
    const isPriorityReply = leadEntry.currentStep > 0 && (lead.status === 'replied' || lead.status === 'interested' || lead.status === 'warm');

    if (threadFollowUp) {
      try {
        const allMessages = await db.select()
          .from(messages)
          .where(eq(messages.leadId, lead.id))
          .orderBy(asc(messages.createdAt));

        if (allMessages.length > 0) {
          // Use the LAST message as the inReplyTo target for proper threading
          const refMsg = allMessages[allMessages.length - 1];
          const refMeta = (refMsg.metadata as any) || {};
          const refId = refMsg.externalId || refMeta.externalId;

          threadId = refMeta.providerThreadId || refMeta.threadId;

          if (refId) {
            inReplyTo = refId;
            const refs = allMessages
              .map(m => m.externalId || ((m.metadata as any)?.externalId))
              .filter(Boolean)
              .join(' ');
            references = `${refId}${refs ? ' ' + refs : ''}`;
          }
        }
      } catch (threadErr) {
        console.warn(`[CampaignWorker] Failed to fetch threading headers for lead ${lead.id}:`, threadErr);
      }
    }

    await sendEmail(userId, lead.email, body, subject, {
      isRaw: true,
      isHtml: true,
      trackingId: campaign.config?.isManual ? undefined : trackingId,
      campaignId: campaign.id,
      leadId: lead.id,
      integrationId,
      allowedIntegrationIds: (campaign.config as any)?.mailboxIds,
      isPriorityReply,
      inReplyTo,
      references,
      threadId,
      replyTo: (campaign.config as any)?.replyTo
    });
    emailSent = true;
  } catch (err: any) {
    // Release lock on error so BullMQ retry can re-acquire it
    await releaseLock(lockKey);
    // If sendEmail never succeeded, delete the pre-send idempotency record
    // so the next BullMQ retry can attempt delivery again.
    if (!emailSent) {
      await withDbRetry(() => db!.delete(campaignEmails)
        .where(and(
          eq(campaignEmails.campaignId, campaign.id),
          eq(campaignEmails.leadId, lead.id),
          eq(campaignEmails.stepIndex, leadEntry.currentStep)
        ))).catch((err) => console.warn(`[CampaignWorker] Failed to delete sending record on error: ${err.message}`));
    }
    throw err;
  }

  // BUG #8 FIX: Release lock after successful send so future jobs aren't blocked
  // by an expired but still-held 5-minute lock from the previous successful send.
  await releaseLock(lockKey);

  // ── CROSS-CAMPAIGN DEDUP: Mark lead as emailed for 1 hour ──────────
  try {
    const { getRedisClient } = await import('@shared/lib/redis/redis.js');
    const redisClient = await getRedisClient();
    if (redisClient) {
      await redisClient.set(`lead:last_email:${lead.id}`, Date.now().toString(), { EX: 3600 });
    }
  } catch (err) {
    console.warn(`[CampaignQueue] Cross-campaign dedup Redis set failed:`, err);
  }

  // Phase 17: Atomic Post-Send Transaction
  // Ensures that message creation, lead status update, and stats all succeed together
  await db!.transaction(async (tx: any) => {
    // Update lead integrationId if not set
    if (!lead.integrationId) {
      await tx.update(leads)
        .set({ integrationId, updatedAt: new Date() })
        .where(eq(leads.id, lead.id));
    }

    // Save message — BUG #7 FIX: use consistent 'integrationId' key name everywhere
    await storage.createMessage({
      userId,
      leadId: lead.id,
      provider: 'email',
      direction: 'outbound',
      subject,
      body,
      integrationId,
      trackingId,
      metadata: { 
        campaignId: campaign.id, 
        step: leadEntry.currentStep, 
        integrationId, 
        integration_id: integrationId,
        variantId, // Track A/B variant for optimization
        inReplyTo,
        references,
        providerThreadId: threadId
      }
    }, tx as any); // Pass transaction client to storage

    // Update campaign lead status
    const newMetadata = { ...(leadEntry.metadata as Record<string, any> || {}) };
    
    // Track initial send date for relative follow-up scheduling
    if (leadEntry.currentStep === 0 && !newMetadata.initialSentAt) {
      newMetadata.initialSentAt = new Date().toISOString();
    }

    const nextStep = leadEntry.currentStep + 1;
    const followupsArr = (campaign.template as any)?.followups || [];
    const hasMore = nextStep <= followupsArr.length;
    let nextActionAt = null;

    if (hasMore) {
      const delayDays = followupsArr[nextStep - 1]?.delayDays || 3;
      if (campaign.excludeWeekends) {
        if (newMetadata.initialSentAt) {
          nextActionAt = addBusinessDays(new Date(newMetadata.initialSentAt), delayDays);
        } else {
          nextActionAt = addBusinessDays(new Date(), delayDays);
        }
      } else {
        if (newMetadata.initialSentAt) {
          nextActionAt = new Date(newMetadata.initialSentAt);
          nextActionAt.setDate(nextActionAt.getDate() + delayDays);
        } else {
          nextActionAt = new Date();
          nextActionAt.setDate(nextActionAt.getDate() + delayDays);
        }
      }
    }

    await tx.update(campaignLeads)
      .set({
        status: 'sent',
        currentStep: nextStep,
        nextActionAt,
        sentAt: new Date(),
        error: null,
        metadata: newMetadata
      })
      .where(eq(campaignLeads.id, leadEntry.id));

    // Promote campaignEmails from 'sending' to 'sent'
    await tx.update(campaignEmails)
      .set({ status: 'sent', sentAt: new Date() })
      .where(and(
        eq(campaignEmails.campaignId, campaign.id),
        eq(campaignEmails.leadId, lead.id),
        eq(campaignEmails.stepIndex, leadEntry.currentStep)
      ));

    // Increment campaign sent count
    await tx.update(outreachCampaigns)
      .set({
        stats: sql`jsonb_set(stats, '{sent}', (COALESCE((stats->>'sent')::int, 0) + 1)::text::jsonb)`,
        updatedAt: new Date()
      })
      .where(eq(outreachCampaigns.id, campaign.id));
  });

  console.log(`[CampaignWorker] ✅ Campaign "${campaign.name}" step ${leadEntry.currentStep} → ${lead.email} via ${integrationId}`);
}

/**
 * Helper to deliver campaign message via Instagram
 */
async function deliverCampaignInstagram(
  userId: string,
  campaign: any,
  lead: any,
  leadEntry: any,
  integrationId: string
): Promise<void> {
  const { sendInstagramOutreach } = await import('../channels/instagram.js');
  
  let body = (campaign.template as any).body || "";
  if (leadEntry.currentStep > 0) {
    const followups = (campaign.template as any)?.followups || [];
    const fuConfig = followups[leadEntry.currentStep - 1];
    if (fuConfig) body = fuConfig.body;
  }

  // AI Adjustment Toggle: Check campaign config (for follow-ups specifically)
  if (leadEntry.currentStep > 0 && (campaign.config as any)?.aiAdjustCopy) {
    try {
      const pastMessages = await db!.select({ subject: campaignEmails.subject, body: campaignEmails.body, sentAt: campaignEmails.sentAt })
        .from(campaignEmails)
        .where(and(eq(campaignEmails.campaignId, campaign.id), eq(campaignEmails.leadId, lead.id)))
        .orderBy(asc(campaignEmails.stepIndex));

      const totalSteps = ((campaign.template as any)?.followups?.length || 0) + 1;

      const adjustment = await adjustCopyIfNecessary({
        userId,
        leadId: lead.id,
        originalBody: body,
        currentStepIndex: leadEntry.currentStep,
        totalSteps,
        sequenceHistory: pastMessages as any
      });
      if (adjustment.adjusted) {
        body = adjustment.body;
      }
    } catch (err) {
      console.error(`[CampaignWorker] IG AI Adjustment failed for lead ${lead.id}:`, err);
    }
  }

  // Personalization
  const rawLeadName = lead.name?.trim();
  const cleanName = rawLeadName === 'Unknown' ? undefined : rawLeadName;
  const firstName = cleanName?.split(' ')[0] || 'there';
  const lastName = cleanName?.split(' ').slice(1).join(' ') || 'there';
  const fullName = cleanName || firstName;
  const company = (lead as any).company?.trim() || 'your company';
  const meta = (lead as any).metadata || {};
  const city = meta.city || (lead as any).city || '';
  const industry = meta.industry || '';
  const niche = meta.niche || '';
  const website = meta.website || '';
  body = body
    .replace(/{{firstName}}/g, firstName)
    .replace(/{{lastName}}/g, lastName)
    .replace(/{{name}}/g, fullName)
    .replace(/{{lead_name}}/g, fullName)
    .replace(/{{company}}/g, company)
    .replace(/{{business_name}}/g, company)
    .replace(/{{city}}/g, city)
    .replace(/{{industry}}/g, industry)
    .replace(/{{niche}}/g, niche)
    .replace(/{{website}}/g, website);

  // ── PRE-SEND IDEMPOTENCY WRITE ─────────────────────────────────────
  const igMessageId = `ig:${campaign.id}:${lead.id}:${leadEntry.currentStep}:${Date.now()}`;
  const insertResult = await withDbRetry(() => db!.insert(campaignEmails)
    .values({
      campaignId: campaign.id,
      leadId: lead.id,
      userId,
      messageId: igMessageId,
      subject: 'Instagram DM',
      body,
      stepIndex: leadEntry.currentStep,
      integrationId,
      isWarmup: false,
      status: 'sending',
    })
    .onConflictDoNothing({
      target: [campaignEmails.campaignId, campaignEmails.leadId, campaignEmails.stepIndex],
    })
    .returning({ id: campaignEmails.id }));

  if (insertResult.length === 0) {
    // Conflict — check if it's a stale 'sending' record from a crashed worker
    const [existing] = await db.select({ status: campaignEmails.status, sentAt: campaignEmails.sentAt })
      .from(campaignEmails)
      .where(and(
        eq(campaignEmails.campaignId, campaign.id),
        eq(campaignEmails.leadId, lead.id),
        eq(campaignEmails.stepIndex, leadEntry.currentStep)
      ))
      .limit(1);

    if (existing?.status === 'sent') {
      console.log(`[CampaignWorker] ⚡ PG idempotency (IG): lead ${lead.id} step ${leadEntry.currentStep} already sent by another worker — skipping.`);
      return;
    }

    if (existing?.status === 'sending') {
      const isStale = Date.now() - new Date(existing.sentAt).getTime() > 15 * 60 * 1000;
      if (!isStale) {
        console.log(`[CampaignWorker] ⏳ PG idempotency (IG): lead ${lead.id} step ${leadEntry.currentStep} is actively being sent by another worker — skipping.`);
        return;
      }
      // Stale — delete and continue so this retry can attempt delivery
      console.log(`[CampaignWorker] 🧹 Stale 'sending' record (IG) found for lead ${lead.id} step ${leadEntry.currentStep} — cleaning up and retrying.`);
      await withDbRetry(() => db!.delete(campaignEmails)
        .where(and(
          eq(campaignEmails.campaignId, campaign.id),
          eq(campaignEmails.leadId, lead.id),
          eq(campaignEmails.stepIndex, leadEntry.currentStep)
        ))).catch((err) => console.warn(`[CampaignWorker] Failed to delete stale IG sending record: ${err.message}`));
    } else {
      console.log(`[CampaignWorker] ⚡ PG idempotency (IG): lead ${lead.id} step ${leadEntry.currentStep} already sent by another worker — skipping.`);
      return;
    }
  }

  // Phase 16: Send Guard (Idempotency)
  const { acquireLock, releaseLock } = await import('@shared/lib/redis/redis.js');
  const lockKey = `send_guard:ig:${campaign.id}:${lead.id}:${leadEntry.currentStep}`;
  // BUG #3 FIX: Pass failOpen:true so sends proceed when Redis is unavailable.
  const hasLock = await acquireLock(lockKey, 300, true);

  if (!hasLock) {
    console.warn(`[CampaignWorker] 🛡️ IG Send Guard triggered for campaign ${campaign.id}, lead ${lead.id}. Already sending...`);
    return;
  }

  let result: any;
  let igSent = false;
  try {
    result = await sendInstagramOutreach(userId, lead.id, body, {
      isAutonomous: true,
      metadata: { campaignId: campaign.id, step: leadEntry.currentStep, integrationId }
    });
    igSent = true;
  } catch (err: any) {
    await releaseLock(lockKey);
    // If sendInstagramOutreach never succeeded, delete the pre-send idempotency record
    // so the next BullMQ retry can attempt delivery again.
    if (!igSent) {
      await withDbRetry(() => db!.delete(campaignEmails)
        .where(and(
          eq(campaignEmails.campaignId, campaign.id),
          eq(campaignEmails.leadId, lead.id),
          eq(campaignEmails.stepIndex, leadEntry.currentStep)
        ))).catch((err) => console.warn(`[CampaignWorker] Failed to delete IG sending record on error: ${err.message}`));
    }
    throw err;
  }

  // Phase 17: Atomic Post-Send Transaction
  await db!.transaction(async (tx: any) => {
    // Promote campaignEmails from 'sending' to 'sent' and update with real messageId
    await tx.update(campaignEmails)
      .set({ status: 'sent', messageId: result?.messageId || igMessageId, sentAt: new Date() })
      .where(and(
        eq(campaignEmails.campaignId, campaign.id),
        eq(campaignEmails.leadId, lead.id),
        eq(campaignEmails.stepIndex, leadEntry.currentStep)
      ));

    // Update lead status
    const nextStep = leadEntry.currentStep + 1;
    const followupsArr = (campaign.template as any)?.followups || [];
    const hasMore = nextStep <= followupsArr.length;
    let nextActionAt = null;

    if (hasMore) {
      const delayDays = followupsArr[nextStep - 1]?.delayDays || 3;
      nextActionAt = new Date();
      nextActionAt.setDate(nextActionAt.getDate() + delayDays);
    }

    await tx.update(campaignLeads)
      .set({
        status: 'sent',
        currentStep: nextStep,
        nextActionAt,
        sentAt: new Date(),
        error: null,
      })
      .where(eq(campaignLeads.id, leadEntry.id));

    // Stats
    await tx.update(outreachCampaigns)
      .set({
        stats: sql`jsonb_set(stats, '{sent}', (COALESCE((stats->>'sent')::int, 0) + 1)::text::jsonb)`,
        updatedAt: new Date()
      })
      .where(eq(outreachCampaigns.id, campaign.id));
  });

  console.log(`[CampaignWorker] 📸 Instagram sent for campaign "${campaign.name}" to ${lead.externalId}`);
}

/**
 * Nightly Worker: Pre-crafts outreach copies for leads scheduled for tomorrow.
 * This avoids AI generation latency during the "Prime Window" peaks.
 */
async function processPreCraft(data: PreCraftJobData): Promise<void> {
  const { campaignId, userId } = data;

  // 1. Fetch leads whose nextActionAt is within the next 24 hours
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const eligibleLeads = await db.select({
    lead: leads,
    campaignLead: campaignLeads
  })
  .from(campaignLeads)
  .innerJoin(leads, eq(campaignLeads.leadId, leads.id))
  .where(and(
    eq(campaignLeads.campaignId, campaignId),
    eq(campaignLeads.status, 'queued'),
    lte(campaignLeads.nextActionAt, tomorrow)
  ))
  .limit(200); // 10x more pre-crafted leads per night for 30k campaigns

  if (eligibleLeads.length === 0) return;

  console.log(`[PreCraft] 🤖 Generating copies for ${eligibleLeads.length} leads in campaign ${campaignId.slice(-8)}`);

  const [campaign] = await db.select().from(outreachCampaigns).where(eq(outreachCampaigns.id, campaignId));
  if (!campaign) return;

  // Batch concurrency: process 5 at a time to respect AI rate limiters
  const CONCURRENCY = 5;
  for (let i = 0; i < eligibleLeads.length; i += CONCURRENCY) {
    const batch = eligibleLeads.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (row) => {
      const lead = row.lead;
      const leadEntry = row.campaignLead;

      try {
        let subject = (campaign.template as any)?.initial?.subject || (campaign.template as any)?.subject;
        let body = (campaign.template as any)?.initial?.body || (campaign.template as any)?.body;

        // Follow-up check
        let isBreakup = false;
        if (leadEntry.currentStep > 0) {
          const followups = (campaign.template as any)?.followups || [];
          const fuConfig = followups[leadEntry.currentStep - 1];
          if (fuConfig) {
            body = fuConfig.body || body;
            isBreakup = fuConfig.isBreakup || false;
          }
        }

        // Generate the copy
        const aiContent = await generateExpertOutreach(lead as any, userId);
        let preCraftedBody = aiContent.body || body;

        // Apply adjustment if necessary
        const adjustment = await adjustCopyIfNecessary({
          userId,
          leadId: lead.id,
          originalBody: preCraftedBody,
          originalSubject: subject,
          currentStepIndex: leadEntry.currentStep,
          isBreakup
        });

        if (adjustment.adjusted) {
          preCraftedBody = adjustment.body;
        }

        // Save to metadata
        const metadata = { ...(leadEntry.metadata as any || {}), preCraftedCopy: preCraftedBody, preCraftedAt: new Date().toISOString() };
        await withDbRetry(() => db.update(campaignLeads)
          .set({ metadata })
          .where(eq(campaignLeads.id, leadEntry.id)));

      } catch (err: any) {
        console.warn(`[PreCraft] Failed for lead ${lead.id.slice(-8)}:`, err.message);
      }
    }));
  }
}

async function resetCampaignFailureCount(campaignId: string): Promise<void> {
  await withDbRetry(() => db!.update(outreachCampaigns)
    .set({
      stats: sql`jsonb_set(stats, '{consecutive_failures}', '0')`,
    })
    .where(eq(outreachCampaigns.id, campaignId)));
}

/**
 * Circuit Breaker: Handle and increment failures
 */
async function handleCampaignFailure(campaignId: string): Promise<void> {
  const [campaign] = await db!.select().from(outreachCampaigns).where(eq(outreachCampaigns.id, campaignId));
  if (!campaign) return;

  // Atomic increment at DB level to prevent race conditions when multiple
  // mailbox workers fail simultaneously (1K mailboxes = up to 1K concurrent workers).
  await withDbRetry(() => db!.update(outreachCampaigns)
    .set({
      stats: sql`jsonb_set(stats, '{consecutive_failures}', ((COALESCE((stats->>'consecutive_failures')::int, 0) + 1))::text::jsonb)`,
    })
    .where(eq(outreachCampaigns.id, campaignId)));

  // Re-read the actual value after atomic increment
  const [updated] = await withDbRetry(() => db!.select({ stats: outreachCampaigns.stats })
    .from(outreachCampaigns)
    .where(eq(outreachCampaigns.id, campaignId)));
  const currentFailures = Number((updated.stats as any)?.consecutive_failures || 0);

  // Threshold: 3 consecutive failures aborts/pauses the campaign
  if (currentFailures >= 3) {
    console.error(`[CampaignWorker] 🚨 CIRCUIT BREAKER: Campaign ${campaignId} hit 3 failures. PAUSING.`);
    await campaignQueueManager.pauseCampaign(campaignId);
    await withDbRetry(() => db!.update(outreachCampaigns)
      .set({ status: 'paused', updatedAt: new Date() })
      .where(eq(outreachCampaigns.id, campaignId)));
      
    // Notify user - via storage helper if exists, or system message
    await storage.createNotification({
      userId: campaign.userId,
      type: 'system',
      title: 'Campaign Paused: High Failure Rate',
      message: `Your campaign "${campaign.name}" has been paused after 3 consecutive errors. Please check your mailbox connection.`,
    });
  }
}

// ─── Initialize Worker ──────────────────────────────────────────────────────

/**
 * Handles A/B testing of subject lines and copy in autonomous mode.
 * Tests on the first 5-10 leads before selecting a winner.
 */
async function handleAutonomousTesting(
  campaign: any, 
  lead: any, 
  userId: string
): Promise<{ subject: string, body: string, variantId: string }> {
  const metadata = campaign.metadata || {};
  const testingVariants = metadata.testing_variants || [];
  const winningVariantId = metadata.winning_variant_id;

  if (winningVariantId) {
    const winner = testingVariants.find((v: any) => v.id === winningVariantId);
    if (winner) return { subject: winner.subject, body: winner.body, variantId: winner.id };
  }

  // Generate variants if they don't exist
  let variants = testingVariants;
  if (!variants || variants.length === 0) {
    console.log(`[CampaignWorker] 🧪 Generating testing variants for campaign ${campaign.id}...`);
    const aiResult = await generateExpertOutreach(lead, userId);
    
    // Create 3 distinct variants: Curiosity, Result, and a blended approach
    variants = [
      { id: 'v1_curiosity', subject: aiResult.subject, body: aiResult.body },
      { id: 'v2_result', subject: aiResult.alternatives?.[0] || aiResult.subject, body: aiResult.body },
      { id: 'v3_hybrid', subject: aiResult.alternatives?.[1] || `Question regarding ${lead.company || 'your team'}`, body: aiResult.body }
    ];
    
    await withDbRetry(() => db.update(outreachCampaigns)
      .set({ 
        metadata: { ...metadata, testing_variants: variants, testing_phase: 'active' } 
      })
      .where(eq(outreachCampaigns.id, campaign.id)));
  }

  // Deterministic assignment for the testing pool
  const leadSeed = lead.id ? parseInt(lead.id.substring(0, 2), 16) || 0 : 0;
  const selected = variants[leadSeed % variants.length];

  return { 
    subject: selected.subject, 
    body: selected.body, 
    variantId: selected.id 
  };
}

/**
 * Cleanup job: mark pending payments older than 7 days as 'expired'.
 * This prevents stale checkout links from indefinitely pausing campaigns.
 */
async function processPaymentCleanup(): Promise<void> {
  if (!db) return;
  console.log('[CleanupWorker] 🧹 Starting payment link cleanup...');
  
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  const result = await withDbRetry(() => db.update(pendingPayments)
    .set({ status: 'expired', updatedAt: new Date() })
    .where(
      and(
        eq(pendingPayments.status, 'pending'),
        or(
          lte(pendingPayments.createdAt, sevenDaysAgo),
          lte(pendingPayments.expiresAt, new Date())
        )
      )
    ).returning());
    
  if (result.length > 0) {
    console.log(`[CleanupWorker] ✅ Marked ${result.length} stale payment links as expired.`);
  }
}

export const campaignWorker = hasRedis ? new Worker<CampaignJobData>(
  'campaign-engine',
  processCampaignJob,
  {
    connection: createFreshConnection(), // dedicated connection — never shares socket with queues or other workers
    concurrency: parseInt(process.env.CAMPAIGN_CONCURRENCY || '50', 10),  // 50 slots — tuned for 1M+ scale (override via env)
    lockDuration:    parseInt(process.env.CAMPAIGN_LOCK_DURATION_MS    || '120000',  10), // 2min — AI generation + SMTP can take >30s
    stalledInterval: parseInt(process.env.CAMPAIGN_STALLED_INTERVAL_MS || '300000',  10), // 5min — prevents false duplicate-send retries
    maxStalledCount: parseInt(process.env.CAMPAIGN_MAX_STALLED_COUNT   || '3',       10), // tolerate 3 stalls before hard-failing job
    limiter: {
      // Prevents thundering-herd when 100+ mailbox jobs come due simultaneously on restart.
      // Set well above concurrency so normal operation is never throttled.
      max: parseInt(process.env.CAMPAIGN_RATE_MAX || '15', 10),  // throttled for small instances
      duration: 1000,
    },
    removeOnComplete: true,   // successful jobs are purged from Redis instantly — zero RAM spent on them
    removeOnFail: { count: 1000 },
  } as any
) : null;

if (campaignWorker) {
  campaignWorker.on('completed', (job) => {
    // Quiet logging — only for non-stats jobs to reduce noise
    if (job.data.type !== 'campaign:update-stats') {
      console.log(`[CampaignWorker] ✓ ${job.data.type} completed (${job.id})`);
    }
  });

  campaignWorker.on('failed', async (job, err) => {
    const jobType = job?.data?.type;
    const jobId = job?.id;
    console.error(`[CampaignWorker] ✗ ${jobType} failed (${jobId}):`, err.message);
    
    // M5 Fix: Structured audit logging for every job failure.
    // This ensures failures are never silent — they are always traceable.
    try {
      const userId = (job?.data as any)?.userId;
      const campaignId = (job?.data as any)?.campaignId;
      if (userId) {
        const { db: auditDb } = await import('@shared/lib/db/db.js');
        const { auditTrail } = await import('@audnix/shared');
        await auditDb.insert(auditTrail).values({
          userId,
          action: 'job_failed',
          details: {
            entityType: 'bullmq_job',
            entityId: campaignId || jobId || 'unknown',
            jobType,
            jobId,
            campaignId: campaignId || null,
            error: err.message,
            failedAt: new Date().toISOString(),
          }
        }).onConflictDoNothing();
      }
    } catch (auditErr: any) {
      // Audit failure must NEVER crash the worker error handler
      console.error('[CampaignWorker] Audit log failed (non-fatal):', auditErr.message);
    }

    // Pre-compute retry exhaustion status (needed by both state safety and cleanup)
    const attemptsMade  = job?.attemptsMade ?? 0;
    const maxAttempts   = (job?.opts as any)?.attempts ?? 3;
    const isPermanentlyFailed = attemptsMade >= maxAttempts;
    const campaignIdForCleanup = (job?.data as any)?.campaignId;

    // Circuit Breaker: Increment campaign failure count
    if (jobType === 'campaign:send-batch' && campaignIdForCleanup) {
      await handleCampaignFailure(campaignIdForCleanup);
    }

    // ── STATE SAFETY: Reconcile campaignLeads.status on permanent failure ──
    // If a job bubbles up an unhandled error, Postgres must still reflect the
    // terminal state. This ensures no lead stays 'pending' when it is dead.
    if (isPermanentlyFailed) {
      const leadId = (job?.data as any)?.campaignLeadId;
      if (leadId && campaignIdForCleanup && db) {
        try {
          await withDbRetry(() => db.update(campaignLeads)
            .set({
              status: 'failed',
              error: `[Worker Terminal] ${err.message.substring(0, 240)}`,
              updatedAt: new Date(),
            })
            .where(eq(campaignLeads.id, leadId)));
          console.log(`[CampaignWorker] 💀 Reconciled campaignLead ${leadId} to 'failed' after terminal job failure.`);
        } catch (reconcileErr: any) {
          console.error('[CampaignWorker] Lead reconciliation failed (non-fatal):', reconcileErr.message);
        }
      }
    }

    // Late-retry cleanup: if this job has exhausted ALL attempts and the campaign is already
    // completed, purge the failed record from Redis immediately.
    // This closes the gap where completeCampaign() ran before these retries finished.

    if (isPermanentlyFailed && campaignIdForCleanup && job) {
      try {
        const { db: cleanupDb } = await import('@shared/lib/db/db.js');
        const { outreachCampaigns: oCampaigns } = await import('@audnix/shared');
        const { eq: eqCleanup } = await import('drizzle-orm');
        const [campaignRow] = await cleanupDb
          .select({ status: oCampaigns.status })
          .from(oCampaigns)
          .where(eqCleanup(oCampaigns.id, campaignIdForCleanup))
          .limit(1);
        if (campaignRow?.status === 'completed' || campaignRow?.status === 'aborted') {
          await job.remove().catch((err) => console.warn(`[CampaignQueue] Failed to remove completed/aborted job: ${err.message}`));
        }
      } catch (e) { console.warn('[CampaignQueue] Failed to check/remove completed job (non-fatal):', e); }
    }
  });

  console.log(`✅ BullMQ Campaign Queue Worker initialized (concurrency: ${parseInt(process.env.CAMPAIGN_CONCURRENCY || '50', 10)})`);

  // Initialize Autonomous Scaler (Daily Optimization Cycle)
  // Using dynamic import with a safer relative path for the worker context
  const scalerPath = '../../../services/outreach-worker/src/outreach-lib/autonomous-scaler.js';
  import(scalerPath).then(({ AutonomousScalerService }) => {
    // Run immediately on start, then every 24 hours
    AutonomousScalerService.runOptimizationCycle().catch((err: any) => console.error('Initial Scaler Cycle failed:', err.message));
    setInterval(() => {
      AutonomousScalerService.runOptimizationCycle().catch((err: any) => console.error('Daily Scaler Cycle failed:', err.message));
    }, 12 * 60 * 60 * 1000); 
  }).catch((err: any) => {
    console.error('Failed to load AutonomousScalerService:', err.message);
  });
  
  // Schedule Global Cleanup Job (Daily at 2 AM UTC)
  if (campaignQueue) {
    campaignQueue.add('global-payment-cleanup', { type: 'system:cleanup-payments' }, {
      repeat: { pattern: '0 2 * * *' },
      jobId: 'global-payment-cleanup',
      removeOnComplete: true,
      removeOnFail: { count: 1000 },
    }).catch(err => console.error('Failed to schedule payment cleanup:', err.message));
  }

} else {
  console.warn('⚠️ BullMQ Campaign Queue Worker disabled (No Redis) — using setInterval fallback');
}

