import { db } from '@shared/lib/db/db.js';
import { bounceTracker, leads, Lead, integrations } from '@audnix/shared';
import { eq, and, sql } from 'drizzle-orm';
import { storage } from '@shared/lib/storage/storage.js';
import { clusterSync } from '@shared/lib/realtime/redis-pubsub.js';
import { mailboxHealthService } from './mailbox-health-service.js';
import { recordProviderOutcome } from './provider-reputation.js';

/**
 * Bounce Handling System
 * 
 * Types of bounces:
 * - Hard bounce: Invalid email, account deleted, domain doesn't exist (permanent)
 * - Soft bounce: Mailbox full, server error, temporary issue (retry later)
 * - Spam: Marked as spam/abuse (stop sending to this email)
 * 
 * Actions:
 * - Hard bounce: Mark lead as cold, disable email channel
 * - Soft bounce: Retry after 3 days
 * - Spam: Mark as not interested, stop all sends
 */

interface BounceEvent {
  userId: string;
  leadId: string;
  email: string;
  bounceType: 'hard' | 'soft' | 'spam';
  reason?: string;
  integrationId?: string;
  messageId?: string;
}

class BounceHandler {
  /**
   * Record a bounce event
   */
  async recordBounce(event: BounceEvent): Promise<void> {
    if (!db) return;

    try {
      // Get the lead to find integrationId if not provided
      const [lead] = await db
        .select()
        .from(leads)
        .where(eq(leads.id, event.leadId))
        .limit(1);

      if (!lead) return;

      const integrationId = event.integrationId || lead.integrationId;

      // Deduplication: skip if this messageId was already recorded
      if (event.messageId) {
        const existing = await db
          .select({ id: bounceTracker.id })
          .from(bounceTracker)
          .where(
            and(
              eq(bounceTracker.leadId, event.leadId),
              eq(bounceTracker.email, event.email),
              sql`${bounceTracker.metadata}->>'messageId' = ${event.messageId}`
            )
          )
          .limit(1);
        if (existing.length > 0) {
          console.log(`[Bounce] Dedup: skip duplicate bounce for ${event.email} msg=${event.messageId}`);
          return;
        }
      }

      // Save bounce record
      await db.insert(bounceTracker).values({
        userId: event.userId,
        leadId: event.leadId,
        integrationId: integrationId || null,
        bounceType: event.bounceType,
        email: event.email,
        metadata: {
          reason: event.reason,
          messageId: event.messageId || null,
          recordedAt: new Date().toISOString()
        }
      });

      // Track per-provider outcome (reduces this provider's send budget)
      if (integrationId) {
        const outcome = event.bounceType === 'spam' ? 'spam' : 'bounced';
        recordProviderOutcome(integrationId, event.email, outcome).catch((err: any) => {
          console.warn(`[BounceHandler] Failed to record provider outcome: ${err.message}`);
        });
      }

      // Handle based on bounce type
      switch (event.bounceType) {
        case 'hard':
          await this.handleHardBounce(lead);
          break;
        case 'soft':
          await this.handleSoftBounce(lead);
          break;
        case 'spam':
          await this.handleSpamBounce(lead);
          break;
      }

      console.log(`📧 ${event.bounceType.toUpperCase()} bounce recorded: ${event.email} (Integration: ${integrationId})`);

      // --- NEW: Trigger AI Reputation Assessment ---
      if (integrationId) {
        const { calculateReputationScore } = await import('./reputation-monitor.js');
        await calculateReputationScore(integrationId).catch(err => 
          console.error('[BounceHandler] Failed to update reputation score:', err)
        );

        // --- NEW: Immediate Spam Risk Check ---
        // If bounce rate spikes, pause the mailbox immediately instead of waiting for the 2m health loop.
        await mailboxHealthService.detectSpamRisk().catch(err =>
          console.error('[BounceHandler] Failed to run real-time spam risk check:', err)
        );
      }

      // Stop any active campaign for this lead
      const { campaignLeads, outreachCampaigns } = await import('@audnix/shared');
      const affectedCampaignLeads = await db.update(campaignLeads)
        .set({ 
          status: 'failed', 
          error: `${event.bounceType.toUpperCase()} bounce: ${event.reason || 'No reason provided'}` 
        })
        .where(eq(campaignLeads.leadId, event.leadId))
        .returning({ campaignId: campaignLeads.campaignId });

      // Track reputation and pause entire campaign if spam risks appear
      const { sql: dbsql } = await import('drizzle-orm');
      for (const cl of affectedCampaignLeads) {
        if (!cl.campaignId) continue;
        
        try {
          // Re-evaluate campaign health
          const stats = await db.execute(dbsql`
            SELECT 
              COUNT(*) as total,
              SUM(CASE WHEN status = 'failed' AND error LIKE '%SPAM bounce%' THEN 1 ELSE 0 END) as spam_count,
              SUM(CASE WHEN status = 'failed' AND error LIKE '%HARD bounce%' THEN 1 ELSE 0 END) as hard_count
            FROM campaign_leads 
            WHERE campaign_id = ${cl.campaignId}
          `);
          
          const row = stats.rows[0];
          const spamCount = Number(row?.spam_count || 0);
          const hardCount = Number(row?.hard_count || 0);
          
          // Conditions to auto-pause: >= 2 SPAM complaints OR >= 10 HARD bounces
          if (spamCount >= 2 || hardCount >= 10) {
            const [pausedCampaign] = await db.update(outreachCampaigns)
              .set({ status: 'paused', updatedAt: new Date() })
              .where(and(eq(outreachCampaigns.id, cl.campaignId), eq(outreachCampaigns.status, 'active')))
              .returning();
              
            if (pausedCampaign) {
              console.log(`⚠️ Campaign ${pausedCampaign.id} auto-paused due to reputation protection (Spam: ${spamCount}, Hard: ${hardCount})`);
              await clusterSync.notifyCampaignsUpdated(event.userId);
              
              await storage.createNotification({
                userId: event.userId,
                type: 'system',
                title: '🛡️ Campaign Auto-Paused',
                message: `Campaign "${pausedCampaign.name}" was paused automatically due to elevated bounce/spam rates to protect your email reputation.`,
              });
            }
          }
        } catch (err) {
          console.error('[BounceHandler] Failed to evaluate campaign reputation:', err);
        }
      }

      // Notify UI in real-time
      await clusterSync.notifyActivityUpdated(event.userId, {
        type: 'email_bounce',
        bounceType: event.bounceType,
        leadId: event.leadId,
        email: event.email
      });

      // Create audit log for activity feed
      await storage.createAuditLog({
        userId: event.userId,
        leadId: event.leadId,
        integrationId: lead.integrationId,
        action: 'email_bounce',
        details: {
          message: `${event.bounceType.toUpperCase()} bounce from ${event.email}`,
          bounceType: event.bounceType,
          reason: event.reason
        }
      });

      // Create persistent notification
      await storage.createNotification({
        userId: event.userId,
        type: 'email_bounce',
        title: '⚠️ Email Delivery Failed',
        message: `${event.bounceType.toUpperCase()} bounce from ${event.email}. Lead marked as cold.`,
        actionUrl: `/dashboard/inbox?leadId=${event.leadId}`
      });

      // Invalidate dashboard stats so bounce rate updates in real-time
      await clusterSync.notifyStatsCacheInvalidate(event.userId).catch(() => {});
    } catch (error) {
      console.error('Error recording bounce:', error);
    }
  }

  /**
   * Handle hard bounce (permanent failure)
   */
  private async handleHardBounce(lead: Lead): Promise<void> {
    if (!db) return;

    try {
      // Mark lead's email as cold (invalid) - using 'cold' as the closest valid status
      await db
        .update(leads)
        .set({
          status: 'cold',
          metadata: {
            ...(lead.metadata as Record<string, unknown> || {}),
            hard_bounce: true,
            hard_bounce_date: new Date().toISOString(),
            invalid_reason: 'Email bounced permanently'
          }
        })
        .where(eq(leads.id, lead.id));

      console.log(`🚫 Hard bounce: Lead ${lead.id} marked as cold (invalid email)`);
    } catch (error) {
      console.error('Error handling hard bounce:', error);
    }
  }

  /**
   * Handle soft bounce (temporary failure - retry later)
   */
  private async handleSoftBounce(lead: Lead): Promise<void> {
    if (!db) return;

    try {
      const leadMetadata = lead.metadata as Record<string, unknown>;
      const softBounceCount = (typeof leadMetadata?.soft_bounce_count === 'number'
        ? leadMetadata.soft_bounce_count
        : 0) + 1;

      // After 3 soft bounces, mark as cold
      if (softBounceCount >= 3) {
        await db
          .update(leads)
          .set({
            status: 'cold',
            metadata: {
              ...leadMetadata,
              soft_bounce_count: softBounceCount,
              too_many_soft_bounces: true,
              disabled_date: new Date().toISOString()
            }
          })
          .where(eq(leads.id, lead.id));

        console.log(`🚫 Soft bounce: Lead ${lead.id} disabled after ${softBounceCount} bounces`);
      } else {
        // Just increment the counter for retry later
        await db
          .update(leads)
          .set({
            metadata: {
              ...leadMetadata,
              soft_bounce_count: softBounceCount,
              last_soft_bounce: new Date().toISOString()
            }
          })
          .where(eq(leads.id, lead.id));

        console.log(`⏸️  Soft bounce: Lead ${lead.id} retry count ${softBounceCount}/3`);
      }
    } catch (error) {
      console.error('Error handling soft bounce:', error);
    }
  }

  /**
   * Handle spam bounce (marked as spam)
   */
  private async handleSpamBounce(lead: Lead): Promise<void> {
    if (!db) return;

    try {
      // Mark as not interested and block all sends
      await db
        .update(leads)
        .set({
          status: 'not_interested',
          metadata: {
            ...(lead.metadata as Record<string, unknown> || {}),
            marked_as_spam: true,
            marked_spam_date: new Date().toISOString(),
            do_not_contact: true
          }
        })
        .where(eq(leads.id, lead.id));

      console.log(`🚫 Spam bounce: Lead ${lead.id} marked as do-not-contact`);
    } catch (error) {
      console.error('Error handling spam bounce:', error);
    }
  }

  /**
   * Check if email should receive more sends
   */
  async shouldSkipBounceEmail(email: string, userId: string): Promise<boolean> {
    if (!db) return false;

    try {
      const bounces = await db
        .select()
        .from(bounceTracker)
        .where(
          and(
            eq(bounceTracker.email, email),
            eq(bounceTracker.userId, userId),
            eq(bounceTracker.bounceType, 'hard')
          )
        )
        .limit(1);

      if (bounces.length > 0) {
        return true; // Skip hard bounced emails
      }

      // Check spam bounces
      const spamBounces = await db
        .select()
        .from(bounceTracker)
        .where(
          and(
            eq(bounceTracker.email, email),
            eq(bounceTracker.userId, userId),
            eq(bounceTracker.bounceType, 'spam')
          )
        )
        .limit(1);

      return spamBounces.length > 0;
    } catch (error) {
      console.error('Error checking bounce status:', error);
      return false;
    }
  }

  /**
   * Get bounce statistics for a user
   */
  async getBounceStats(userId: string): Promise<{
    hardBounces: number;
    softBounces: number;
    spamBounces: number;
    totalBounces: number;
    bounceRate: number; // percentage
  }> {
    if (!db) return { hardBounces: 0, softBounces: 0, spamBounces: 0, totalBounces: 0, bounceRate: 0 };

    try {
      // [FIX] Use SQL aggregation instead of loading all rows into memory
      const result = await db
        .select({
          total: sql<number>`count(*)`,
          hard: sql<number>`count(*) FILTER (WHERE ${bounceTracker.bounceType} = 'hard')`,
          soft: sql<number>`count(*) FILTER (WHERE ${bounceTracker.bounceType} = 'soft')`,
          spam: sql<number>`count(*) FILTER (WHERE ${bounceTracker.bounceType} = 'spam')`,
        })
        .from(bounceTracker)
        .where(eq(bounceTracker.userId, userId));

      const row = result[0] || { total: 0, hard: 0, soft: 0, spam: 0 };
      const totalBounces = row.total;

      // Calculate bounce rate against total leads created in last 30 days
      // Use SQL COUNT directly instead of loading 10K+ rows into memory
      const leadCountResult = await db.execute(sql`
        SELECT COUNT(*) as count FROM leads 
        WHERE user_id = ${userId} 
        AND created_at >= NOW() - INTERVAL '30 days'
      `);
      const recentLeadCount = Number(leadCountResult.rows[0]?.count || 0);
      const bounceRate = recentLeadCount > 0
        ? Number(((totalBounces / recentLeadCount) * 100).toFixed(2))
        : 0;

      return {
        hardBounces: row.hard,
        softBounces: row.soft,
        spamBounces: row.spam,
        totalBounces,
        bounceRate,
      };
    } catch (error) {
      console.error('Error getting bounce stats:', error);
      return { hardBounces: 0, softBounces: 0, spamBounces: 0, totalBounces: 0, bounceRate: 0 };
    }
  }
}

export const bounceHandler = new BounceHandler();
export type { BounceEvent };







