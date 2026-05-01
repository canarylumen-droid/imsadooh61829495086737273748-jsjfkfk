import { db } from '@shared/lib/db/db.js';
import { emailWarmupSchedules, users, type EmailWarmupSchedule, type User } from '@audnix/shared';
import { eq, and } from 'drizzle-orm';
import { storage } from '@shared/lib/storage/storage.js';
import { workerHealthMonitor } from '@shared/lib/monitoring/worker-health.js';
import { quotaService } from '@shared/lib/monitoring/quota-service.js';

/**
 * Email Warm-up System
 * 
 * ULTRA-AGGRESSIVE warmup for handling 5K+ leads in 3-4 days:
 * - Day 1: 300 emails (~12-15/hour)
 * - Day 2: 450 emails (~20/hour)
 * - Day 3: 500 emails (~21/hour)
 * - Day 4+: 500+ emails - Sustained flow
 * 
 * Total: 5,000+ emails handled over time with safe throughput
 * Auto-adjusts based on bounce rate
 */

interface WarmupSchedule {
  day: number;
  emailsToSend: number;
}

/**
 * ULTRA-AGGRESSIVE WARMUP SCHEDULE for rapid lead handling
 * 
 * - Day 1: 300 emails/day (~12-15/hour)
 * - Day 2: 450 emails/day (~20/hour)
 * - Day 3: 500 emails/day (~21/hour)
 * - Day 4+: 500 emails/day (sustained)
 */
const WARMUP_SCHEDULE: WarmupSchedule[] = [
  { day: 1, emailsToSend: 300 },
  { day: 2, emailsToSend: 450 },
  { day: 3, emailsToSend: 500 },
  { day: 4, emailsToSend: 500 },
  { day: 5, emailsToSend: 500 },
  { day: 6, emailsToSend: 500 },
  { day: 7, emailsToSend: 500 },
  { day: 8, emailsToSend: 500 },
  { day: 9, emailsToSend: 500 },
  { day: 10, emailsToSend: 500 },
];

/**
 * HOURLY LIMITS for safe but fast sending
 */
export const HOURLY_EMAIL_LIMIT = 25; // Safe default for warmed domains
export const EMAILS_PER_MINUTE = 1; // ~1 email/minute for natural flow

class EmailWarmupWorker {
  private isRunning = false;
  private checkInterval: NodeJS.Timeout | null = null;

  /**
   * Start the email warm-up worker
   */
  start(): void {
    if (this.isRunning) {
      console.log('Email warmup worker already running');
      return;
    }

    this.isRunning = true;
    console.log('🔥 Email warmup worker started');

    this.checkInterval = setInterval(() => {
      this.checkAndUpdateWarmupLimits();
    }, 60 * 60 * 1000);

    this.checkAndUpdateWarmupLimits();
  }

  /**
   * Stop the worker
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isRunning = false;
    console.log('Email warmup worker stopped');
  }

  /**
   * Check and update warm-up limits for all users
   */
  private async checkAndUpdateWarmupLimits(): Promise<void> {
    if (!db) return;

    if (quotaService.isRestricted()) {
      console.log('[EmailWarmup] Skipping check: Database quota restricted');
      return;
    }

    try {
      const activeUsers: User[] = await db
        .select()
        .from(users)
        .where(eq(users.plan, 'starter'));

      for (const user of activeUsers) {
        await this.updateUserWarmupSchedule(user.id);
      }
      workerHealthMonitor.recordSuccess('email-warmup-worker');
    } catch (error: any) {
      console.error('Warmup check error:', error);
      quotaService.reportDbError(error);
      workerHealthMonitor.recordError('email-warmup-worker', error?.message || 'Unknown error');
    }
  }

  /**
   * Update warm-up schedule for a user
   * 
   * NOTE: The `day` field stores the calendar day (1-31) as a deduplication key
   * to ensure only one schedule record per day. The actual warmup level is
   * determined by `daysSinceCreated` (days since user account creation),
   * ensuring warmup properly ramps up regardless of calendar date.
   */
  private async updateUserWarmupSchedule(userId: string): Promise<void> {
    if (!db) return;

    try {
      const now = new Date();
      const today = now.getDate(); // Calendar day as deduplication key

      // Check if schedule already exists for today (prevent duplicates)
      const scheduleResults: EmailWarmupSchedule[] = await db
        .select()
        .from(emailWarmupSchedules)
        .where(
          and(
            eq(emailWarmupSchedules.userId, userId),
            eq(emailWarmupSchedules.day, today)
          )
        )
        .limit(1);

      const existingSchedule = scheduleResults[0];

      if (existingSchedule) {
        return; // Already has today's schedule
      }

      const user = await storage.getUserById(userId);
      if (!user?.createdAt) return;

      // --- ADVANCED (PHASE 13): REPUTATION-DRIVEN SCALING ---
      // Instead of relying on a static day index, we query the reputation monitor
      // to see the REAL health of this user's mailboxes.
      const { calculateReputationScore } = await import('./reputation-monitor.js');
      
      const userIntegrations = await storage.getIntegrations(userId);
      const emailIntegrations = userIntegrations.filter(i => 
        ['gmail', 'outlook', 'custom_email'].includes(i.provider) && i.connected
      );

      let maxReputation = 0;
      let existingLimit = 50;

      for (const integration of emailIntegrations) {
        const score = await calculateReputationScore(integration.id);
        maxReputation = Math.max(maxReputation, score);
        existingLimit = Math.max(existingLimit, integration.dailyLimit || 50);
      }

      // Dynamic Limit Logic:
      // 1. If reputation is excellent (>90), we can spike the warmup faster.
      // 2. If reputation is poor (<50), we freeze or slash the limit.
      let newDailyLimit = existingLimit;

      if (maxReputation > 90) {
        // High confidence: Spike limit by 20% or +25 emails
        newDailyLimit = Math.min(500, existingLimit + Math.max(25, Math.floor(existingLimit * 0.2)));
      } else if (maxReputation < 50) {
        // Poor health: Slash limit by 50%
        newDailyLimit = Math.max(10, Math.floor(existingLimit * 0.5));
      }

      await db.insert(emailWarmupSchedules).values({
        userId,
        day: today, 
        dailyLimit: newDailyLimit,
        randomDelay: true
      });

      console.log(`🚀 [Dynamic Warmup] Updated ${user.email}: Limit set to ${newDailyLimit} based on ${maxReputation}/100 reputation.`);
    } catch (error) {
      console.error('Error updating warmup schedule:', error);
    }
  }

  /**
   * Get today's allowed send count for a user
   */
  async getTodaysSendLimit(userId: string): Promise<number> {
    if (!db) return 0;

    try {
      const today = new Date().getDate();
      const scheduleResults: EmailWarmupSchedule[] = await db
        .select()
        .from(emailWarmupSchedules)
        .where(
          and(
            eq(emailWarmupSchedules.userId, userId),
            eq(emailWarmupSchedules.day, today)
          )
        )
        .limit(1);

      const schedule = scheduleResults[0];
      return schedule?.dailyLimit || 0;
    } catch (error) {
      console.error('Error getting warmup limit:', error);
      return 0;
    }
  }

  /**
   * Apply warm-up delay before sending
   */
  async applyWarmupDelay(userId: string): Promise<number> {
    if (!db) return 0;

    try {
      const scheduleResults: EmailWarmupSchedule[] = await db
        .select()
        .from(emailWarmupSchedules)
        .where(eq(emailWarmupSchedules.userId, userId))
        .limit(1);

      const schedule = scheduleResults[0];

      if (!schedule?.randomDelay) {
        return 0;
      }

      const delay = Math.floor(Math.random() * 10000) + 2000;
      return delay;
    } catch (error) {
      console.error('Error applying warmup delay:', error);
      return 0;
    }
  }
}

export const emailWarmupWorker = new EmailWarmupWorker();






