import { storage } from '@shared/lib/storage/storage.js';
import { wsSync } from "@shared/lib/realtime/websocket-sync.js";
import { workerHealthMonitor } from "@shared/lib/monitoring/worker-health.js";

/**
 * AI Budget Worker
 * 
 * Manages user-level AI token consumption:
 * 1. Resets daily token counters at midnight.
 * 2. Monitor for high usage and notify users.
 * 3. Enforces hard-caps to prevent bill shock.
 */

const DEFAULT_DAILY_LIMIT = 500000; // 500k tokens default
const WARNING_THRESHOLD = 0.8; // 80%

export class AiBudgetWorker {
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor() {
    console.log("[AiBudgetWorker] 🛡️ AI Budget Monitor initialized.");
  }

  public start() {
    // Run every 15 minutes to check for quota warnings
    this.timer = setInterval(() => this.tick(), 15 * 60 * 1000);
    // Also run immediately on start
    this.tick();
  }

  public stop() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const startTime = Date.now();
      const users = await storage.getUsers();
      
      const now = new Date();
      const isMidnight = now.getHours() === 0 && now.getMinutes() < 15;

      for (const user of users) {
        const metadata = (user.intelligenceMetadata as any) || {};
        let dailyUsage = metadata.dailyTokenUsage || 0;
        const lastReset = metadata.lastUsageReset || new Date(0).toISOString();
        
        // 1. Reset daily count if it's a new day
        const lastResetDate = new Date(lastReset);
        const dayStarted = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        if (lastResetDate < dayStarted || isMidnight) {
          console.log(`[AiBudgetWorker] 🔄 Resetting daily quota for user ${user.id}`);
          await storage.updateUser(user.id, {
            intelligenceMetadata: {
              ...metadata,
              dailyTokenUsage: 0,
              lastUsageReset: now.toISOString(),
              lastWarningSentAt: null
            }
          });
          dailyUsage = 0;
        }

        // 2. Check for warning thresholds
        const limit = metadata.customDailyTokenLimit || DEFAULT_DAILY_LIMIT;
        if (dailyUsage > limit * WARNING_THRESHOLD && !metadata.lastWarningSentAt) {
          console.warn(`[AiBudgetWorker] ⚠️ User ${user.id} reached ${Math.round((dailyUsage/limit)*100)}% of daily AI quota.`);
          
          await storage.createNotification({
            userId: user.id,
            type: 'system',
            title: 'AI Usage Warning ⚡',
            message: `You've used ${Math.round((dailyUsage/limit)*100)}% of your daily AI token budget (${Math.round(dailyUsage/1000)}k / ${Math.round(limit/1000)}k).`,
            metadata: { dailyUsage, limit }
          });

          // Mark warning as sent to avoid spam
          await storage.updateUser(user.id, {
            intelligenceMetadata: {
              ...metadata,
              lastWarningSentAt: now.toISOString()
            }
          });
        }
      }

      workerHealthMonitor.recordSuccess('ai-budget-worker');
    } catch (error: any) {
      console.error("[AiBudgetWorker] ❌ Error in budget tick:", error.message);
      workerHealthMonitor.recordError('ai-budget-worker', error.message);
    } finally {
      this.isProcessing = false;
    }
  }
}

export const aiBudgetWorker = new AiBudgetWorker();






