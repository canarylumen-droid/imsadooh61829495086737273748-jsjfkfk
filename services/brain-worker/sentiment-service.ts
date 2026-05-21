/**
 * ─── SERVICE: SENTIMENT ANALYSIS ─────────────────────────────────────────────
 *
 * Entry point for specialized AI worker.
 *
 * Responsibilities:
 *  - Real-time sentiment detection (Positive, Negative, Neutral)
 *  - Objection detection in messages
 *  - Urgency detection
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

const log = createLogger('AI-SENTIMENT');

async function startSentimentService() {
  log.info('🎭 Sentiment Analysis Service starting...');

  startWorkerHealthServer('sentiment', parseInt(process.env.SENTIMENT_PORT || '8089', 10));
  workerHealthMonitor.registerWorker('Sentiment Analyzer');

  if (hasRedis && redisConnection) {
    const sentimentWorker = new Worker(
      'audnix-sentiment-analysis',
      async (job: Job) => {
        const { leadId, message, platform } = job.data;
        log.info('🎭 Analyzing sentiment', { leadId, platform, jobId: job.id });
        log.reasoning(`Detecting mood and objections for message on ${platform}`, { leadId, messagePreview: message.slice(0, 50) });

        if (quotaService.isRestricted()) throw new Error('DB quota restricted — will retry');

        try {
          const { analyzeSentiment } = await import('@services/brain-worker/src/ai-lib/analyzers/competitor-detection.js');
          const score = analyzeSentiment(message);
          const result = {
            sentiment: score > 0.2 ? 'positive' : score < -0.2 ? 'negative' : 'neutral',
            confidence: Math.abs(score),
            priority: score < -0.5 ? 9 : 5,
            objections: [] as string[]
          };

          log.reasoning(`Sentiment detected: ${result.sentiment}. Confidence: ${result.confidence}`, { leadId });

          // Update lead status/sentiment in CRM
          await db.update(leads)
            .set({ 
              sentiment: result.sentiment as any,
              lastMessagePreview: message.slice(0, 255),
              updatedAt: new Date()
            })
            .where(eq(leads.id, leadId));

          log.info('✅ Sentiment analysis complete', { leadId, sentiment: result.sentiment });
          
          // Optionally trigger orchestrator if sentiment is highly negative or contains high-priority objection
          if (result.sentiment === 'negative' || result.priority > 8) {
            // Use relative path to ensure TSC finds the module in this microservice context
            const { orchestratorQueue } = await import('../api-gateway/src/core/queues.js');
            if (orchestratorQueue) {
              await (orchestratorQueue as any).add('handle-high-priority-objection', {
                leadId,
                sentiment: result.sentiment,
                message,
                objections: result.objections
              });
            }
          }
        } catch (err: any) {
          log.error('❌ Sentiment analysis failed', { leadId, error: err.message });
          throw err;
        }
      },
      {
        connection: redisConnection as any,
        concurrency: 10,
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 1000 },
      } as any
    );

    sentimentWorker.on('completed', job => log.info('🎭 Sentiment job done', { jobId: job.id }));
    sentimentWorker.on('failed', (job, err) => log.error('🎭 Sentiment job failed', { jobId: job?.id, error: err.message }));
  }

  log.info('🚀 Sentiment Analysis Service fully online');
}

startSentimentService().catch(err => {
  console.error('[SENTIMENT] Fatal startup error:', err);
  process.exit(1);
});
