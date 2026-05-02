import '@services/api-gateway/src/core/bootstrap.js';
import { createLogger } from '@services/api-gateway/src/core/logger.js';
import { startWorkerHealthServer } from '@services/api-gateway/src/core/worker-health-server.js';
import { createWorker } from '@shared/lib/worker';
import { ragQueue, vectorOpsQueue } from '@shared/lib/queue';

const log = createLogger('RAG-WORKER');

async function startRagService() {
  log.info('🧠 RAG Worker Service starting...');

  startWorkerHealthServer('rag-worker', parseInt(process.env.RAG_WORKER_PORT || process.env.PORT || '8083', 10));

  // ── BullMQ Worker — processes RAG tasks (indexing, embedding, searching) ────
  createWorker(ragQueue.name, async (job) => {
    const { action, documentId, content, metadata, userId, fileName, query, topK } = job.data;
    log.info('Processing RAG job', { action, documentId, jobId: job.id });

    try {
      // Lazy load to avoid db connections until needed
      const { indexPdfChunks, searchSimilarChunks } = await import('./src/lib/vector-store.js');
      const { db } = await import('@shared/lib/db/db.js');
      const { sql } = await import('drizzle-orm');

      switch (action) {
        case 'index':
          log.info(`Generating embeddings for document ${documentId}`);
          await indexPdfChunks(content, userId, documentId, fileName, metadata);
          break;
        case 'delete':
          log.info(`Deleting document ${documentId}`);
          await db.execute(sql`DELETE FROM brand_embeddings WHERE document_id = ${documentId} AND user_id = ${userId}`);
          break;
        case 'search':
          log.info(`Searching chunks for user ${userId}`);
          const results = await searchSimilarChunks(query, userId, topK);
          // Return results via BullMQ job return value
          return results;
        case 'update':
          break;
        default:
          log.warn('Unknown RAG job action', { action });
      }
    } catch (e: any) {
      log.error(`RAG operation failed: ${e.message}`);
      throw e;
    }
  });

  log.info(`✅ BullMQ worker listening on [${ragQueue.name}]`);

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    log.info(`🛑 ${signal} — shutting down RAG Worker service...`);
    setTimeout(() => process.exit(0), 5000);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  log.info('🚀 RAG Worker Service fully online');
}

startRagService().catch(err => {
  console.error('[RAG-WORKER] Fatal startup error:', err);
  process.exit(1);
});
