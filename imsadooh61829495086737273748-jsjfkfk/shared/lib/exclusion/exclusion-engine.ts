import { db } from '../db/db.js';
import { getRedisClient } from '../redis/redis.js';
import {
  leadCampaignOutcomes,
  leadExclusionRules,
  leads,
  campaignEmails,
  messages,
} from '@audnix/shared';
import { and, eq, inArray, or, isNull, sql, gt, gte, desc } from 'drizzle-orm';
import { clusterSync } from '../realtime/redis-pubsub.js';

export type OutcomeType =
  | 'converted' | 'not_interested' | 'ghosted' | 'bounced'
  | 'unsubscribed' | 'booked' | 'replied_no_convert'
  | 'completed_no_response' | 'spam_complaint'
  | 'hard_bounce' | 'soft_bounce';

export type DetectedBy =
  | 'ai_sentiment' | 'manual' | 'auto_rule' | 'reply_analysis'
  | 'bounce_detection' | 'ghost_detection' | 'system';

export interface ExclusionResult {
  excluded: boolean;
  reason: string | null;
  excludedUntil: Date | null;
  outcome: OutcomeType | null;
  ruleName: string | null;
}

const EXCLUSION_CACHE_TTL = 300;

const OUTCOME_COOLDOWNS: Record<string, { defaultDays: number; permanent: boolean }> = {
  converted:             { defaultDays: 0, permanent: true },
  unsubscribed:          { defaultDays: 0, permanent: true },
  spam_complaint:        { defaultDays: 0, permanent: true },
  hard_bounce:           { defaultDays: 0, permanent: true },
  booked:                { defaultDays: 0, permanent: true },
  not_interested:        { defaultDays: 180, permanent: false },
  ghosted:               { defaultDays: 60, permanent: false },
  replied_no_convert:    { defaultDays: 45, permanent: false },
  completed_no_response: { defaultDays: 30, permanent: false },
  soft_bounce:           { defaultDays: 7, permanent: false },
  bounced:               { defaultDays: 14, permanent: false },
};

export class LeadExclusionEngine {
  /**
   * Check if a single lead is excluded for a user.
   * Uses Redis cache (fast), falls back to PostgreSQL.
   * All queries scoped by userId — multi-tenant safe at the schema level.
   */
  async isExcluded(leadId: string, userId: string): Promise<ExclusionResult> {
    // 1) Fast path: Redis cache
    const cached = await this.getCachedExclusion(leadId, userId);
    if (cached !== null) return cached;

    // 2) PG: check lead_campaign_outcomes for active exclusions
    const now = new Date();
    const outcome = await db.query.leadCampaignOutcomes.findFirst({
      where: and(
        eq(leadCampaignOutcomes.leadId, leadId),
        eq(leadCampaignOutcomes.userId, userId),
        or(
          isNull(leadCampaignOutcomes.excludedUntil),
          gt(leadCampaignOutcomes.excludedUntil, now)
        )
      ),
      orderBy: [desc(leadCampaignOutcomes.createdAt)],
    });

    if (outcome) {
      const excluded = outcome.excludedUntil === null || outcome.excludedUntil > now;
      if (excluded) {
        const result: ExclusionResult = {
          excluded: true,
          reason: outcome.reasonDetail || `Excluded due to outcome: ${outcome.outcome}`,
          excludedUntil: outcome.excludedUntil,
          outcome: outcome.outcome as OutcomeType,
          ruleName: null,
        };
        await this.setCachedExclusion(leadId, userId, result);
        return result;
      }
    }

    // 3) Check user-defined exclusion rules
    const rules = await db.query.leadExclusionRules.findMany({
      where: and(
        eq(leadExclusionRules.userId, userId),
        eq(leadExclusionRules.isActive, true)
      ),
      orderBy: [desc(leadExclusionRules.priority)],
    });

    for (const rule of rules) {
      const ruleResult = await this.evaluateRule(leadId, userId, rule);
      if (ruleResult.excluded) {
        await this.setCachedExclusion(leadId, userId, ruleResult);
        return ruleResult;
      }
    }

    // 4) Not excluded
    const notExcluded: ExclusionResult = { excluded: false, reason: null, excludedUntil: null, outcome: null, ruleName: null };
    await this.setCachedExclusion(leadId, userId, notExcluded);
    return notExcluded;
  }

  /**
   * Bulk check — filters an array of lead IDs, returning only those that
   * are NOT excluded. Uses batched PG query (efficient at scale).
   * NOTE: Only checks outcome-based exclusions (fast path). Custom
   * exclusion rules are evaluated at send-time via isExcluded().
   */
  async filterExcluded(leadIds: string[], userId: string): Promise<string[]> {
    if (leadIds.length === 0) return [];

    const now = new Date();
    const excludedLeads = await db
      .select({ leadId: leadCampaignOutcomes.leadId })
      .from(leadCampaignOutcomes)
      .where(and(
        eq(leadCampaignOutcomes.userId, userId),
        inArray(leadCampaignOutcomes.leadId, leadIds),
        or(
          isNull(leadCampaignOutcomes.excludedUntil),
          gt(leadCampaignOutcomes.excludedUntil, now)
        )
      ));

    const excludedSet = new Set(excludedLeads.map(r => r.leadId));
    return leadIds.filter(id => !excludedSet.has(id));
  }

  /**
   * Record a campaign outcome for a lead.
   * This writes to lead_campaign_outcomes and updates the leads table status.
   * Automatically computes exclusion period with exponential backoff.
   */
  async recordOutcome(params: {
    leadId: string;
    campaignId: string;
    userId: string;
    outcome: OutcomeType;
    detectedBy: DetectedBy;
    reasonDetail?: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    const { leadId, campaignId, userId, outcome, detectedBy, reasonDetail, metadata } = params;

    const cooldown = OUTCOME_COOLDOWNS[outcome] || { defaultDays: 30, permanent: false };

    let exclusionPeriodDays: number | null = cooldown.permanent ? null : cooldown.defaultDays;

    // Exponential backoff: count how many times this lead has had this outcome
    if (!cooldown.permanent && exclusionPeriodDays !== null) {
      const prevCount = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(leadCampaignOutcomes)
        .where(and(
          eq(leadCampaignOutcomes.leadId, leadId),
          eq(leadCampaignOutcomes.userId, userId),
          eq(leadCampaignOutcomes.outcome, outcome)
        ))
        .then(r => Number(r[0]?.count || 0));

      if (prevCount > 0) {
        exclusionPeriodDays = Math.min(
          exclusionPeriodDays * Math.pow(2, prevCount),
          365
        );
      }
    }

    const excludedUntil = exclusionPeriodDays !== null
      ? new Date(Date.now() + exclusionPeriodDays * 86400000)
      : null;

    // Upsert: one outcome per lead+campaign
    await db.insert(leadCampaignOutcomes).values({
      leadId,
      campaignId,
      userId,
      outcome,
      detectedBy,
      exclusionPeriodDays,
      excludedUntil,
      reasonDetail: reasonDetail || null,
      metadata: metadata || {},
    }).onConflictDoUpdate({
      target: [leadCampaignOutcomes.leadId, leadCampaignOutcomes.campaignId],
      set: {
        outcome,
        detectedBy,
        exclusionPeriodDays,
        excludedUntil,
        reasonDetail: reasonDetail || null,
        metadata: metadata || {},
      },
    });

    // Update lead status to reflect outcome
    const statusMap: Partial<Record<OutcomeType, string>> = {
      converted: 'converted',
      not_interested: 'not_interested',
      unsubscribed: 'not_interested',
      spam_complaint: 'not_interested',
      booked: 'booked',
      replied_no_convert: 'replied',
      hard_bounce: 'bouncy',
      soft_bounce: 'bouncy',
      bounced: 'bouncy',
    };

    const newStatus = statusMap[outcome];
    const shouldPause = outcome === 'hard_bounce' || outcome === 'spam_complaint' || outcome === 'unsubscribed' || outcome === 'booked' || outcome === 'converted';
    if (newStatus) {
      const [updated] = await db.update(leads)
        .set({
          status: newStatus as any,
          aiPaused: shouldPause,
          updatedAt: new Date(),
        })
        .where(and(eq(leads.id, leadId), eq(leads.userId, userId)))
        .returning();

      // Real-time notification for status change
      if (updated) {
        clusterSync.notifyLeadsUpdated(userId, { event: 'UPDATE', lead: updated }).catch(() => {});
        clusterSync.notifyStatsCacheInvalidate(userId).catch(() => {});
        clusterSync.notifyStatsUpdated(userId).catch(() => {});
      }
    }

    // Invalidate cache
    await this.invalidateCache(leadId, userId);
  }

  /**
   * Mark a lead as ghosted — detected when:
   * - Lead was sent 5+ messages across a campaign
   * - 14+ days since last message
   * - 0 replies from lead
   */
  async detectAndRecordGhost(leadId: string, campaignId: string, userId: string): Promise<boolean> {
    const msgCount = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(campaignEmails)
      .where(and(
        eq(campaignEmails.leadId, leadId),
        eq(campaignEmails.campaignId, campaignId),
        eq(campaignEmails.status, 'sent')
      ))
      .then(r => Number(r[0]?.count || 0));

    if (msgCount < 5) return false;

    const lastMsg = await db.query.campaignEmails.findFirst({
      where: and(
        eq(campaignEmails.leadId, leadId),
        eq(campaignEmails.campaignId, campaignId),
        eq(campaignEmails.status, 'sent')
      ),
      orderBy: [desc(campaignEmails.sentAt)],
    });

    if (!lastMsg || !lastMsg.sentAt) return false;

    const daysSinceLastContact = (Date.now() - new Date(lastMsg.sentAt).getTime()) / 86400000;
    if (daysSinceLastContact < 14) return false;

    const hasReply = await db
      .select({ id: messages.id })
      .from(messages)
      .where(and(
        eq(messages.leadId, leadId),
        eq(messages.direction, 'inbound')
      ))
      .limit(1);

    if (hasReply.length > 0) return false;

    await this.recordOutcome({
      leadId,
      campaignId,
      userId,
      outcome: 'ghosted',
      detectedBy: 'ghost_detection',
      reasonDetail: `No reply after ${msgCount} messages over ${Math.round(daysSinceLastContact)} days`,
      metadata: { messagesSent: msgCount, daysSinceLastContact: Math.round(daysSinceLastContact) },
    });

    return true;
  }

  /**
   * Detect and record "not_interested" from reply sentiment analysis.
   * Keywords and patterns that indicate disinterest.
   */
  async detectAndRecordNotInterested(
    leadId: string,
    campaignId: string,
    userId: string,
    replyText: string
  ): Promise<boolean> {
    const DISINTEREST_PATTERNS = [
      /\b(?:stop|unsubscribe|remove|opt\s*out|leave me alone)\b/i,
      /\bnot\s+(?:interested|thanks|right now|at this time)\b/i,
      /\b(?:don't|do not|dont)\s+(?:contact|email|message|bother)\b/i,
      /\b(?:take me off|take me out|remove me)\b/i,
      /\b(?:spam|junk|unwanted|unsolicited)\b/i,
      /^no\b/i,
    ];

    for (const pattern of DISINTEREST_PATTERNS) {
      if (pattern.test(replyText)) {
        await this.recordOutcome({
          leadId,
          campaignId,
          userId,
          outcome: 'not_interested',
          detectedBy: 'reply_analysis',
          reasonDetail: `Reply matched disinterest pattern: ${pattern.source}`,
          metadata: { matchedPattern: pattern.source, replySnippet: replyText.slice(0, 200) },
        });
        return true;
      }
    }

    return false;
  }

  /**
   * Evaluate a single custom exclusion rule against a lead.
   */
  private async evaluateRule(
    leadId: string,
    userId: string,
    rule: any
  ): Promise<ExclusionResult> {
    const cfg = rule.config || {};
    const now = new Date();

    try {
      switch (rule.ruleType) {
        case 'outcome_based': {
          const targetOutcomes = cfg.outcomes || [];
          if (targetOutcomes.length === 0) break;

          const match = await db.query.leadCampaignOutcomes.findFirst({
            where: and(
              eq(leadCampaignOutcomes.leadId, leadId),
              eq(leadCampaignOutcomes.userId, userId),
              inArray(leadCampaignOutcomes.outcome, targetOutcomes),
              or(
                isNull(leadCampaignOutcomes.excludedUntil),
                gt(leadCampaignOutcomes.excludedUntil, now)
              )
            ),
          });

          if (match) {
            const days = cfg.permanent ? null : (cfg.exclusionDays || 180);
            const until = days !== null ? new Date(now.getTime() + days * 86400000) : null;
            return {
              excluded: true,
              reason: `Matched rule "${rule.name}": outcome ${match.outcome}`,
              excludedUntil: until,
              outcome: match.outcome as OutcomeType,
              ruleName: rule.name,
            };
          }
          break;
        }

        case 'fatigue_based': {
          const maxCampaigns = cfg.maxCampaignsInDays || 3;
          const windowDays = cfg.campaignWindowDays || 30;
          const windowStart = new Date(now.getTime() - windowDays * 86400000);

          const campaignCount = await db
            .select({ count: sql<number>`COUNT(DISTINCT ${leadCampaignOutcomes.campaignId})::int` })
            .from(leadCampaignOutcomes)
            .where(and(
              eq(leadCampaignOutcomes.leadId, leadId),
              eq(leadCampaignOutcomes.userId, userId),
              gte(leadCampaignOutcomes.createdAt, windowStart)
            ))
            .then(r => Number(r[0]?.count || 0));

          if (campaignCount >= maxCampaigns) {
            const cooldownDays = cfg.cooldownDays || 60;
            const until = new Date(now.getTime() + cooldownDays * 86400000);
            return {
              excluded: true,
              reason: `Campaign fatigue: ${campaignCount} campaigns in ${windowDays} days (max: ${maxCampaigns})`,
              excludedUntil: until,
              outcome: null,
              ruleName: rule.name,
            };
          }
          break;
        }

        case 'time_based': {
          if (cfg.noReplyDays && cfg.minMessagesSent) {
            const lastMsg = await db.query.campaignEmails.findFirst({
              where: and(
                eq(campaignEmails.leadId, leadId),
                eq(campaignEmails.userId, userId),
                eq(campaignEmails.status, 'sent')
              ),
              orderBy: [desc(campaignEmails.sentAt)],
            });

            if (lastMsg?.sentAt) {
              const daysSince = (now.getTime() - new Date(lastMsg.sentAt).getTime()) / 86400000;
              if (daysSince >= cfg.noReplyDays) {
                const msgCount = await db
                  .select({ count: sql<number>`COUNT(*)::int` })
                  .from(campaignEmails)
                  .where(and(
                    eq(campaignEmails.leadId, leadId),
                    eq(campaignEmails.userId, userId)
                  ))
                  .then(r => Number(r[0]?.count || 0));

                if (msgCount >= cfg.minMessagesSent) {
                  const until = new Date(now.getTime() + (cfg.cooldownDays || 60) * 86400000);
                  return {
                    excluded: true,
                    reason: `No reply after ${msgCount} messages in ${Math.round(daysSince)} days`,
                    excludedUntil: until,
                    outcome: 'ghosted',
                    ruleName: rule.name,
                  };
                }
              }
            }
          }
          break;
        }

        case 'status_based': {
          const leadStatuses: string[] = cfg.leadStatuses || [];
          if (leadStatuses.length === 0) break;

          const lead = await db.query.leads.findFirst({
            where: and(eq(leads.id, leadId), eq(leads.userId, userId)),
          });

          if (lead && leadStatuses.includes(lead.status)) {
            const until = new Date(now.getTime() + (cfg.cooldownDays || 90) * 86400000);
            return {
              excluded: true,
              reason: `Lead status "${lead.status}" matches exclusion rule "${rule.name}"`,
              excludedUntil: until,
              outcome: null,
              ruleName: rule.name,
            };
          }
          break;
        }
      }
    } catch (err) {
      console.error(`[ExclusionEngine] Rule evaluation error for rule "${rule.name}":`, err);
    }

    return { excluded: false, reason: null, excludedUntil: null, outcome: null, ruleName: null };
  }

  // ─── Cache Layer ─────────────────────────────────────────────────────────────

  private cacheKey(leadId: string, userId: string): string {
    return `excl:${userId}:${leadId}`;
  }

  private async getCachedExclusion(leadId: string, userId: string): Promise<ExclusionResult | null> {
    try {
      const client = await getRedisClient();
      if (!client) return null;
      const raw = await client.get(this.cacheKey(leadId, userId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed.excludedUntil) parsed.excludedUntil = new Date(parsed.excludedUntil);
      return parsed as ExclusionResult;
    } catch {
      return null;
    }
  }

  private async setCachedExclusion(leadId: string, userId: string, result: ExclusionResult): Promise<void> {
    try {
      const client = await getRedisClient();
      if (!client) return;
      const ttl = result.excluded
        ? Math.min(EXCLUSION_CACHE_TTL, 60)
        : EXCLUSION_CACHE_TTL;
      await client.setEx(this.cacheKey(leadId, userId), ttl, JSON.stringify(result));
    } catch {
      // Cache unavailable — proceed without
    }
  }

  private async invalidateCache(leadId: string, userId: string): Promise<void> {
    try {
      const client = await getRedisClient();
      if (!client) return;
      await client.del(this.cacheKey(leadId, userId));
    } catch {
      // Best-effort
    }
  }
}

export const exclusionEngine = new LeadExclusionEngine();
