/**
 * ─── SERVICE: BILLING ─────────────────────────────────────────────────────────
 *
 * Entry point for Railway worker: start:worker:billing
 *
 * Responsibilities:
 *  - Stripe payment auto-approval
 *  - Checkout session processing
 *  - Subscription lifecycle management
 * ─────────────────────────────────────────────────────────────────────────────
 */

import '@services/api-gateway/src/core/bootstrap.js';

import { createLogger } from '@services/api-gateway/src/core/logger.js';
import { startWorkerHealthServer } from '@services/api-gateway/src/core/worker-health-server.js';
import { Worker, Job } from 'bullmq';
import { redisConnection, hasRedis } from '@shared/lib/queues/redis-config.js';
import { workerHealthMonitor } from '@shared/lib/monitoring/worker-health.js';
import { startHeartbeat } from '@shared/lib/monitoring/health-heartbeat.js';
import { ServiceRegistry } from '@shared/lib/monitoring/service-registry.js';

const log = createLogger('BILLING');

// ─── Global Process Safety Net ─────────────────────────────────────────────
process.on('unhandledRejection', (reason: any) => {
  log.error('🚨 unhandledRejection', { reason: reason?.message || String(reason) });
});
process.on('uncaughtException', (err: Error) => {
  log.error('🚨 uncaughtException — shutting down gracefully', { error: err.message, stack: err.stack });
  setTimeout(() => process.exit(1), 1500);
});

const serviceRegistry = new ServiceRegistry(process.env.REDIS_URL || 'redis://localhost:6379', 'billing-service');

async function startBillingService() {
  await serviceRegistry.register({ version: '1.0.0' });
  log.info('💳 Billing Service starting...');

  startWorkerHealthServer('billing', parseInt(process.env.BILLING_WORKER_PORT || process.env.PORT || '8085', 10));

  ['Payment Auto-Approval', 'Checkout Worker'].forEach(n =>
    workerHealthMonitor.registerWorker(n)
  );

  const startWorker = async (name: string, startFn: () => any) => {
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

  const [{ paymentAutoApprovalWorker }, { checkoutWorker }] = await Promise.all([
    import('@services/billing-service/src/billing-lib/payment-auto-approval-worker.js'),
    import("./workers/checkout-worker.js"),
  ]);

  await startWorker('Payment Auto-Approval', () => paymentAutoApprovalWorker.start());
  await startWorker('Checkout Worker',        () => (checkoutWorker as any).start?.());

  // ── BullMQ Worker ─────────────────────────────────────────────────────────
  let bullWorker: Worker | null = null;
  if (hasRedis && redisConnection) {
    bullWorker = new Worker(
      'audnix-billing',
      async (job: Job) => {
        const { type, data } = job.data;
        log.info('Processing job', { type, jobId: job.id });

        switch (type) {
          case 'stripe-webhook':
            await (paymentAutoApprovalWorker as any).processEvent?.(data);
            break;
          case 'pending-payment':
            await checkoutWorker.processPendingPayment(job.data.paymentId);
            break;
          case 'checkout-session':
            await (checkoutWorker as any).processSession?.(data);
            break;
          default:
            log.warn('Unknown billing job type', { type });
        }
      },
      {
        connection: redisConnection as any,
        concurrency: 2, // Billing: low concurrency by design
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 2000 }, // Keep many failures for audit trail
      } as any
    );

    bullWorker.on('completed', job => log.info('Job done', { jobId: job.id }));
    // Billing failures are critical — log full job data for debugging
    bullWorker.on('failed', (job, err) =>
      log.error('Job FAILED — review required', {
        jobId: job?.id, type: job?.data?.type, error: err.message,
      })
    );

    log.info('✅ BullMQ billing worker listening on [audnix-billing]');
  }

  // ── Health heartbeat ──────────────────────────────────────────────────────
  startHeartbeat('billing-service', () => ({ bullmqActive: !!bullWorker }));

  const shutdown = async (signal: string) => {
    log.info(`🛑 ${signal} — shutting down Billing service...`);
    try { await serviceRegistry.deregister(); } catch (_e) {}
    try { paymentAutoApprovalWorker.stop(); } catch (_e) {}
    try { if (bullWorker) await bullWorker.close(); } catch (_e) {}
    log.info('Billing service shutdown complete');
    if (process.env.UNIFIED_MODE !== 'true') process.exit(0);
  };
  if (process.env.UNIFIED_MODE !== 'true') {
    process.on('SIGTERM', async () => { await shutdown('SIGTERM'); });
    process.on('SIGINT',  async () => { await shutdown('SIGINT'); });
  }

  log.info('🚀 Billing Service fully online');
}

export { startBillingService };

if (process.env.UNIFIED_MODE !== 'true') {
  startBillingService().catch(err => {
    console.error('[BILLING] Fatal startup error:', err);
    process.exit(1);
  });
}

