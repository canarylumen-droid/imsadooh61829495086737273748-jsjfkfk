/**
 * Fleet Auditor — Phase 4: Dynamic Lead Overflow & Workload Swap
 *
 * Treats the mailbox fleet as a shared processing unit.
 * Runs every 30 minutes to re-allocate pending initial leads from overloaded
 * mailboxes to inactive ones, while strictly preserving follow-up tethering.
 *
 * Rules:
 * 1. Only swap leads with status = 'pending' (initial untouched)
 * 2. Never touch leads in follow-up sequences (status = 'sent', etc.)
 * 3. Respect receiving mailbox's current daily ramp-up cap
 * 4. Update integration_id on campaign_leads, preserving campaign context
 */

import { db } from '@shared/lib/db/db.js';
import { campaignLeads, integrations, outreachCampaigns } from '@audnix/shared';
import { eq, and, sql, gte, ne, count, inArray, or, isNull } from 'drizzle-orm';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';

const AUDIT_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const OVERLOAD_MULTIPLIER = 2;            // pending > dailyCap × 2 = overloaded
const INACTIVE_RATIO = 0.1;              // pending < dailyCap × 0.1 = inactive (can receive)
const RAMP_CAP_DEFAULT = 45;             // Default daily initial outreach cap
const MAX_BATCH_SWAP = 20;               // Max leads per swap batch

class FleetAuditor {
  private interval: NodeJS.Timeout | null = null;

  start(): void {
    if (this.interval) return;
    console.log('[FleetAuditor] Starting 30-min workload swap daemon...');
    this.interval = setInterval(() => this.runAudit().catch(console.error), AUDIT_INTERVAL_MS);
    // Immediate first run
    this.runAudit().catch(console.error);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      console.log('[FleetAuditor] Stopped.');
    }
  }

  async runAudit(): Promise<{ swapped: number; fromMailboxes: number; toMailboxes: number }> {
    if (!db) return { swapped: 0, fromMailboxes: 0, toMailboxes: 0 };
    console.log('[FleetAuditor] Running workload audit...');

    try {
      // 1. Aggregate pending lead counts per mailbox per active campaign
      const pendingCounts = await db
        .select({
          integrationId: campaignLeads.integrationId,
          campaignId: campaignLeads.campaignId,
          count: count(campaignLeads.id),
        })
        .from(campaignLeads)
        .where(
          and(
            eq(campaignLeads.status, 'pending'),
            ne(campaignLeads.integrationId, sql`NULL`)
          )
        )
        .groupBy(campaignLeads.integrationId, campaignLeads.campaignId);

      // 2. Fetch mailbox limits and health for dynamic thresholds
      const allMailboxIds = [...new Set(pendingCounts.map(r => r.integrationId).filter(Boolean))];
      const mailboxProfiles = await this.getMailboxProfiles(allMailboxIds as string[]);

      // 3. Categorize mailboxes using dynamic thresholds
      const overloaded: Array<{ integrationId: string; campaignId: string; count: number }> = [];
      const inactive: Array<{ integrationId: string; campaignId: string; count: number }> = [];

      for (const row of pendingCounts) {
        if (!row.integrationId) continue;
        const profile = mailboxProfiles.get(row.integrationId);
        if (!profile) continue;

        // Skip unhealthy mailboxes entirely
        if (profile.healthStatus === 'failed' || profile.isHardPaused) continue;

        const dailyCap = profile.initialOutreachLimit || profile.dailyLimit || RAMP_CAP_DEFAULT;
        const overloadThreshold = dailyCap * OVERLOAD_MULTIPLIER;
        const inactiveThreshold = Math.max(1, Math.floor(dailyCap * INACTIVE_RATIO));

        if (Number(row.count) > overloadThreshold) {
          overloaded.push({ integrationId: row.integrationId, campaignId: row.campaignId, count: Number(row.count) });
        } else if (Number(row.count) < inactiveThreshold) {
          inactive.push({ integrationId: row.integrationId, campaignId: row.campaignId, count: Number(row.count) });
        }
      }

      if (overloaded.length === 0 || inactive.length === 0) {
        console.log(`[FleetAuditor] No swap needed. Overloaded: ${overloaded.length}, Inactive: ${inactive.length}`);
        return { swapped: 0, fromMailboxes: 0, toMailboxes: 0 };
      }

      // 4. Fetch ramp caps and health for inactive mailboxes
      const inactiveIds = inactive.map(i => i.integrationId);
      const caps = await db
        .select({
          id: integrations.id,
          initialOutreachLimit: integrations.initialOutreachLimit,
          dailyLimit: integrations.dailyLimit,
          warmupStatus: integrations.warmupStatus,
        })
        .from(integrations)
        .where(inArray(integrations.id, inactiveIds));
      const capMap = new Map(caps.map(c => [c.id, {
        limit: c.initialOutreachLimit ?? c.dailyLimit ?? RAMP_CAP_DEFAULT,
        isWarmingUp: c.warmupStatus === 'active',
      }]));

      // 5. Execute swaps: move pending leads from overloaded → inactive within same campaign
      let totalSwapped = 0;
      const usedFrom = new Set<string>();
      const usedTo = new Set<string>();

      for (const over of overloaded) {
        // Find inactive mailboxes in the SAME campaign
        const candidates = inactive.filter(i => i.campaignId === over.campaignId);
        if (candidates.length === 0) continue;

        for (const candidate of candidates) {
          const profile = capMap.get(candidate.integrationId);
          const rampCap = profile?.limit ?? RAMP_CAP_DEFAULT;

          // Skip warming-up mailboxes — they can't handle overflow yet
          if (profile?.isWarmingUp) continue;

          // How many leads can this inactive mailbox receive today?
          const headroom = Math.max(0, rampCap - candidate.count);
          if (headroom <= 0) continue;

          // How many leads to move? Up to MAX_BATCH_SWAP at a time, respecting headroom
          const overloadThreshold = rampCap * OVERLOAD_MULTIPLIER;
          const batchSize = Math.min(MAX_BATCH_SWAP, headroom, over.count - overloadThreshold);
          if (batchSize <= 0) continue;

          // Atomically reassign leads using FOR UPDATE SKIP LOCKED
          const result = await db.execute(sql`
            UPDATE campaign_leads
            SET integration_id = ${candidate.integrationId},
                updated_at = NOW()
            WHERE id IN (
              SELECT id FROM campaign_leads
              WHERE campaign_id = ${over.campaignId}
                AND status = 'pending'
                AND integration_id = ${over.integrationId}
              ORDER BY created_at ASC
              FOR UPDATE SKIP LOCKED
              LIMIT ${batchSize}
            )
            RETURNING id;
          `);

          const moved = result.rows.length;
          if (moved > 0) {
            totalSwapped += moved;
            usedFrom.add(over.integrationId);
            usedTo.add(candidate.integrationId);
            candidate.count += moved;
            over.count -= moved;
            console.log(`[FleetAuditor] Swapped ${moved} leads from ${over.integrationId.slice(0,8)} → ${candidate.integrationId.slice(0,8)} (campaign ${over.campaignId.slice(0,8)})`);
          }

          if (over.count <= overloadThreshold) break; // This mailbox is now balanced
        }
      }

      // 6. Trigger Hourly Distribution recalculation for affected mailboxes
      if (totalSwapped > 0) {
        try {
          const { hourlyDistribution } = await import('./hourly-distribution.js');
          await hourlyDistribution.recalculateAll().catch(err => console.warn('[FleetAuditor] Hourly distribution recalculation failed:', err.message));
        } catch { /* non-critical */ }
      }

      // 5. Notify affected users
      if (totalSwapped > 0) {
        const affectedCampaignIds = new Set([...overloaded.map(o => o.campaignId), ...inactive.map(i => i.campaignId)]);
        for (const campaignId of affectedCampaignIds) {
          const [campaign] = await db.select({ userId: outreachCampaigns.userId }).from(outreachCampaigns).where(eq(outreachCampaigns.id, campaignId)).limit(1);
          if (campaign?.userId) {
            wsSync.broadcastToUser(campaign.userId, { type: 'fleet_auditor_swapped', payload: { campaignId, totalSwapped } });
          }
        }
      }

      console.log(`[FleetAuditor] ✅ Audit complete. Swapped ${totalSwapped} leads across ${usedFrom.size} → ${usedTo.size} mailboxes.`);
      return { swapped: totalSwapped, fromMailboxes: usedFrom.size, toMailboxes: usedTo.size };

    } catch (err: any) {
      console.error('[FleetAuditor] Audit failed:', err.message);
      return { swapped: 0, fromMailboxes: 0, toMailboxes: 0 };
    }
  }

  private async getMailboxProfiles(mailboxIds: string[]): Promise<Map<string, {
    dailyLimit: number;
    initialOutreachLimit: number | null;
    healthStatus: string;
    isHardPaused: boolean;
  }>> {
    const profiles = new Map<string, any>();
    if (mailboxIds.length === 0) return profiles;

    const rows = await db
      .select({
        id: integrations.id,
        dailyLimit: integrations.dailyLimit,
        initialOutreachLimit: integrations.initialOutreachLimit,
        healthStatus: integrations.healthStatus,
        mailboxPauseUntil: integrations.mailboxPauseUntil,
      })
      .from(integrations)
      .where(inArray(integrations.id, mailboxIds));

    for (const row of rows) {
      const isHardPaused = row.mailboxPauseUntil
        ? new Date(row.mailboxPauseUntil).getTime() > Date.now()
        : false;

      profiles.set(row.id, {
        dailyLimit: row.dailyLimit ?? RAMP_CAP_DEFAULT,
        initialOutreachLimit: row.initialOutreachLimit,
        healthStatus: row.healthStatus ?? 'connected',
        isHardPaused,
      });
    }

    return profiles;
  }
}

export const fleetAuditor = new FleetAuditor();
