/**
 * Daily Checkpoint Cron — Phase 7
 *
 * Runs at 00:00 local time every day. Queries PostgreSQL for all tasks due
 * today and enqueues only today's slice into BullMQ. This keeps Redis memory
 * footprint minimal (no multi-day delayed jobs) and ensures resilience:
 * if Redis restarts, the next midnight checkpoint restores everything.
 *
 * Responsibilities:
 * 1. Query campaign_leads with next_action_at = today → enqueue send-batch per mailbox
 * 2. Query follow_up_queue with scheduled_at = today → schedule follow-ups
 * 3. Query campaign_job_logs for any missed/stranded jobs → re-enqueue
 * 4. Trigger pre-craft for tomorrow's leads (AI copy generation)
 * 5. Snapshot warmup pool state for dashboard
 * 6. Distribute sends across business hours with per-mailbox hourly slots
 */

import { db } from '@shared/lib/db/db.js';
import {
  campaignLeads,
  campaignJobLogs,
  followUpQueue,
  outreachCampaigns,
  integrations,
  warmupMailboxes,
  warmupPoolState,
} from '@audnix/shared';
import { eq, and, gte, lt, or, isNull, sql, inArray } from 'drizzle-orm';
import { campaignQueue, campaignQueueManager } from './campaign-queue.js';

const CHECKPOINT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const BUSINESS_START_HOUR = 8;
const BUSINESS_END_HOUR = 18;
const MAX_BATCH_SIZE = 5;

class DailyCheckpoint {
  private interval: NodeJS.Timeout | null = null;
  private isRunning = false;

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[DailyCheckpoint] ⏰ Starting 24-hour checkpoint daemon...');

    const msUntilMidnight = this.getMsUntilMidnightLocal();
    console.log(`[DailyCheckpoint] First checkpoint in ${Math.round(msUntilMidnight / 60000)} minutes`);

    setTimeout(() => {
      this.runCheckpoint().catch((err) =>
        console.error('[DailyCheckpoint] Initial checkpoint failed:', err.message)
      );
      this.interval = setInterval(
        () => this.runCheckpoint().catch((err) =>
          console.error('[DailyCheckpoint] Checkpoint failed:', err.message)
        ),
        CHECKPOINT_INTERVAL_MS
      );
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
    warmupSnapshot: boolean;
    preCraftTriggered: boolean;
  }> {
    if (!db) {
      console.warn('[DailyCheckpoint] DB unavailable — skipping checkpoint.');
      return { campaignJobsEnqueued: 0, followUpsEnqueued: 0, warmupSnapshot: false, preCraftTriggered: false };
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);
    const tomorrowStart = new Date(todayEnd);
    const tomorrowEnd = new Date(tomorrowStart);
    tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);

    console.log(`[DailyCheckpoint] 🌙 Running checkpoint for ${todayStart.toISOString().slice(0, 10)}...`);

    let campaignJobsEnqueued = 0;
    let followUpsEnqueued = 0;
    let warmupSnapshot = false;
    let preCraftTriggered = false;

    try {
      campaignJobsEnqueued = await this.enqueueTodaysCampaignLeads(todayStart, todayEnd);
      const strandedEnqueued = await this.recoverStrandedJobs(todayStart, todayEnd);
      campaignJobsEnqueued += strandedEnqueued;
      followUpsEnqueued = await this.enqueueTodaysFollowUps(todayStart, todayEnd);
      preCraftTriggered = await this.triggerPreCraftForTomorrow(tomorrowStart, tomorrowEnd);
      warmupSnapshot = await this.snapshotWarmupPool();

      console.log(
        `[DailyCheckpoint] ✅ Complete. Campaign: ${campaignJobsEnqueued}, Follow-ups: ${followUpsEnqueued}, Pre-craft: ${preCraftTriggered}, Warmup snapshot: ${warmupSnapshot}`
      );

      return { campaignJobsEnqueued, followUpsEnqueued, warmupSnapshot, preCraftTriggered };
    } catch (err: any) {
      console.error('[DailyCheckpoint] Fatal checkpoint error:', err.message);
      return { campaignJobsEnqueued: 0, followUpsEnqueued: 0, warmupSnapshot: false, preCraftTriggered: false };
    }
  }

  private async enqueueTodaysCampaignLeads(todayStart: Date, todayEnd: Date): Promise<number> {
    if (!campaignQueue) return 0;

    const todaysLeads = await db
      .select({
        campaignId: campaignLeads.campaignId,
        integrationId: campaignLeads.integrationId,
        userId: outreachCampaigns.userId,
        leadCount: sql<number>`count(*)`,
      })
      .from(campaignLeads)
      .innerJoin(outreachCampaigns, eq(campaignLeads.campaignId, outreachCampaigns.id))
      .where(
        and(
          or(eq(campaignLeads.status, 'pending'), eq(campaignLeads.status, 'queued')),
          gte(campaignLeads.nextActionAt, todayStart),
          lt(campaignLeads.nextActionAt, todayEnd),
          eq(outreachCampaigns.status, 'active'),
          sql`${campaignLeads.integrationId} IS NOT NULL`
        )
      )
      .groupBy(campaignLeads.campaignId, campaignLeads.integrationId, outreachCampaigns.userId);

    if (todaysLeads.length === 0) {
      console.log('[DailyCheckpoint] No campaign leads scheduled for today.');
      return 0;
    }

    const mailboxIds = [...new Set(todaysLeads.map((g) => g.integrationId).filter(Boolean))];
    const mailboxLimits = await this.getMailboxLimits(mailboxIds as string[]);

    let enqueued = 0;
    for (const group of todaysLeads) {
      const integrationId = group.integrationId;
      if (!integrationId) continue;

      const dailyLimit = mailboxLimits.get(integrationId) || 50;
      const totalLeads = Number(group.leadCount);
      const effectiveTotal = Math.min(totalLeads, dailyLimit);
      const businessHours = BUSINESS_END_HOUR - BUSINESS_START_HOUR;
      const sendsPerHour = Math.max(1, Math.ceil(effectiveTotal / businessHours));
      const batchesPerHour = Math.ceil(sendsPerHour / MAX_BATCH_SIZE);

      for (let hour = 0; hour < businessHours; hour++) {
        const hourStart = BUSINESS_START_HOUR + hour;
        for (let batch = 0; batch < batchesPerHour; batch++) {
          const minuteOffset = Math.floor((batch / batchesPerHour) * 60) + Math.floor(Math.random() * 5);
          const delayMs = this.calculateDelayUntil(hourStart, minuteOffset);
          if (delayMs < 0) continue;

          const jobKey = `send-batch_${group.campaignId}_${integrationId}_${hour}_${batch}`;
          try {
            await campaignQueue.add(jobKey, {
              type: 'campaign:send-batch' as const,
              campaignId: group.campaignId,
              userId: group.userId,
              integrationId,
              dailyLimit,
            }, {
              delay: delayMs,
              jobId: jobKey,
              priority: 2,
              removeOnComplete: true,
              removeOnFail: { count: 1000 },
            });
            enqueued++;
          } catch (err: any) {
            if (!err.message?.includes('Job') || !err.message?.includes('exists')) {
              console.warn(`[DailyCheckpoint] Failed to enqueue ${jobKey}:`, err.message);
            }
          }
        }
      }
    }

    console.log(`[DailyCheckpoint] 📬 Enqueued ${enqueued} send-batch jobs across ${mailboxIds.length} mailboxes`);
    return enqueued;
  }

  private async recoverStrandedJobs(todayStart: Date, todayEnd: Date): Promise<number> {
    if (!campaignQueue) return 0;

    const strandedJobs = await db
      .select()
      .from(campaignJobLogs)
      .where(
        and(
          eq(campaignJobLogs.status, 'pending'),
          gte(campaignJobLogs.scheduledAt, todayStart),
          lt(campaignJobLogs.scheduledAt, todayEnd)
        )
      );

    let enqueued = 0;
    for (const job of strandedJobs) {
      const jobData = job.jobData as any;
      if (!jobData) continue;

      const delayMs = Math.max(0, new Date(job.scheduledAt).getTime() - Date.now());
      try {
        await campaignQueue.add(job.jobBullmqId, jobData, {
          delay: delayMs,
          jobId: job.jobBullmqId,
          priority: job.jobType === 'campaign:follow-up' ? 1 : 2,
          removeOnComplete: true,
          removeOnFail: { count: 1000 },
        });
        enqueued++;
      } catch { /* duplicate jobId — skip */ }
    }

    if (enqueued > 0) {
      console.log(`[DailyCheckpoint] 🔄 Recovered ${enqueued} stranded jobs from campaign_job_logs`);
    }
    return enqueued;
  }

  private async enqueueTodaysFollowUps(todayStart: Date, todayEnd: Date): Promise<number> {
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

    let enqueued = 0;
    for (const fu of pendingFollowUps) {
      const context = fu.context as any;
      if (!context?.campaignId || !context?.campaignLeadId) continue;

      const integrationId = fu.integrationId || context.integrationId;
      if (!integrationId) continue;

      await campaignQueueManager.scheduleFollowUp(
        context.campaignId,
        fu.userId,
        context.campaignLeadId,
        integrationId,
        context.stepIndex || 0,
        Math.max(0, new Date(fu.scheduledAt!).getTime() - Date.now())
      );
      enqueued++;
    }

    if (enqueued > 0) {
      console.log(`[DailyCheckpoint] 📨 Enqueued ${enqueued} follow-ups for today`);
    }
    return enqueued;
  }

  private async triggerPreCraftForTomorrow(tomorrowStart: Date, tomorrowEnd: Date): Promise<boolean> {
    if (!campaignQueue) return false;

    const tomorrowCampaigns = await db
      .select({ campaignId: campaignLeads.campaignId, userId: outreachCampaigns.userId })
      .from(campaignLeads)
      .innerJoin(outreachCampaigns, eq(campaignLeads.campaignId, outreachCampaigns.id))
      .where(
        and(
          eq(campaignLeads.status, 'queued'),
          gte(campaignLeads.nextActionAt, tomorrowStart),
          lt(campaignLeads.nextActionAt, tomorrowEnd),
          eq(outreachCampaigns.status, 'active')
        )
      )
      .groupBy(campaignLeads.campaignId, outreachCampaigns.userId);

    const uniqueCampaigns = new Map<string, string>();
    for (const c of tomorrowCampaigns) {
      uniqueCampaigns.set(c.campaignId, c.userId);
    }

    let triggered = 0;
    for (const [campaignId, userId] of uniqueCampaigns) {
      try {
        await campaignQueue.add(
          `pre-craft-${campaignId}`,
          { type: 'campaign:pre-craft' as const, campaignId, userId },
          {
            jobId: `pre-craft-${campaignId}-${tomorrowStart.toISOString().slice(0, 10)}`,
            priority: 3,
            removeOnComplete: true,
            removeOnFail: { count: 100 },
          }
        );
        triggered++;
      } catch { /* duplicate */ }
    }

    if (triggered > 0) {
      console.log(`[DailyCheckpoint] 🧠 Triggered pre-craft for ${triggered} campaigns (tomorrow's leads)`);
    }
    return triggered > 0;
  }

  private async snapshotWarmupPool(): Promise<boolean> {
    try {
      const poolTypes = ['enterprise', 'global'] as const;
      for (const poolType of poolTypes) {
        const mailboxes = await db
          .select({
            total: sql<number>`count(*)`,
            active: sql<number>`count(*) FILTER (WHERE ${warmupMailboxes.status} = 'active')`,
            paused: sql<number>`count(*) FILTER (WHERE ${warmupMailboxes.status} = 'paused')`,
          })
          .from(warmupMailboxes)
          .where(eq(warmupMailboxes.poolType, poolType));

        const stats = mailboxes[0];
        if (!stats) continue;

        await db.insert(warmupPoolState).values({
          poolType,
          totalMailboxes: Number(stats.total),
          activeMailboxes: Number(stats.active),
          pausedMailboxes: Number(stats.paused),
          lastSnapshotAt: new Date(),
          isHealthy: Number(stats.active) >= 2,
          metadata: { snapshotType: 'daily-checkpoint' },
        });
      }

      console.log('[DailyCheckpoint] 📊 Warmup pool state snapshotted');
      return true;
    } catch (err: any) {
      console.warn('[DailyCheckpoint] Warmup pool snapshot failed:', err.message);
      return false;
    }
  }

  private async getMailboxLimits(mailboxIds: string[]): Promise<Map<string, number>> {
    const limits = new Map<string, number>();
    if (mailboxIds.length === 0) return limits;

    const rows = await db
      .select({
        id: integrations.id,
        dailyLimit: integrations.dailyLimit,
        initialOutreachLimit: integrations.initialOutreachLimit,
      })
      .from(integrations)
      .where(inArray(integrations.id, mailboxIds));

    for (const row of rows) {
      const limit = row.initialOutreachLimit && row.initialOutreachLimit > 0
        ? row.initialOutreachLimit
        : row.dailyLimit || 50;
      limits.set(row.id, limit);
    }

    return limits;
  }

  private calculateDelayUntil(hour: number, minute: number): number {
    const now = new Date();
    const target = new Date(now);
    target.setHours(hour, minute, 0, 0);
    return target.getTime() - now.getTime();
  }

  private getMsUntilMidnightLocal(): number {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    return midnight.getTime() - now.getTime();
  }
}

export const dailyCheckpoint = new DailyCheckpoint();
