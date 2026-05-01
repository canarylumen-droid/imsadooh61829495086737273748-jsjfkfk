/**
 * Upload Rate Limiter
 * Prevents abuse of file upload endpoints
 */

import { db } from '@shared/lib/db/db.js';
import { uploadRateLimit } from "@audnix/shared";
import { eq } from "drizzle-orm";

export interface RateLimitConfig {
  uploadsPerHour: number; // Default: 10 files per hour
  windowSizeMinutes: number; // Default: 60 minutes
}

const DEFAULT_CONFIG: RateLimitConfig = {
  uploadsPerHour: 10,
  windowSizeMinutes: 60,
};

export class UploadRateLimiter {
  /**
   * Check if user can upload
   */
  static async canUpload(userId: string, config = DEFAULT_CONFIG): Promise<{
    allowed: boolean;
    remainingUploads: number;
    resetTime: Date;
    message?: string;
  }> {
    try {
      // Get or create rate limit record
      let record = await db
        .select()
        .from(uploadRateLimit)
        .where(eq(uploadRateLimit.userId, userId))
        .limit(1);

      const now = new Date();
      let rateLimitRecord = record[0];

      if (!rateLimitRecord) {
        // Create new record
        const newRecord = await db
          .insert(uploadRateLimit)
          .values({
            userId,
            uploads: 0,
            lastResetAt: now,
            windowSizeMinutes: config.windowSizeMinutes,
          })
          .returning();

        rateLimitRecord = newRecord[0];
      }

      // Check if window has expired
      const lastResetTime = new Date(rateLimitRecord.lastResetAt);
      const minutesSinceReset = (now.getTime() - lastResetTime.getTime()) / (1000 * 60);

      if (minutesSinceReset > config.windowSizeMinutes) {
        // Reset window
        await db
          .update(uploadRateLimit)
          .set({
            uploads: 0,
            lastResetAt: now,
          })
          .where(eq(uploadRateLimit.userId, userId));

        return {
          allowed: true,
          remainingUploads: config.uploadsPerHour - 1,
          resetTime: new Date(now.getTime() + config.windowSizeMinutes * 60 * 1000),
        };
      }

      // Check if within limit
      const remainingUploads = config.uploadsPerHour - rateLimitRecord.uploads;
      const canUpload = remainingUploads > 0;

      if (canUpload) {
        // Increment upload count
        await db
          .update(uploadRateLimit)
          .set({
            uploads: rateLimitRecord.uploads + 1,
          })
          .where(eq(uploadRateLimit.userId, userId));
      }

      const resetTime = new Date(
        lastResetTime.getTime() + config.windowSizeMinutes * 60 * 1000
      );

      return {
        allowed: canUpload,
        remainingUploads: Math.max(0, remainingUploads - 1),
        resetTime,
        message: canUpload
          ? `${remainingUploads - 1} uploads remaining this hour`
          : `Rate limit exceeded. Try again after ${resetTime.toLocaleTimeString()}`,
      };
    } catch (error) {
      console.error("Rate limit check error:", error);
      // On error, allow upload (fail open)
      return {
        allowed: true,
        remainingUploads: DEFAULT_CONFIG.uploadsPerHour,
        resetTime: new Date(),
      };
    }
  }

  /**
   * Manually reset rate limit (admin only)
   */
  static async resetLimit(userId: string): Promise<void> {
    try {
      await db
        .update(uploadRateLimit)
        .set({
          uploads: 0,
          lastResetAt: new Date(),
        })
        .where(eq(uploadRateLimit.userId, userId));

      console.log(`✓ Rate limit reset for user ${userId}`);
    } catch (error) {
      console.error("Reset rate limit error:", error);
    }
  }

  /**
   * Get current rate limit status
   */
  static async getStatus(userId: string, config = DEFAULT_CONFIG) {
    try {
      const record = await db
        .select()
        .from(uploadRateLimit)
        .where(eq(uploadRateLimit.userId, userId))
        .limit(1);

      if (!record[0]) {
        return {
          uploads: 0,
          remaining: config.uploadsPerHour,
          resetTime: new Date(),
        };
      }

      const now = new Date();
      const lastResetTime = new Date(record[0].lastResetAt);
      const minutesSinceReset = (now.getTime() - lastResetTime.getTime()) / (1000 * 60);

      if (minutesSinceReset > config.windowSizeMinutes) {
        return {
          uploads: 0,
          remaining: config.uploadsPerHour,
          resetTime: new Date(now.getTime() + config.windowSizeMinutes * 60 * 1000),
        };
      }

      return {
        uploads: record[0].uploads,
        remaining: Math.max(0, config.uploadsPerHour - record[0].uploads),
        resetTime: new Date(
          lastResetTime.getTime() + config.windowSizeMinutes * 60 * 1000
        ),
      };
    } catch (error) {
      console.error("Error getting rate limit status:", error);
      return {
        uploads: 0,
        remaining: config.uploadsPerHour,
        resetTime: new Date(),
      };
    }
  }
}




