import { db } from '../db/warmup-db.js';
import { eq, and, sql, gte, lte } from 'drizzle-orm';
import { warmupInteractions, warmupMailboxes, warmupThreads, emailTracking, emailEvents, leads, leadTimezoneProfiles } from '@audnix/shared';

interface SendTimeScore {
  hour: number;
  dayOfWeek: number;
  score: number;
  sampleSize: number;
}

interface PredictiveWindow {
  optimalHours: number[];
  suboptimalHours: number[];
  avoidHours: number[];
  optimalDays: number[];
  confidence: 'high' | 'medium' | 'low';
}

const CACHE_TTL_MS = 30 * 60 * 1000;
const hourScoreCache = new Map<string, { scores: SendTimeScore[]; expiresAt: number }>();

function getDomainFromEmail(email: string): string {
  return email.split('@')[1] || '';
}

export async function analyzeSendTiming(mailboxId: string): Promise<PredictiveWindow | null> {
  const cacheKey = `timing:${mailboxId}`;
  const cached = hourScoreCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return scoresToWindow(cached.scores);

  const mb = await db
    .select({ email: warmupMailboxes.email, createdAt: warmupMailboxes.createdAt })
    .from(warmupMailboxes)
    .where(eq(warmupMailboxes.id, mailboxId))
    .limit(1);

  if (!mb[0]) return null;

  const sentInteractions = await db
    .select({
      hour: sql<number>`EXTRACT(HOUR FROM ${warmupInteractions.sentAt})::int`,
      dayOfWeek: sql<number>`EXTRACT(DOW FROM ${warmupInteractions.sentAt})::int`,
      status: warmupInteractions.status,
    })
    .from(warmupInteractions)
    .where(
      and(
        eq(warmupInteractions.fromMailboxId, mailboxId),
        gte(warmupInteractions.sentAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
        eq(warmupInteractions.direction, 'outbound')
      )
    );

  if (sentInteractions.length < 10) return getDefaultWindow(mb[0].createdAt);

  const hourBuckets = new Map<string, { total: number; bounces: number; success: number }>();

  for (const s of sentInteractions) {
    const key = `${s.dayOfWeek}:${s.hour}`;
    const bucket = hourBuckets.get(key) || { total: 0, bounces: 0, success: 0 };
    bucket.total++;
    if (s.status === 'bounced' || s.status === 'failed') bucket.bounces++;
    else bucket.success++;
    hourBuckets.set(key, bucket);
  }

  const scores: SendTimeScore[] = [];
  for (const [key, bucket] of hourBuckets) {
    const [dayOfWeek, hour] = key.split(':').map(Number);
    const successRate = bucket.total > 0 ? bucket.success / bucket.total : 0;
    const score = Math.round(successRate * 100 - (bucket.bounces / Math.max(bucket.total, 1)) * 50);
    scores.push({
      hour,
      dayOfWeek,
      score: Math.max(0, Math.min(100, score)),
      sampleSize: bucket.total,
    });
  }

  scores.sort((a, b) => b.score - a.score);

  hourScoreCache.set(cacheKey, { scores, expiresAt: Date.now() + CACHE_TTL_MS });
  return scoresToWindow(scores);
}

function scoresToWindow(scores: SendTimeScore[]): PredictiveWindow {
  const optimalHours: number[] = [];
  const suboptimalHours: number[] = [];
  const avoidHours: number[] = [];
  const optimalDays: number[] = [];
  const dayScores = new Map<number, { score: number; count: number }>();

  for (const s of scores) {
    if (s.score >= 70 && s.sampleSize >= 3) optimalHours.push(s.hour);
    else if (s.score >= 40 && s.sampleSize >= 2) suboptimalHours.push(s.hour);
    else if (s.sampleSize >= 2) avoidHours.push(s.hour);

    const ds = dayScores.get(s.dayOfWeek) || { score: 0, count: 0 };
    ds.score += s.score;
    ds.count++;
    dayScores.set(s.dayOfWeek, ds);
  }

  for (const [day, ds] of dayScores) {
    if (ds.count > 0 && ds.score / ds.count >= 50) optimalDays.push(day);
  }

  const totalSamples = scores.reduce((sum, s) => sum + s.sampleSize, 0);
  const confidence: 'high' | 'medium' | 'low' =
    totalSamples >= 100 ? 'high' : totalSamples >= 30 ? 'medium' : 'low';

  return { optimalHours, suboptimalHours, avoidHours, optimalDays, confidence };
}

function getDefaultWindow(createdAt: Date | null): PredictiveWindow {
  const daysSinceCreation = createdAt
    ? (Date.now() - new Date(createdAt).getTime()) / (24 * 60 * 60 * 1000)
    : 0;

  if (daysSinceCreation < 3) {
    return {
      optimalHours: [10, 11, 14, 15],
      suboptimalHours: [9, 12, 13, 16],
      avoidHours: [0, 1, 2, 3, 4, 5, 6, 7, 8, 17, 18, 19, 20, 21, 22, 23],
      optimalDays: [1, 2, 3, 4, 5],
      confidence: 'low',
    };
  }

  return {
    optimalHours: [9, 10, 11, 14, 15, 16],
    suboptimalHours: [8, 12, 13, 17],
    avoidHours: [0, 1, 2, 3, 4, 5, 6, 7, 18, 19, 20, 21, 22, 23],
    optimalDays: [1, 2, 3, 4, 5],
    confidence: 'low',
  };
}

export function getSendDelayFromWindow(window: PredictiveWindow): number {
  const now = new Date();
  const currentHour = now.getUTCHours();
  const currentDay = now.getUTCDay();

  if (window.optimalHours.includes(currentHour) && window.optimalDays.includes(currentDay)) {
    return Math.floor(1000 + Math.random() * 4000);
  }

  if (window.suboptimalHours.includes(currentHour) && window.optimalDays.includes(currentDay)) {
    return Math.floor(30000 + Math.random() * 60000);
  }

  if (window.avoidHours.length > 0 && window.optimalHours.length > 0) {
    const nextOptimalHour = window.optimalHours.find(h => h > currentHour) || window.optimalHours[0];
    let hoursUntil = nextOptimalHour - currentHour;
    if (hoursUntil <= 0) hoursUntil += 24;
    return hoursUntil * 60 * 60 * 1000;
  }

  return Math.floor(5 * 60 * 1000 + Math.random() * 5 * 60 * 1000);
}

export function calculateAveragePerDay(totalLeads: number, durationDays: number): number {
  if (durationDays <= 0) return totalLeads;
  return Math.ceil(totalLeads / durationDays);
}

export function calculateProjectedDuration(totalLeads: number, dailyLimit: number): number {
  if (dailyLimit <= 0) return 999;
  return Math.ceil(totalLeads / dailyLimit);
}

export function generateSendDistribution(
  totalLeads: number,
  dailyLimit: number,
  durationDays: number
): Array<{ day: number; sends: number }> {
  const distribution: Array<{ day: number; sends: number }> = [];
  const effectiveLimit = durationDays > 0
    ? Math.min(dailyLimit, Math.ceil(totalLeads / durationDays))
    : dailyLimit;
  const totalDays = durationDays > 0 ? durationDays : Math.ceil(totalLeads / dailyLimit);
  let remaining = totalLeads;

  for (let day = 0; day < totalDays && remaining > 0; day++) {
    const todaySends = Math.min(effectiveLimit, remaining);
    distribution.push({ day: day + 1, sends: todaySends });
    remaining -= todaySends;
  }

  return distribution;
}
