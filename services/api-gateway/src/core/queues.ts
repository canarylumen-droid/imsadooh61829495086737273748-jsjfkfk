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
 * If a consumer service crashes, jobs stay in Redis and are retried when it
 * comes back online. Other services are completely unaffected.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Queue, QueueEvents } from 'bullmq';
import { redisConnection, hasRedis } from '@shared/lib/queues/redis-config.js';

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

// ── Queue: Email Sync ──────────────────────────────────────────────────────────
// Consumed by: server/services/email/index.ts
// Producers: API routes triggering manual syncs, IMAP idle push events
export const emailSyncQueue = hasRedis
  ? new Queue('audnix-email-sync', {
      connection: redisConnection as any,
      defaultJobOptions,
    })
  : null;

// ── Queue: Outreach ────────────────────────────────────────────────────────────
// Consumed by: server/services/outreach/index.ts
// Producers: Campaign scheduler, follow-up engine
export const outreachQueue = hasRedis
  ? new Queue('audnix-outreach', {
      connection: redisConnection as any,
      defaultJobOptions: { ...defaultJobOptions, attempts: 5 },
    })
  : null;

// ── Queue: AI Processing ───────────────────────────────────────────────────────
// Consumed by: server/services/ai/index.ts
// Producers: Lead import, enrichment trigger routes, post-mortem scheduler
export const aiProcessingQueue = hasRedis
  ? new Queue('audnix-ai-processing', {
      connection: redisConnection as any,
      defaultJobOptions,
    })
  : null;

// ── Queue: Social Sync ─────────────────────────────────────────────────────────
// Consumed by: server/services/social/index.ts
// Producers: Instagram webhook handlers, scheduled comment syncs
export const socialSyncQueue = hasRedis
  ? new Queue('audnix-social-sync', {
      connection: redisConnection as any,
      defaultJobOptions,
    })
  : null;

// ── Queue: Billing ─────────────────────────────────────────────────────────────
// Consumed by: server/services/billing/index.ts
// Producers: Stripe webhook, payment route
export const billingQueue = hasRedis
  ? new Queue('audnix-billing', {
      connection: redisConnection as any,
      defaultJobOptions: { ...defaultJobOptions, attempts: 10 }, // Payment jobs must not be dropped
    })
  : null;

// ── Queue: Notifications ───────────────────────────────────────────────────────
// Consumed by: server/index.ts (API Gateway process)
// Producers: All services publishing alerts to users
export const notificationsQueue = hasRedis
  ? new Queue('audnix-notifications', {
      connection: redisConnection as any,
      defaultJobOptions: { ...defaultJobOptions, removeOnComplete: { count: 200 } },
    })
  : null;

// ── Queue: Orchestrator (The Brain) ──────────────────────────────────────────
// Consumed by: server/services/orchestrator/index.ts
// Producers: API, Email Sync, Social Sync (dispatching high-level tasks)
export const orchestratorQueue = hasRedis
  ? new Queue('audnix-orchestrator', {
      connection: redisConnection as any,
      defaultJobOptions: { ...defaultJobOptions, attempts: 5 },
    })
  : null;

// ── Queue: Knowledge (RAG / Vector DB) ────────────────────────────────────────
// Consumed by: server/services/knowledge/index.ts
// Producers: Lead import, Orchestrator (requesting brand context / RAG)
export const knowledgeQueue = hasRedis
  ? new Queue('audnix-knowledge', {
      connection: redisConnection as any,
      defaultJobOptions,
    })
  : null;

// ── Queue: Audit (Event Logs / Reasoning) ─────────────────────────────────────
// Consumed by: server/services/audit/index.ts
// Producers: All services (logging detailed reasoning steps for audit)
export const auditQueue = hasRedis
  ? new Queue('audnix-audit', {
      connection: redisConnection as any,
      defaultJobOptions: { ...defaultJobOptions, removeOnComplete: { count: 1000 } },
    })
  : null;


// ── Queue: Lead Scoring ───────────────────────────────────────────────────────
// Consumed by: server/services/ai/lead-scoring.ts
// Producers: Lead import, Orchestrator
export const leadScoringQueue = hasRedis
  ? new Queue('audnix-lead-scoring', {
      connection: redisConnection as any,
      defaultJobOptions,
    })
  : null;

// ── Queue: Sentiment Analysis ────────────────────────────────────────────────
// Consumed by: server/services/ai/sentiment-service.ts
// Producers: Email Sync, Social Sync, Orchestrator
export const sentimentAnalysisQueue = hasRedis
  ? new Queue('audnix-sentiment-analysis', {
      connection: redisConnection as any,
      defaultJobOptions,
    })
  : null;

// ── Queue: Internal CRM ──────────────────────────────────────────────────────
// Consumed by: server/services/crm/index.ts
// Producers: All services (replacing direct DB writes where possible)
export const internalCrmQueue = hasRedis
  ? new Queue('audnix-internal-crm', {
      connection: redisConnection as any,
      defaultJobOptions,
    })
  : null;


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
} as const;


/**
 * Get health status for all queues (for /health endpoint)
 */
export async function getQueueHealthStatus(): Promise<Record<string, any>> {
  const results: Record<string, any> = {};

  for (const [name, queue] of Object.entries(ALL_QUEUES)) {
    if (!queue) {
      results[name] = { status: 'disabled', reason: 'No Redis' };
      continue;
    }
    try {
      const [waiting, active, failed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getFailedCount(),
      ]);
      results[name] = { status: 'ok', waiting, active, failed };
    } catch (err: any) {
      results[name] = { status: 'error', error: err.message };
    }
  }

  return results;
}

if (hasRedis) {
  console.log('✅ [Core Queues] All BullMQ queues registered on Redis');
} else {
  console.warn('⚠️ [Core Queues] Redis not configured — all queues DISABLED. Workers will fall back to in-process intervals.');
}

