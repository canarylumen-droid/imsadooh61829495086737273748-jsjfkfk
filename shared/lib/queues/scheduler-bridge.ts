import { getRedisClient } from '@shared/lib/redis/redis.js';

const SCHEDULING_QUEUE = process.env.SCHEDULING_QUEUE || 'scheduling-queue';
const SCHEDULING_RESULT_QUEUE = process.env.SCHEDULING_RESULT_QUEUE || 'scheduling-results';
const SCHEDULING_TIMEOUT = parseInt(process.env.SCHEDULING_TIMEOUT_MS || '5000', 10);

async function callRust(job: any): Promise<any | null> {
  const client = await getRedisClient();
  if (!client) return null;
  try {
    const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const payload = { ...job, requestId };
    await client.lPush(SCHEDULING_QUEUE, JSON.stringify(payload));
    const deadline = Date.now() + SCHEDULING_TIMEOUT;
    while (Date.now() < deadline) {
      const result = await client.brPop(SCHEDULING_RESULT_QUEUE, 1);
      if (result) {
        try {
          const data = JSON.parse((result as any).element || (result as any)[1]);
          if (data.requestId === requestId) return data;
        } catch {}
      }
    }
  } catch {}
  return null;
}

function floorCeilDistribute(count: number, slots: number): number[] {
  if (slots <= 0) return [];
  const base = Math.floor(count / slots);
  const remainder = count % slots;
  return Array.from({ length: slots }, (_, i) => base + (i < remainder ? 1 : 0));
}

export interface DailyPlanInput {
  dailyCap: number;
  warmupPct: number;
  campaignSentToday: number;
  warmupSentToday: number;
}
export interface DailyPlanResult {
  warmupBudget: number;
  campaignBudget: number;
  warmupRemaining: number;
  campaignRemaining: number;
  totalRemaining: number;
  warmupReduced: boolean;
}

function calcDailyPlanInline(input: DailyPlanInput): DailyPlanResult {
  const warmupBudget = Math.max(1, Math.round(input.dailyCap * input.warmupPct / 100));
  const campaignBudget = Math.max(0, input.dailyCap - warmupBudget);
  const warmupRemaining = Math.max(0, warmupBudget - input.warmupSentToday);
  let campaignRemaining = Math.max(0, campaignBudget - input.campaignSentToday);
  const warmupReduced = input.warmupSentToday >= warmupBudget && input.campaignSentToday < campaignBudget;
  if (warmupRemaining === 0 && input.warmupSentToday < warmupBudget) {
    const freed = warmupBudget - input.warmupSentToday;
    if (freed > 0) {
      const overflow = Math.max(0, campaignBudget - input.campaignSentToday);
      campaignRemaining += Math.min(Math.floor(freed / 2), overflow);
    }
  }
  return {
    warmupBudget,
    campaignBudget,
    warmupRemaining,
    campaignRemaining,
    totalRemaining: Math.max(0, input.dailyCap - input.campaignSentToday - input.warmupSentToday),
    warmupReduced,
  };
}

export interface MailboxInfo {
  id: string;
  provider: string;
  domain?: string;
  dailyCap: number;
  sentToday: number;
}
export interface DistributeInput {
  mailboxCaps: MailboxInfo[];
  leadsByDomain: Record<string, number>;
}
export interface MailboxAssignment {
  mailboxId: string;
  leadCount: number;
  fromDomain: string;
}
export interface DistributeResult {
  assignments: MailboxAssignment[];
  unassigned: number;
  exhausted: boolean;
}

function distributeLeadsInline(input: DistributeInput): DistributeResult {
  const assignments: MailboxAssignment[] = [];
  let unassigned = 0;
  let exhausted = false;
  const checkCandidates = (domain: string): { matched: MailboxInfo[]; remaining: MailboxInfo[] } => {
    const dl = domain.toLowerCase();
    const matched: MailboxInfo[] = [];
    const remaining: MailboxInfo[] = [];
    for (const m of input.mailboxCaps) {
      const prov = m.provider.toLowerCase();
      const mdom = (m.domain || '').toLowerCase();
      if (dl === 'gmail.com' || dl === 'googlemail.com') {
        if (prov === 'gmail') matched.push(m);
        else remaining.push(m);
      } else if (['outlook.com', 'hotmail.com', 'live.com', 'msn.com'].includes(dl)) {
        if (prov === 'outlook') matched.push(m);
        else remaining.push(m);
      } else if (mdom && dl === mdom) {
        matched.push(m);
      } else {
        remaining.push(m);
      }
    }
    return { matched, remaining };
  };
  for (const [domain, count] of Object.entries(input.leadsByDomain)) {
    if (count <= 0) continue;
    const { matched, remaining } = checkCandidates(domain);
    const candidates = matched.length > 0 ? matched : remaining;
    if (candidates.length === 0) {
      unassigned += count;
      exhausted = true;
      continue;
    }
    const available = candidates.filter(m => m.sentToday < m.dailyCap);
    if (available.length === 0) {
      unassigned += count;
      exhausted = true;
      continue;
    }
    const totalCap = available.reduce((s, m) => s + Math.max(0, m.dailyCap - m.sentToday), 0);
    if (totalCap <= 0) {
      unassigned += count;
      exhausted = true;
      continue;
    }
    const shares = floorCeilDistribute(count, available.length);
    for (let i = 0; i < available.length; i++) {
      const cap = available[i].dailyCap - available[i].sentToday;
      const share = Math.min(shares[i], cap);
      if (share > 0) {
        assignments.push({ mailboxId: available[i].id, leadCount: share, fromDomain: domain });
      }
    }
  }
  return { assignments, unassigned, exhausted };
}

export interface SpacingInput {
  campaignInitials: number;
  followUps: number;
  warmupSends: number;
  minGapMinutes: number;
  hoursActive: number;
  startHour: number;
}
export interface SpacingSlot {
  minuteOfDay: number;
  sendType: 'CampaignInitial' | 'FollowUp' | 'Warmup';
}

function calcSpacingInline(input: SpacingInput): SpacingSlot[] {
  const total = input.campaignInitials + input.followUps + input.warmupSends;
  if (total <= 0 || input.hoursActive <= 0) return [];
  const activeMin = input.hoursActive * 60;
  const startMin = input.startHour * 60;
  const interval = Math.max(input.minGapMinutes, activeMin / total);
  const slots: SpacingSlot[] = [];
  let ci = input.campaignInitials;
  let fu = input.followUps;
  let wu = input.warmupSends;
  let minute = startMin;
  let lastWarmup = -100;
  let lastCampaign = -100;
  const warmupGap = Math.max(input.minGapMinutes, 10);
  const campaignGap = input.minGapMinutes;
  while ((ci > 0 || fu > 0 || wu > 0) && minute < startMin + activeMin) {
    const warmupDue = wu > 0 && (minute - lastWarmup) >= warmupGap && (minute - lastCampaign) >= campaignGap;
    const campaignDue = ci > 0 && (minute - lastCampaign) >= campaignGap && (!warmupDue || wu <= 0);
    const deadline = minute >= startMin + activeMin - campaignGap * 2;
    if (campaignDue || (deadline && ci > 0)) {
      slots.push({ minuteOfDay: Math.round(minute), sendType: 'CampaignInitial' });
      ci--;
      lastCampaign = minute;
    } else if (warmupDue) {
      slots.push({ minuteOfDay: Math.round(minute), sendType: 'Warmup' });
      wu--;
      lastWarmup = minute;
      lastCampaign = minute;
    } else if (fu > 0 && (minute - lastCampaign) >= campaignGap) {
      slots.push({ minuteOfDay: Math.round(minute), sendType: 'FollowUp' });
      fu--;
      lastCampaign = minute;
    }
    minute += interval;
  }
  return slots;
}

export interface RedistributeInput {
  mailboxes: { id: string; dailyCap: number; sentToday: number }[];
  unassignedCount: number;
  isFollowUp: boolean;
}
export interface RedistAssignment {
  mailboxId: string;
  count: number;
}
export interface RedistributeResult {
  assignments: RedistAssignment[];
  carryOver: number;
}

function redistributeInline(input: RedistributeInput): RedistributeResult {
  if (input.isFollowUp) return { assignments: [], carryOver: input.unassignedCount };
  const total = input.unassignedCount;
  const withCap = input.mailboxes.filter(m => m.sentToday < m.dailyCap);
  const totalCap = withCap.reduce((s, m) => s + m.dailyCap - m.sentToday, 0);
  if (totalCap <= 0) return { assignments: [], carryOver: total };
  const assignable = Math.min(total, totalCap);
  const carryOver = Math.max(0, total - totalCap);
  const shares = floorCeilDistribute(assignable, withCap.length);
  let remaining = assignable;
  const assignments: RedistAssignment[] = [];
  for (let i = 0; i < withCap.length; i++) {
    const cap = withCap[i].dailyCap - withCap[i].sentToday;
    const share = Math.min(shares[i], cap, remaining);
    if (share > 0) {
      assignments.push({ mailboxId: withCap[i].id, count: share });
      remaining -= share;
    }
  }
  return { assignments, carryOver: carryOver + remaining };
}

async function tryRustOrFallback<T>(job: any, inlineFn: () => T, timeoutMs = SCHEDULING_TIMEOUT): Promise<T> {
  const result = await Promise.race([
    callRust(job),
    new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs)),
  ]);
  if (result && result.payload) return result.payload as T;
  return inlineFn();
}

export async function calcDailyPlan(input: DailyPlanInput): Promise<DailyPlanResult> {
  return tryRustOrFallback(
    { jobType: 'DailyPlan', dailyCap: input.dailyCap, warmupPct: input.warmupPct, campaignSentToday: input.campaignSentToday, warmupSentToday: input.warmupSentToday },
    () => calcDailyPlanInline(input),
  );
}

export async function distributeLeads(input: DistributeInput): Promise<DistributeResult> {
  return tryRustOrFallback(
    { jobType: 'Distribute', mailboxCaps: input.mailboxCaps, leadsByDomain: input.leadsByDomain },
    () => distributeLeadsInline(input),
  );
}

export async function calcSpacing(input: SpacingInput): Promise<SpacingSlot[]> {
  return tryRustOrFallback(
    { jobType: 'Spacing', ...input },
    () => calcSpacingInline(input),
  );
}

export async function redistribute(input: RedistributeInput): Promise<RedistributeResult> {
  return tryRustOrFallback(
    { jobType: 'Redistribute', ...input },
    () => redistributeInline(input),
  );
}

export { floorCeilDistribute, calcDailyPlanInline, distributeLeadsInline, calcSpacingInline, redistributeInline };
