import { db } from '@shared/lib/db/db.js';
import { integrations, outreachCampaigns, campaignEmails, users } from '@audnix/shared';
import { eq, and, sql, gte, desc } from 'drizzle-orm';
import { storage } from '@shared/lib/storage/storage.js';

/**
 * Autonomous Scaler Service
 * Hardens the SDR engine with self-optimizing feedback loops.
 * 
 * Logic:
 * 1. Ramp-up: Starts at 45-50 sends/day. 
 * 2. Scaling: If Open Rate > 30% and Reply Rate > 3% for 2 weeks, scale to 80-100.
 * 3. Neural Throttling: If performance is elite (>45% OR, >4% RR) for 3 days, accelerate to max.
 * 4. Safety: If bounces > 5% or spam risk increases, scale down immediately.
 */
export class AutonomousScalerService {
  /**
   * Run daily optimization for all autonomous mailboxes
   */
  static async runOptimizationCycle(): Promise<void> {
    console.log('[AutonomousScaler] 🤖 Starting daily optimization cycle...');
    
    const activeIntegrations = await db.select()
      .from(integrations)
      .where(and(
        eq(integrations.aiAutonomousMode, true),
        eq(integrations.connected, true)
      ));

    for (const integration of activeIntegrations) {
      try {
        await this.optimizeMailbox(integration);
      } catch (err) {
        console.error(`[AutonomousScaler] Failed to optimize mailbox ${integration.id}:`, err);
      }
    }
  }

  private static async optimizeMailbox(integration: any): Promise<void> {
    const userId = integration.userId;
    const now = new Date();
    const accountAgeDays = Math.floor((now.getTime() - new Date(integration.createdAt).getTime()) / (1000 * 3600 * 24));
    
    // 1. Fetch performance metrics for the last 14 days
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 3600 * 1000);
    const metrics = await this.getMailboxMetrics(integration.id, fourteenDaysAgo);
    
    // 2. Fetch performance metrics for the last 3 days (for elite acceleration)
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 3600 * 1000);
    const eliteMetrics = await this.getMailboxMetrics(integration.id, threeDaysAgo);

    let newLimit = integration.dailyLimit || 50;
    const oldLimit = newLimit;

    // --- SAFETY-FIRST SCALING LOGIC ---
    const SAFE_HARD_CAP = 50;
    const SAFETY_FLOOR = 20;

    // A. Performance-Based Scaling (Safety-First)
    if (metrics.totalSent >= 50 && metrics.openRate >= 0.35 && metrics.replyRate >= 0.05) {
      console.log(`[AutonomousScaler] 🚀 Strong performance for ${integration.id}. Safely incrementing.`);
      newLimit = Math.min(SAFE_HARD_CAP, oldLimit + 2); // Very slow +2 increment
    } 
    // B. Performance Cooldown (Danger: OR < 25%)
    else if (metrics.openRate < 0.25 && metrics.totalSent > 30) {
      console.warn(`[AutonomousScaler] 📉 Low Open Rate for ${integration.id}. Dropping to Safety Floor.`);
      newLimit = SAFETY_FLOOR; 
    }
    // C. Safety Scale Down (Bounce > 3%)
    else if (metrics.bounceRate > 0.03 || (integration.spamRiskScore || 0) > 0.5) {
      console.warn(`[AutonomousScaler] ⚠️ Reputation Risk detected for ${integration.id}. Scaling down.`);
      newLimit = Math.max(SAFETY_FLOOR, Math.floor(newLimit * 0.7));
    }
    // D. Standard Ramp-up (Very Slow Growth)
    else if (accountAgeDays < 21) {
      const safeCap = 25 + (accountAgeDays * 1); // Only +1 per day
      newLimit = Math.min(newLimit, safeCap);
    }
    
    // Ensure we NEVER exceed 50 per mailbox in autonomous mode
    newLimit = Math.min(newLimit, SAFE_HARD_CAP);

    // 3. Apply changes if limit changed
    if (newLimit !== oldLimit) {
      await db.update(integrations)
        .set({ 
          dailyLimit: newLimit,
          updatedAt: new Date()
        })
        .where(eq(integrations.id, integration.id));
      
      console.log(`[AutonomousScaler] ✅ Adjusted ${integration.id}: ${oldLimit} -> ${newLimit} (OR: ${(metrics.openRate * 100).toFixed(1)}%, RR: ${(metrics.replyRate * 100).toFixed(1)}%)`);
      
      // Notify user of autonomous adjustment
      await storage.createNotification({
        userId,
        type: 'insight',
        title: 'Neural Throttling: Auto-Scaling Active',
        message: `Audnix AI has ${newLimit > oldLimit ? 'increased' : 'decreased'} your daily send limit to ${newLimit} based on recent ${metrics.openRate > 0.3 ? 'excellent' : 'health'} metrics.`,
        metadata: { integrationId: integration.id, newLimit, oldLimit }
      });
    }
  }

  private static async getMailboxMetrics(integrationId: string, since: Date) {
    const stats = await db.select({
      status: campaignEmails.status,
      count: sql<number>`count(*)`
    })
    .from(campaignEmails)
    .where(and(
      eq(campaignEmails.metadata, sql`${integrationId} = (metadata->>'integrationId')`), // Adjust based on how integrationId is stored in metadata
      gte(campaignEmails.sentAt, since)
    ))
    .groupBy(campaignEmails.status);

    // Drizzle/Postgres metadata query can be tricky, using a simpler approach if needed
    // But let's try to get them from outreach_campaigns stats if easier? 
    // No, we need per-mailbox across all campaigns.
    
    // Fallback for metadata query if above fails:
    const rawStats = await db.execute(sql`
      SELECT status, count(*) as count
      FROM campaign_emails
      WHERE (metadata->>'integrationId' = ${integrationId} OR metadata->>'integration_id' = ${integrationId})
      AND sent_at >= ${since}
      GROUP BY status
    `);

    let total = 0;
    let opened = 0;
    let replied = 0;
    let bounced = 0;

    rawStats.rows.forEach((row: any) => {
      const count = parseInt(row.count);
      total += count;
      if (row.status === 'opened' || row.status === 'replied' || row.status === 'clicked') opened += count;
      if (row.status === 'replied') replied += count;
      if (row.status === 'bounced') bounced += count;
    });

    return {
      totalSent: total,
      openRate: total > 0 ? opened / total : 0,
      replyRate: total > 0 ? replied / total : 0,
      bounceRate: total > 0 ? bounced / total : 0
    };
  }
}
