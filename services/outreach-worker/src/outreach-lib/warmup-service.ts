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
   * Warmup = 10% of daily outreach limit, scaled progressively:
   * 1-2   Days -> 10% of providerMax
   * 3-5   Days -> 25% of providerMax
   * 6-10  Days -> 50% of providerMax
   * 11-14 Days -> 75% of providerMax
   * 15+   Days -> 100% (warmup complete)
   */
  private readonly WARMUP_STAGES: Array<{ maxDays: number; percent: number }> = [
    { maxDays: 2,  percent: 0.10 },
    { maxDays: 5,  percent: 0.25 },
    { maxDays: 10, percent: 0.50 },
    { maxDays: 14, percent: 0.75 },
  ];

  private readonly FULL_WARMUP_DAYS = 14;

  /**
   * Returns the effective daily send limit for a mailbox integration based on age.
   */
  getWarmupStatus(integration: Integration, providerMax: number): WarmupStatus {
    const createdAt = integration.createdAt
      ? new Date(integration.createdAt)
      : new Date();

    const diffTime = Date.now() - createdAt.getTime();
    const daysSinceConnected = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));

    // Calculate warmup limit as percentage of providerMax
    for (const stage of this.WARMUP_STAGES) {
      if (daysSinceConnected <= stage.maxDays) {
        const warmupLimit = Math.max(1, Math.round(providerMax * stage.percent));
        return {
          isWarmingUp: true,
          dailyLimit: warmupLimit,
          daysSinceConnected,
          reason: `Warmup Day ${daysSinceConnected + 1}/${this.FULL_WARMUP_DAYS} – limit capped at ${warmupLimit}/day (${Math.round(stage.percent * 100)}% of ${providerMax}) to protect sender reputation`,
        };
      }
    }

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






