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
import { redisConnection, hasRedis } from './redis-config.js';
export { hasRedis, redisConnection };
import { db } from '@shared/lib/db/db.js';
import {
  outreachCampaigns,
  campaignLeads,
  leads,
  messages,
  campaignEmails,
  integrations,
} from '@audnix/shared';
import { eq, and, or, sql, lte, isNull, ne, asc, gt } from 'drizzle-orm';
import { storage } from '@shared/lib/storage/storage.js';
import { sendEmail } from '../channels/email.js';
import { adjustCopyIfNecessary } from "../ai/copy-adjuster.js";
import { generateExpertOutreach } from "@services/brain-worker/src/ai-lib/core/conversation-ai.js";
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';
import { decryptToJSON } from '@shared/lib/crypto/encryption.js';
import { mailboxHealthService } from '@services/email-service/src/email/mailbox-health-service.js';
import { warmupService } from '@services/outreach-worker/src/outreach-lib/warmup-service.js';
import { getLeadProfile, isWithinLeadPreferredWindow, getOptimalSendProbability } from '../calendar/lead-timezone-intelligence.js';

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

type CampaignJobData = SendBatchJobData | FollowUpJobData | AutoReplyJobData | StatsUpdateJobData | AutonomousJobData | PreCraftJobData;

// ─── Queue & Worker ───────────────────────────────────────────────────────────

export const campaignQueue = hasRedis ? new Queue<CampaignJobData>('campaign-engine', {
  connection: redisConnection as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 300000, // 5 minutes (5min -> 15min -> 60min backoff for transient issues)
    },
    removeOnComplete: { count: 500 },
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

    const config = campaign.config || {};
    const mailboxIds: string[] = config.mailboxIds || [];
    const mailboxLimits: Record<string, number> = config.mailboxLimits || {};

    if (mailboxIds.length === 0) {
      console.warn(`[CampaignQueue] Campaign ${campaign.id} has no mailboxes assigned`);
      return;
    }

    console.log(`[CampaignQueue] 🚀 Starting campaign "${campaign.name}" with ${mailboxIds.length} mailbox(es)`);

    // Create a repeatable send-batch job for EACH mailbox independently
    for (const mbId of mailboxIds) {
      const dailyLimit = mailboxLimits[mbId] || 50;
      
      // Heartbeat: Run every 5 minutes to check for leads in their PRIME window.
      // This high frequency allows the worker to be lead-aware rather than linearly spaced.
      const jitteredRepeatMs = 300_000 + Math.floor(Math.random() * 60_000); 
      const jobKey = `send-batch_${campaign.id}_${mbId}`;

      if (campaignQueue) {
        await campaignQueue.add(jobKey, {
          type: 'campaign:send-batch',
          campaignId: campaign.id,
          userId: campaign.userId,
          integrationId: mbId,
          dailyLimit,
        }, {
          repeat: { every: jitteredRepeatMs },
          jobId: jobKey.replace(/:/g, '-'),
          priority: 2
        });
      } else {
        // [FALLBACK] No Redis — Start a local setInterval loop
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
        }, jitteredRepeatMs);
        this.fallbackIntervals.set(jobKey, interval);
        console.log(`[CampaignFallback] ⚡ Interval started for ${mbId} (${Math.round(jitteredRepeatMs/60000)}m)`);
      }
    }

    // Schedule a daily PRE-CRAFT job to generate AI copies for the next 24 hours
    const preCraftKey = `pre-craft_${campaign.id}`;
    if (campaignQueue) {
      await campaignQueue.add(preCraftKey, {
        type: 'campaign:pre-craft',
        campaignId: campaign.id,
        userId: campaign.userId
      }, {
        repeat: { pattern: '0 1 * * *' }, // Run daily at 1 AM UTC
        jobId: preCraftKey.replace(/:/g, '-')
      });
    }

    // Stats aggregation job (every 30s)
    await campaignQueue.add(`stats:${campaign.id}`, {
      type: 'campaign:update-stats',
      campaignId: campaign.id,
      userId: campaign.userId,
    }, {
      repeat: { every: 60_000 }, // Reduced from 30s to 60s for DB sanity
      jobId: `stats-${campaign.id}`,
    });

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

    // Remove delayed follow-up and auto-reply jobs
    const delayedJobs = await campaignQueue.getDelayed();
    for (const job of delayedJobs) {
      if ((job.data as any)?.campaignId === campaignId) {
        await job.remove();
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
      const jobId = `followup:${campaignId}:${campaignLeadId}:step${stepIndex}`;
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
    
    if (campaignQueue) {
      const jobId = `autoreply:${campaignId}:${campaignLeadId}:${Date.now()}`;
      await campaignQueue.add(jobId, {
        type: 'campaign:auto-reply',
        campaignId,
        userId,
        campaignLeadId,
        integrationId,
        leadId,
      }, {
        delay: delayMs,
        jobId,
        priority: 0,
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
}

export const campaignQueueManager = new CampaignQueueManager();

// ─── Worker: Process All Campaign Job Types ──────────────────────────────────

async function processCampaignJob(job: Job<CampaignJobData>): Promise<void> {
  const data = job.data;

  switch (data.type) {
    case 'campaign:send-batch':
      await processSendBatch(data);
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
    default:
      console.warn(`[CampaignWorker] Unknown job type: ${(data as any).type}`);
  }
}

// ─── Shared Helpers ──────────────────────────────────────────────────────────

/**
 * Get the number of outbound emails sent today by this mailbox.
 */
async function getMailboxSentCount(userId: string, integrationId: string): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(*) as count FROM messages
    WHERE user_id = ${userId}
    AND direction = 'outbound'
    AND integration_id = ${integrationId}::uuid
    AND created_at >= CURRENT_DATE::timestamp
  `);
  return Number(result.rows[0].count);
}

/**
 * Check if a pending auto-reply job exists for this specific mailbox in BullMQ.
 * Used by processSendBatch to yield when a reply is about to go out.
 */
export async function mailboxHasPendingReply(integrationId: string): Promise<boolean> {
  if (!campaignQueue) return false;
  try {
    // Check delayed jobs (not yet fired)
    const delayed = await campaignQueue.getDelayed();
    return delayed.some(j =>
      j.data.type === 'campaign:auto-reply' &&
      (j.data as AutoReplyJobData).integrationId === integrationId
    );
  } catch {
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

  // Neural Brain Smart Capping (applied to interval calculation)
  if (integration) {
    const tier = integration.tier || 'starter';
    if (tier !== 'enterprise') {
      const createdAt = new Date(integration.createdAt || Date.now());
      const isWarmed = (Date.now() - createdAt.getTime()) > (14 * 24 * 60 * 60 * 1000);
      const smartCap = isWarmed ? 60 : 45; // Use conservative 45 for interval spreading
      effectiveDailyLimit = Math.min(effectiveDailyLimit, smartCap);
    }
  }

  const now = new Date();
  const currentHour = now.getHours(); // Local server time
  
  // Detect Night Watch (10 PM to 6 AM)
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

  // Add ±15% random jitter to avoid mechanical patterns
  const jitter = clamped * 0.15 * (Math.random() * 2 - 1);
  return Math.round(clamped + jitter);
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
async function processSendBatch(data: SendBatchJobData): Promise<void> {
  if (!db) return;

  const { campaignId, userId, integrationId, dailyLimit } = data;



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

  // 24/7 MODE: Ignoring weekend exclusion flag for autonomous performance
  // if (isWeekend && campaign.excludeWeekends) return;

  // 3. FAULT TOLERANCE: Check mailbox health (Smart Recovery aware)
  const { MailboxHealthMonitor } = await import('@shared/lib/monitoring/health-monitor.js');
  const healthState = await MailboxHealthMonitor.checkHealthState(integrationId, userId);
  
  if (healthState.isHardPaused) {
    // We removed the console.log here to prevent endless log spam every 5 minutes when a mailbox is dead.
    return;
  }

  const isSoftPaused = !healthState.canSendInitial && healthState.canSendFollowUp;
  if (isSoftPaused) {
    console.log(`[CampaignWorker] ⚠️ Mailbox ${integrationId.slice(-8)} is soft paused. Throttling down to follow-ups ONLY.`);
  }

  // 4. Check dynamic daily budget (respecting Warmup & Neural Brain)
  const sentToday = await getMailboxSentCount(userId, integrationId);
  
  // Refetch current integration to get latest warmup status
  const currentIntegration = await storage.getIntegrationById(integrationId);
  let effectiveLimit = dailyLimit;
  
  if (currentIntegration) {
    const warmup = warmupService.getWarmupStatus(currentIntegration as any, dailyLimit);
    if (warmup.isWarmingUp && warmup.dailyLimit < effectiveLimit) {
      effectiveLimit = warmup.dailyLimit;
    }

    // Neural Brain Smart Capping
    const tier = (currentIntegration as any).tier || 'starter';
    const isEnterprise = tier.toLowerCase() === 'enterprise';
    if (!isEnterprise) {
      const createdAt = new Date((currentIntegration as any).createdAt || Date.now());
      const isWarmed = (Date.now() - createdAt.getTime()) > (14 * 24 * 60 * 60 * 1000);
      const smartCap = isWarmed ? 60 : 45 + Math.floor(Math.random() * 6); // 45-50
      effectiveLimit = Math.min(effectiveLimit, smartCap);
    }
  }

  if (sentToday >= effectiveLimit) {
    return;
  }

  // 4b. REPLY GATE: If a pending auto-reply job exists for this mailbox,
  // hold off on batch sending so the reply lands first (avoids double-send collision).
  // The auto-reply itself has P0 priority and fires in 2-4 min — we wait for it.
  const replyPending = await mailboxHasPendingReply(integrationId);
  if (replyPending) {
    console.log(`[CampaignWorker] ⏳ Reply pending on mailbox ${integrationId.slice(-8)} — batch yielding`);
    return; // This job will reschedule automatically via BullMQ repeat
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
    if (Date.now() - lastSentAt < minDelayMs) return;
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
            or(eq(campaignLeads.status, 'pending'), eq(campaignLeads.status, 'queued'))
          ),
          // Leads in pool (no mailbox assigned) — any healthy mailbox can pick them up
          and(
            isNull(campaignLeads.integrationId),
            eq(campaignLeads.status, 'queued')
          )
        ),
        or(isNull(campaignLeads.nextActionAt), lte(campaignLeads.nextActionAt, new Date())),
        eq(leads.aiPaused, false),
        ne(leads.status, 'replied'),
        ne(leads.status, 'booked'),
        ne(leads.status, 'converted'),
        ne(leads.status, 'not_interested'),
        // SOFT PAUSE GATE: If soft paused, only fetch leads that are already in a follow-up sequence
        isSoftPaused ? gt(campaignLeads.currentStep, 0) : undefined
      )
    )
    .orderBy(campaignLeads.nextActionAt)
    .limit(5); // Fetch up to 5 so a timezone-blocked lead doesn't stall the whole mailbox

  if (nextLeadResult.length === 0) return; // No more leads for this mailbox

  // BUG #10 FIX: Iterate up to 5 leads so a timezone-gated lead
  // doesn't stall the entire mailbox queue.
  for (const row of nextLeadResult) {
  const leadEntry = (row as any).campaignLead;
  const lead = (row as any).lead;

  if (!lead?.email) continue;

  // Claim the lead for this mailbox (assign integrationId)
  if (!leadEntry.integrationId || leadEntry.status === 'queued') {
    await db.update(campaignLeads)
      .set({ integrationId, status: 'pending' })
      .where(eq(campaignLeads.id, leadEntry.id));
  }

  // --- PHASE 50: INTELLIGENT SCHEDULING GATE ---
  const tzProfile = await getLeadProfile(lead.id);
  const isActivelyEngaged = lead.status === 'replied' || lead.status === 'warm';
  
  if (tzProfile && !isActivelyEngaged) {
    const probability = await getOptimalSendProbability(new Date(), tzProfile, userId);
    
    // Dice Roll: If probability is low (e.g. 0.2), we only send 20% of the time.
    // This naturally spreads leads across the day and clusters them in PEAK hours (prob=1.0).
    const diceRoll = Math.random();
    
    if (probability === 0) {
      console.log(`[CampaignWorker] 😴 Lead ${lead.id.slice(-8)} is outside business window. Rescheduling.`);
      const nextCheck = new Date(Date.now() + 60 * 60 * 1000);
      await db.update(campaignLeads)
        .set({ nextActionAt: nextCheck, status: 'queued' })
        .where(eq(campaignLeads.id, leadEntry.id));
      continue; 
    }

    if (diceRoll > probability) {
      console.log(`[CampaignWorker] 🎲 Dice roll (${diceRoll.toFixed(2)}) > Prob (${probability}) for lead ${lead.id.slice(-8)}. Yielding to next heartbeat.`);
      // Delay by 15-30 mins to try again later in the same business day
      const retryAt = new Date(Date.now() + (15 + Math.random() * 15) * 60 * 1000);
      await db.update(campaignLeads)
        .set({ nextActionAt: retryAt, status: 'queued' })
        .where(eq(campaignLeads.id, leadEntry.id));
      continue;
    }

    console.log(`[CampaignWorker] 🎯 Target Lock: Sending lead ${lead.id.slice(-8)} (Prob: ${probability})`);
  }


  // 7. FAULT-TOLERANT SEND: Wrap in try/catch to handle mailbox errors
  try {
    if (lead.channel === 'instagram') {
      await deliverCampaignInstagram(userId, campaign, lead, leadEntry, integrationId);
    } else {
      await deliverCampaignEmail(userId, campaign, lead, leadEntry, integrationId);
    }
    
    // Success: Reset failure counts if any
    await resetCampaignFailureCount(campaignId);
    await db!.update(integrations).set({ failureCount: 0 }).where(eq(integrations.id, integrationId));
    
  } catch (sendError: any) {
    const errorMsg = sendError.message || 'Unknown send error';
    console.error(`[CampaignWorker] ❌ Send failed for ${lead.email} via ${integrationId}: ${errorMsg}`);

    // BUG #6 FIX: Distinguish transient network errors from fatal mailbox failures.
    // Transient errors (ETIMEDOUT, ECONNRESET, etc.) should only re-queue the lead.
    // Fatal errors (bad credentials, EAUTH) should trigger handleMailboxFailure.
    const isTransient = mailboxHealthService.isTransientNetworkError(errorMsg);

    // Phase 19: Dead-Lead Circuit Breaker
    const metadata = { ...(leadEntry.metadata as Record<string, any> || {}) };
    const failCount = (metadata.failCount || 0) + 1;
    metadata.failCount = failCount;
    metadata.lastError = errorMsg;

    if (failCount >= 3) {
      console.error(`[CampaignWorker] 🛑 Lead ${lead.email} reached max failure threshold (3). Killing lead.`);
      await db.update(campaignLeads)
        .set({ status: 'failed', error: `Max failures (3) exceeded: ${errorMsg}`, metadata })
        .where(eq(campaignLeads.id, leadEntry.id));
      continue; // next lead in batch
    }

    if (isTransient || mailboxHealthService.isMailboxError(errorMsg)) {
      if (!isTransient) {
        // Only trigger mailbox health failure for auth/credential errors, not network blips
        const integration = integrationId ? await storage.getIntegrationById(integrationId) : null;
        if (integration) {
          await mailboxHealthService.handleMailboxFailure(integration, errorMsg);
        }
      }

      // Re-queue the lead so another mailbox can pick it up
      await db.update(campaignLeads)
        .set({ integrationId: null, status: 'queued', error: errorMsg, metadata })
        .where(eq(campaignLeads.id, leadEntry.id));

      console.warn(`[CampaignWorker] 🔄 Lead ${lead.email} re-queued after ${isTransient ? 'transient network' : 'mailbox'} failure (Attempt ${failCount}/3)`);
    } else {
      // Non-mailbox error (e.g. invalid recipient) — mark lead as failed
      await db.update(campaignLeads)
        .set({ status: 'failed', error: errorMsg, metadata })
        .where(eq(campaignLeads.id, leadEntry.id));
    }
    continue; // Don't schedule follow-ups on failure
  }

  // 8. Schedule follow-up if there's a next step
  const followupsArr = (campaign.template as any)?.followups || [];
  const nextStep = leadEntry.currentStep + 1;
  const hasMore = nextStep <= followupsArr.length;

  if (hasMore) {
    const delayDays = followupsArr[nextStep - 1]?.delayDays || 3;
    let delayMs = delayDays * 24 * 60 * 60 * 1000;

    // Relative scheduling: Calculate delay from initialSentAt if available
    const initialSentAt = leadEntry.metadata?.initialSentAt;
    if (initialSentAt) {
      const targetDate = new Date(initialSentAt);
      targetDate.setDate(targetDate.getDate() + delayDays);
      delayMs = Math.max(60000, targetDate.getTime() - Date.now()); // Ensure at least 1m delay
    }

    await campaignQueueManager.scheduleFollowUp(
      campaignId,
      userId,
      leadEntry.id,
      integrationId,
      nextStep,
      delayMs
    );
  }

  // 9. Real-time KPI push
  wsSync.notifyLeadsUpdated(userId, { leadId: lead.id, action: 'campaign_sent' });
  wsSync.notifyCampaignStatsUpdated(userId, campaignId);
  wsSync.notifyStatsUpdated(userId);

  // HEARTBEAT SEND CAP: Send at most 1 lead per 5-min heartbeat cycle.
  // The loop fetches multiple leads so timezone-gated ones can be rescheduled,
  // but we break after the first successful send to respect distributed pacing.
  break;
  } // end for-loop (Bug #10 fix)
}

/**
 * Process a scheduled follow-up for a specific campaign lead.
 */
async function processFollowUp(data: FollowUpJobData): Promise<void> {
  if (!db) return;

  const { campaignId, userId, campaignLeadId, integrationId, stepIndex } = data;

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

  // 4. Check if the lead has replied or unsubscribed since the follow-up was scheduled
  if (lead.status === 'replied' || lead.status === 'converted' || lead.status === 'booked' || lead.status === 'unsubscribed') {
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

  // Neural Brain Smart Capping (Applied to follow-ups too)
  let effectiveHardLimit = baseLimit;
  if (currentIntegration) {
    const tier = (currentIntegration as any).tier || 'starter';
    const isEnterprise = tier.toLowerCase() === 'enterprise';
    if (!isEnterprise) {
      const createdAt = new Date((currentIntegration as any).createdAt || Date.now());
      const isWarmed = (Date.now() - createdAt.getTime()) > (14 * 24 * 60 * 60 * 1000);
      const smartCap = isWarmed ? 60 : 45 + Math.floor(Math.random() * 6); // 45-50
      effectiveHardLimit = Math.min(baseLimit, smartCap);
    }
  }

  // Max multiplier for flexibility
  const isSmtp = (currentIntegration?.provider as any) === 'smtp' || currentIntegration?.provider === 'custom_email';
  const defaultCeiling = isSmtp ? 500 : 100;
  const maxMultipliers = config.mailboxMaxMultipliers || {};
  const maxMultiplier = maxMultipliers[integrationId] || config.maxDailyMultiplier || (isSmtp ? 10 : 7);
  const hardCeiling = config.totalDailyLimit || (effectiveHardLimit * maxMultiplier) || defaultCeiling;

  if (sentToday >= hardCeiling) {
    const retryDelay = 1 * 60 * 60 * 1000; // 1 hour re-check
    console.log(`[CampaignWorker] 📉 Mailbox ${integrationId.slice(-8)} hit capacity (${sentToday}/${hardCeiling}). Rescheduling.`);

    await campaignQueueManager.scheduleFollowUp(
      campaignId, userId, campaignLeadId, integrationId, stepIndex,
      retryDelay
    );
    return;
  }

  // 6. Deliver the follow-up email
  try {
    await deliverCampaignEmail(userId, campaign, lead, { ...leadEntry, currentStep: stepIndex }, integrationId);

    // 7. Schedule NEXT follow-up step if there are more
    const followupsArr = (campaign.template as any)?.followups || [];
    const nextStep = stepIndex + 1;
    if (nextStep <= followupsArr.length) {
      const delayDays = followupsArr[nextStep - 1]?.delayDays || 3;
      let delayMs = delayDays * 24 * 60 * 60 * 1000;

      // Relative scheduling
      const initialSentAt = leadEntry.metadata?.initialSentAt;
      if (initialSentAt) {
        const targetDate = new Date(initialSentAt);
        targetDate.setDate(targetDate.getDate() + delayDays);
        delayMs = Math.max(60000, targetDate.getTime() - Date.now());
      }

      await campaignQueueManager.scheduleFollowUp(
        campaignId, userId, campaignLeadId, integrationId, nextStep,
        delayMs
      );
    }

    // 8. Real-time KPI push
    wsSync.notifyLeadsUpdated(userId, { leadId: lead.id, action: 'followup_sent' });
    wsSync.notifyCampaignStatsUpdated(userId, campaignId);
    wsSync.notifyStatsUpdated(userId);
  } catch (err: any) {
    const errorMsg = err.message || 'Follow-up send failed';
    console.error(`[CampaignWorker] ❌ Follow-up failed for ${lead.email}: ${errorMsg}`);

    // Phase 19: Circuit Breaker for follow-ups
    const metadata = { ...(leadEntry.metadata as Record<string, any> || {}) };
    const failCount = (metadata.failCount || 0) + 1;
    metadata.failCount = failCount;

    if (failCount >= 3) {
      console.error(`[CampaignWorker] 🛑 Follow-up reached max failure (3) for ${lead.email}. Killing lead.`);
      await db.update(campaignLeads)
        .set({ status: 'failed', error: `Max follow-up failures: ${errorMsg}`, metadata })
        .where(eq(campaignLeads.id, leadEntry.id));
      return;
    }

    // Re-queue for another attempt in 1 hour
    await db.update(campaignLeads)
      .set({ metadata })
      .where(eq(campaignLeads.id, leadEntry.id));

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

  // 2. Fetch campaign and verify status
  const [campaign] = await db.select().from(outreachCampaigns).where(eq(outreachCampaigns.id, campaignId));
  if (!campaign || campaign.status === 'aborted' || campaign.status === 'paused') return;

  // 3. Get lead details
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
  if (!lead?.email || lead.aiPaused) return;

  const [leadEntry] = await db.select().from(campaignLeads)
    .where(eq(campaignLeads.id, campaignLeadId));
  if (!leadEntry) return;

  // Get the auto-reply body from campaign template
  let body = (campaign.template as any)?.autoReply?.body || (campaign.template as any)?.autoReplyBody || "Thanks for your reply! We'll get back to you soon.";
  let subject = (campaign.template as any)?.initial?.subject || (campaign.template as any)?.subject || 'Re: ';
  subject = subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`;

  // Variable replacement
  const firstName = lead.name?.trim().split(' ')[0] || 'there';
  const company = (lead as any).company?.trim() || 'your company';
  body = body
    .replace(/{{firstName}}/g, firstName)
    .replace(/{{name}}/g, lead.name?.trim() || firstName)
    .replace(/{{company}}/g, company)
    .replace(/{{business_name}}/g, company);

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

  await sendEmail(userId, lead.email, body, subject, {
    isRaw: true,
    isHtml: true,
    trackingId,
    campaignId,
    leadId: lead.id,
    integrationId,
    isPriorityReply: true // Auto-replies always have priority
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
    metadata: { campaignId, step: 'auto-reply', integrationId }
  });

  // Update campaign lead: clear pendingAutoReply flag
  const newMetadata = { ...(leadEntry.metadata as Record<string, any> || {}) };
  delete newMetadata.pendingAutoReply;

  await db.update(campaignLeads)
    .set({
      metadata: newMetadata,
      updatedAt: new Date()
    })
    .where(eq(campaignLeads.id, campaignLeadId));

  // Stats
  await db.update(outreachCampaigns)
    .set({
      stats: sql`jsonb_set(stats, '{sent}', (COALESCE((stats->>'sent')::int, 0) + 1)::text::jsonb)`,
      updatedAt: new Date()
    })
    .where(eq(outreachCampaigns.id, campaignId));

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

  const stats: Record<string, number> = { total: 0, sent: 0, failed: 0, pending: 0, replied: 0 };

  leadStats.forEach((s: any) => {
    stats.total += Number(s.count);
    if (stats[s.status] !== undefined) stats[s.status] += Number(s.count);
  });

  // Update campaign stats in DB
  await db.update(outreachCampaigns)
    .set({ 
      stats: {
        total: stats.total || 0,
        sent: stats.sent || 0,
        replied: stats.replied || 0,
        bounced: (stats as any).bounced || 0
      }, 
      updatedAt: new Date() 
    })
    .where(eq(outreachCampaigns.id, campaignId));

  // Check if campaign is complete (no more pending leads)
  if (stats.pending === 0 && stats.total > 0 && campaign.status === 'active') {
    // Check if all follow-ups are also done
    const pendingFollowUps = await db.select({ count: sql<number>`count(*)` })
      .from(campaignLeads)
      .where(and(
        eq(campaignLeads.campaignId, campaignId),
        eq(campaignLeads.status, 'sent') // 'sent' means waiting for follow-up
      ));

    if (Number(pendingFollowUps[0]?.count || 0) === 0) {
      await db.update(outreachCampaigns)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(eq(outreachCampaigns.id, campaignId));

      // Clean up repeatable jobs
      await campaignQueueManager.pauseCampaign(campaignId);
      console.log(`[CampaignWorker] 🏁 Campaign ${campaignId} completed!`);
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
  const template = campaign.template as any;
  let subject = template?.initial?.subject || template?.subject || 'Contacting you';
  let body = template?.initial?.body || template?.body;

  // Follow-up logic: use the correct template for the current step
  let variantId = 'standard';
  let isBreakup = false;
  
  if (leadEntry.currentStep > 0) {
    const followups = (campaign.template as any)?.followups || [];
    const fuConfig = followups[leadEntry.currentStep - 1];
    if (fuConfig) {
      body = fuConfig.body || body; 
      const fuSubject = fuConfig.subject || subject;
      subject = fuSubject.toLowerCase().startsWith('re:') ? fuSubject : `Re: ${fuSubject}`;
      isBreakup = fuConfig.isBreakup || false;
    }
  } else {
    // For initial step, use AI generation or A/B testing variants if in autonomous mode
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
    } catch (e) {
      console.warn(`[CampaignWorker] AI generation failed, using template fallback:`, e);
    }
  }

  // CHECK FOR PRE-CRAFTED COPY (Nightly Worker Optimization)
  if (leadEntry.metadata?.preCraftedCopy) {
    console.log(`[CampaignWorker] ⚡ Using pre-crafted copy for lead ${lead.id.slice(-8)}`);
    body = leadEntry.metadata.preCraftedCopy;
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
  const firstName = lead.name?.trim().split(' ')[0] || 'there';
  const company = (lead as any).company?.trim() || 'your company';
  body = body
    .replace(/{{firstName}}/g, firstName)
    .replace(/{{lead_name}}/g, lead.name?.trim() || firstName)
    .replace(/{{company}}/g, company)
    .replace(/{{business_name}}/g, company);

  subject = subject
    .replace(/{{firstName}}/g, firstName)
    .replace(/{{lead_name}}/g, lead.name?.trim() || firstName)
    .replace(/{{company}}/g, company);

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

  try {
    // Determine if this is a priority reply
    const isPriorityReply = leadEntry.currentStep > 0 && (lead.status === 'replied' || lead.status === 'interested' || lead.status === 'warm');

    await sendEmail(userId, lead.email, body, subject, {
      isRaw: true,
      isHtml: true,
      trackingId: campaign.config?.isManual ? undefined : trackingId,
      campaignId: campaign.id,
      leadId: lead.id,
      integrationId,
      isPriorityReply
    });
  } catch (err) {
    // Release lock on error so BullMQ retry can re-acquire it
    await releaseLock(lockKey);
    throw err;
  }

  // BUG #8 FIX: Release lock after successful send so future jobs aren't blocked
  // by an expired but still-held 5-minute lock from the previous successful send.
  await releaseLock(lockKey);

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
        variantId // Track A/B variant for optimization
      }
    }, tx as any); // Pass transaction client to storage

    // Detailed campaign email tracking
    await tx.insert(campaignEmails).values({
      campaignId: campaign.id,
      leadId: lead.id,
      userId,
      messageId: trackingId,
      subject,
      body,
      stepIndex: leadEntry.currentStep,
      status: 'sent'
    });

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
      if (newMetadata.initialSentAt) {
        nextActionAt = new Date(newMetadata.initialSentAt);
        nextActionAt.setDate(nextActionAt.getDate() + delayDays);
      } else {
        nextActionAt = new Date();
        nextActionAt.setDate(nextActionAt.getDate() + delayDays);
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
  const firstName = lead.name?.trim().split(' ')[0] || 'there';
  const company = (lead as any).company?.trim() || 'your company';
  body = body
    .replace(/{{firstName}}/g, firstName)
    .replace(/{{lead_name}}/g, lead.name?.trim() || firstName)
    .replace(/{{company}}/g, company);

  // Phase 16: Send Guard (Idempotency)
  const { acquireLock, releaseLock } = await import('@shared/lib/redis/redis.js');
  const lockKey = `send_guard:ig:${campaign.id}:${lead.id}:${leadEntry.currentStep}`;
  const hasLock = await acquireLock(lockKey, 300); // 5 minute guard

  if (!hasLock) {
    console.warn(`[CampaignWorker] 🛡️ IG Send Guard triggered for campaign ${campaign.id}, lead ${lead.id}. Already sending...`);
    return;
  }

  let result;
  try {
    result = await sendInstagramOutreach(userId, lead.id, body, {
      isAutonomous: true,
      metadata: { campaignId: campaign.id, step: leadEntry.currentStep, integrationId }
    });
  } catch (err) {
    await releaseLock(lockKey);
    throw err;
  }

  // Phase 17: Atomic Post-Send Transaction
  await db!.transaction(async (tx: any) => {
    // Track Instagram message in campaign history
    await tx.insert(campaignEmails).values({
      campaignId: campaign.id,
      leadId: lead.id,
      userId,
      messageId: result.messageId,
      subject: 'Instagram DM',
      body,
      stepIndex: leadEntry.currentStep,
      status: 'sent'
    });

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
  .limit(20); // Process in manageable batches

  if (eligibleLeads.length === 0) return;

  console.log(`[PreCraft] 🤖 Generating copies for ${eligibleLeads.length} leads in campaign ${campaignId.slice(-8)}`);

  const [campaign] = await db.select().from(outreachCampaigns).where(eq(outreachCampaigns.id, campaignId));
  if (!campaign) return;

  for (const row of eligibleLeads) {
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
      await db.update(campaignLeads)
        .set({ metadata })
        .where(eq(campaignLeads.id, leadEntry.id));

    } catch (err: any) {
      console.warn(`[PreCraft] Failed for lead ${lead.id.slice(-8)}:`, err.message);
    }
  }
}

async function resetCampaignFailureCount(campaignId: string): Promise<void> {
  await db!.update(outreachCampaigns)
    .set({
      stats: sql`jsonb_set(stats, '{consecutive_failures}', '0')`,
    })
    .where(eq(outreachCampaigns.id, campaignId));
}

/**
 * Circuit Breaker: Handle and increment failures
 */
async function handleCampaignFailure(campaignId: string): Promise<void> {
  const [campaign] = await db!.select().from(outreachCampaigns).where(eq(outreachCampaigns.id, campaignId));
  if (!campaign) return;

  const currentFailures = Number((campaign.stats as any)?.consecutive_failures || 0) + 1;
  
  await db!.update(outreachCampaigns)
    .set({
      stats: sql`jsonb_set(stats, '{consecutive_failures}', ${currentFailures.toString()}::jsonb)`,
    })
    .where(eq(outreachCampaigns.id, campaignId));

  // Threshold: 3 consecutive failures aborts/pauses the campaign
  if (currentFailures >= 3) {
    console.error(`[CampaignWorker] 🚨 CIRCUIT BREAKER: Campaign ${campaignId} hit 3 failures. PAUSING.`);
    await campaignQueueManager.pauseCampaign(campaignId);
    await db!.update(outreachCampaigns)
      .set({ status: 'paused', updatedAt: new Date() })
      .where(eq(outreachCampaigns.id, campaignId));
      
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
      { id: 'v2_result', subject: aiResult.alternatives[0] || aiResult.subject, body: aiResult.body },
      { id: 'v3_hybrid', subject: aiResult.alternatives[1] || `Question regarding ${lead.company || 'your team'}`, body: aiResult.body }
    ];
    
    await db.update(outreachCampaigns)
      .set({ 
        metadata: { ...metadata, testing_variants: variants, testing_phase: 'active' } 
      })
      .where(eq(outreachCampaigns.id, campaign.id));
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

export const campaignWorker = hasRedis ? new Worker<CampaignJobData>(
  'campaign-engine',
  processCampaignJob,
  {
    connection: redisConnection as any,
    concurrency: 25, // Handle multiple mailboxes concurrently
    removeOnComplete: { count: 500 },
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
    console.error(`[CampaignWorker] ✗ ${job?.data?.type} failed (${job?.id}):`, err.message);
    
    // Circuit Breaker: Increment campaign failure count
    if (job?.data?.type === 'campaign:send-batch' && job.data.campaignId) {
      await handleCampaignFailure(job.data.campaignId);
    }
  });

  console.log('✅ BullMQ Campaign Queue Worker initialized (concurrency: 25)');

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

} else {
  console.warn('⚠️ BullMQ Campaign Queue Worker disabled (No Redis) — using setInterval fallback');
}







