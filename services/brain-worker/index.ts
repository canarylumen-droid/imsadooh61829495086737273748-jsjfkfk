/**
 * ─── SERVICE: AI AGENT ────────────────────────────────────────────────────────
 */

import '@services/api-gateway/src/core/bootstrap.js';

import { createLogger } from '@services/api-gateway/src/core/logger.js';
import { startWorkerHealthServer } from '@services/api-gateway/src/core/worker-health-server.js';
import { Worker, Job } from 'bullmq';
import { redisConnection, hasRedis } from '@shared/lib/queues/redis-config.js';
import { workerHealthMonitor } from '@shared/lib/monitoring/worker-health.js';
import { startMemoryWatchdog } from '@shared/lib/monitoring/memory-watchdog.js';
import { startHeartbeat } from '@shared/lib/monitoring/health-heartbeat.js';
import { ServiceRegistry } from '@shared/lib/monitoring/service-registry.js';

// Start resilience layers
startMemoryWatchdog(Number(process.env.HEAP_LIMIT_MB) || 1024);
import { quotaService } from '@shared/lib/monitoring/quota-service.js';
import { db } from '@shared/lib/db/db.js';
import { users, notifications } from '@audnix/shared';

const log = createLogger('AI-AGENT');

// ─── Global Process Safety Net ─────────────────────────────────────────────
process.on('unhandledRejection', (reason: any) => {
  log.error('🚨 unhandledRejection', { reason: reason?.message || String(reason) });
});
process.on('uncaughtException', (err: Error) => {
  log.error('🚨 uncaughtException — shutting down gracefully', { error: err.message, stack: err.stack });
  setTimeout(() => process.exit(1), 1500);
});

const serviceRegistry = new ServiceRegistry(process.env.REDIS_URL || 'redis://localhost:6379', 'brain-worker');

/**
 * Enterprise DLQ Reporter
 * Automatically notifies the Admin Panel when a critical job fails permanently.
 */
async function reportPermanentFailure(job: Job, err: Error) {
  const { type, userId, leadId } = job.data;
  log.error(`[DLQ] Job ${job.id} failed permanently:`, { type, error: err.message });

  if (userId) {
    await db.insert(notifications).values({
      userId,
      type: 'webhook_error',
      title: 'Critical Job Failed 🚨',
      message: `System failed to process ${type} for lead ${leadId || 'unknown'}. Manual review recommended.`,
      metadata: { jobId: job.id, type, error: err.message, leadId }
    }).catch(e => log.error('Failed to log DLQ notification', e));
  }
}

async function startAIService() {
  await serviceRegistry.register({ version: '1.0.0' });
  log.info('🤖 AI Agent Service starting...');

  const enabledWorkers = process.env.START_WORKERS ? process.env.START_WORKERS.split(',').map(w => w.trim().toLowerCase()) : ['all'];
  const isEnabled = (name: string) => enabledWorkers.includes('all') || enabledWorkers.includes(name.toLowerCase().replace(/\s+/g, '-'));

  startWorkerHealthServer('ai-agent', parseInt(process.env.AI_WORKER_PORT || process.env.PORT || '8082', 10));

  // ── Register workers ──────────────────────────────────────────────────────
  [
    'Lead Enrichment', 'Autonomous Closing', 'Cold Re-engagement',
    'Follow-up', 'Post-mortem', 'Video Comment', 'AI Budget Monitor',
    'Fathom Processing', 'Calendly Processing', 'Billing Dispatch'
  ].filter(isEnabled).forEach(n => workerHealthMonitor.registerWorker(n));

  const startWorker = async (name: string, startFn: () => any) => {
    if (!isEnabled(name)) return;
    try {
      const result = startFn();
      if (result instanceof Promise) {
        result.catch((err: any) => log.error(`${name} async error`, { error: err?.message }));
      }
      log.info(`${name} ✅ Online`);
    } catch (err: any) {
      log.error(`${name} ❌ Failed`, { error: err?.message });
    }
  };

  // ── Load all AI workers ───────────────────────────────────────────────────
  // We still load them all for now to keep the code simple, but only start the enabled ones
  const [
    { leadEnrichmentWorker },
    { closingWorker },
    { postMortemWorker },
    { reEngagementWorker },
    { followUpWorker },
    { startVideoCommentMonitoring },
    { aiBudgetWorker },
    { ragWorker },
    { checkoutWorker },
  ] = await Promise.all([
    import('./workers/lead-enrichment-worker.js'),
    import('./workers/closing-worker.js'),
    import('./workers/post-mortem-worker.js'),
    import('./workers/re-engagement-worker.js'),
    import('@services/brain-worker/src/ai-lib/core/follow-up-worker.js'),
    import('@services/brain-worker/src/ai-lib/specialized/video-comment-monitor.js'),
    import('./workers/ai-budget-worker.js'),
    import('./workers/rag-worker.js'),
    import('@services/billing-service/src/billing/workers/checkout-worker.js'),
  ]);

  await startWorker('Lead Enrichment',    () => leadEnrichmentWorker.start());
  await startWorker('Autonomous Closing', () => closingWorker.start());
  await startWorker('Cold Re-engagement', () => reEngagementWorker.start());
  await startWorker('Post-mortem',        () => postMortemWorker.start());
  await startWorker('Follow-up',          () => followUpWorker.start());
  await startWorker('Video Comment',      () => startVideoCommentMonitoring());
  await startWorker('AI Budget Monitor',  () => aiBudgetWorker.start());
  await startWorker('Billing Dispatch',   () => checkoutWorker.start());

  let fathomWorker: Worker | null = null;
  let calendlyWorker: Worker | null = null;
  let billingWorker: Worker | null = null;

  if (hasRedis && redisConnection) {
    // ── Fathom Meeting Worker ───────────────────────────────────────────────
    if (isEnabled('Fathom Processing')) {
      const { processFathomWebhook } = await import('@services/brain-worker/src/ai-lib/specialized/fathom-integration.js');
      fathomWorker = new Worker(
        'fathom-processing',
        async (job: Job) => { await processFathomWebhook(job.data); },
        { 
          connection: redisConnection as any, 
          concurrency: parseInt(process.env.FATHOM_CONCURRENCY || '5', 10) 
        }
      );
      fathomWorker.on('failed', (job, err) => {
        if (job && job.attemptsMade >= (job.opts.attempts || 1)) reportPermanentFailure(job, err);
      });
      log.info('Fathom Processing ✅ Online');
    }

    // ── Calendly Booking Worker ─────────────────────────────────────────────
    if (isEnabled('Calendly Processing')) {
      const { processCalendlyWebhook } = await import('@services/brain-worker/src/ai-lib/specialized/calendly-integration.js');
      calendlyWorker = new Worker(
        'calendly-processing',
        async (job: Job) => { await processCalendlyWebhook(job.data); },
        { 
          connection: redisConnection as any, 
          concurrency: parseInt(process.env.CALENDLY_CONCURRENCY || '10', 10) 
        }
      );
      calendlyWorker.on('failed', (job, err) => {
        if (job && job.attemptsMade >= (job.opts.attempts || 1)) reportPermanentFailure(job, err);
      });
      log.info('Calendly Processing ✅ Online');
    }

    // ── Billing / Checkout Worker ───────────────────────────────────────────
    if (isEnabled('Billing Dispatch')) {
      billingWorker = new Worker(
        'audnix-billing',
        async (job: Job) => {
          const { type, paymentId } = job.data;
          if (type === 'pending-payment' && paymentId) await checkoutWorker.processPendingPayment(paymentId);
        },
        { 
          connection: redisConnection as any, 
          concurrency: parseInt(process.env.BILLING_CONCURRENCY || '5', 10) 
        }
      );
      billingWorker.on('failed', (job, err) => {
        if (job && job.attemptsMade >= (job.opts.attempts || 1)) reportPermanentFailure(job, err);
      });
      log.info('Billing Dispatch ✅ Online');
    }

    log.info('✅ Enterprise Webhook & Billing workers fully listening with DLQ monitoring');
  }

  // ── Health heartbeat ──────────────────────────────────────────────────────
  startHeartbeat('brain-worker');

  const shutdown = async (signal: string) => {
    log.info(`🛑 ${signal} — shutting down AI Agent service...`);
    try { await serviceRegistry.deregister(); } catch (_e) {}
    try { leadEnrichmentWorker.stop(); } catch (_e) {}
    try { reEngagementWorker.stop(); }   catch (_e) {}
    try { postMortemWorker.stop(); }     catch (_e) {}
    try { followUpWorker.stop(); }       catch (_e) {}
    try { ragWorker.stop(); }           catch (_e) {}
    if (fathomWorker) await fathomWorker.close().catch(err => console.error('[Brain Worker] Fathom worker shutdown failed:', err));
    if (calendlyWorker) await calendlyWorker.close().catch(err => console.error('[Brain Worker] Calendly worker shutdown failed:', err));
    if (billingWorker) await billingWorker.close().catch(err => console.error('[Brain Worker] Billing worker shutdown failed:', err));
    if (process.env.UNIFIED_MODE !== 'true') process.exit(0);
  };
  if (process.env.UNIFIED_MODE !== 'true') {
    process.on('SIGTERM', async () => { await shutdown('SIGTERM'); });
    process.on('SIGINT',  async () => { await shutdown('SIGINT'); });
  }

  log.info('🚀 AI Agent Service fully online');
}

export { startAIService };

if (process.env.UNIFIED_MODE !== 'true') {
  startAIService().catch(err => {
    console.error('[AI-AGENT] Fatal startup error:', err);
    process.exit(1);
  });
}

