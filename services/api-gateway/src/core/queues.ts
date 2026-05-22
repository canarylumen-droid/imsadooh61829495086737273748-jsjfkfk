/**
 * ─── AUDNIX CORE QUEUE REGISTRY ───────────────────────────────────────────────
 * 
 * Central definition of all BullMQ queues used across all microservices.
 * Each queue is isolated - workers in different Railway services can connect
 * to these by name and process jobs independently.
 *
 * A queue producer (e.g. the API service) adds jobs.
 * A queue consumer (e.g. the email worker service) processes them.
 * 
 * comes back online. Other services are completely independent.
 */

import { Queue } from 'bullmq';
import { getSharedRedisConnection, hasRedis } from '@shared/lib/queues/redis-config.js';
import {
  bullmqActiveJobs,
  bullmqDelayedJobs,
  bullmqFailedJobs,
  bullmqWaitingJobs,
} from '@shared/lib/monitoring/metrics-service.js';

/**
 * Default robust job options shared by all queues.
 */
const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 5000,
  },
  removeOnComplete: { count: 500 },  // Keep last 500 completed jobs for debugging
  removeOnFail: { count: 1000 },     // Keep last 1000 failed jobs for audit
};

function createLazyQueue(name: string, opts?: any): Queue {
  let instance: Queue | null = null;
  return new Proxy({}, {
    get(target, prop) {
      if (prop === '__closeIfInitialized') {
        return async () => {
          if (instance) {
            await instance.close();
          }
        };
      }
      if (!instance) {
        if (!hasRedis) return undefined;
        instance = new Queue(name, {
          connection: getSharedRedisConnection(),
          ...opts,
        });
      }
      const value = Reflect.get(instance, prop);
      return typeof value === 'function' ? value.bind(instance) : value;
    }
  }) as any as Queue;
}

// ── Queue: Email Sync ──────────────────────────────────────────────────────────
// Consumed by: server/services/email/index.ts
// Producers: API routes triggering manual syncs, IMAP idle push events
export const emailSyncQueue = createLazyQueue('audnix-email-sync', { defaultJobOptions });

// ── Queue: Outreach ────────────────────────────────────────────────────────────
// Consumed by: server/services/outreach/index.ts
// Producers: Campaign scheduler, follow-up engine
export const outreachQueue = createLazyQueue('audnix-outreach', {
  defaultJobOptions: { ...defaultJobOptions, attempts: 5 },
});

// ── Queue: AI Processing ───────────────────────────────────────────────────────
// Consumed by: server/services/ai/index.ts
// Producers: Lead import, enrichment trigger routes, post-mortem scheduler
export const aiProcessingQueue = createLazyQueue('audnix-ai-processing', { defaultJobOptions });

// ── Queue: Social Sync ─────────────────────────────────────────────────────────
// Consumed by: server/services/social/index.ts
// Producers: Instagram webhook handlers, scheduled comment syncs
export const socialSyncQueue = createLazyQueue('audnix-social-sync', { defaultJobOptions });

// ── Queue: Billing ─────────────────────────────────────────────────────────────
// Consumed by: server/services/billing/index.ts
// Producers: Stripe webhook, payment route
export const billingQueue = createLazyQueue('audnix-billing', {
  defaultJobOptions: { ...defaultJobOptions, attempts: 10 }, // Payment jobs must not be dropped
});

// ── Queue: Notifications ───────────────────────────────────────────────────────
// Consumed by: server/index.ts (API Gateway process)
// Producers: All services publishing alerts to users
export const notificationsQueue = createLazyQueue('audnix-notifications', {
  defaultJobOptions: { ...defaultJobOptions, removeOnComplete: { count: 200 } },
});

// ── Queue: Orchestrator (The Brain) ──────────────────────────────────────────
// Consumed by: server/services/orchestrator/index.ts
// Producers: API, Email Sync, Social Sync (dispatching high-level tasks)
export const orchestratorQueue = createLazyQueue('audnix-orchestrator', {
  defaultJobOptions: { ...defaultJobOptions, attempts: 5 },
});

// ── Queue: Knowledge (RAG / Vector DB) ────────────────────────────────────────
// Consumed by: server/services/knowledge/index.ts
// Producers: Lead import, Orchestrator (requesting brand context / RAG)
export const knowledgeQueue = createLazyQueue('audnix-knowledge', { defaultJobOptions });

// ── Queue: Audit (Event Logs / Reasoning) ─────────────────────────────────────
// Consumed by: server/services/audit/index.ts
// Producers: All services (logging detailed reasoning steps for audit)
export const auditQueue = createLazyQueue('audnix-audit', {
  defaultJobOptions: { ...defaultJobOptions, removeOnComplete: { count: 1000 } },
});

// ── Queue: Lead Scoring ───────────────────────────────────────────────────────
// Consumed by: server/services/ai/lead-scoring.ts
// Producers: Lead import, Orchestrator
export const leadScoringQueue = createLazyQueue('audnix-lead-scoring', { defaultJobOptions });

// ── Queue: Sentiment Analysis ────────────────────────────────────────────────
// Consumed by: server/services/ai/sentiment-service.ts
// Producers: Email Sync, Social Sync, Orchestrator
export const sentimentAnalysisQueue = createLazyQueue('audnix-sentiment-analysis', { defaultJobOptions });

// ── Queue: Internal CRM ──────────────────────────────────────────────────────
// Consumed by: server/services/crm/index.ts
// Producers: All services (replacing direct DB writes where possible)
export const internalCrmQueue = createLazyQueue('audnix-internal-crm', { defaultJobOptions });

// Legacy/shared queue names still used by existing workers. They are registered
// here so health checks and autoscalers see the full BullMQ backlog surface.
export const campaignEngineQueue = createLazyQueue('campaign-engine', { defaultJobOptions });
export const mailSyncQueue = createLazyQueue('mailSyncQueue', { defaultJobOptions });
export const vectorOpsQueue = createLazyQueue('vectorOpsQueue', { defaultJobOptions });
export const emailVerificationQueue = createLazyQueue('email-verification', { defaultJobOptions });
export const emailRoutingQueue = createLazyQueue('email-routing', { defaultJobOptions });
export const emailReassignQueue = createLazyQueue('email-reassign', { defaultJobOptions });
export const webhookProcessingQueue = createLazyQueue('webhook-processing', { defaultJobOptions });

/**
 * Registry of all queues for health check reporting
 */
export const ALL_QUEUES = {
  emailSync: emailSyncQueue,
  outreach: outreachQueue,
  aiProcessing: aiProcessingQueue,
  socialSync: socialSyncQueue,
  billing: billingQueue,
  notifications: notificationsQueue,
  orchestrator: orchestratorQueue,
  knowledge: knowledgeQueue,
  audit: auditQueue,
  leadScoring: leadScoringQueue,
  sentimentAnalysis: sentimentAnalysisQueue,
  internalCrm: internalCrmQueue,
  campaignEngine: campaignEngineQueue,
  mailSync: mailSyncQueue,
  vectorOps: vectorOpsQueue,
  emailVerification: emailVerificationQueue,
  emailRouting: emailRoutingQueue,
  emailReassign: emailReassignQueue,
  webhookProcessing: webhookProcessingQueue,
} as const;

export interface QueueBacklogMetric {
  status: 'ok' | 'disabled' | 'error';
  queue: string;
  waiting: number;
  delayed: number;
  active: number;
  failed: number;
  backlog: number;
  error?: string;
}

async function readQueueBacklog(name: string, queue: Queue | undefined): Promise<QueueBacklogMetric> {
  if (!queue || !hasRedis) {
    return {
      status: 'disabled',
      queue: name,
      waiting: 0,
      delayed: 0,
      active: 0,
      failed: 0,
      backlog: 0,
    };
  }

  try {
    const [waiting, delayed, active, failed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getDelayedCount(),
      queue.getActiveCount(),
      queue.getFailedCount(),
    ]);

    return {
      status: 'ok',
      queue: name,
      waiting,
      delayed,
      active,
      failed,
      backlog: waiting + delayed,
    };
  } catch (err: any) {
    return {
      status: 'error',
      queue: name,
      waiting: 0,
      delayed: 0,
      active: 0,
      failed: 0,
      backlog: 0,
      error: err.message,
    };
  }
}

function recordQueueMetric(metric: QueueBacklogMetric): void {
  bullmqWaitingJobs.set({ queue: metric.queue }, metric.waiting);
  bullmqDelayedJobs.set({ queue: metric.queue }, metric.delayed);
  bullmqActiveJobs.set({ queue: metric.queue }, metric.active);
  bullmqFailedJobs.set({ queue: metric.queue }, metric.failed);
}

/**
 * Get health status for all queues (for /health endpoint)
 */
export async function getQueueHealthStatus(): Promise<Record<string, any>> {
  const results: Record<string, any> = {};

  for (const [name, queue] of Object.entries(ALL_QUEUES)) {
    const metric = await readQueueBacklog(name, queue as Queue);
    recordQueueMetric(metric);
    results[name] = metric;
  }

  return results;
}

export async function getQueueBacklogSnapshot(): Promise<{
  totalBacklog: number;
  queues: Record<string, QueueBacklogMetric>;
}> {
  const queues: Record<string, QueueBacklogMetric> = {};
  let totalBacklog = 0;

  for (const [name, queue] of Object.entries(ALL_QUEUES)) {
    const metric = await readQueueBacklog(name, queue as Queue);
    recordQueueMetric(metric);
    queues[name] = metric;
    totalBacklog += metric.backlog;
  }

  return { totalBacklog, queues };
}

if (hasRedis) {
  console.log('✅ [Core Queues] All BullMQ queues registered on Redis');
} else {
  console.warn('⚠️ [Core Queues] Redis not configured — all queues DISABLED. Workers will fall back to in-process intervals.');
}

