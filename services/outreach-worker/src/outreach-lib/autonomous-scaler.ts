import { db } from '@shared/lib/db/db.js';
import { integrations, campaignEmails } from '@audnix/shared';
import { eq, and, sql, gte } from 'drizzle-orm';
import { storage } from '@shared/lib/storage/storage.js';
import { getQueueBacklogSnapshot, type QueueBacklogMetric } from '@services/api-gateway/src/core/queues.js';
import { startWorkerHealthServer } from '@services/api-gateway/src/core/worker-health-server.js';
import { connectMySql, hasMySqlUri, getLeadRecoveryBacklog as getMySqlLeadRecoveryBacklog } from '@shared/lib/mysql.js';

type QueueSnapshot = Awaited<ReturnType<typeof getQueueBacklogSnapshot>>;

interface RailwayScaleTarget {
  service: string;
  queues: string[];
  backlogSource?: 'bullmq' | 'lead-recovery-mysql';
  webhookUrl?: string;
  minReplicas: number;
  maxReplicas: number;
  scaleUpAt: number;
  scaleDownAt: number;
  step: number;
}

interface RailwayScaleState {
  replicas: number;
  lastChangedAt: number;
  lastBacklog: number;
}

function readInt(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) ? value : fallback;
}

function readWebhook(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

/**
 * MailboxDeliveryLimitScaler adjusts human-like mailbox send limits only.
 * It never starts, stops, or sizes infrastructure containers.
 */
export class AutonomousScalerService {
  static async runOptimizationCycle(): Promise<void> {
    console.log('[MailboxDeliveryLimitScaler] Starting daily mailbox optimization cycle...');

    const activeIntegrations = await db.select()
      .from(integrations)
      .where(and(
        eq(integrations.aiAutonomousMode, true),
        eq(integrations.connected, true)
      ));

    for (const integration of activeIntegrations) {
      try {
        await this.optimizeMailbox(integration);
      } catch (err) {
        console.error(`[MailboxDeliveryLimitScaler] Failed to optimize mailbox ${integration.id}:`, err);
      }
    }
  }

  private static async optimizeMailbox(integration: any): Promise<void> {
    const userId = integration.userId;
    const now = new Date();
    const accountAgeDays = Math.floor((now.getTime() - new Date(integration.createdAt).getTime()) / (1000 * 3600 * 24));
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 3600 * 1000);
    const metrics = await this.getMailboxMetrics(integration.id, fourteenDaysAgo);

    let newLimit = integration.dailyLimit || 50;
    const oldLimit = newLimit;
    const safeHardCap = readInt('MAILBOX_DAILY_SAFE_HARD_CAP', 65);
    const safetyFloor = readInt('MAILBOX_DAILY_SAFETY_FLOOR', 20);

    if (metrics.totalSent >= 50 && metrics.openRate >= 0.35 && metrics.replyRate >= 0.05) {
      newLimit = Math.min(safeHardCap, oldLimit + 2);
    } else if (metrics.openRate < 0.25 && metrics.totalSent > 30) {
      newLimit = safetyFloor;
    } else if (metrics.bounceRate > 0.03 || (integration.spamRiskScore || 0) > 0.5) {
      newLimit = Math.max(safetyFloor, Math.floor(newLimit * 0.7));
    } else if (accountAgeDays < 21) {
      const safeCap = 25 + accountAgeDays;
      newLimit = Math.min(newLimit, safeCap);
    }

    newLimit = Math.min(newLimit, safeHardCap);

    // REPUTATION MONITOR GUARD: If the reputation monitor has already adjusted
    // initialOutreachLimit (it won't be the default 50), it owns the sending caps.
    // The scaler must NOT overwrite dailyLimit in this case — the reputation
    // monitor is the single source of truth for throttled mailboxes.
    const reputationActive = (integration.initialOutreachLimit != null && integration.initialOutreachLimit !== 50)
      || (integration.healthLevel && integration.healthLevel !== 'healthy');

    if (newLimit !== oldLimit) {
      if (reputationActive) {
        console.log(`[MailboxDeliveryLimitScaler] Skipping ${integration.id}: reputation monitor is active (initialOutreachLimit=${integration.initialOutreachLimit}, healthLevel=${integration.healthLevel}). Scaler recommends ${newLimit} but defers to reputation authority.`);
      } else {
        await db.update(integrations)
          .set({
            dailyLimit: newLimit,
            updatedAt: new Date()
          })
          .where(eq(integrations.id, integration.id));

        console.log(`[MailboxDeliveryLimitScaler] Adjusted ${integration.id}: ${oldLimit} -> ${newLimit}`);

        await storage.createNotification({
          userId,
          type: 'insight',
          title: 'Mailbox delivery limit adjusted',
          message: `Audnix adjusted your daily mailbox send limit to ${newLimit} based on recent mailbox health.`,
          metadata: { integrationId: integration.id, newLimit, oldLimit }
        });
      }
    }
  }

  private static async getMailboxMetrics(integrationId: string, since: Date) {
    await db.select({
      status: campaignEmails.status,
      count: sql<number>`count(*)`
    })
      .from(campaignEmails)
      .where(and(
        eq(campaignEmails.metadata, sql`${integrationId} = (metadata->>'integrationId')`),
        gte(campaignEmails.sentAt, since)
      ))
      .groupBy(campaignEmails.status)
      .catch(() => []);

    const rawStats = await db.execute(sql`
      SELECT status, count(*) as count
      FROM campaign_emails
      WHERE (metadata->>'integrationId' = ${integrationId} OR metadata->>'integration_id' = ${integrationId})
      AND sent_at >= ${since}
      GROUP BY status
    `);

    let total = 0;
    let opened = 0;
    let replied = 0;
    let bounced = 0;

    rawStats.rows.forEach((row: any) => {
      const count = Number.parseInt(row.count, 10) || 0;
      total += count;
      if (row.status === 'opened' || row.status === 'replied' || row.status === 'clicked') opened += count;
      if (row.status === 'replied') replied += count;
      if (row.status === 'bounced') bounced += count;
    });

    return {
      totalSent: total,
      openRate: total > 0 ? opened / total : 0,
      replyRate: total > 0 ? replied / total : 0,
      bounceRate: total > 0 ? bounced / total : 0
    };
  }
}

/**
 * RailwayQueueAutoscaler is infrastructure-only. It reads BullMQ waiting +
 * delayed backlog and calls Railway scaling webhooks for worker services.
 */
export class RailwayQueueAutoscaler {
  private readonly pollMs = readInt('QUEUE_AUTOSCALER_POLL_MS', 15_000);
  private readonly cooldownMs = readInt('QUEUE_AUTOSCALER_COOLDOWN_MS', 180_000);
  private readonly backlogWarningIntervalMs = readInt('QUEUE_AUTOSCALER_BACKLOG_WARNING_INTERVAL_MS', 300_000);
  private readonly targets: RailwayScaleTarget[];
  private readonly state = new Map<string, RailwayScaleState>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastLeadRecoveryBacklogWarningAt = 0;

  constructor(targets = RailwayQueueAutoscaler.defaultTargets()) {
    this.targets = targets;
    for (const target of targets) {
      this.state.set(target.service, {
        replicas: target.minReplicas,
        lastChangedAt: 0,
        lastBacklog: 0,
      });
    }
  }

  static defaultTargets(): RailwayScaleTarget[] {
    const minReplicas = readInt('QUEUE_AUTOSCALER_MIN_REPLICAS', 1);
    const maxReplicas = readInt('QUEUE_AUTOSCALER_MAX_REPLICAS', 10);
    const scaleUpAt = readInt('QUEUE_AUTOSCALER_SCALE_UP_AT', 100);
    const scaleDownAt = readInt('QUEUE_AUTOSCALER_SCALE_DOWN_AT', 20);

    return [
      {
        service: 'audnix-worker-ai',
        queues: ['aiProcessing', 'leadScoring', 'sentimentAnalysis'],
        webhookUrl: readWebhook('RAILWAY_SCALE_WEBHOOK_AI'),
        minReplicas,
        maxReplicas,
        scaleUpAt,
        scaleDownAt,
        step: 1,
      },
      {
        service: 'audnix-worker-social',
        queues: ['socialSync'],
        webhookUrl: readWebhook('RAILWAY_SCALE_WEBHOOK_SOCIAL'),
        minReplicas,
        maxReplicas,
        scaleUpAt,
        scaleDownAt,
        step: 1,
      },
      {
        service: 'audnix-worker-billing',
        queues: ['billing'],
        webhookUrl: readWebhook('RAILWAY_SCALE_WEBHOOK_BILLING'),
        minReplicas,
        maxReplicas: Math.min(maxReplicas, 4),
        scaleUpAt: Math.max(scaleUpAt, 50),
        scaleDownAt,
        step: 1,
      },
      {
        service: 'audnix-worker-orchestrator',
        queues: ['orchestrator', 'campaignEngine'],
        webhookUrl: readWebhook('RAILWAY_SCALE_WEBHOOK_ORCHESTRATOR'),
        minReplicas,
        maxReplicas,
        scaleUpAt,
        scaleDownAt,
        step: 1,
      },
      {
        service: 'audnix-worker-knowledge',
        queues: ['knowledge', 'vectorOps'],
        webhookUrl: readWebhook('RAILWAY_SCALE_WEBHOOK_KNOWLEDGE'),
        minReplicas,
        maxReplicas: Math.min(maxReplicas, 6),
        scaleUpAt: Math.max(25, Math.floor(scaleUpAt / 2)),
        scaleDownAt: Math.max(5, Math.floor(scaleDownAt / 2)),
        step: 1,
      },
      {
        service: 'audnix-worker-audit',
        queues: ['audit', 'webhookProcessing'],
        webhookUrl: readWebhook('RAILWAY_SCALE_WEBHOOK_AUDIT'),
        minReplicas,
        maxReplicas,
        scaleUpAt: scaleUpAt * 2,
        scaleDownAt: scaleDownAt * 2,
        step: 1,
      },
      {
        service: 'audnix-worker-email',
        queues: ['emailSync', 'emailVerification', 'emailRouting', 'emailReassign'],
        webhookUrl: readWebhook('RAILWAY_SCALE_WEBHOOK_EMAIL'),
        minReplicas,
        maxReplicas,
        scaleUpAt,
        scaleDownAt,
        step: 1,
      },
      {
        service: 'audnix-worker-imap',
        queues: ['mailSync'],
        webhookUrl: readWebhook('RAILWAY_SCALE_WEBHOOK_IMAP'),
        minReplicas,
        maxReplicas,
        scaleUpAt,
        scaleDownAt,
        step: 1,
      },
      {
        service: 'audnix-worker-outreach',
        queues: ['outreach', 'campaignEngine'],
        webhookUrl: readWebhook('RAILWAY_SCALE_WEBHOOK_OUTREACH'),
        minReplicas,
        maxReplicas,
        scaleUpAt,
        scaleDownAt,
        step: 1,
      },
      {
        service: 'audnix-worker-lead-recovery',
        queues: [],
        backlogSource: 'lead-recovery-mysql',
        webhookUrl: readWebhook('RAILWAY_SCALE_WEBHOOK_LEAD_RECOVERY'),
        minReplicas,
        maxReplicas: Math.min(maxReplicas, 20),
        scaleUpAt: Math.max(10, Math.floor(scaleUpAt / 2)),
        scaleDownAt: Math.max(2, Math.floor(scaleDownAt / 4)),
        step: 1,
      },
      {
        service: 'audnix-vector-db',
        queues: ['vectorOps'],
        webhookUrl: readWebhook('RAILWAY_SCALE_WEBHOOK_VECTOR_DB'),
        minReplicas,
        maxReplicas: Math.min(maxReplicas, 6),
        scaleUpAt: Math.max(10, Math.floor(scaleUpAt / 2)),
        scaleDownAt: Math.max(5, Math.floor(scaleDownAt / 2)),
        step: 1,
      },
    ];
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        console.error('[RailwayQueueAutoscaler] tick failed:', err);
      });
    }, this.pollMs);
    this.tick().catch((err) => console.error('[RailwayQueueAutoscaler] initial tick failed:', err));
    console.log('[RailwayQueueAutoscaler] started', {
      pollMs: this.pollMs,
      cooldownMs: this.cooldownMs,
      targets: this.targets.map((target) => target.service),
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const snapshot = await getQueueBacklogSnapshot();
      await Promise.all(this.targets.map((target) => this.evaluateTarget(target, snapshot)));
    } finally {
      this.running = false;
    }
  }

  private async evaluateTarget(target: RailwayScaleTarget, snapshot: QueueSnapshot): Promise<void> {
    const serviceState = this.state.get(target.service);
    if (!serviceState) return;

    const backlog = await this.getTargetBacklog(target, snapshot);
    serviceState.lastBacklog = backlog;

    const now = Date.now();
    if (now - serviceState.lastChangedAt < this.cooldownMs) return;

    let desiredReplicas = serviceState.replicas;
    let reason: 'scale-up' | 'scale-down' | null = null;

    if (backlog >= target.scaleUpAt && serviceState.replicas < target.maxReplicas) {
      const pressureSteps = Math.max(1, Math.floor(backlog / target.scaleUpAt));
      desiredReplicas = Math.min(target.maxReplicas, serviceState.replicas + (target.step * pressureSteps));
      reason = 'scale-up';
    } else if (backlog <= target.scaleDownAt && serviceState.replicas > target.minReplicas) {
      desiredReplicas = Math.max(target.minReplicas, serviceState.replicas - target.step);
      reason = 'scale-down';
    }

    if (!reason || desiredReplicas === serviceState.replicas) return;

    await this.dispatchScaleRequest(target, serviceState.replicas, desiredReplicas, backlog, reason);
    serviceState.replicas = desiredReplicas;
    serviceState.lastChangedAt = now;
  }

  private sumBacklog(queueNames: string[], queues: Record<string, QueueBacklogMetric>): number {
    return queueNames.reduce((total, name) => total + (queues[name]?.backlog || 0), 0);
  }

  private async getTargetBacklog(target: RailwayScaleTarget, snapshot: QueueSnapshot): Promise<number> {
    if (target.backlogSource === 'lead-recovery-mysql') {
      return this.getLeadRecoveryBacklog();
    }

    return this.sumBacklog(target.queues, snapshot.queues);
  }

  private async getLeadRecoveryBacklog(): Promise<number> {
    if (!hasMySqlUri()) return 0;

    try {
      await connectMySql();
      return getMySqlLeadRecoveryBacklog();
    } catch (err) {
      this.warnLeadRecoveryBacklogUnavailable(err);
      return 0;
    }
  }

  private warnLeadRecoveryBacklogUnavailable(err: unknown): void {
    const now = Date.now();
    if (now - this.lastLeadRecoveryBacklogWarningAt < this.backlogWarningIntervalMs) return;

    this.lastLeadRecoveryBacklogWarningAt = now;
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.warn('[RailwayQueueAutoscaler] lead recovery backlog unavailable; treating backlog as 0', {
      error: message,
      retryInMs: this.backlogWarningIntervalMs,
    });
  }

  private async dispatchScaleRequest(
    target: RailwayScaleTarget,
    currentReplicas: number,
    desiredReplicas: number,
    backlog: number,
    reason: 'scale-up' | 'scale-down'
  ): Promise<void> {
    const payload = {
      service: target.service,
      desiredReplicas,
      currentReplicas,
      backlog,
      queues: target.queues,
      reason,
      timestamp: new Date().toISOString(),
    };

    if (!target.webhookUrl) {
      console.warn('[RailwayQueueAutoscaler] webhook not configured; dry-run scale decision', payload);
      return;
    }

    const response = await fetch(target.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.RAILWAY_SCALE_WEBHOOK_TOKEN
          ? { Authorization: `Bearer ${process.env.RAILWAY_SCALE_WEBHOOK_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Railway scale webhook failed for ${target.service}: ${response.status} ${text}`);
    }

    console.log('[RailwayQueueAutoscaler] scale request dispatched', payload);
  }
}

export const railwayQueueAutoscaler = new RailwayQueueAutoscaler();

if (process.env.QUEUE_AUTOSCALER_ENABLED === 'true') {
  startWorkerHealthServer('infra-scaler', parseInt(process.env.INFRA_SCALER_PORT || process.env.PORT || '8090', 10));
  railwayQueueAutoscaler.start();

  const shutdown = (signal: string) => {
    console.log(`[RailwayQueueAutoscaler] ${signal} received; stopping`);
    railwayQueueAutoscaler.stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
