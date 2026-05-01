/**
 * ─── SERVICE: AUDIT (OBSERVABILITY & REASONING) ────────────────────────────────
 *
 * Entry point for Railway worker: start:worker:audit
 *
 * Responsibilities:
 *  - Logging detailed agent reasoning steps
 *  - Event history tracking (Audit Trail)
 *  - Performance monitoring of AI tasks
 *  - Auditable transparency for autonomous actions
 * ─────────────────────────────────────────────────────────────────────────────
 */

import '../../core/bootstrap.js';

import { createLogger } from '@services/api-gateway/src/core/logger.js';
import { startWorkerHealthServer } from '@services/api-gateway/src/core/worker-health-server.js';
import { Worker, Job } from 'bullmq';
import { redisConnection, hasRedis } from '@shared/lib/redis/redis.js';
import { workerHealthMonitor } from '@shared/lib/monitoring/worker-health.js';

const log = createLogger('AUDIT');

async function startAuditService() {
  log.info('👁️ Audit Service (Observability) starting...');

  startWorkerHealthServer('audit', parseInt(process.env.AUDIT_WORKER_PORT || process.env.PORT || '8088', 10));

  workerHealthMonitor.registerWorker('Audit Tracker');

  // ── Load Audit logic ──────────────────────────────────────────────────────
  const { AuditTrailService } = await import('../../lib/monitoring/audit-trail-service.js');

  // ── BullMQ Worker: Audit Logging ──────────────────────────────────────────
  if (hasRedis && redisConnection) {
    const auditWorker = new Worker(
      'audnix-audit',
      async (job: Job) => {
        const { type, userId, event, reasoning, data } = job.data;
        log.info('👁️ Tracking event', { type, userId, event });

        switch (type) {
          case 'log-reasoning':
            await AuditTrailService.logReasoning({
              userId: userId || 'system',
              leadId: job.data.leadId || data?.leadId || null,
              event: event || 'ai_decision',
              reasoning: reasoning || job.data.message,
              ...data
            });
            break;
          case 'log-event':
            await AuditTrailService.logEvent({
              userId: userId || 'system',
              event: event || 'system_update',
              ...data
            });
            break;
          default:
            log.warn('Unknown audit job type', { type });
        }
      },
      {
        connection: redisConnection as any,
        concurrency: 20, // Reduced from 50 to avoid DB pressure during bursts
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 2000 },
      } as any
    );

    auditWorker.on('failed', (job, err) => log.error('👁️ Audit failure', { jobId: job?.id, error: err.message }));

    log.info('✅ BullMQ audit worker listening on [audnix-audit]');
  }

  const shutdown = async (signal: string) => {
    log.info(`🛑 ${signal} — shutting down Audit service...`);
    setTimeout(() => process.exit(0), 5000);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  log.info('🚀 Audit Service (Observability) fully online');
}

startAuditService().catch(err => {
  console.error('[AUDIT] Fatal startup error:', err);
  process.exit(1);
});

