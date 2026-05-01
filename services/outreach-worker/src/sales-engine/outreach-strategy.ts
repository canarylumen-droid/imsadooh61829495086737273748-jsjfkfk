/**
 * Audnix AI - Bulletproof Humanized Outreach Strategy
 * Target: $15k in 5 days with zero spam flags & high deliverability
 * 
 * Strategy: Segment → Randomize → Rotate → Follow-up → Convert
 */

export interface OutreachSegment {
  planId: string;
  planName: string;
  price: number;
  totalLeads: number;
  dailyLimit: number;
  spreadDays: number;
  intervalMin: number; // minutes between sends
  intervalMax: number;
  conversionRate: number;
  expectedRevenue: number;
}

export const OUTREACH_STRATEGY: Record<string, OutreachSegment> = {
  // Free Trial → Quick upsell, high volume same day
  TRIAL: {
    planId: 'trial',
    planName: 'Free Trial (Day 1)',
    price: 0,
    totalLeads: 500,
    dailyLimit: 500,
    spreadDays: 1,
    intervalMin: 10,
    intervalMax: 40,
    conversionRate: 0.08, // 8% → $49 upsell or higher
    expectedRevenue: 500 * 0.08 * 65, // 8% × avg $65 plan
  },

  // $49 Starter - Steady, 3-day rollout
  STARTER: {
    planId: 'starter',
    planName: '$49 Starter (Days 1-3)',
    price: 49.99,
    totalLeads: 2500,
    dailyLimit: 833,
    spreadDays: 3,
    intervalMin: 15,
    intervalMax: 60,
    conversionRate: 0.15, // 15% conversion
    expectedRevenue: 2500 * 0.15 * 49.99,
  },

  // $99 Pro - Moderate volume, 4-day gentle push
  PRO: {
    planId: 'pro',
    planName: '$99 Pro (Days 2-5)',
    price: 99.99,
    totalLeads: 1500, // 1.5k of 7k go Pro tier
    dailyLimit: 375,
    spreadDays: 4,
    intervalMin: 20,
    intervalMax: 75,
    conversionRate: 0.20, // 20% conversion
    expectedRevenue: 1500 * 0.20 * 99.99,
  },

  // $199 Enterprise - High-touch, selective
  ENTERPRISE: {
    planId: 'enterprise',
    planName: '$199 Enterprise (Days 3-5)',
    price: 199.99,
    totalLeads: 200, // Only warmest leads
    dailyLimit: 50,
    spreadDays: 4,
    intervalMin: 60,
    intervalMax: 180, // Slower, more thoughtful
    conversionRate: 0.25, // 25% conversion (warm only)
    expectedRevenue: 200 * 0.25 * 199.99,
  },
};

export const REVENUE_PROJECTION = {
  TRIAL: 2600,
  STARTER: 18749,
  PRO: 5999,
  ENTERPRISE: 9999,
  TOTAL_5_DAY: 37347, // Way above $15k target
};

/**
 * Randomize send time to humanize outreach
 * Avoids detection, respects recipient timezone if possible
 */
export function getRandomInterval(minMinutes: number, maxMinutes: number): number {
  return Math.floor(Math.random() * (maxMinutes - minMinutes + 1)) + minMinutes;
}

/**
 * Batch size varies to avoid pattern detection
 */
export function getRandomBatchSize(
  totalRemaining: number,
  batchMin: number = 30,
  batchMax: number = 150
): number {
  const randomSize = Math.floor(Math.random() * (batchMax - batchMin + 1)) + batchMin;
  return Math.min(randomSize, totalRemaining);
}

/**
 * Should send now? Check rate limits, time windows, deliverability
 */
export function shouldSendBatch(
  segmentId: string,
  hourOfDay: number,
  recentSendCount: number,
  dailyLimit: number
): boolean {
  const segment = OUTREACH_STRATEGY[segmentId];
  if (!segment) return false;

  // Respect quiet hours (10 PM - 7 AM globally)
  if (hourOfDay >= 22 || hourOfDay < 7) return false;

  // Don't exceed daily limit
  if (recentSendCount >= dailyLimit) return false;

  // Boost morning/afternoon sends (peak engagement)
  const isPeakHour = hourOfDay >= 9 && hourOfDay <= 17;
  return isPeakHour || Math.random() > 0.7; // 30% off-peak sends for naturalness
}

/**
 * Priority matrix for lead quality
 * Cold → Warm, by engagement signals
 */
export interface LeadQuality {
  score: number; // 0-100
  tier: 'cold' | 'warm' | 'hot';
  recommendedPlan: keyof typeof OUTREACH_STRATEGY;
}

export function rankLeadQuality(
  leadData: Record<string, any> = {}
): LeadQuality {
  const data = leadData || {};
  let score = 0;

  // Engagement signals (+points)
  if (data.recentActivity) score += 30;
  if (data.websiteTraffic) score += 20;
  if (data.openedEmailBefore) score += 15;
  if (data.respondedBefore) score += 25;
  if (data.industryMatch) score += 10;
  if (data.isWarm === true || data.warm === true) score += 40; // High boost for manually qualified leads

  // Cold signals (-points)
  if (data.unsubscribed) score = 0;
  if (data.bounced) score = Math.max(0, score - 50);

  // Tier assignment
  let tier: 'cold' | 'warm' | 'hot' = 'cold';
  let recommendedPlan: keyof typeof OUTREACH_STRATEGY = 'TRIAL';

  if (score >= 70) {
    tier = 'hot';
    recommendedPlan = 'ENTERPRISE';
  } else if (score >= 40) {
    tier = 'warm';
    recommendedPlan = 'PRO';
  } else {
    tier = 'cold';
    recommendedPlan = 'STARTER';
  }

  return { score, tier, recommendedPlan };
}

/**
 * Deliverability safety checks
 */
export const DELIVERABILITY_RULES = {
  maxPerHour: 100, // Never exceed 100/hour per domain
  maxPerDay: 1000, // Never exceed 1k/day
  minIntervalMs: 10 * 60 * 1000, // 10 min minimum between batches
  respectedQuietHours: [22, 23, 0, 1, 2, 3, 4, 5, 6], // 10 PM - 7 AM
  skipWeekends: false, // Weekend sends OK (test engagement)
  templateRotationRequired: true, // Always rotate to avoid spam
  bouncedLeadCooldown: 7, // Don't retry bounced for 7 days
};
