import { useUser } from './use-user';
import { canAccessFeature, getPlanCapabilities, isPaidPlan, FeatureKey } from '@shared/plan-utils';

export interface AccessGate {
  canAccess: boolean;
  reason?: string;
  showUpgradePrompt: boolean;
}

export function useAccessGate(featureKey?: FeatureKey): AccessGate {
  const { data: user } = useUser();

  if (!user) {
    return {
      canAccess: false,
      reason: 'User not authenticated',
      showUpgradePrompt: false
    };
  }

  const plan = user.plan || 'free';
  const capabilities = getPlanCapabilities(plan);

  if (featureKey && !canAccessFeature(featureKey, plan)) {
    return {
      canAccess: false,
      reason: `This feature requires a ${isPaidPlan(plan) ? 'higher' : 'paid'} plan`,
      showUpgradePrompt: true
    };
  }

  const leadCount = user.leadCount || 0;
  const voiceMinutesUsed = user.voiceMinutesUsed || 0;

  const leadsExceeded = capabilities.leadsLimit > 0 && leadCount >= capabilities.leadsLimit;
  const voiceExceeded = capabilities.voiceMinutes > 0 && voiceMinutesUsed >= capabilities.voiceMinutes;

  if (leadsExceeded || voiceExceeded) {
    return {
      canAccess: false,
      reason: leadsExceeded ? 'Lead limit reached' : 'Voice minutes limit reached',
      showUpgradePrompt: true
    };
  }

  return {
    canAccess: true,
    showUpgradePrompt: false
  };
}

export function useCanSendMessages(): AccessGate {
  const { data: user } = useUser();

  if (!user) {
    return { canAccess: false, showUpgradePrompt: false };
  }

  const plan = user.plan || 'free';
  const capabilities = getPlanCapabilities(plan);
  const leadCount = user.leadCount || 0;

  if (capabilities.leadsLimit > 0 && leadCount >= capabilities.leadsLimit) {
    return {
      canAccess: false,
      reason: 'Lead limit reached',
      showUpgradePrompt: true
    };
  }

  return { canAccess: true, showUpgradePrompt: false };
}

export function useCanAccessVoiceNotes(): AccessGate {
  return useAccessGate('voiceNotes');
}

export function useCanAccessAnalytics(): AccessGate {
  return useAccessGate('analytics');
}

export function useCanAccessFullAnalytics(): AccessGate {
  return useAccessGate('fullAnalytics');
}

export function useCanAccessVideoAutomation(): AccessGate {
  return useAccessGate('videoAutomation');
}

export function useCanAccessEmail(): AccessGate {
  return useAccessGate('email');
}
