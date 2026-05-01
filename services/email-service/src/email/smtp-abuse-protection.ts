import { db } from '@shared/lib/db/db.js';
import { users } from '@audnix/shared';
import { eq } from 'drizzle-orm';

/**
 * SMTP Abuse Protection
 * - Rate limit: 150-300 emails/hour (configurable per plan)
 * - Daily max: 5000 emails/day
 * - Random delays: 2-12 seconds between sends
 * - Tracks sending patterns to detect abuse
 */

interface SmtpRateLimit {
  perHour: number;      // emails per hour
  perDay: number;       // max per day
  minDelay: number;     // seconds
  maxDelay: number;     // seconds
  enabled: boolean;
}

const RATE_LIMITS: Record<string, SmtpRateLimit> = {
  'free': {
    perHour: 50,
    perDay: 300,
    minDelay: 3,
    maxDelay: 10,
    enabled: true
  },
  'starter': {
    perHour: 150,
    perDay: 1000,
    minDelay: 2,
    maxDelay: 8,
    enabled: true
  },
  'pro': {
    perHour: 500,
    perDay: 5000,
    minDelay: 1,
    maxDelay: 5,
    enabled: true
  },
  'enterprise': {
    perHour: 2000,
    perDay: 50000,
    minDelay: 0,
    maxDelay: 2,
    enabled: true
  }
};

class SmtpAbuseProtection {
  private sendingTracking = new Map<string, { count: number; timestamp: number }[]>();

  /**
   * Check if user can send email now
   */
  async canSendEmail(userId: string): Promise<{ allowed: boolean; reason?: string; delay?: number }> {
    try {
      // Get user's plan
      const [user] = await db
        .select({ subscriptionTier: users.plan })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      const tier = user?.subscriptionTier || 'free';
      const limit = RATE_LIMITS[tier] || RATE_LIMITS['free'];

      if (!limit.enabled) {
        return { allowed: true };
      }

      const now = Date.now();
      const tracking = this.sendingTracking.get(userId) || [];

      // Clean up old entries (older than 1 hour)
      const recentSends = tracking.filter(t => now - t.timestamp < 60 * 60 * 1000);

      // Check hourly limit
      const lastHour = recentSends.filter(t => now - t.timestamp < 60 * 60 * 1000);
      if (lastHour.length >= limit.perHour) {
        const oldestSend = Math.min(...lastHour.map(t => t.timestamp));
        const timeUntilAvailable = 60 * 60 * 1000 - (now - oldestSend);
        return {
          allowed: false,
          reason: `Hourly rate limit (${limit.perHour}/hr) reached`,
          delay: Math.ceil(timeUntilAvailable / 1000)
        };
      }

      // Check daily limit
      const lastDay = recentSends.filter(t => now - t.timestamp < 24 * 60 * 60 * 1000);
      if (lastDay.length >= limit.perDay) {
        return {
          allowed: false,
          reason: `Daily limit (${limit.perDay}/day) reached`,
          delay: 24 * 60 * 60
        };
      }

      // Calculate random delay for human-like timing
      const delay = this.getRandomDelay(limit.minDelay, limit.maxDelay);

      return { allowed: true, delay };
    } catch (error) {
      console.error('SMTP abuse protection check failed:', error);
      // Fail open - allow send if check fails
      return { allowed: true };
    }
  }

  /**
   * Record that email was sent
   */
  recordSend(userId: string): void {
    const now = Date.now();
    const tracking = this.sendingTracking.get(userId) || [];
    tracking.push({ count: 1, timestamp: now });

    // Clean old entries
    const recent = tracking.filter(t => now - t.timestamp < 24 * 60 * 60 * 1000);
    this.sendingTracking.set(userId, recent);
  }

  /**
   * Get random delay in milliseconds
   */
  private getRandomDelay(minSeconds: number, maxSeconds: number): number {
    const min = minSeconds * 1000;
    const max = maxSeconds * 1000;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Get current sending stats for user
   */
  async getStats(userId: string): Promise<{
    sentThisHour: number;
    sentToday: number;
    hourlyLimit: number;
    dailyLimit: number;
    plan: string;
  }> {
    const [user] = await db
      .select({ subscriptionTier: users.plan })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const tier = user?.subscriptionTier || 'free';
    const limit = RATE_LIMITS[tier] || RATE_LIMITS['free'];
    const tracking = this.sendingTracking.get(userId) || [];
    const now = Date.now();

    const sentThisHour = tracking.filter(t => now - t.timestamp < 60 * 60 * 1000).length;
    const sentToday = tracking.filter(t => now - t.timestamp < 24 * 60 * 60 * 1000).length;

    return {
      sentThisHour,
      sentToday,
      hourlyLimit: limit.perHour,
      dailyLimit: limit.perDay,
      plan: tier
    };
  }
}

export const smtpAbuseProtection = new SmtpAbuseProtection();
export type { SmtpRateLimit };





