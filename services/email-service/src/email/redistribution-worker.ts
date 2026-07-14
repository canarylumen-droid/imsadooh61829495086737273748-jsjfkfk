/**
 * Lead Redistribution Worker
 * 
 * Automatically redistributes unsent leads from failed mailboxes:
 * - Runs every hour
 * - If a mailbox has been failed for >24h with no user action, 
 *   redistributes leads across remaining active mailboxes
 * - Respects daily sending limits
 * - Creates audit trail and notifications
 */

import { db } from '@shared/lib/db/db.js';
import {
  integrations,
  campaignLeads,
  outreachCampaigns,
  userOutreachSettings,
} from '@audnix/shared';
import { eq, and, ne, sql, isNull, or, lte, inArray } from 'drizzle-orm';
import { storage } from '@shared/lib/storage/storage.js';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';
import { mailboxHealthService } from './mailbox-health-service.js';
import { quotaService } from '@shared/lib/monitoring/quota-service.js';

class RedistributionWorker {
  private interval: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL_MS = 900000; // Every 15 minutes
  private readonly REDISTRIBUTION_THRESHOLD_HOURS = 24;

  start(): void {
    if (this.interval) return;

    console.log('🔄 Lead Redistribution Worker started (1h interval)');

    this.interval = setInterval(() => {
      this.run().catch(err => {
        console.error('[Redistribution] Worker error:', err.message);
      });
    }, this.CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /**
   * Main redistribution logic
   */
  async run(): Promise<number> {
    if (quotaService.isRestricted()) {
      console.log('[Redistribution] Skipping run: Database quota restricted');
      return 0;
    }
    console.log('🔄 [Redistribution] Starting worker run...');
    let totalRedistributed = 0;
    try {
      // 1. Find mailboxes that have been failed for > 24 hours
      const threshold = new Date();
      threshold.setHours(threshold.getHours() - this.REDISTRIBUTION_THRESHOLD_HOURS);

      const failedMailboxes = await db.select()
        .from(integrations)
        .where(and(
          eq(integrations.healthStatus, 'failed'),
          lte(integrations.lastHealthCheckAt, threshold)
        ));

      console.log(`[Redistribution] Found ${failedMailboxes.length} failed integrations at threshold ${threshold.toISOString()}`);

      if (failedMailboxes.length === 0) return 0;

      // Group by user
      const userMailboxes = new Map<string, typeof failedMailboxes>();
      for (const mb of failedMailboxes) {
        const list = userMailboxes.get(mb.userId) || [];
        list.push(mb);
        userMailboxes.set(mb.userId, list);
      }

      for (const [userId, failedMbs] of userMailboxes) {
        totalRedistributed += await this.redistributeForUser(userId, failedMbs);
      }

    } catch (err: any) {
      console.error('[Redistribution] Error:', err.message);
      quotaService.reportDbError(err);
    }
    return totalRedistributed;
  }

  /**
   * Redistribute leads for a specific user from failed mailboxes
   */
  public async redistributeForUser(userId: string, failedMailboxes: any[]): Promise<number> {
    let redistributedCount = 0;
    try {
      // 1. Check if user allows auto-redistribution
      const [settings] = await db.select().from(userOutreachSettings).where(eq(userOutreachSettings.userId, userId));
      if (settings && !settings.autoRedistribute) {
        console.log(`[Redistribution] User ${userId} has auto-redistribute DISABLED. Skipping.`);
        return 0;
      }

      // 2. Get active mailboxes for this user  
      const activeMailboxes = await mailboxHealthService.getActiveMailboxes(userId);
      console.log(`[Redistribution] User ${userId}: Found ${activeMailboxes.length} active mailboxes`);

      if (activeMailboxes.length === 0) {
        console.warn(`[Redistribution] No active mailboxes for user ${userId} — cannot redistribute`);
        
        await storage.createNotification({
          userId,
          type: 'mailbox_failure',
          title: '🚨 No Active Mailboxes',
          message: 'All your mailboxes are down. Please reconnect a mailbox to continue sending campaigns.',
          metadata: { activityType: 'all_mailboxes_down' }
        });
        return 0;
      }

      // 3. Get remaining capacity for active mailboxes
      const mbIds = activeMailboxes.map(mb => mb.id);
      const capacities = await mailboxHealthService.getMailboxCapacities(mbIds);
      console.log(`[Redistribution] Capacities: ${JSON.stringify(Array.from(capacities.entries()))}`);
      
      // Filter only mailboxes with capacity > 0
      const capableMailboxes = activeMailboxes.filter(mb => (capacities.get(mb.id) || 0) > 0);
      console.log(`[Redistribution] Capable mailboxes: ${capableMailboxes.length}`);

      if (capableMailboxes.length === 0) {
        console.warn(`[Redistribution] Active mailboxes for user ${userId} have reached their daily limits.`);
        return 0;
      }

      const failedIds = failedMailboxes.map(mb => mb.id);

      // 4. Find all pending/queued campaign leads assigned to failed mailboxes
      const strandedLeads = await db.select()
        .from(campaignLeads)
        .where(and(
          inArray(campaignLeads.integrationId, failedIds),
          or(
            eq(campaignLeads.status, 'pending'),
            eq(campaignLeads.status, 'queued')
          )
        ));

      console.log(`[Redistribution] Found ${strandedLeads.length} stranded leads across failed mailboxes: ${failedIds.join(', ')}`);

      if (strandedLeads.length === 0) {
        console.log(`[Redistribution] No stranded leads for user ${userId}`);
        return 0;
      }

      console.log(`[Redistribution] Redistributing ${strandedLeads.length} leads across ${capableMailboxes.length} capable mailboxes`);

      // 5. Smart Assignment (respecting capacity)
      let currentMbIndex = 0;
      let redistributedCount = 0;

      for (const lead of strandedLeads) {
        // Find next mailbox with capacity
        let attempts = 0;
        let found = false;
        
        while (attempts < capableMailboxes.length) {
          const mb = capableMailboxes[currentMbIndex % capableMailboxes.length];
          const remaining = capacities.get(mb.id) || 0;
          
          if (remaining > 0) {
            // Assign
            await db.update(campaignLeads)
              .set({
                integrationId: mb.id,
                status: 'pending'
              })
              .where(eq(campaignLeads.id, lead.id));
            
            capacities.set(mb.id, remaining - 1);
            redistributedCount++;
            found = true;
            break;
          }
          currentMbIndex++;
          attempts++;
        }
        
        if (!found) {
          console.warn(`[Redistribution] Ran out of capacity while redistributing for user ${userId}. ${strandedLeads.length - redistributedCount} leads remaining.`);
          break;
        }
      }

      // 6. Notify user
      if (redistributedCount > 0) {
        await storage.createNotification({
          userId,
          type: 'lead_redistribution',
          title: '🔄 Leads Redistributed',
          message: `${redistributedCount} unsent leads from failed mailbox(es) have been automatically redistributed across ${capableMailboxes.length} active mailbox(es).`,
          metadata: {
            count: redistributedCount,
            totalStranded: strandedLeads.length,
            activeMailboxCount: capableMailboxes.length,
            failedMailboxIds: failedIds,
            activityType: 'auto_redistribution'
          }
        });

        wsSync.notifyLeadsUpdated(userId, { event: 'BULK_UPDATE' });
        wsSync.notifyCampaignsUpdated(userId);
      }

      console.log(`[Redistribution] ✅ Redistributed ${redistributedCount} leads for user ${userId}`);
      return redistributedCount;

    } catch (err: any) {
      console.error(`[Redistribution] Error for user ${userId}:`, err.message);
      return redistributedCount;
    }
  }
}

export const redistributionWorker = new RedistributionWorker();







