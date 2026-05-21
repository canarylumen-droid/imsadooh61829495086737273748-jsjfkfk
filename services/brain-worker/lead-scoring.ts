/**
 * ─── SERVICE: LEAD SCORING ────────────────────────────────────────────────────
 *
 * Entry point for specialized AI worker.
 *
 * Responsibilities:
 *  - Real-time lead qualification
 *  - Intent analysis from past interactions
 *  - Assigning scoring metadata for CRM
 * ─────────────────────────────────────────────────────────────────────────────
 */

import '@services/api-gateway/src/core/bootstrap.js';
import { createLogger } from '@services/api-gateway/src/core/logger.js';
import { startWorkerHealthServer } from '@services/api-gateway/src/core/worker-health-server.js';
import { Worker, Job } from 'bullmq';
import { redisConnection, hasRedis } from '@shared/lib/redis/redis.js';
import { workerHealthMonitor } from '@shared/lib/monitoring/worker-health.js';
import { quotaService } from '@shared/lib/monitoring/quota-service.js';
import { db } from '@shared/lib/db/db.js';
import { leads } from '@audnix/shared';
import { eq } from 'drizzle-orm';

const log = createLogger('AI-LEAD-SCORING');

async function startLeadScoringService() {
  log.info('🎯 Lead Scoring Service starting...');

  startWorkerHealthServer('lead-scoring', parseInt(process.env.LEAD_SCORING_PORT || '8088', 10));
  workerHealthMonitor.registerWorker('Lead Scorer');

  if (hasRedis && redisConnection) {
    const scorerWorker = new Worker(
      'audnix-lead-scoring',
      async (job: Job) => {
        const { leadId, userId, data } = job.data;
        log.info('🎯 Scoring lead', { leadId, jobId: job.id });
        log.reasoning('Evaluating lead profile and recent interactions for score calculation', { leadId });

        if (quotaService.isRestricted()) throw new Error('DB quota restricted — will retry');

        try {
          const { analyzeLeadIntent } = await import('@services/brain-worker/src/ai-lib/analyzers/intent-analyzer.js');
          const scoringResult: any = await analyzeLeadIntent(leadId, data);

          log.reasoning(`Lead score calculated: ${scoringResult.score}/100. Intent: ${scoringResult.intent}`, { leadId });

          // Update CRM via internal task (or direct DB for now, moving to internal-crm queue later)
          await db.update(leads)
            .set({ 
              score: scoringResult.score,
              status: scoringResult.score > 70 ? 'qualified' : 'cold',
              lastEnrichedAt: new Date()
            })
            .where(eq(leads.id, leadId));

          log.info('✅ Lead scoring complete', { leadId, score: scoringResult.score });
        } catch (err: any) {
          log.error('❌ Lead scoring failed', { leadId, error: err.message });
          throw err;
        }
      },
      {
        connection: redisConnection as any,
        concurrency: 5,
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      } as any
    );

    scorerWorker.on('completed', job => log.info('🎯 Scoring job done', { jobId: job.id }));
    scorerWorker.on('failed', (job, err) => log.error('🎯 Scoring job failed', { jobId: job?.id, error: err.message }));
  }

  log.info('🚀 Lead Scoring Service fully online');
}

startLeadScoringService().catch(err => {
  console.error('[LEAD-SCORING] Fatal startup error:', err);
  process.exit(1);
});
