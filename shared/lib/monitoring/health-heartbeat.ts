/**
 * ─── SYSTEM HEALTH HEARTBEAT MONITOR ──────────────────────────────────────────
 *
 * Every worker writes a heartbeat record to Redis every 30 seconds.
 * A centralized monitor reads these records and fires alerts when:
 *  - >5 mailboxes are disconnected for >10 minutes
 *  - SMTP bounce rate exceeds 7%
 *  - Any worker has not checked in for >5 minutes
 *
 * Redis Schema:
 *   health:heartbeat:{service}  → { status, timestamp, podId, metrics }
 *   health:status:latest        → consolidated health snapshot (JSON)
 *
 * Usage:
 *   import { startHeartbeat, HealthMonitor } from '@shared/lib/monitoring/health-heartbeat.js';
 *   startHeartbeat('email-worker', { mailboxCount: 12, disconnectedCount: 0 });
 *
 *   const monitor = new HealthMonitor();
 *   await monitor.checkAndAlert(); // run every 60s via setInterval
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { getRedisClient } from '@shared/lib/redis/redis.js';
import { createStructuredLogger } from './structured-logger.js';
import { db } from '@shared/lib/db/db.js';
import { integrations, bounceTracker } from '@audnix/shared';
import { eq, and, gte, sql, count } from 'drizzle-orm';

const log = createStructuredLogger('HEARTBEAT');

interface HeartbeatPayload {
  service: string;
  podId: string;
  status: 'healthy' | 'degraded' | 'critical';
  timestamp: number;
  metrics?: Record<string, any>;
}

interface AlertConfig {
  maxDisconnectedMailboxes: number;
  disconnectedWindowMs: number;
  bounceRateThreshold: number;
  bounceRateWindowHours: number;
  workerTimeoutMs: number;
}

const DEFAULT_ALERT_CONFIG: AlertConfig = {
  maxDisconnectedMailboxes: 5,
  disconnectedWindowMs: 10 * 60 * 1000, // 10 minutes
  bounceRateThreshold: 0.07, // 7%
  bounceRateWindowHours: 24,
  workerTimeoutMs: 5 * 60 * 1000, // 5 minutes
};

/** Write a heartbeat for this service */
export async function writeHeartbeat(
  service: string,
  status: 'healthy' | 'degraded' | 'critical',
  metrics?: Record<string, any>
): Promise<void> {
  const redis = await getRedisClient();
  if (!redis) return;

  const podId = process.env.ECS_TASK_ID || process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || 'local';
  const payload: HeartbeatPayload = {
    service,
    podId,
    status,
    timestamp: Date.now(),
    metrics,
  };

  const key = `health:heartbeat:${service}`;
  await redis.setEx(key, 300, JSON.stringify(payload)); // TTL = 5 minutes
}

/** Start a recurring heartbeat every 30 seconds */
export function startHeartbeat(
  service: string,
  getMetrics?: () => Record<string, any> | Promise<Record<string, any>>
): NodeJS.Timeout {
  const interval = setInterval(async () => {
    try {
      const metrics = getMetrics ? await getMetrics() : undefined;
      await writeHeartbeat(service, 'healthy', metrics);
    } catch (err: any) {
      log.error('Heartbeat failed', { service, error: err.message });
    }
  }, 30_000);

  // Write immediately on start
  writeHeartbeat(service, 'healthy', getMetrics ? undefined : undefined).catch(() => {});

  return interval;
}

/** ─── HEALTH MONITOR (centralized alerting) ──────────────────────────────── */

export class HealthMonitor {
  private alertConfig: AlertConfig;
  private lastAlertTimestamps: Map<string, number> = new Map();
  private readonly alertCooldownMs = 5 * 60 * 1000; // 5 min between same alert

  constructor(config?: Partial<AlertConfig>) {
    this.alertConfig = { ...DEFAULT_ALERT_CONFIG, ...config };
  }

  /** Run all health checks and fire alerts if needed */
  async checkAndAlert(): Promise<void> {
    const now = Date.now();
    const redis = await getRedisClient();
    if (!redis) {
      log.warn('Redis unavailable — health checks skipped');
      return;
    }

    const snapshot: Record<string, any> = {
      timestamp: new Date().toISOString(),
      alerts: [] as string[],
      workers: {} as Record<string, any>,
      mailboxes: {} as any,
      bounceRate: null as number | null,
    };

    try {
      // ── 1. Worker heartbeat check ───────────────────────────────────────
      const workerKeys = await redis.keys('health:heartbeat:*');
      for (const key of workerKeys) {
        const raw = await redis.get(key);
        if (!raw) continue;
        const beat = JSON.parse(raw) as HeartbeatPayload;
        const age = now - beat.timestamp;
        const service = key.replace('health:heartbeat:', '');

        snapshot.workers[service] = {
          status: age > this.alertConfig.workerTimeoutMs ? 'MISSING' : beat.status,
          podId: beat.podId,
          lastSeenMs: age,
          metrics: beat.metrics,
        };

        if (age > this.alertConfig.workerTimeoutMs) {
          await this.fireAlert('worker-missing', {
            service,
            podId: beat.podId,
            lastSeenSeconds: Math.round(age / 1000),
          });
        }
      }

      // ── 2. Mailbox disconnection check ────────────────────────────────────
      const mailboxSnapshot = await this.checkMailboxHealth();
      snapshot.mailboxes = mailboxSnapshot;

      if (mailboxSnapshot.disconnectedCount > this.alertConfig.maxDisconnectedMailboxes) {
        await this.fireAlert('mailbox-disconnect', {
          disconnectedCount: mailboxSnapshot.disconnectedCount,
          threshold: this.alertConfig.maxDisconnectedMailboxes,
          oldestDisconnectSeconds: Math.round(mailboxSnapshot.oldestDisconnectMs / 1000),
        });
      }

      // ── 3. Bounce rate check ────────────────────────────────────────────
      const bounceRate = await this.calculateBounceRate();
      snapshot.bounceRate = bounceRate;

      if (bounceRate !== null && bounceRate > this.alertConfig.bounceRateThreshold) {
        await this.fireAlert('bounce-rate', {
          bounceRate: Math.round(bounceRate * 1000) / 10,
          thresholdPercent: Math.round(this.alertConfig.bounceRateThreshold * 100),
          windowHours: this.alertConfig.bounceRateWindowHours,
        });
      }

      // Write consolidated snapshot to Redis
      await redis.setEx('health:status:latest', 300, JSON.stringify(snapshot));
    } catch (err: any) {
      log.error('Health monitor check failed', { error: err.message });
    }
  }

  /** Check mailbox health via DB (disconnected for >10 min) */
  private async checkMailboxHealth(): Promise<{
    totalCount: number;
    disconnectedCount: number;
    oldestDisconnectMs: number;
  }> {
    if (!db) {
      return { totalCount: 0, disconnectedCount: 0, oldestDisconnectMs: 0 };
    }

    try {
      const tenMinutesAgo = new Date(Date.now() - this.alertConfig.disconnectedWindowMs);

      // Count disconnected integrations (health = 'error' or 'failed')
      const result = await db
        .select({
          count: count(),
          oldestError: sql`MIN(${integrations.updatedAt})`,
        })
        .from(integrations)
        .where(
          and(
            eq(integrations.connected, true),
            sql`${integrations.healthStatus} IN ('warning', 'failed')`,
            sql`${integrations.updatedAt} < ${tenMinutesAgo}`
          )
        );

      const disconnectedCount = Number(result[0]?.count || 0);
      const oldestErrorRaw = result[0]?.oldestError;
      const oldestDisconnectMs = oldestErrorRaw && typeof oldestErrorRaw === 'string'
        ? Date.now() - new Date(oldestErrorRaw).getTime()
        : 0;

      const total = await db.select({ count: count() }).from(integrations).where(eq(integrations.connected, true));
      const totalCount = Number(total[0]?.count || 0);

      return { totalCount, disconnectedCount, oldestDisconnectMs };
    } catch (err: any) {
      log.error('Mailbox health check failed', { error: err.message });
      return { totalCount: 0, disconnectedCount: 0, oldestDisconnectMs: 0 };
    }
  }

  /** Calculate 24-hour bounce rate from bounce_tracker */
  private async calculateBounceRate(): Promise<number | null> {
    if (!db) return null;

    try {
      const windowStart = new Date(Date.now() - this.alertConfig.bounceRateWindowHours * 60 * 60 * 1000);

      // Count bounces in window
      const bounceResult = await db
        .select({ count: count() })
        .from(bounceTracker)
        .where(gte(bounceTracker.timestamp, windowStart));

      const bounceCount = Number(bounceResult[0]?.count || 0);
      if (bounceCount === 0) return 0;

      // Count total emails sent in same window (from campaignEmails)
      const sentResult = await db
        .select({ count: count() })
        .from(integrations) // We don't have a sent_events table; use a heuristic
        // For now, use bounce count vs total connected integrations as proxy
        .where(eq(integrations.connected, true));

      const total = Math.max(Number(sentResult[0]?.count || 1), 1);

      // Better: bounce rate = bounces / (bounces + non-bounces)
      // Since we don't have total sends easily, use a proxy:
      // Assume each connected integration sends ~50 emails/day on average
      const estimatedSends = total * 50 * (this.alertConfig.bounceRateWindowHours / 24);
      return bounceCount / Math.max(estimatedSends, 1);
    } catch (err: any) {
      log.error('Bounce rate calculation failed', { error: err.message });
      return null;
    }
  }

  /** Fire an alert (with cooldown to prevent spam) */
  private async fireAlert(type: string, context: Record<string, any>): Promise<void> {
    const now = Date.now();
    const lastAlert = this.lastAlertTimestamps.get(type) || 0;

    if (now - lastAlert < this.alertCooldownMs) {
      return; // Cooldown active
    }

    this.lastAlertTimestamps.set(type, now);

    const alert = {
      type,
      severity: type === 'bounce-rate' ? 'critical' : type === 'mailbox-disconnect' ? 'warning' : 'warning',
      timestamp: new Date().toISOString(),
      ...context,
    };

    log.error(`🚨 SRE ALERT: ${type}`, alert);

    // Write alert to Redis for dashboard consumption
    const redis = await getRedisClient();
    if (redis) {
      await redis.lPush('alerts:active', JSON.stringify(alert));
      await redis.lTrim('alerts:active', 0, 99); // Keep last 100
      await redis.expire('alerts:active', 86400); // 24h TTL
    }

    // TODO: Integrate with PagerDuty / Slack / SNS here
    // Example:
    // await sendSlackNotification(`🚨 ALERT: ${type}\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``);
  }

  /** Start the monitor loop (call once from a long-running worker) */
  startMonitoring(intervalMs: number = 60_000): NodeJS.Timeout {
    log.info('Health monitor started', { intervalMs, config: this.alertConfig });
    const timer = setInterval(() => this.checkAndAlert(), intervalMs);
    // Run immediately
    this.checkAndAlert().catch(() => {});
    return timer;
  }
}
