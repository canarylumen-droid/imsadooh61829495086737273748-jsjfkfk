import { db } from '@shared/lib/db/db.js';
import { systemHealthLogs } from "@audnix/shared";
import type { InsertSystemHealthLog } from "@audnix/shared";

/**
 * System Health Service
 * Centralized logging for enterprise observability and DLQ reporting.
 */
export class SystemHealthService {
  private static recentLogs = new Map<string, number>();

  /**
   * Log a health event (Error, Warn, Info)
   * Implements a 5-minute rate-limit per event/message combo to prevent DB flooding.
   */
  static async log(params: Omit<InsertSystemHealthLog, 'id' | 'createdAt' | 'isResolved' | 'resolvedAt'>): Promise<void> {
    const logKey = `${params.service}:${params.event}:${params.message}`;
    const now = Date.now();
    const lastTime = this.recentLogs.get(logKey);

    if (lastTime && (now - lastTime) < 300_000) {
      return; // Throttled
    }
    this.recentLogs.set(logKey, now);

    // Periodically prune the map (every 100 logs)
    if (this.recentLogs.size > 1000) {
      for (const [k, v] of this.recentLogs.entries()) {
        if (now - v > 300_000) this.recentLogs.delete(k);
      }
    }

    try {
      await db.insert(systemHealthLogs).values({
        ...params,
        createdAt: new Date(),
        isResolved: false
      });

      // Console output for local dev
      const prefix = params.level === 'critical' ? '🚨' : params.level === 'error' ? '❌' : '⚠️';
      console.log(`${prefix} [Health:${params.service}] ${params.event}: ${params.message}`);
    } catch (error) {
      console.error("[Health Service] Logging failed:", error);
    }
  }

  /**
   * Specifically log AI failures for the DLQ dashboard
   */
  static async logAiError(userId: string, provider: string, event: string, error: any, details: Record<string, any> = {}): Promise<void> {
    await this.log({
      userId,
      service: 'ai',
      level: 'error',
      event,
      provider,
      message: error instanceof Error ? error.message : String(error),
      stackTrace: error instanceof Error ? error.stack : undefined,
      details: {
        ...details,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Log critical service outages
   */
  static async logCritical(service: string, event: string, message: string, details: Record<string, any> = {}): Promise<void> {
    await this.log({
      service,
      level: 'critical',
      event,
      message,
      details
    });
  }
}
