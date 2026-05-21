/**
 * ─── SERVICE: SOCIAL SYNC ─────────────────────────────────────────────────────
 *
 * Entry point for Railway worker: start:worker:social
 *
 * Responsibilities:
 *  - Instagram DM real-time sync
 *  - Facebook / Instagram webhook event processing
 *  - Social platform comment monitoring
 * ─────────────────────────────────────────────────────────────────────────────
 */

import '@services/api-gateway/src/core/bootstrap.js';

import { createLogger } from '@services/api-gateway/src/core/logger.js';
import { startWorkerHealthServer } from '@services/api-gateway/src/core/worker-health-server.js';
import { Worker, Job } from 'bullmq';
import { redisConnection, hasRedis } from '@shared/lib/queues/redis-config.js';
import { workerHealthMonitor } from '@shared/lib/monitoring/worker-health.js';
import { quotaService } from '@shared/lib/monitoring/quota-service.js';

const log = createLogger('SOCIAL-SYNC');

async function startSocialService() {
  log.info('📱 Social Sync Service starting...');

  startWorkerHealthServer('social-sync', parseInt(process.env.SOCIAL_WORKER_PORT || process.env.PORT || '8084', 10));

  workerHealthMonitor.registerWorker('Instagram DM Sync');

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

  const [{ instagramSyncWorker }] = await Promise.all([
    import("./workers/instagram-sync-worker.js"),
  ]);

  await startWorker('Instagram DM Sync', () => instagramSyncWorker.start());

  // ── BullMQ Worker ─────────────────────────────────────────────────────────
  if (hasRedis && redisConnection) {
    const bullWorker = new Worker(
      'audnix-social-sync',
      async (job: Job) => {
        const { type, userId } = job.data;
        log.info('Processing job', { type, userId, jobId: job.id });

        if (quotaService.isRestricted()) throw new Error('DB quota restricted — will retry');

        switch (type) {
          case 'instagram-dm-sync':
            await (instagramSyncWorker as any).syncUser?.(userId);
            break;
          default:
            log.warn('Unknown social job type', { type });
        }
      },
      {
        connection: redisConnection as any,
        concurrency: 5,
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      } as any
    );

    bullWorker.on('completed', job => log.info('Job done', { jobId: job.id }));
    bullWorker.on('failed',    (job, err) => log.error('Job failed', { jobId: job?.id, error: err.message }));

    log.info('✅ BullMQ social worker listening on [audnix-social-sync]');
  }

  const shutdown = async (signal: string) => {
    log.info(`🛑 ${signal} — shutting down Social Sync service...`);
    try { instagramSyncWorker.stop(); } catch (_e) {}
    setTimeout(() => process.exit(0), 5000);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  log.info('🚀 Social Sync Service fully online');
}

startSocialService().catch(err => {
  console.error('[SOCIAL-SYNC] Fatal startup error:', err);
  process.exit(1);
});

