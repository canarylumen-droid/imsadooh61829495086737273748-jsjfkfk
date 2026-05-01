/**
 * Batch Scheduler - Intelligent batching with randomization
 * Sends leads in human-like patterns to maximize deliverability
 */

import {
  OUTREACH_STRATEGY,
  getRandomInterval,
  getRandomBatchSize,
  LeadQuality,
  rankLeadQuality,
  DELIVERABILITY_RULES,
} from './outreach-strategy.js';

export interface ScheduledBatch {
  batchId: string;
  segmentId: keyof typeof OUTREACH_STRATEGY;
  leadIds: string[]; // Still keep leadIds but length will be 1 for 1-by-1
  scheduledTime: Date;
  intervalBetweenLeads: number; // For 1-by-1, this is the delay to next send
  status: 'pending' | 'sending' | 'completed' | 'failed';
  sentCount: number;
  failedCount: number;
}

export interface SendSchedule {
  totalLeads: number;
  totalBatches: number; // Now represents total messages
  segmentDistribution: Record<string, number>;
  estimatedCompletionDate: Date;
  batchSchedules: ScheduledBatch[];
}

/**
 * Generate 5-day send schedule across all segments
 * Optimized for: deliverability, humanization, revenue maximization
 */
export function generateSendSchedule(
  leadsBySegment: Record<string, string[]>,
  startTime: Date = new Date()
): SendSchedule {
  const batchSchedules: ScheduledBatch[] = [];
  const segmentDistribution: Record<string, number> = {};

  let totalLeads = 0;
  const startDay = new Date(startTime);

  // Align to next available business hour if currently in quiet hours
  if (startDay.getHours() >= 22 || startDay.getHours() < 7) {
    startDay.setHours(8, 0, 0, 0);
    if (startTime.getHours() >= 22) startDay.setDate(startDay.getDate() + 1);
  }

  // Distribution settings for the campaign
  const campaignDays = {
    day1: 300,
    day2: 400,
    day3: 500,
    standard: 500
  };

  // Process all leads into a 1-by-1 queue
  Object.entries(leadsBySegment).forEach(([segmentId, leadIds]) => {
    const segment = OUTREACH_STRATEGY[segmentId as keyof typeof OUTREACH_STRATEGY];
    if (!segment || leadIds.length === 0) return;

    segmentDistribution[segmentId] = leadIds.length;
    totalLeads += leadIds.length;

    const leadsRemaining = [...leadIds];
    let currentLeadTime = new Date(startDay);
    let dayIndex = 0;

    while (leadsRemaining.length > 0) {
      // Determine daily limit for this day of the campaign
      const dayKey = `day${dayIndex + 1}` as keyof typeof campaignDays;
      const dailyLimit = campaignDays[dayKey] || campaignDays.standard;

      // Calculate interval: 60 mins / (dailyLimit / 9 active hours)
      // 9 AM to 6 PM = 9 hours
      const activeHoursPerDay = 9;
      const leadsPerHour = dailyLimit / activeHoursPerDay;
      const intervalMinutes = 60 / leadsPerHour;

      for (let i = 0; i < dailyLimit && leadsRemaining.length > 0; i++) {
        const leadId = leadsRemaining.shift();
        if (!leadId) break;

        // Humanization: Add 2-4 minute randomized jitter per lead
        const jitterMinutes = 2 + (Math.random() * 2);
        const scheduledTime = new Date(currentLeadTime.getTime() + (jitterMinutes * 60 * 1000));

        batchSchedules.push({
          batchId: `send_${leadId}_${Date.now()}_${i}`,
          segmentId: segmentId as keyof typeof OUTREACH_STRATEGY,
          leadIds: [leadId],
          scheduledTime: scheduledTime,
          intervalBetweenLeads: intervalMinutes * 60 * 1000,
          status: 'pending',
          sentCount: 0,
          failedCount: 0,
        });

        // Increment time for next lead calculation
        currentLeadTime = new Date(scheduledTime.getTime() + (intervalMinutes * 60 * 1000));

        // If moved into quiet hours (after 7 PM), jump to next day 9 AM
        if (currentLeadTime.getHours() >= 19) {
          currentLeadTime.setDate(currentLeadTime.getDate() + 1);
          currentLeadTime.setHours(9, 0, 0, 0);
          dayIndex++;
        }
      }

      // If we finished the daily limit but still have leads, jump to next day
      if (leadsRemaining.length > 0 && currentLeadTime.getHours() < 19) {
        currentLeadTime.setDate(currentLeadTime.getDate() + 1);
        currentLeadTime.setHours(9, 0, 0, 0); 
        dayIndex++;
      }
    }
  });

  // Sort global queue by time
  const sortedQueue = batchSchedules.sort((a, b) => a.scheduledTime.getTime() - b.scheduledTime.getTime());

  return {
    totalLeads,
    totalBatches: sortedQueue.length,
    segmentDistribution,
    estimatedCompletionDate: sortedQueue.length > 0 ? sortedQueue[sortedQueue.length - 1].scheduledTime : new Date(),
    batchSchedules: sortedQueue,
  };
}

/**
 * Check if batch is safe to send (deliverability checks)
 */
export function isDeliverableSafe(
  batch: ScheduledBatch,
  recentSendHistory: { hour: number; count: number }[]
): boolean {
  const now = new Date();
  const currentHour = now.getHours();

  // 1. Skip quiet hours
  if (DELIVERABILITY_RULES.respectedQuietHours.includes(currentHour)) {
    return false;
  }

  // 2. Check hourly limit
  const thisHourSends = recentSendHistory.find((h) => h.hour === currentHour)?.count || 0;
  if (thisHourSends >= DELIVERABILITY_RULES.maxPerHour) {
    return false;
  }

  // 3. Check daily limit
  const dailySends = recentSendHistory.reduce((sum, h) => sum + h.count, 0);
  if (dailySends >= DELIVERABILITY_RULES.maxPerDay) {
    return false;
  }

  // 4. Check min interval since last batch
  if (batch.scheduledTime > now && batch.scheduledTime.getTime() - now.getTime() < DELIVERABILITY_RULES.minIntervalMs) {
    return false;
  }

  return true;
}

/**
 * Segment leads by quality for tiered outreach
 * Hot leads → Enterprise, Warm → Pro, Cold → Starter
 */
export function segmentLeadsByQuality(
  leads: Array<{ id: string; data: Record<string, any> }>
): Record<string, string[]> {
  const segments: Record<string, string[]> = {
    ENTERPRISE: [],
    PRO: [],
    STARTER: [],
    TRIAL: [],
  };

  leads.forEach(({ id, data }) => {
    const quality = rankLeadQuality(data);
    const tier = quality.tier;

    if (tier === 'hot') {
      segments.ENTERPRISE.push(id);
    } else if (tier === 'warm') {
      segments.PRO.push(id);
    } else if (Math.random() > 0.3) {
      // 70% of cold goes to Starter
      segments.STARTER.push(id);
    } else {
      // 30% of cold to Trial (faster conversion)
      segments.TRIAL.push(id);
    }
  });

  return segments;
}

/**
 * Revenue-weighted scheduling
 * Prioritize high-value segments early, reorder internally
 */
export function optimizeForRevenue(
  schedule: SendSchedule
): ScheduledBatch[] {
  const SEGMENT_PRIORITY: Record<string, number> = {
    ENTERPRISE: 4, // Highest ROI per lead
    PRO: 3,
    STARTER: 2,
    TRIAL: 1, // Lowest priority (but quick upsell)
  };

  return schedule.batchSchedules.sort((a, b) => {
    const priorityA = SEGMENT_PRIORITY[a.segmentId] || 0;
    const priorityB = SEGMENT_PRIORITY[b.segmentId] || 0;

    if (priorityA !== priorityB) {
      return priorityB - priorityA; // Higher priority first
    }

    // Same priority → earlier time
    return a.scheduledTime.getTime() - b.scheduledTime.getTime();
  });
}

/**
 * Format schedule for display/logging
 */
export function formatScheduleForLogging(schedule: SendSchedule): string {
  const lines = [
    '📊 5-DAY HUMANIZED OUTREACH SCHEDULE',
    `Total Leads: ${schedule.totalLeads}`,
    `Total Batches: ${schedule.totalBatches}`,
    `Completion by: ${schedule.estimatedCompletionDate.toLocaleString()}`,
    '',
    '📈 Segment Breakdown:',
  ];

  Object.entries(schedule.segmentDistribution).forEach(([segment, count]) => {
    const expectedRevenue =
      OUTREACH_STRATEGY[segment as keyof typeof OUTREACH_STRATEGY]?.expectedRevenue || 0;
    lines.push(
      `  ${segment}: ${count} leads → ~$${expectedRevenue.toLocaleString('en-US', {
        maximumFractionDigits: 0,
      })}`
    );
  });

  lines.push('', '⏰ First 24 Hours:');
  const firstDay = schedule.batchSchedules.filter(
    (b) => b.scheduledTime.getTime() - schedule.batchSchedules[0].scheduledTime.getTime() < 86400000
  );
  lines.push(`  ${firstDay.length} batches scheduled`);
  lines.push(`  ${firstDay.reduce((sum, b) => sum + b.leadIds.length, 0)} leads`);

  return lines.join('\n');
}

/**
 * Calculate estimated revenue from schedule
 */
export function estimateRevenue(schedule: SendSchedule): number {
  let total = 0;

  Object.entries(schedule.segmentDistribution).forEach(([segment, count]) => {
    const strategySegment = OUTREACH_STRATEGY[segment as keyof typeof OUTREACH_STRATEGY];
    if (strategySegment) {
      total += count * strategySegment.conversionRate * strategySegment.price;
    }
  });

  return total;
}
