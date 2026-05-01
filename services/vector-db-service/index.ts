import '@services/api-gateway/src/core/bootstrap.js';
import { createLogger } from '@services/api-gateway/src/core/logger.js';
import { startWorkerHealthServer } from '@services/api-gateway/src/core/worker-health-server.js';
import { createWorker } from '@shared/lib/worker';
import { vectorOpsQueue } from '@shared/lib/queue';
import { redisClient } from '@shared/lib/redis';

const log = createLogger('VECTOR-DB-SERVICE');

async function startVectorDbService() {
  log.info('🗄️ Vector DB Service starting...');

  startWorkerHealthServer('vector-db-service', parseInt(process.env.VECTOR_DB_WORKER_PORT || process.env.PORT || '8084', 10));

  // ── BullMQ Worker — processes Vector DB operations ────
  createWorker(vectorOpsQueue.name, async (job) => {
    const { action, documentId, vector, metadata } = job.data;
    log.info('Processing Vector DB job', { action, documentId, jobId: job.id });

    try {
      switch (action) {
        case 'upsert':
          // Upsert vector into Qdrant/Pinecone
          log.info(`Upserting vector for document ${documentId}`);
          // Notify other services that an embedding was created
          await redisClient.publish('events:embeddingCreated', JSON.stringify({ documentId, status: 'success' }));
          break;
        case 'delete':
          log.info(`Deleting vector for document ${documentId}`);
          await redisClient.publish('events:embeddingDeleted', JSON.stringify({ documentId, status: 'success' }));
          break;
        case 'search':
          log.info(`Searching vectors...`);
          break;
        default:
          log.warn('Unknown Vector DB job action', { action });
      }
    } catch (error: any) {
      log.error(`Vector DB operation failed: ${error.message}`);
      throw error;
    }
  });

  log.info(`✅ BullMQ worker listening on [${vectorOpsQueue.name}]`);

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    log.info(`🛑 ${signal} — shutting down Vector DB service...`);
    setTimeout(() => process.exit(0), 5000);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  log.info('🚀 Vector DB Service fully online');
}

startVectorDbService().catch(err => {
  console.error('[VECTOR-DB-SERVICE] Fatal startup error:', err);
  process.exit(1);
});
