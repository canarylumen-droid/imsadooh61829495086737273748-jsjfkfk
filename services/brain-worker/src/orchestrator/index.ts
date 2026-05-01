/**
 * ─── SERVICE: ORCHESTRATOR (THE BRAIN) ────────────────────────────────────────
 *
 * Entry point for Railway worker: start:worker:orchestrator
 *
 * Responsibilities:
 *  - High-level autonomous agent logic
 *  - Multi-channel orchestration (Email + Instagram + SMS)
 *  - Strategic decision making (calling specialized AI services)
 *  - Dispatching tasks to downstream workers (Outreach, Sync, etc.)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import '../../core/bootstrap.js';

import { createLogger } from '@services/api-gateway/src/core/logger.js';
import { startWorkerHealthServer } from '@services/api-gateway/src/core/worker-health-server.js';
import { Worker, Job } from 'bullmq';
import { redisConnection, hasRedis } from '@shared/lib/redis/redis.js';
import { workerHealthMonitor } from '@shared/lib/monitoring/worker-health.js';
import { quotaService } from '@shared/lib/monitoring/quota-service.js';

const log = createLogger('ORCHESTRATOR');

async function startOrchestratorService() {
  log.info('🧠 Orchestrator Service (The Brain) starting...');

  startWorkerHealthServer('orchestrator', parseInt(process.env.ORCHESTRATOR_WORKER_PORT || process.env.PORT || '8086', 10));

  workerHealthMonitor.registerWorker('Autonomous Brain');

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

  // ── Load AI Agent logic ───────────────────────────────────────────────────
  const { MultiChannelOrchestrator } = await import("@shared/lib/multi-channel-orchestrator.js");
  const { universalSalesAgent } = await import('./agents/universal-sales-agent-integrated.js');

  await startWorker('Universal Sales Agent', () => (universalSalesAgent as any).start?.());

  // ── BullMQ Worker: The Brain ──────────────────────────────────────────────
  if (hasRedis && redisConnection) {
    const brainWorker = new Worker(
      'audnix-orchestrator',
      async (job: Job) => {
        const { type, userId, data } = job.data;
        log.info('🧠 Processing strategic decision', { type, userId, jobId: job.id });

        if (quotaService.isRestricted()) throw new Error('DB quota restricted — will retry');

        switch (type) {
          case 'analyze-conversation':
            log.reasoning('Analyzing conversation history to identify user intent and potential objections.', { userId, platform: data.platform });
            await (MultiChannelOrchestrator as any).processInboxSync?.(data.userId, data.platform);
            break;
          case 'determine-next-action':
            log.reasoning('Evaluating current lead state against campaign goals to determine the next best action.', { leadId: data.leadId });
            await (universalSalesAgent as any).evaluateNextBestAction?.(data.leadId, data.summary);
            break;
          case 'strategic-followup':
            log.reasoning('Calculating optimal timing and channel for the next follow-up message.', { userId });
            await (MultiChannelOrchestrator as any).dispatchFollowUps?.(userId);
            break;
          case 'handle-high-priority-objection':
            log.reasoning('High-priority objection detected. Formulating a strategic response to overcome the barrier.', { leadId: data.leadId, sentiment: data.sentiment });
            // Logic to handle specific objections would go here
            break;
          default:
            log.warn('Unknown strategic job type', { type });
        }
      },
      {
        connection: redisConnection as any,
        concurrency: 20, // Brain can handle many concurrent "thinking" tasks
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      } as any
    );

    brainWorker.on('completed', job => log.info('🧠 Decision complete', { jobId: job.id }));
    brainWorker.on('failed',    (job, err) => log.error('🧠 Brain error', { jobId: job?.id, error: err.message }));

    log.info('✅ BullMQ orchestrator worker listening on [audnix-orchestrator]');
  }

  const shutdown = async (signal: string) => {
    log.info(`🛑 ${signal} — shutting down Orchestrator service...`);
    // Graceful cleanup here
    setTimeout(() => process.exit(0), 5000);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  log.info('🚀 Orchestrator Service (The Brain) fully online');
}

startOrchestratorService().catch(err => {
  console.error('[ORCHESTRATOR] Fatal startup error:', err);
  process.exit(1);
});


