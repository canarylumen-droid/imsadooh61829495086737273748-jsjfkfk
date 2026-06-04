/**
 * Hourly Distribution Engine — Phase 7
 *
 * Pre-computes 24 hourly send slots per mailbox and dynamically recalculates
 * distribution as conditions change throughout the day. Runs every 30 minutes
 * and also on-demand when follow-ups/replies consume budget mid-hour.
 *
 * Responsibilities:
 * 1. Pre-compute hourly slots at day start (delegates to Daily Checkpoint)
 * 2. Recalculate every 30 min: adjust remaining slots based on actual sends
 * 3. On-demand recalculation when follow-up/reply consumes budget
 * 4. Ensure no mailbox bursts — smooth, human-like distribution
 * 5. Respect reputation-adjusted limits (initialOutreachLimit)
 */

import { db } from '@shared/lib/db/db.js';
import {
  campaignLeads,
  campaignEmails,
  outreachCampaigns,
  integrations,
} from '@audnix/shared';
import { eq, and, gte, sql, inArray, or, isNull } from 'drizzle-orm';
import { campaignQueue } from './campaign-queue.js';
import { getExternalSentCount } from './external-sent-monitor.js';

const RECALC_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const BUSINESS_START_HOUR = 8;
const BUSINESS_END_HOUR = 18;
const MAX_BATCH_SIZE = 5;

interface MailboxSlot {
  integrationId: string;
  campaignId: string;
  userId: string;
  dailyLimit: number;
  sentToday: number;
  remainingSends: number;
  remainingHours: number;
  sendsPerHour: number;
  nextSlotDelayMs: number;
}

class HourlyDistributionEngine {
  private interval: NodeJS.Timeout | null = null;
  private isRunning = false;

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[HourlyDist] ⏱️ Starting 30-minute distribution recalculation daemon...');

    // First run after 30 minutes (let Daily Checkpoint handle initial distribution)
    setTimeout(() => {
      this.recalculateAll().catch((err) =>
        console.error('[HourlyDist] Initial recalculation failed:', err.message)
      );
      this.interval = setInterval(
        () => this.recalculateAll().catch((err) =>
          console.error('[HourlyDist] Recalculation failed:', err.message)
        ),
        RECALC_INTERVAL_MS
      );
    }, RECALC_INTERVAL_MS);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isRunning = false;
    console.log('[HourlyDist] Stopped.');
  }

  /**
   * Full recalculation sweep — runs every 30 minutes.
   * Queries all active mailboxes with pending leads, recalculates
   * their remaining hourly slots, and updates send-batch job delays.
   */
  async recalculateAll(): Promise<{ mailboxesChecked: number; slotsAdjusted: number }> {
    if (!db || !campaignQueue) {
      return { mailboxesChecked: 0, slotsAdjusted: 0 };
    }

    const now = new Date();
    const currentHour = now.getHours();

    // Skip recalculation outside business hours (Night Watch handles it)
    if (currentHour < BUSINESS_START_HOUR || currentHour >= BUSINESS_END_HOUR) {
      return { mailboxesChecked: 0, slotsAdjusted: 0 };
    }

    // Find all active mailboxes with pending campaign leads
    const activeMailboxes = await db
      .select({
        integrationId: campaignLeads.integrationId,
        campaignId: campaignLeads.campaignId,
        userId: outreachCampaigns.userId,
        pendingCount: sql<number>`count(*)`,
      })
      .from(campaignLeads)
      .innerJoin(outreachCampaigns, eq(campaignLeads.campaignId, outreachCampaigns.id))
      .where(
        and(
          or(eq(campaignLeads.status, 'pending'), eq(campaignLeads.status, 'queued')),
          eq(outreachCampaigns.status, 'active'),
          sql`${campaignLeads.integrationId} IS NOT NULL`
        )
      )
      .groupBy(campaignLeads.integrationId, campaignLeads.campaignId, outreachCampaigns.userId);

    if (activeMailboxes.length === 0) {
      return { mailboxesChecked: 0, slotsAdjusted: 0 };
    }

    // Fetch mailbox limits
    const mailboxIds = [...new Set(activeMailboxes.map((m) => m.integrationId).filter(Boolean))];
    const limits = await this.getMailboxLimits(mailboxIds as string[]);

    // Fetch today's sent counts per mailbox
    const sentCounts = await this.getTodaysSentCounts(mailboxIds as string[]);

    let slotsAdjusted = 0;

    for (const mailbox of activeMailboxes) {
      const integrationId = mailbox.integrationId;
      if (!integrationId) continue;

      const dailyLimit = limits.get(integrationId) || 50;
      const audnixSentToday = sentCounts.get(integrationId) || 0;
      const externalSentToday = await getExternalSentCount(integrationId);
      const sentToday = audnixSentToday + externalSentToday;
      const pendingCount = Number(mailbox.pendingCount);

      // Calculate remaining distribution
      const slot = this.calculateSlot(integrationId, mailbox.campaignId, mailbox.userId, dailyLimit, sentToday, pendingCount);

      if (slot.remainingSends <= 0) {
        // Budget exhausted — reschedule far out
        await this.rescheduleMailbox(mailbox.campaignId, integrationId, mailbox.userId, dailyLimit, 60 * 60 * 1000);
        slotsAdjusted++;
        continue;
      }

      // Enqueue staggered send-batch jobs for remaining slots
      const batchesPerHour = Math.ceil(slot.sendsPerHour / MAX_BATCH_SIZE);

      for (let hour = 0; hour < Math.ceil(slot.remainingHours); hour++) {
        const hourStart = currentHour + hour;
        if (hourStart >= BUSINESS_END_HOUR) break;

        for (let batch = 0; batch < batchesPerHour; batch++) {
          const minuteOffset = Math.floor((batch / batchesPerHour) * 60) + Math.floor(Math.random() * 15);
          const delayMs = this.calculateDelayUntil(hourStart, minuteOffset);

          if (delayMs < 0) continue;

          const jobKey = `send-batch_${mailbox.campaignId}_${integrationId}_${hourStart}_${batch}`;
          try {
            await campaignQueue.add(jobKey, {
              type: 'campaign:send-batch' as const,
              campaignId: mailbox.campaignId,
              userId: mailbox.userId,
              integrationId,
              dailyLimit,
            }, {
              delay: delayMs,
              jobId: jobKey,
              priority: 2,
              removeOnComplete: true,
              removeOnFail: { count: 1000 },
            });
            slotsAdjusted++;
          } catch {
            // duplicate jobId — skip
          }
        }
      }
    }

    if (slotsAdjusted > 0) {
      console.log(`[HourlyDist] 🔄 Recalculated ${slotsAdjusted} slots across ${activeMailboxes.length} mailboxes`);
    }

    return { mailboxesChecked: activeMailboxes.length, slotsAdjusted };
  }

  /**
   * On-demand recalculation for a single mailbox.
   * Called by processFollowUp / processAutoReply after they consume budget.
   * This ensures initial outreach pacing adjusts immediately when budget is consumed.
   */
  async recalculateMailbox(
    integrationId: string,
    campaignId: string,
    userId: string,
    dailyLimit: number
  ): Promise<void> {
    if (!db || !campaignQueue) return;

    const now = new Date();
    const currentHour = now.getHours();
    if (currentHour < BUSINESS_START_HOUR || currentHour >= BUSINESS_END_HOUR) return;

    const audnixSentToday = await this.getMailboxSentToday(integrationId);
    const externalSentToday = await getExternalSentCount(integrationId);
    const sentToday = audnixSentToday + externalSentToday;
    const limits = await this.getMailboxLimits([integrationId]);
    const effectiveLimit = limits.get(integrationId) || dailyLimit;

    const pendingCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(campaignLeads)
      .where(
        and(
          eq(campaignLeads.campaignId, campaignId),
          eq(campaignLeads.integrationId, integrationId),
          or(eq(campaignLeads.status, 'pending'), eq(campaignLeads.status, 'queued'))
        )
      )
      .then((r) => Number(r[0]?.count || 0));

    const slot = this.calculateSlot(integrationId, campaignId, userId, effectiveLimit, sentToday, pendingCount);

    if (slot.remainingSends <= 0) {
      await this.rescheduleMailbox(campaignId, integrationId, userId, effectiveLimit, 60 * 60 * 1000);
      return;
    }

    // Update the immediate next send-batch job delay
    const nextDelay = slot.nextSlotDelayMs;
    const jobKey = `send-batch_${campaignId}_${integrationId}`;

    try {
      // Remove the existing delayed job and re-add with new delay
      await campaignQueue.remove(jobKey).catch(() => {});
      await campaignQueue.add(jobKey, {
        type: 'campaign:send-batch' as const,
        campaignId,
        userId,
        integrationId,
        dailyLimit: effectiveLimit,
      }, {
        delay: nextDelay,
        jobId: jobKey,
        priority: 2,
        removeOnComplete: true,
        removeOnFail: { count: 1000 },
      });
    } catch {
      // best-effort
    }
  }

  // ── Slot Calculation ────────────────────────────────────────────────────

  private calculateSlot(
    integrationId: string,
    campaignId: string,
    userId: string,
    dailyLimit: number,
    sentToday: number,
    pendingCount: number
  ): MailboxSlot {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    const endOfBusiness = new Date(now);
    endOfBusiness.setHours(BUSINESS_END_HOUR, 0, 0, 0);
    const remainingMs = Math.max(0, endOfBusiness.getTime() - now.getTime());
    const remainingHours = remainingMs / (3600 * 1000);

    const remainingSends = Math.max(0, dailyLimit - sentToday);
    const effectiveRemaining = Math.min(remainingSends, pendingCount);

    // Spread remaining sends across remaining hours
    const sendsPerHour = remainingHours > 0
      ? Math.max(1, Math.ceil(effectiveRemaining / remainingHours))
      : 0;

    // Next slot: calculate delay until the next appropriate minute within current hour
    const minutesRemainingInHour = 60 - currentMinute;
    const nextSlotDelayMs = sendsPerHour > 0
      ? Math.max(30_000, (minutesRemainingInHour * 60_000) / sendsPerHour)
      : 30 * 60_000;

    return {
      integrationId,
      campaignId,
      userId,
      dailyLimit,
      sentToday,
      remainingSends: effectiveRemaining,
      remainingHours,
      sendsPerHour,
      nextSlotDelayMs: Math.round(nextSlotDelayMs),
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

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

  private async getTodaysSentCounts(mailboxIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (mailboxIds.length === 0) return counts;

    const rows = await db
      .select({
        integrationId: campaignEmails.integrationId,
        count: sql<number>`count(*)`,
      })
      .from(campaignEmails)
      .where(
        and(
          inArray(campaignEmails.integrationId, mailboxIds),
          eq(campaignEmails.stepIndex, 0),
          eq(campaignEmails.status, 'sent'),
          gte(campaignEmails.sentAt, sql`CURRENT_DATE::timestamp`)
        )
      )
      .groupBy(campaignEmails.integrationId);

    for (const row of rows) {
      if (row.integrationId) {
        counts.set(row.integrationId, Number(row.count));
      }
    }

    return counts;
  }

  private async getMailboxSentToday(integrationId: string): Promise<number> {
    const rows = await db
      .select({ count: sql<number>`count(*)` })
      .from(campaignEmails)
      .where(
        and(
          eq(campaignEmails.integrationId, integrationId),
          eq(campaignEmails.stepIndex, 0),
          eq(campaignEmails.status, 'sent'),
          gte(campaignEmails.sentAt, sql`CURRENT_DATE::timestamp`)
        )
      );
    return Number(rows[0]?.count || 0);
  }

  private async rescheduleMailbox(
    campaignId: string,
    integrationId: string,
    userId: string,
    dailyLimit: number,
    delayMs: number
  ): Promise<void> {
    if (!campaignQueue) return;
    const jobKey = `send-batch_${campaignId}_${integrationId}`;
    try {
      await campaignQueue.add(jobKey, {
        type: 'campaign:send-batch' as const,
        campaignId,
        userId,
        integrationId,
        dailyLimit,
      }, {
        delay: delayMs,
        jobId: jobKey,
        priority: 2,
        removeOnComplete: true,
        removeOnFail: { count: 1000 },
      });
    } catch {
      // duplicate — skip
    }
  }

  private calculateDelayUntil(hour: number, minute: number): number {
    const now = new Date();
    const target = new Date(now);
    target.setHours(hour, minute, 0, 0);
    return target.getTime() - now.getTime();
  }
}

export const hourlyDistribution = new HourlyDistributionEngine();
