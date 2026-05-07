/**
 * ─── SERVICE: AI AGENT ────────────────────────────────────────────────────────
 *
 * Entry point for Railway worker: start:worker:ai
 *
 * Responsibilities:
 *  - Lead enrichment (Google search + Gemini synthesis)
 *  - Autonomous closing conversations
 *  - Post-mortem deal analysis
 *  - Cold re-engagement campaigns
 *  - Follow-up queue processing
 *  - Video comment monitoring + AI replies
 *  - AI budget monitoring
 *  - Objection intelligence extraction (every 4h across all users)
 *
 * If this service crashes, emails keep syncing and the API keeps serving.
 * Jobs stay in Redis and are retried when this service recovers.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import '@services/api-gateway/src/core/bootstrap.js';

import { createLogger } from '@services/api-gateway/src/core/logger.js';
import { startWorkerHealthServer } from '@services/api-gateway/src/core/worker-health-server.js';
import { Worker, Job } from 'bullmq';
import { redisConnection, hasRedis } from '@shared/lib/queues/redis-config.js';
import { workerHealthMonitor } from '@shared/lib/monitoring/worker-health.js';
import { quotaService } from '@shared/lib/monitoring/quota-service.js';
import { db } from '@shared/lib/db/db.js';
import { users } from '@audnix/shared';

const log = createLogger('AI-AGENT');

async function startAIService() {
  log.info('🤖 AI Agent Service starting...');

  startWorkerHealthServer('ai-agent', parseInt(process.env.AI_WORKER_PORT || process.env.PORT || '8082', 10));

  if (!process.env.GEMINI_API_KEY) {
    log.warn('⚠️ GEMINI_API_KEY not set — AI features will degrade gracefully');
  }

  // ── Register workers ──────────────────────────────────────────────────────
  [
    'Lead Enrichment', 'Autonomous Closing', 'Cold Re-engagement',
    'Follow-up', 'Post-mortem', 'Video Comment', 'AI Budget Monitor',
  ].forEach(n => workerHealthMonitor.registerWorker(n));

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

  // ── Load all AI workers from lib/ ─────────────────────────────────────────
  const [
    { leadEnrichmentWorker },
    { closingWorker },
    { postMortemWorker },
    { reEngagementWorker },
    { followUpWorker },
    { startVideoCommentMonitoring },
    { aiBudgetWorker },
    { objectionService },
    { ragWorker },
  ] = await Promise.all([
    import('./workers/lead-enrichment-worker.js'),
    import('./workers/closing-worker.js'),
    import('./workers/post-mortem-worker.js'),
    import('./workers/re-engagement-worker.js'),
    import('@services/brain-worker/src/ai-lib/core/follow-up-worker.js'),
    import('@services/brain-worker/src/ai-lib/specialized/video-comment-monitor.js'),
    import('./workers/ai-budget-worker.js'),
    import('@services/brain-worker/src/ai-lib/analyzers/objection-service.js'),
    import('./workers/rag-worker.js'),
  ]);

  await startWorker('Lead Enrichment',    () => leadEnrichmentWorker.start());
  await startWorker('Autonomous Closing', () => closingWorker.start());
  await startWorker('Cold Re-engagement', () => reEngagementWorker.start());
  await startWorker('Follow-up',          () => followUpWorker.start());
  await startWorker('Video Comment',      () => startVideoCommentMonitoring());
  await startWorker('AI Budget Monitor',  () => aiBudgetWorker.start());
  await startWorker('RAG Search Engine',  () => { /* RagWorker starts automatically on import */ });

  // Post-mortem: run now, then hourly
  postMortemWorker.tick();
  setInterval(() => postMortemWorker.tick(), 60 * 60 * 1000);

  // Objection intelligence: sweep all active users every 4 hours
  setInterval(async () => {
    try {
      const allUsers = await db.select({ id: users.id }).from(users);
      for (const u of allUsers) {
        objectionService.extractWinningHandles(u.id).catch(() => {});
      }
      log.info('Objection intelligence sweep complete', { userCount: allUsers.length });
    } catch (e: any) {
      log.warn('Objection scan error', { error: e?.message });
    }
  }, 4 * 60 * 60 * 1000);

  // ── [HARDENING] System 11: Pulse Sweep & Strategy Distillation ──────────────────
  // These were moved from local setInterval (which is volatile) to BullMQ (which is persistent).
  // The persistent trigger is registered in shared/lib/queues/outreach-queue.ts
  // The execution logic is handled in the 'pulse-sweep' and 'distill-patterns' cases below.

  // Strategy distillation and Pulse Sweeps are now handled via persistent BullMQ jobs 
  // registered in outreach-queue.ts or scheduled via the dashboard.

  // ── AI Provider smoke test ────────────────────────────────────────────────
  try {
    const { getAIStatus } = await import('@services/brain-worker/src/ai-lib/core/ai-service.js');
    const s = getAIStatus();
    log.info('AI Engine online', { provider: s.activeProvider });
  } catch (e: any) {
    log.warn('AI smoke test skipped', { error: e?.message });
  }

  // ── BullMQ Worker — handles queue-dispatched AI jobs ─────────────────────
  if (hasRedis && redisConnection) {
    const bullWorker = new Worker(
      'audnix-ai-processing',
      async (job: Job) => {
        const { type, userId, leadId, data } = job.data;
        log.info('Processing job', { type, userId, leadId, jobId: job.id });

        if (quotaService.isRestricted()) throw new Error('DB quota restricted — will retry');

        switch (type) {
          case 'enrich-lead':
            await leadEnrichmentWorker.enrichLead({ id: leadId, userId, ...data });
            break;
          case 'timezone-enrichment':
            const { timezoneEnrichmentWorker } = await import('./workers/timezone-enrichment-worker.js');
            await timezoneEnrichmentWorker.enrichLead({ leadId, userId, ...data });
            break;
          case 'post-mortem-tick':
            await postMortemWorker.tick();
            break;

          case 'objection-scan':
            await objectionService.extractWinningHandles(userId);
            break;
          case 'distill-patterns':
            const { learningWorker: lw } = await import('./workers/learning-worker.js');
            await lw.processRawEpisodes(); 
            await lw.distillGlobalPatterns();
            break;
          case 'pulse-sweep':
            const { AIObserver } = await import('./src/ai-lib/engines/ai-observer.js');
            const allUsers = await db.select({ id: users.id }).from(users);
            for (const u of allUsers) {
               await AIObserver.survey(u.id).catch(e => log.error(`Pulse Sweep failed for ${u.id}`, { error: e.message }));
            }
            log.info('Global Pulse Sweep complete');
            break;
          case 'process-followup-queue':
            await followUpWorker.processQueue();
            break;
          default:
            log.warn('Unknown AI job type', { type });
        }
      },
      {
        connection: redisConnection as any,
        concurrency: 3, // AI jobs are expensive — hard cap
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      } as any
    );

    bullWorker.on('completed', job => log.info('Job done', { jobId: job.id, type: job.data.type }));
    bullWorker.on('failed',    (job, err) => log.error('Job failed', { jobId: job?.id, error: err.message }));

    log.info('✅ BullMQ AI worker listening on [audnix-ai-processing]');
  }

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    log.info(`🛑 ${signal} — shutting down AI Agent service...`);
    try { leadEnrichmentWorker.stop(); } catch (_e) {}
    try { reEngagementWorker.stop(); }   catch (_e) {}
    try { followUpWorker.stop(); }       catch (_e) {}
    try { ragWorker.stop(); }           catch (_e) {}
    setTimeout(() => process.exit(0), 5000);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  log.info('🚀 AI Agent Service fully online');
}

startAIService().catch(err => {
  console.error('[AI-AGENT] Fatal startup error:', err);
  process.exit(1);
});


