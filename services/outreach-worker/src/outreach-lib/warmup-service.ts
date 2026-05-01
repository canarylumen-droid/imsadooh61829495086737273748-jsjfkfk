import { storage } from '@shared/lib/storage/storage.js';
import type { Integration } from '@audnix/shared';

/**
 * Phase 11: Domain Warmup & Load Balancing Service
 *
 * Prevents spam-folder placement by enforcing progressive send limits
 * for newly connected email accounts.
 */

interface WarmupStatus {
  isWarmingUp: boolean;
  dailyLimit: number;
  daysSinceConnected: number;
  reason?: string;
}

class WarmupService {
  /**
   * Professional tiered warmup schedule:
   * 1-2   Days -> 25  emails / day
   * 3-5   Days -> 75  emails / day
   * 6-10  Days -> 150 emails / day
   * 11-14 Days -> 300 emails / day
   */
  private readonly WARMUP_STAGES: Array<{ maxDays: number; limit: number }> = [
    { maxDays: 2,  limit: 25  },
    { maxDays: 5,  limit: 75  },
    { maxDays: 10, limit: 150 },
    { maxDays: 14, limit: 300 },
  ];

  private readonly FULL_WARMUP_DAYS = 14;

  /**
   * Returns the effective daily send limit for a mailbox integration based on age.
   */
  getWarmupStatus(integration: Integration, providerMax: number): WarmupStatus {
    // Treat null/undefined createdAt as "now" (Day 0)
    const createdAt = integration.createdAt
      ? new Date(integration.createdAt)
      : new Date();

    const diffTime = Date.now() - createdAt.getTime();
    const daysSinceConnected = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));

    // Find the current stage
    for (const stage of this.WARMUP_STAGES) {
      if (daysSinceConnected <= stage.maxDays) {
        return {
          isWarmingUp: true,
          dailyLimit: stage.limit,
          daysSinceConnected,
          reason: `Warmup Day ${daysSinceConnected + 1}/${this.FULL_WARMUP_DAYS} – limit capped at ${stage.limit}/day to protect sender reputation`,
        };
      }
    }

    // Past warmup – use normal provider limits
    return {
      isWarmingUp: false,
      dailyLimit: providerMax,
      daysSinceConnected,
    };
  }

  /**
   * Given a list of mailboxes with their sent counts, apply warmup limits.
   * Returns the effective cap for each mailbox.
   */
  applyWarmupLimits(
    mailboxes: Array<Integration & { sentCount: number; limit: number }>
  ): Array<Integration & { sentCount: number; limit: number; warmupCapped: boolean }> {
    return mailboxes.map((mb) => {
      const warmup = this.getWarmupStatus(mb, mb.limit);

      if (warmup.isWarmingUp && warmup.dailyLimit < mb.limit) {
        console.log(
          `[WarmupService] 🛡️ Mailbox ${mb.id} (${mb.provider}) – ${warmup.reason}`
        );
        return {
          ...mb,
          limit: warmup.dailyLimit,
          warmupCapped: true,
        };
      }

      return { ...mb, warmupCapped: false };
    });
  }

  /**
   * Quick check: is this integration currently in warmup?
   */
  isWarming(integration: Integration): boolean {
    return this.getWarmupStatus(integration, 99999).isWarmingUp;
  }
}

export const warmupService = new WarmupService();






