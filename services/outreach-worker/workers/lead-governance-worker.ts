import { db } from '@shared/lib/db/db.js';
import { leads } from '@audnix/shared';
import { eq, and, sql, lt } from 'drizzle-orm';
import { clusterSync } from "@shared/lib/realtime/redis-pubsub.js";
import { workerHealthMonitor } from "@shared/lib/monitoring/worker-health.js";
import { quotaService } from "@shared/lib/monitoring/quota-service.js";

/**
 * Lead Governance Worker
 * 
 * 1. Periodically checks for leads with 'new' status that were created more than 6 hours ago and transitions them to 'open' status.
 * 2. Periodically checks for 'warm' leads with no response for 7 days and transitions them to 'cold' status (Warmth Decay).
 */
export class LeadGovernanceWorker {
  private isRunning: boolean = false;
  private interval: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL_MS = 900000; // Check every 15 minutes
  private readonly EXPIRY_HOURS = 6;
  private readonly WARMTH_DECAY_DAYS = 7;

  /**
   * Start the lead expiry worker
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('🕒 Lead Governance Worker started (Expiry + Warmth Decay)');

    this.interval = setInterval(() => this.tick(), this.CHECK_INTERVAL_MS);
    this.tick(); // Run immediately on start
  }

  /**
   * Stop the worker
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isRunning = false;
    console.log('🛑 Lead Governance Worker stopped');
  }

  /**
   * Single check iteration
   */
  async tick(): Promise<void> {
    if (quotaService.isRestricted()) {
      console.log('[LeadGovernanceWorker] Skipping tick: Database quota restricted');
      return;
    }
    try {
      const expiryTime = new Date();
      expiryTime.setHours(expiryTime.getHours() - this.EXPIRY_HOURS);

      const warmthDecayTime = new Date();
      warmthDecayTime.setDate(warmthDecayTime.getDate() - this.WARMTH_DECAY_DAYS);

      const expiredLeads = await db
        .select({ id: leads.id, userId: leads.userId })
        .from(leads)
        .where(
          and(
            eq(leads.status, 'new'),
            lt(leads.createdAt, expiryTime)
          )
        );

      if (expiredLeads.length > 0) {
        console.log(`🕒 Expiring 'new' status for ${expiredLeads.length} leads...`);

        // Batch update status to 'contacted'
        const leadIds = expiredLeads.map((l: { id: string }) => l.id);
        await db.update(leads)
          .set({ status: 'contacted', updatedAt: new Date() })
          .where(sql`id IN (${sql.join(leadIds, sql`, `)})`);

        // Notify users via WebSocket
        const uniqueUserIds = [...new Set(expiredLeads.map((l: { userId: string }) => l.userId))];
        for (const userId of uniqueUserIds) {
          await clusterSync.notifyLeadsUpdated(userId as string, { action: 'status_expired' });
        }
      }

      // --- WARMTH DECAY LOGIC ---
      const coldLeads = await db
        .select({ id: leads.id, userId: leads.userId })
        .from(leads)
        .where(
          and(
            eq(leads.status, 'warm'),
            lt(leads.lastMessageAt, warmthDecayTime)
          )
        );

      if (coldLeads.length > 0) {
        console.log(`❄️  Decaying warmth for ${coldLeads.length} leads (No response in 7 days)...`);
        
        const coldLeadIds = coldLeads.map((l: { id: string }) => l.id);
        await db.update(leads)
          .set({ 
            status: 'cold', 
            warm: false, 
            updatedAt: new Date(),
            metadata: sql`jsonb_set(metadata, '{warmthDecayAt}', ${sql`${new Date().toISOString()}`}::jsonb)` 
          })
          .where(sql`id IN (${sql.join(coldLeadIds, sql`, `)})`);

        const uniqueUserIds = [...new Set(coldLeads.map((l: { userId: string }) => l.userId))];
        for (const userId of uniqueUserIds) {
          await clusterSync.notifyLeadsUpdated(userId as string, { action: 'warmth_decay' });
        }
      }

      workerHealthMonitor.recordSuccess('lead-governance-worker');
    } catch (error: any) {
      console.error('[LeadGovernanceWorker] Tick error:', error);
      quotaService.reportDbError(error);
      workerHealthMonitor.recordError('lead-governance-worker', error?.message || 'Unknown error');
    }
  }
}

export const leadGovernanceWorker = new LeadGovernanceWorker();






