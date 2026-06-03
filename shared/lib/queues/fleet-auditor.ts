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
import { eq, and, sql, gte, ne, count } from 'drizzle-orm';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';

const AUDIT_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const OVERLOAD_THRESHOLD = 50;          // More than 50 pending leads = overloaded
const INACTIVE_THRESHOLD = 5;           // Fewer than 5 pending leads = can receive
const RAMP_CAP_DEFAULT = 45;            // Default daily initial outreach cap

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

      // 2. Categorize mailboxes
      const overloaded: Array<{ integrationId: string; campaignId: string; count: number }> = [];
      const inactive: Array<{ integrationId: string; campaignId: string; count: number }> = [];

      for (const row of pendingCounts) {
        if (!row.integrationId) continue;
        if (Number(row.count) > OVERLOAD_THRESHOLD) {
          overloaded.push({ integrationId: row.integrationId, campaignId: row.campaignId, count: Number(row.count) });
        } else if (Number(row.count) < INACTIVE_THRESHOLD) {
          inactive.push({ integrationId: row.integrationId, campaignId: row.campaignId, count: Number(row.count) });
        }
      }

      if (overloaded.length === 0 || inactive.length === 0) {
        console.log(`[FleetAuditor] No swap needed. Overloaded: ${overloaded.length}, Inactive: ${inactive.length}`);
        return { swapped: 0, fromMailboxes: 0, toMailboxes: 0 };
      }

      // 3. Fetch ramp caps for inactive mailboxes (respect daily limits)
      const inactiveIds = inactive.map(i => i.integrationId);
      const caps = await db
        .select({ id: integrations.id, initialOutreachLimit: integrations.initialOutreachLimit })
        .from(integrations)
        .where(sql`${integrations.id} IN (${sql.join(inactiveIds.map(id => sql`${id}`), sql`, `)})`);
      const capMap = new Map(caps.map(c => [c.id, c.initialOutreachLimit ?? RAMP_CAP_DEFAULT]));

      // 4. Execute swaps: move pending leads from overloaded → inactive within same campaign
      let totalSwapped = 0;
      const usedFrom = new Set<string>();
      const usedTo = new Set<string>();

      for (const over of overloaded) {
        // Find inactive mailboxes in the SAME campaign
        const candidates = inactive.filter(i => i.campaignId === over.campaignId);
        if (candidates.length === 0) continue;

        for (const candidate of candidates) {
          const rampCap = capMap.get(candidate.integrationId) ?? RAMP_CAP_DEFAULT;
          // How many leads can this inactive mailbox receive today?
          const headroom = Math.max(0, rampCap - candidate.count);
          if (headroom <= 0) continue;

          // How many leads to move? Up to 20 at a time, respecting headroom
          const batchSize = Math.min(20, headroom, over.count - OVERLOAD_THRESHOLD);
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

          if (over.count <= OVERLOAD_THRESHOLD) break; // This mailbox is now balanced
        }
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
}

export const fleetAuditor = new FleetAuditor();
