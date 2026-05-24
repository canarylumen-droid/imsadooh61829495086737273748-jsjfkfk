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

const log = createLogger('BILLING');

async function startBillingService() {
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
  if (hasRedis && redisConnection) {
    const bullWorker = new Worker(
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

  const shutdown = async (signal: string) => {
    log.info(`🛑 ${signal} — shutting down Billing service...`);
    try { paymentAutoApprovalWorker.stop(); } catch (_e) {}
    if (process.env.UNIFIED_MODE !== 'true') setTimeout(() => process.exit(0), 5000);
  };
  if (process.env.UNIFIED_MODE !== 'true') {
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));
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

