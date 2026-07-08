import { db } from '@shared/lib/db/db.js';
import { integrations, bounceTracker } from '@audnix/shared';
import { eq, and, gte, sql } from 'drizzle-orm';

export const PROVIDER_GROUPS = ['google', 'microsoft', 'yahoo', 'aol', 'proton', 'icloud', 'other'] as const;
export type ProviderGroup = typeof PROVIDER_GROUPS[number];

const DOMAIN_TO_GROUP: Record<string, ProviderGroup> = {
  'gmail.com': 'google', 'googlemail.com': 'google',
  'outlook.com': 'microsoft', 'hotmail.com': 'microsoft', 'live.com': 'microsoft', 'msn.com': 'microsoft',
  'yahoo.com': 'yahoo', 'yahoo.co.uk': 'yahoo', 'ymail.com': 'yahoo', 'rocketmail.com': 'yahoo',
  'aol.com': 'aol', 'aol.co.uk': 'aol',
  'protonmail.com': 'proton', 'proton.me': 'proton', 'pm.me': 'proton',
  'icloud.com': 'icloud', 'me.com': 'icloud', 'mac.com': 'icloud',
};

export function detectProviderGroup(email: string): ProviderGroup {
  if (!email || !email.includes('@')) return 'other';
  const at = email.lastIndexOf('@');
  if (at === -1 || at >= email.length - 1) return 'other';
  const domain = email.slice(at + 1).toLowerCase().trim();
  if (!domain) return 'other';
  if (DOMAIN_TO_GROUP[domain]) return DOMAIN_TO_GROUP[domain];
  if (domain.endsWith('gmail.com') || domain.endsWith('googlemail.com')) return 'google';
  if (domain.endsWith('outlook.com') || domain.endsWith('hotmail.com') || domain.endsWith('live.com') || domain.endsWith('office365.com')) return 'microsoft';
  if (domain.endsWith('yahoo.com') || domain.endsWith('yahoo.co.uk') || domain.endsWith('yahoo.com.au')) return 'yahoo';
  if (domain.endsWith('aol.com')) return 'aol';
  if (domain.endsWith('protonmail.com') || domain.endsWith('proton.me') || domain.endsWith('pm.me')) return 'proton';
  if (domain.endsWith('icloud.com') || domain.endsWith('me.com') || domain.endsWith('mac.com')) return 'icloud';
  return 'other';
}

interface ProviderState {
  initialOutreachLimit: number;
  warmupLimit: number;
  reputationScore: number;
  healthLevel: string;
  dailySentCount: number;
  dailyBounceCount: number;
  dailySpamCount: number;
  lastAdjustmentAt: string | null;
  lastResetAt: string | null;
}

const FLOOR_LIMIT = 1;
const CEILING_LIMIT = 50;
const RECOVERY_RATE = 2;

function defaultProviderState(): ProviderState {
  return {
    initialOutreachLimit: CEILING_LIMIT,
    warmupLimit: 5,
    reputationScore: 100,
    healthLevel: 'healthy',
    dailySentCount: 0,
    dailyBounceCount: 0,
    dailySpamCount: 0,
    lastAdjustmentAt: null,
    lastResetAt: null,
  };
}

export function getProviderState(
  providerLimits: any,
  group: string
): ProviderState {
  if (!providerLimits || typeof providerLimits !== 'object') return defaultProviderState();
  const state = providerLimits[group];
  if (!state || typeof state !== 'object') return defaultProviderState();
  return {
    initialOutreachLimit: typeof state.initialOutreachLimit === 'number' ? state.initialOutreachLimit : CEILING_LIMIT,
    warmupLimit: typeof state.warmupLimit === 'number' ? state.warmupLimit : 5,
    reputationScore: typeof state.reputationScore === 'number' ? state.reputationScore : 100,
    healthLevel: typeof state.healthLevel === 'string' ? state.healthLevel : 'healthy',
    dailySentCount: typeof state.dailySentCount === 'number' ? state.dailySentCount : 0,
    dailyBounceCount: typeof state.dailyBounceCount === 'number' ? state.dailyBounceCount : 0,
    dailySpamCount: typeof state.dailySpamCount === 'number' ? state.dailySpamCount : 0,
    lastAdjustmentAt: state.lastAdjustmentAt || null,
    lastResetAt: state.lastResetAt || null,
  };
}

/**
 * Check if a specific lead's provider has remaining budget for INITIAL cold sends.
 * Follow-ups and replies MUST call canSendFollowUpOrReply() instead — they bypass provider limits.
 */
export async function canSendToProvider(
  integrationId: string,
  leadEmail: string,
  isFollowUpOrReply: boolean = false,
  cachedIntegration?: { providerLimits: any; initialOutreachLimit: number | null }
): Promise<{ allowed: boolean; reason?: string; remaining?: number }> {
  // Domain reputation throttling is disabled per user request
  return { allowed: true, remaining: 999 };
}

export async function canSendFollowUpOrReply(
  integrationId: string,
  leadEmail: string
): Promise<{ allowed: boolean; remaining: number }> {
  return { allowed: true, remaining: 999 };
}

export async function recordProviderOutcome(
  integrationId: string,
  leadEmail: string,
  outcome: 'sent' | 'bounced' | 'spam' | 'opened' | 'replied'
): Promise<void> {
  if (!leadEmail || !integrationId) return;
  if (outcome !== 'sent' && outcome !== 'bounced' && outcome !== 'spam') return;

  const group = detectProviderGroup(leadEmail);
  if (!PROVIDER_GROUPS.includes(group as any)) return;

  const now = new Date().toISOString();
  const fieldToInc = outcome === 'sent' ? 'dailySentCount'
    : outcome === 'bounced' ? 'dailyBounceCount'
    : 'dailySpamCount';

  await db.execute(sql`
    UPDATE integrations
    SET provider_limits = jsonb_set(
      jsonb_set(
        COALESCE(provider_limits, '{}'::jsonb),
        ARRAY[${group}, ${fieldToInc}],
        to_jsonb(COALESCE(((provider_limits #>> ARRAY[${group}, ${fieldToInc}])::int), 0) + 1),
        true
      ),
      ARRAY[${group}, 'lastAdjustmentAt'],
      to_jsonb(${now}::text),
      true
    ),
    updated_at = NOW()
    WHERE id = ${integrationId}::uuid
  `).catch((err: any) => {
    console.warn(`[ProviderReputation] recordProviderOutcome failed for ${group}/${fieldToInc}: ${err.message}`);
  });
}

export async function recalculateProviderReputation(
  integrationId: string
): Promise<Record<string, any>> {
  const integration = await db
    .select()
    .from(integrations)
    .where(eq(integrations.id, integrationId))
    .limit(1);

  if (!integration[0]) return {};

  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  const recentBounces = await db
    .select()
    .from(bounceTracker)
    .where(
      and(
        eq(bounceTracker.integrationId, integrationId),
        gte(bounceTracker.createdAt, fourteenDaysAgo)
      )
    );

  const current = (integration[0].providerLimits || {}) as any;
  const updated: Record<string, any> = {};

  for (const group of PROVIDER_GROUPS) {
    const groupBounces = recentBounces.filter((b: any) => {
      const leadEmail = (b as any).email || '';
      return detectProviderGroup(leadEmail) === group;
    });

    const state = getProviderState(current, group);

    let score = state.reputationScore;
    let hardBounces = 0;
    let spamComplaints = 0;

    for (const bounce of groupBounces) {
      const daysOld = (Date.now() - new Date(bounce.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      const weight = Math.max(0.2, 1 - (daysOld / 14));
      if (bounce.bounceType === 'hard') { score -= 7 * weight; hardBounces++; }
      else if (bounce.bounceType === 'soft') { score -= 3 * weight; }
      else if (bounce.bounceType === 'spam') { score -= 25 * weight; spamComplaints++; }
    }

    if (hardBounces === 0 && spamComplaints === 0 && score < 100) {
      score = Math.min(100, score + RECOVERY_RATE);
    }

    score = Math.max(1, Math.min(100, Math.round(score)));

    let newLimit = state.initialOutreachLimit ?? CEILING_LIMIT;
    if (score < 40) {
      newLimit = Math.max(FLOOR_LIMIT, Math.min(CEILING_LIMIT, Math.floor(newLimit * 0.3)));
    } else if (score < 65) {
      newLimit = Math.max(FLOOR_LIMIT, Math.min(CEILING_LIMIT, Math.floor(newLimit * 0.5)));
    } else if (score < 85) {
      newLimit = Math.max(FLOOR_LIMIT, Math.min(CEILING_LIMIT, Math.floor(newLimit * 0.8)));
    } else {
      newLimit = Math.min(CEILING_LIMIT, newLimit + RECOVERY_RATE);
    }

    const healthLevel = score >= 85 ? 'healthy' : score >= 65 ? 'cautious' : score >= 40 ? 'poor' : 'critical';

    updated[group] = {
      initialOutreachLimit: newLimit,
      warmupLimit: state.warmupLimit ?? 5,
      reputationScore: score,
      healthLevel,
      dailySentCount: state.dailySentCount ?? 0,
      dailyBounceCount: hardBounces,
      dailySpamCount: spamComplaints,
      lastAdjustmentAt: new Date().toISOString(),
      lastResetAt: state.lastResetAt,
    };
  }

  await db
    .update(integrations)
    .set({ providerLimits: updated as any })
    .where(eq(integrations.id, integrationId));

  return updated;
}

export async function resetProviderDailyCounters(): Promise<void> {
  const active = await db
    .select({ id: integrations.id, providerLimits: integrations.providerLimits })
    .from(integrations)
    .where(sql`provider IN ('gmail', 'outlook', 'custom_email') AND connected = true`);

  const now = new Date().toISOString();
  let updated = 0;

  for (const integration of active) {
    const current = (integration.providerLimits || {}) as any;
    let changed = false;

    for (const group of PROVIDER_GROUPS) {
      if (current[group]) {
        if (current[group].dailySentCount > 0 || current[group].dailyBounceCount > 0 || current[group].dailySpamCount > 0) {
          current[group].dailySentCount = 0;
          current[group].dailyBounceCount = 0;
          current[group].dailySpamCount = 0;
          current[group].lastResetAt = now;
          changed = true;
        }
      }
    }

    if (changed) {
      await db
        .update(integrations)
        .set({ providerLimits: current as any })
        .where(eq(integrations.id, integration.id));
      updated++;
    }
  }

  if (updated > 0) {
    console.log(`[ProviderReputation] Reset daily counters for ${updated} integration(s)`);
  }
}

export async function getProviderSummary(integrationId: string): Promise<Record<string, any>> {
  const integration = await db
    .select({ providerLimits: integrations.providerLimits })
    .from(integrations)
    .where(eq(integrations.id, integrationId))
    .limit(1);

  if (!integration[0]) return {};

  const current = (integration[0].providerLimits || {}) as any;
  const summary: Record<string, any> = {};

  for (const group of PROVIDER_GROUPS) {
    const state = getProviderState(current, group);
    summary[group] = {
      limit: state.initialOutreachLimit,
      sent: state.dailySentCount,
      remaining: Math.max(0, state.initialOutreachLimit - state.dailySentCount),
      reputationScore: state.reputationScore,
      healthLevel: state.healthLevel,
      bounceCount: state.dailyBounceCount,
      spamCount: state.dailySpamCount,
    };
  }

  return summary;
}