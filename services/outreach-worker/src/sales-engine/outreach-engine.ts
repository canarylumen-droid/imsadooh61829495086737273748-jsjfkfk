/**
 * Outreach Engine - The brain that orchestrates everything
 * Combines: Strategy, Message Rotation, Batch Scheduling, Deliverability
 */

import { generateSendSchedule, optimizeForRevenue, estimateRevenue, ScheduledBatch, SendSchedule, CampaignConfig } from './batch-scheduler.js';
import { generateStrategicSequenceMessage, shouldRotateTemplate } from './message-rotator.js';
import { rankLeadQuality } from './outreach-strategy.js';
import type { MessageTemplate, MessageType } from './message-rotator.js';
import type { Lead } from '@audnix/shared';
import { calculateAveragePerDay, calculateProjectedDuration } from '@services/warmup-service/src/engine/predictive-timing.js';

export interface OutreachCampaign {
  campaignId: string;
  name: string;
  totalLeads: number;
  startTime: Date;
  schedule: SendSchedule;
  queuedSends: ScheduledBatch[];
  estimatedRevenue: number;
  status: 'draft' | 'scheduled' | 'active' | 'completed';
  config: CampaignConfig;
  metrics: {
    totalSent: number;
    totalFailed: number;
    totalReplies: number;
    totalConversions: number;
    totalRevenue: number;
  };
}

export interface LeadOutreachState {
  leadId: string;
  email: string;
  name: string;
  company: string;
  segmentId: string;
  leadQuality: ReturnType<typeof rankLeadQuality>;
  sendHistory: {
    timestamp: Date;
    templateId: string;
    messageType: string;
    success: boolean;
  }[];
  replied: boolean;
  converted: boolean;
  plan?: string;
  revenue?: number;
  bounced: boolean;
  lastFollowup?: Date;
  nextFollowup?: Date;
}

/**
 * Create outreach campaign from lead list
 */
export async function createOutreachCampaign(
  leads: Array<{ id: string; email: string; name: string; company: string; data: Record<string, any> }>,
  campaignName: string,
  campaignConfig?: CampaignConfig
): Promise<OutreachCampaign> {
  const campaignId = `campaign_${Date.now()}`;

  const leadsByQuality = segmentByQuality(leads);

  const leadTimezones: Record<string, string> = {};
  leads.forEach(l => {
    if (l.data?.timezone) {
      leadTimezones[l.id] = l.data.timezone;
    }
  });

  const schedule = generateSendSchedule(leadsByQuality, new Date(), leadTimezones, campaignConfig);

  // Optimize for revenue (reorder batches)
  const optimizedBatches = optimizeForRevenue(schedule);

  // Calculate estimated revenue
  const estimatedRevenue = estimateRevenue(schedule);

  const dailyLimit = campaignConfig?.dailyLimit || 300;
  const durationDays = campaignConfig?.durationDays || 0;
  const avgPerDay = calculateAveragePerDay(leads.length, durationDays || calculateProjectedDuration(leads.length, dailyLimit));

  return {
    campaignId,
    name: campaignName,
    totalLeads: leads.length,
    startTime: new Date(),
    schedule,
    queuedSends: optimizedBatches,
    estimatedRevenue,
    status: 'draft',
    config: { dailyLimit, durationDays, ...campaignConfig },
    metrics: {
      totalSent: 0,
      totalFailed: 0,
      totalReplies: 0,
      totalConversions: 0,
      totalRevenue: 0,
    },
  };
}

/**
 * Segment leads by quality for tiered outreach
 */
function segmentByQuality(
  leads: Array<{ id: string; email: string; name: string; company: string; data: Record<string, any> }>
): Record<string, string[]> {
  const segments: Record<string, string[]> = {
    ENTERPRISE: [],
    PRO: [],
    STARTER: [],
    TRIAL: [],
  };

  leads.forEach((lead) => {
    if (!lead) return;
    const { id, data } = lead;
    const quality = rankLeadQuality(data || {});

    if (quality.tier === 'hot') {
      segments.ENTERPRISE.push(id);
    } else if (quality.tier === 'warm') {
      segments.PRO.push(id);
    } else {
      // 70% cold → Starter (slower warmup), 30% → Trial (quick upsell)
      segments[Math.random() > 0.3 ? 'STARTER' : 'TRIAL'].push(id);
    }
  });

  return segments;
}

/**
 * Get next message for a lead
 * Handles: Message type progression, AI strategic generation
 */
export async function getNextOutreachMessage(
  leadState: LeadOutreachState,
  lead: Lead
): Promise<{ template: MessageTemplate; message: string }> {
  const sendCount = leadState.sendHistory.length;

  // Message sequence: Hook → Value → Social Proof → Urgency → Followup
  const messageTypes: MessageType[] = ['hook', 'value', 'social_proof', 'urgency', 'followup'];

  // For initial sends: cycle through types
  let messageType = messageTypes[Math.min(sendCount, messageTypes.length - 1)];

  // Generate dynamic strategic message
  const template = await generateStrategicSequenceMessage(
    lead,
    lead.userId,
    messageType,
    lead.channel as 'email' | 'instagram'
  );

  return {
    template,
    message: template.subject ? `${template.subject}\n\n${template.body}` : template.body
  };
}

/**
 * Calculate follow-up timing based on segment
 */
export function getFollowupTiming(segmentId: string, sendAttempt: number): Date {
  const followupOffsets = {
    TRIAL: [12, 24], // 12h, 24h
    STARTER: [24, 48], // 24h, 48h
    PRO: [48, 72], // 48h, 72h
    ENTERPRISE: [48, 96, 168], // 2d, 3d, 7d
  };

  const offsets = followupOffsets[segmentId as keyof typeof followupOffsets] || [24, 48];
  const hoursOffset = offsets[Math.min(sendAttempt - 1, offsets.length - 1)] || offsets[offsets.length - 1];

  const nextFollowup = new Date();
  nextFollowup.setHours(nextFollowup.getHours() + hoursOffset);

  return nextFollowup;
}

/**
 * Format campaign metrics for logging
 */
export function formatCampaignMetrics(campaign: OutreachCampaign): string {
  const lines = [
    '📈 OUTREACH CAMPAIGN METRICS',
    `Campaign: ${campaign.name} (${campaign.campaignId})`,
    `Status: ${campaign.status}`,
    '',
    '📊 Volume:',
    `  Total Leads: ${campaign.totalLeads}`,
    `  Queued Sends: ${campaign.queuedSends.length}`,
    `  Spread Over: ${campaign.schedule.estimatedCompletionDate.toLocaleDateString()}`,
    '',
    '💰 Revenue Projection:',
    `  Estimated Revenue: $${campaign.estimatedRevenue.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
    `  Based on: ${Object.entries(campaign.schedule.segmentDistribution)
      .map(([seg, count]) => `${seg}: ${count}`)
      .join(', ')}`,
    '',
    '✉️ Current Progress:',
    `  Sent: ${campaign.metrics.totalSent}`,
    `  Failed: ${campaign.metrics.totalFailed}`,
    `  Replies: ${campaign.metrics.totalReplies}`,
    `  Conversions: ${campaign.metrics.totalConversions}`,
    `  Revenue Generated: $${campaign.metrics.totalRevenue.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
  ];

  return lines.join('\n');
}

/**
 * Safety guardrails - prevent oversending and reputation damage
 */
export const SAFETY_GUARDRAILS = {
  maxSendsPerHour: 40, // More humanized (1 per 1.5 mins)
  maxSendsPerDay: 500, // Safe default for SMTP
  gmailMaxPerDay: 100, // Safe ceiling for Gmail/Outlook
  minIntervalBetweenSends: 30, // 30 seconds minimum for jitter
  maxFollowupsPerLead: 10,
  bounceRateThreshold: 0.08, // 8% bounce = pause
  spamComplaintThreshold: 0.02, // 2% complaints = review
  autoStopOnHighBounceRate: true,
  requireApprovalAbove: 20000, 
};

/**
 * Pre-flight checks before launching campaign
 */
export function validateCampaignSafety(campaign: OutreachCampaign): { safe: boolean; warnings: string[] } {
  const warnings: string[] = [];

  if (campaign.totalLeads > SAFETY_GUARDRAILS.requireApprovalAbove) {
    warnings.push(
      `⚠️  Campaign has ${campaign.totalLeads} leads (>5k). Requires manual approval for safety.`
    );
  }

  if (campaign.schedule.totalBatches < 3) {
    warnings.push('⚠️  Low volume scheduled - consider adding more leads for better scalability.');
  }

  if (campaign.estimatedRevenue < 5000) {
    warnings.push('ℹ️  Estimated revenue is below $5k target. Check lead quality or adjust messaging.');
  }

  return {
    safe: warnings.length === 0 || warnings.every((w) => !w.includes('CRITICAL')),
    warnings,
  };
}

/**
 * Triggers automatic outreach for all leads with 'new' or 'hardened' status
 * that haven't been contacted yet.
 */
export async function triggerAutoOutreach(userId: string): Promise<void> {
  try {
    const { storage } = await import('@shared/lib/storage/storage.js');
    const { scheduleInitialFollowUp } = await import("@services/brain-worker/src/ai-lib/core/follow-up-worker.js");

    // Get all leads for the user that are 'new' or 'hardened'
    const [newLeads, hardenedLeads] = await Promise.all([
      storage.getLeads({ userId, status: 'new' }),
      storage.getLeads({ userId, status: 'hardened' })
    ]);

    const allLeads = [...newLeads, ...hardenedLeads];
    console.log(`[AutoOutreach] Found ${allLeads.length} leads for user ${userId} to trigger outreach.`);

    /* 
    // DISABLED for stabilization: User requested to stop unauthorized sending
    for (const lead of allLeads) {
      // Check if they already have a follow-up scheduled to avoid duplicates
      const existing = await storage.getPendingFollowUp(lead.id);
      if (!existing) {
        console.log(`[AutoOutreach] Scheduling initial follow-up for lead: ${lead.name}`);
        await scheduleInitialFollowUp(userId, lead.id, lead.channel);
      }
    }
    */
    console.log(`[AutoOutreach] Manual trigger required. Not automatically scheduling for ${allLeads.length} leads.`);
  } catch (error) {
    console.error('[AutoOutreach] Error triggering auto-outreach:', error);
  }
}

/**
 * Distributes leads from the global Lead Inventory pool to available mailboxes.
 * Respects daily sending limits (Gmail: 50, Custom: meta-specified).
 */
export async function distributeLeadsFromPool(userId: string, targetIntegrationId?: string): Promise<void> {
  try {
    const { storage } = await import('@shared/lib/storage/storage.js');
    const { db } = await import('@shared/lib/db/db.js');
    const { leads, users, outreachCampaigns } = await import('@audnix/shared');
    const { eq, and, isNull } = await import('drizzle-orm');

    console.log(`[LeadPool] Starting professional distribution for user ${userId}`);

    // Fetch integrations to check capacity
    const integrations = await storage.getIntegrations(userId);
    const activeMailboxes = integrations.filter(i => i.connected);

    if (activeMailboxes.length === 0) {
      console.log(`[LeadPool] No active mailboxes found for user ${userId}. Leads will remain in Inventory.`);
      return;
    }

    // Find leads in the inventory pool (unassigned)
    const inventoryLeads = await db.select()
      .from(leads)
      .where(and(eq(leads.userId, userId), isNull(leads.integrationId)));

    if (inventoryLeads.length === 0) {
      console.log(`[LeadPool] Lead Inventory is currently empty for user ${userId}`);
      return;
    }

    console.log(`[LeadPool] Found ${inventoryLeads.length} leads in Inventory. Processing allocation...`);

    // 1. Fetch User Config & Active Campaigns to prioritize mailboxes
    const [user] = await db.select({ config: users.config }).from(users).where(eq(users.id, userId));
    const isAutonomous = (user?.config as any)?.autonomousMode === true;

    const activeCampaigns = await db.select().from(outreachCampaigns)
      .where(and(eq(outreachCampaigns.userId, userId), eq(outreachCampaigns.status, 'active')));
    
    const campaignMailboxIds = new Set<string>();
    activeCampaigns.forEach((c: any) => {
      const mbIds = (c.config as any)?.mailboxIds || [];
      mbIds.forEach((id: string) => campaignMailboxIds.add(id));
    });

    console.log(`[LeadPool] Found ${activeCampaigns.length} active campaigns. User is in ${isAutonomous ? 'AUTONOMOUS' : 'CAMPAIGN-ONLY'} mode.`);

    const getDailyLimit = (integration: any) => {
      // Priority: metadata override > provider default (Gmail: 100, SMTP: 500)
      if (integration.metadata?.dailyLimit) {
        const customLimit = Number(integration.metadata.dailyLimit);
        // Ensure even overrides don't exceed extreme caps unless explicitly specified
        return Math.min(customLimit, transitionToSafeLimit(integration.provider));
      }
      return transitionToSafeLimit(integration.provider);
    };

    function transitionToSafeLimit(provider?: string) {
      if (provider === 'gmail' || provider === 'outlook') return 100;
      return 500;
    }

    // 2. Calculate capacity for each mailbox
    const mailboxCapacities = await Promise.all(activeMailboxes.map(async (mb) => {
      const limit = getDailyLimit(mb);
      const currentLeads = await db.select()
        .from(leads)
        .where(and(eq(leads.integrationId, mb.id), eq(leads.archived, false)));
      
      return {
        id: mb.id,
        provider: mb.provider,
        limit,
        currentCount: currentLeads.length,
        remainingCapacity: Math.max(0, limit - currentLeads.length)
      };
    }));

    // 3. Filter and Group by Priority
    // P1: Mailboxes actively used in campaigns (Always refill)
    // P2: Other mailboxes (Refill only if autonomous mode is on)
    const priority1 = mailboxCapacities.filter(m => campaignMailboxIds.has(m.id) && m.remainingCapacity > 0);
    const priority2 = isAutonomous 
      ? mailboxCapacities.filter(m => !campaignMailboxIds.has(m.id) && m.remainingCapacity > 0)
      : [];

    let eligibleMailboxes = [...priority1, ...priority2];
    
    if (targetIntegrationId) {
      eligibleMailboxes = eligibleMailboxes.filter(m => m.id === targetIntegrationId);
    }

    if (eligibleMailboxes.length === 0) {
      console.log(`[LeadPool] No eligible mailboxes need distribution (Capacities full or no active campaigns/autonomous mode).`);
      return;
    }

    // 4. Distribute Fairly (Round Robin / Proportional)
    let poolIndex = 0;
    let totalDistributed = 0;
    const leadsToDistribute = inventoryLeads;
    
    // Sort eligible mailboxes so Priority 1 always gets leads first in the loop
    const sortedMailboxes = eligibleMailboxes.sort((a, b) => {
      const aPrio = campaignMailboxIds.has(a.id) ? 1 : 2;
      const bPrio = campaignMailboxIds.has(b.id) ? 1 : 2;
      return aPrio - bPrio;
    });

    let stillHasCapacity = true;
    while (poolIndex < leadsToDistribute.length && stillHasCapacity) {
      stillHasCapacity = false;
      for (const mb of sortedMailboxes) {
        if (mb.remainingCapacity > 0 && poolIndex < leadsToDistribute.length) {
          const lead = leadsToDistribute[poolIndex];
          
          // Attempt to reserve the lead to prevent race conditions during distribution
          const reserved = await storage.reserveLeadForAction(lead.id, 'distribution');
          if (!reserved) {
            console.log(`[LeadPool] Lead ${lead.id} is already being processed. skipping.`);
            poolIndex++;
            continue;
          }

          await storage.updateLead(lead.id, { integrationId: mb.id });
          
          mb.remainingCapacity--;
          poolIndex++;
          totalDistributed++;
          stillHasCapacity = true;
        }
      }
    }

    console.log(`[LeadPool] Distribution complete. ${totalDistributed} leads shared across ${sortedMailboxes.length} mailboxes (Prioritizing Campaign health).`);

    // Notify UI
    const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
    wsSync.notifyLeadsUpdated(userId);

  } catch (error) {
    console.error('[LeadPool] Error distributing leads from inventory:', error);
  }
}






