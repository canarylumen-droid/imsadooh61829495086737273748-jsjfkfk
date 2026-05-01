import { db } from '@shared/lib/db/db.js';
import { emailWarmupSchedules } from '@audnix/shared';
import { eq } from 'drizzle-orm';

/**
 * Email Warm-up Engine
 * Gradually ramps up email sending to build domain reputation
 * 
 * Schedule:
 * Day 1: 30 emails
 * Day 2: 50 emails
 * Day 3: 80 emails
 * Day 4: 120 emails
 * Day 5: 200 emails
 * Days 6-30: Continue scaling based on engagement
 */

export async function initializeWarmupSchedule(userId: string): Promise<void> {
  const schedule = generateWarmupSchedule();

  for (const day of schedule) {
    await db.insert(emailWarmupSchedules).values({
      userId,
      day: day.day,
      dailyLimit: day.limit,
      randomDelay: true
    });
  }
}

export function generateWarmupSchedule(): Array<{ day: number; limit: number }> {
  return [
    { day: 1, limit: 200 },
    { day: 2, limit: 300 },
    { day: 3, limit: 300 },
    { day: 4, limit: 400 },
    { day: 5, limit: 450 },
    ...Array.from({ length: 25 }, (_, i) => ({
      day: 6 + i,
      limit: 450
    }))
  ];
}

export async function getDailyLimit(userId: string, day: number): Promise<number> {
  try {
    const result = await db
      .select()
      .from(emailWarmupSchedules)
      .where(
        eq(emailWarmupSchedules.userId, userId) &&
        eq(emailWarmupSchedules.day, day)
      )
      .limit(1);

    if (result.length > 0) {
      return result[0].dailyLimit;
    }
  } catch (error) {
    console.error('Error getting daily limit:', error);
  }

  // Default: moderate sending
  return 150;
}

export async function getRandomDelay(): Promise<number> {
  // 1 email per 2-3 minutes (120,000ms - 180,000ms)
  return Math.floor(Math.random() * (180000 - 120000 + 1)) + 120000;
}



