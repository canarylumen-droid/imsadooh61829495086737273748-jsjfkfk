import { PRICING_TIERS, PricingTier } from './pricing-config';

export type PlanId = 'free' | 'trial' | 'starter' | 'pro' | 'enterprise';

export function getActivePlanId(user: any): string {
  if (!user) return 'starter';
  const tier = typeof user.subscriptionTier === 'string' ? user.subscriptionTier.toLowerCase() : null;
  const plan = typeof user.plan === 'string' ? user.plan.toLowerCase() : null;
  const altPlan = typeof user.subscription_tier === 'string' ? user.subscription_tier.toLowerCase() : null;
  
  const active = (tier && tier !== 'free' && tier !== 'none' ? tier : (plan || altPlan)) || 'starter';
  return active;
}

export function isPaidPlan(planId: string | undefined): boolean {
  if (!planId) return false;
  return planId !== 'free' && planId !== 'trial';
}

export function getPlanTier(planId: string): PricingTier | undefined {
  return PRICING_TIERS.find(tier => tier.id === planId);
}

export function getPlanCapabilities(planId: string) {
  const tier = getPlanTier(planId);

  if (!tier) {
    return {
      leadsLimit: 0,
      mailboxLimit: 0,
      voiceMinutes: 0,
      hasVoiceNotes: false,
      hasAnalytics: false,
      hasAutoBooking: false,
      hasObjectionHandling: false,
      hasAdvancedSequencing: false,
      hasTeamWorkflows: false,
      hasAPIAccess: false,
      hasPrioritySupport: false
    };
  }

  const hasVoiceNotes = tier.voiceMinutes > 0; // Voice notes PAID ONLY (starter+ plans)
  const isPaid = isPaidPlan(planId);
  const isProOrAbove = ['pro', 'enterprise'].includes(planId);
  const isEnterprise = planId === 'enterprise';

  return {
    leadsLimit: tier.leadsLimit,
    mailboxLimit: tier.mailboxLimit,
    voiceMinutes: tier.voiceMinutes,
    hasVoiceNotes,
    hasAnalytics: true, // FREE for all users - show preview for trial/free, full features for paid
    hasFullAnalytics: isPaid, // Full analytics only for paid plans
    hasAutoBooking: isPaid,
    hasObjectionHandling: isPaid,
    hasAdvancedSequencing: isProOrAbove,
    hasTeamWorkflows: isEnterprise,
    hasAPIAccess: isEnterprise,
    hasPrioritySupport: isProOrAbove,
    hasVideoAutomation: true, // Video automation FREE for all plans
    hasEmail: true // Email available to ALL users including free/trial
  };
}

export type FeatureKey =
  | 'voiceNotes'
  | 'analytics'
  | 'fullAnalytics'
  | 'autoBooking'
  | 'objectionHandling'
  | 'advancedSequencing'
  | 'teamWorkflows'
  | 'apiAccess'
  | 'prioritySupport'
  | 'videoAutomation'
  | 'email';

export function canAccessFeature(featureKey: FeatureKey, planId: string): boolean {
  const capabilities = getPlanCapabilities(planId);

  const featureMap: Record<FeatureKey, boolean> = {
    voiceNotes: !!capabilities.hasVoiceNotes,
    analytics: !!capabilities.hasAnalytics,
    fullAnalytics: !!capabilities.hasFullAnalytics,
    autoBooking: !!capabilities.hasAutoBooking,
    objectionHandling: !!capabilities.hasObjectionHandling,
    advancedSequencing: !!capabilities.hasAdvancedSequencing,
    teamWorkflows: !!capabilities.hasTeamWorkflows,
    apiAccess: !!capabilities.hasAPIAccess,
    prioritySupport: !!capabilities.hasPrioritySupport,
    videoAutomation: !!capabilities.hasVideoAutomation,
    email: !!capabilities.hasEmail
  };

  return featureMap[featureKey] || false;
}

export function getSortedPricingTiers(): PricingTier[] {
  return [...PRICING_TIERS].sort((a, b) => a.order - b.order);
}

export function isLimitReached(current: number, limit: number): boolean {
  if (limit === -1 || limit === Infinity) return false;
  return current >= limit;
}

export function shouldShowUpgradePrompt(planId: string, leadCount: number, voiceMinutesUsed: number): boolean {
  const capabilities = getPlanCapabilities(planId);
  const leadsNearLimit = capabilities.leadsLimit !== -1 && capabilities.leadsLimit > 0 && leadCount >= capabilities.leadsLimit * 0.9;
  const voiceNearLimit = capabilities.voiceMinutes !== -1 && capabilities.voiceMinutes > 0 && voiceMinutesUsed >= capabilities.voiceMinutes * 0.9;

  return leadsNearLimit || voiceNearLimit || (!isPaidPlan(planId) && planId !== 'free');
}
