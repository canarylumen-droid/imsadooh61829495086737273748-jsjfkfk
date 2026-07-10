import { db } from '../db/db.js';
import {
  leadCampaignOutcomes,
  campaignEmails,
  leads,
  messages,
  outreachCampaigns,
} from '@audnix/shared';
import { and, eq, inArray, sql, desc } from 'drizzle-orm';
import { exclusionEngine, type OutcomeType, type DetectedBy } from './exclusion-engine.js';

const GHOSTED_OUTCOME = 'ghosted' as OutcomeType;
const GHOSTED_DETECTED = 'ghost_detection' as DetectedBy;
const NO_RESPONSE_OUTCOME = 'completed_no_response' as OutcomeType;
const SYSTEM_DETECTED = 'system' as DetectedBy;
const BOOKED_OUTCOME = 'booked' as OutcomeType;
const REPLY_ANALYSIS = 'reply_analysis' as DetectedBy;
const REPLIED_NO_CONVERT = 'replied_no_convert' as OutcomeType;
const BOUNCE_DETECTED = 'bounce_detection' as DetectedBy;
const CONVERTED_OUTCOME = 'converted' as OutcomeType;
const UNSUBSCRIBED_OUTCOME = 'unsubscribed' as OutcomeType;

export class OutcomeRecorder {
  /**
   * Called when a reply is detected from a lead.
   * Analyzes the reply to determine the outcome and records it.
   * Safely scoped by userId — multi-tenant.
   */
  async processReply(
    leadId: string,
    campaignId: string,
    userId: string,
    replyText: string,
    replySubject?: string
  ): Promise<void> {
    // 1) Check if already has an outcome recorded for this campaign (scoped by userId)
    const existing = await db.query.leadCampaignOutcomes.findFirst({
      where: and(
        eq(leadCampaignOutcomes.leadId, leadId),
        eq(leadCampaignOutcomes.campaignId, campaignId),
        eq(leadCampaignOutcomes.userId, userId)
      ),
    });
    if (existing) return;

    // 2) Check for not_interested patterns
    const isNotInterested = await exclusionEngine.detectAndRecordNotInterested(
      leadId, campaignId, userId, replyText
    );
    if (isNotInterested) return;

    // 3) Check for booking/meeting keywords
    // Deliberately narrow patterns to avoid false positives.
    // "call" alone is too broad (e.g. "I'll call you tomorrow" is not booking).
    const BOOKING_PATTERNS = [
      /\b(?:book|schedule|scheduled|scheduling)\b/i,
      /\b(?:let's|lets)\s+(?:book|schedule|set\s+up)\b/i,
      /\b(?:calendar|calendly)\b/i,
      /\b(?:booked|scheduled)\b/i,
    ];

    for (const pattern of BOOKING_PATTERNS) {
      if (pattern.test(replyText)) {
        await exclusionEngine.recordOutcome({
          leadId,
          campaignId,
          userId,
          outcome: BOOKED_OUTCOME,
          detectedBy: REPLY_ANALYSIS,
          reasonDetail: `Reply matched booking pattern: ${pattern.source}`,
          metadata: { replySnippet: replyText.slice(0, 200) },
        });
        return;
      }
    }

    // 4) General positive reply — record as replied_no_convert
    await exclusionEngine.recordOutcome({
      leadId,
      campaignId,
      userId,
      outcome: REPLIED_NO_CONVERT,
      detectedBy: REPLY_ANALYSIS,
      reasonDetail: 'Lead replied but no specific action detected',
      metadata: { replySnippet: replyText.slice(0, 200) },
    });
  }

  /**
   * Called when a bounce is detected.
   * Classifies as hard or soft bounce and records outcome.
   */
  async processBounce(
    leadId: string,
    campaignId: string,
    userId: string,
    bounceType: 'hard' | 'soft' | 'spam',
    bounceMessage?: string
  ): Promise<void> {
    const outcomeMap: Record<string, OutcomeType> = {
      hard: 'hard_bounce' as OutcomeType,
      soft: 'soft_bounce' as OutcomeType,
      spam: 'spam_complaint' as OutcomeType,
    };

    const outcome = outcomeMap[bounceType] || ('bounced' as OutcomeType);

    await exclusionEngine.recordOutcome({
      leadId,
      campaignId,
      userId,
      outcome,
      detectedBy: BOUNCE_DETECTED,
      reasonDetail: bounceMessage || `Bounce type: ${bounceType}`,
      metadata: { bounceType, bounceMessage },
    });
  }

  /**
   * Called manually when a lead books/converts (e.g. via Stripe webhook, Calendly).
   */
  async recordConversion(
    leadId: string,
    campaignId: string,
    userId: string,
    source: 'payment' | 'calendly' | 'manual',
    detail?: string
  ): Promise<void> {
    await exclusionEngine.recordOutcome({
      leadId,
      campaignId,
      userId,
      outcome: CONVERTED_OUTCOME,
      detectedBy: source === 'manual' ? ('manual' as DetectedBy) : SYSTEM_DETECTED,
      reasonDetail: detail || `Conversion via ${source}`,
      metadata: { conversionSource: source },
    });
  }

  /**
   * Process an unsubscribe request (header or link click).
   */
  async processUnsubscribe(
    leadId: string,
    campaignId: string,
    userId: string,
    source: 'header' | 'link' | 'reply',
    detail?: string
  ): Promise<void> {
    await exclusionEngine.recordOutcome({
      leadId,
      campaignId,
      userId,
      outcome: UNSUBSCRIBED_OUTCOME,
      detectedBy: SYSTEM_DETECTED,
      reasonDetail: detail || `Unsubscribe via ${source}`,
      metadata: { unsubscribeSource: source },
    });
  }

  /**
   * Process when a campaign completes for a lead that never replied.
   * Uses bulk queries to avoid N+1 at scale.
   * Finds leads sent to in this campaign that have no outcome recorded yet,
   * then batch-inserts outcomes for those that qualify as ghosted vs no_response.
   */
  async processCampaignCompletion(campaignId: string, userId: string): Promise<void> {
    // Get all lead IDs that were sent to in this campaign
    const sentRows = await db
      .select({ leadId: campaignEmails.leadId })
      .from(campaignEmails)
      .where(and(
        eq(campaignEmails.campaignId, campaignId),
        eq(campaignEmails.userId, userId),
        eq(campaignEmails.status, 'sent')
      ))
      .groupBy(campaignEmails.leadId);

    if (sentRows.length === 0) return;
    const allLeadIds = sentRows.map(r => r.leadId);

    // Batch-find which leads already have outcomes
    const existingOutcomes = await db
      .select({ leadId: leadCampaignOutcomes.leadId })
      .from(leadCampaignOutcomes)
      .where(and(
        eq(leadCampaignOutcomes.campaignId, campaignId),
        eq(leadCampaignOutcomes.userId, userId),
        inArray(leadCampaignOutcomes.leadId, allLeadIds)
      ));

    const existingSet = new Set(existingOutcomes.map(r => r.leadId));
    const unprocessedLeadIds = allLeadIds.filter(id => !existingSet.has(id));

    if (unprocessedLeadIds.length === 0) return;

    // Batch-check which leads ghosted (have replies) vs no-response
    const repliedLeadIds = await db
      .select({ leadId: messages.leadId })
      .from(messages)
      .where(and(
        inArray(messages.leadId, unprocessedLeadIds),
        eq(messages.direction, 'inbound'),
        eq(messages.userId, userId)
      ))
      .groupBy(messages.leadId);

    const repliedSet = new Set(repliedLeadIds.map(r => r.leadId));

    // Single batch query: get msg count + last sent time for all unprocessed leads
    const msgStats = await db
      .select({
        leadId: campaignEmails.leadId,
        count: sql<number>`COUNT(*)::int`,
        lastSentAt: sql<string>`MAX(sent_at)`,
      })
      .from(campaignEmails)
      .where(and(
        inArray(campaignEmails.leadId, unprocessedLeadIds),
        eq(campaignEmails.campaignId, campaignId),
        eq(campaignEmails.status, 'sent')
      ))
      .groupBy(campaignEmails.leadId);

    const msgStatsMap = new Map(msgStats.map(r => [r.leadId, { count: Number(r.count), lastSentAt: r.lastSentAt }]));

    const ghostBatch: string[] = [];
    const noResponseBatch: string[] = [];

    const now = Date.now();
    for (const lid of unprocessedLeadIds) {
      if (repliedSet.has(lid)) {
        const stats = msgStatsMap.get(lid);
        if (stats && stats.count >= 5 && stats.lastSentAt) {
          const daysSince = (now - new Date(stats.lastSentAt).getTime()) / 86400000;
          if (daysSince >= 14) {
            ghostBatch.push(lid);
            continue;
          }
        }
      }
      noResponseBatch.push(lid);
    }

    // Batch-insert ghosted outcomes
    if (ghostBatch.length > 0) {
      await db.insert(leadCampaignOutcomes).values(
        ghostBatch.map(lid => ({
          leadId: lid,
          campaignId,
          userId,
          outcome: GHOSTED_OUTCOME,
          detectedBy: GHOSTED_DETECTED,
          exclusionPeriodDays: 60,
          excludedUntil: new Date(Date.now() + 60 * 86400000),
          reasonDetail: 'No reply after campaign completion',
          metadata: {},
        }))
      ).onConflictDoNothing();

      await db.update(leads)
        .set({ status: 'cold', aiPaused: false, updatedAt: new Date() })
        .where(and(inArray(leads.id, ghostBatch), eq(leads.userId, userId)));
    }

    // Batch-insert no-response outcomes
    if (noResponseBatch.length > 0) {
      await db.insert(leadCampaignOutcomes).values(
        noResponseBatch.map(lid => ({
          leadId: lid,
          campaignId,
          userId,
          outcome: NO_RESPONSE_OUTCOME,
          detectedBy: SYSTEM_DETECTED,
          exclusionPeriodDays: 30,
          excludedUntil: new Date(Date.now() + 30 * 86400000),
          reasonDetail: 'Campaign completed without reply or conversion',
          metadata: {},
        }))
      ).onConflictDoNothing();
    }

    console.log(`[OutcomeRecorder] Campaign ${campaignId}: ${ghostBatch.length} ghosted, ${noResponseBatch.length} no-response`);
  }

  /**
   * Bulk scan — runs periodically to detect ghosted leads across all campaigns.
   * Processes completed campaigns in batch to find leads that never replied.
   */
  async scanForGhosts(userId: string): Promise<number> {
    const campaigns = await db
      .select({ id: outreachCampaigns.id })
      .from(outreachCampaigns)
      .where(and(
        eq(outreachCampaigns.userId, userId),
        eq(outreachCampaigns.status, 'completed')
      ));

    let totalGhosted = 0;
    for (const campaign of campaigns) {
      const beforeCount = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(leadCampaignOutcomes)
        .where(and(
          eq(leadCampaignOutcomes.campaignId, campaign.id),
          eq(leadCampaignOutcomes.outcome, 'ghosted')
        ))
        .then(r => Number(r[0]?.count || 0));

      await this.processCampaignCompletion(campaign.id, userId);

      const afterCount = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(leadCampaignOutcomes)
        .where(and(
          eq(leadCampaignOutcomes.campaignId, campaign.id),
          eq(leadCampaignOutcomes.outcome, 'ghosted')
        ))
        .then(r => Number(r[0]?.count || 0));

      totalGhosted += (afterCount - beforeCount);
    }

    return totalGhosted;
  }
}

export const outcomeRecorder = new OutcomeRecorder();
