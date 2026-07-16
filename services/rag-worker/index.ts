import '@services/api-gateway/src/core/bootstrap.js';
import { createLogger } from '@services/api-gateway/src/core/logger.js';
import { startWorkerHealthServer } from '@services/api-gateway/src/core/worker-health-server.js';
import { createWorker } from '@shared/lib/worker';
import { ragQueue, vectorOpsQueue } from '@shared/lib/queue';
import { workerHealthMonitor } from '@shared/lib/monitoring/worker-health.js';
import { startHeartbeat } from '@shared/lib/monitoring/health-heartbeat.js';
import { ServiceRegistry } from '@shared/lib/monitoring/service-registry.js';

const log = createLogger('RAG-WORKER');
const serviceRegistry = new ServiceRegistry(process.env.REDIS_URL || 'redis://localhost:6379', 'rag-worker');
const WORKER_NAME = 'RAG';

async function startRagService() {
  await serviceRegistry.register({ version: '1.0.0' });
  log.info('🧠 RAG Worker Service starting...');

  const role = process.env.APP_ROLE || 'rag';
  const portVar = role === 'knowledge' ? 'KNOWLEDGE_WORKER_PORT' : 'RAG_WORKER_PORT';
  const defaultPort = role === 'knowledge' ? '8090' : '8083';
  startWorkerHealthServer(`${role}-worker`, parseInt(process.env[portVar] || process.env.PORT || defaultPort, 10));

  // Phase 10: Register with worker health monitor so crashes appear in the dashboard
  workerHealthMonitor.registerWorker(WORKER_NAME);
  log.info(`✅ [${WORKER_NAME}] Registered with worker health monitor`);

  // ── BullMQ Worker — processes RAG tasks (indexing, embedding, searching) ────
  const ragMainWorker = createWorker(ragQueue.name, async (job) => {
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
  }, { lockDuration: 600000 }); // Phase 10: increased from 120s to 600s to prevent vector search timeouts

  // Phase 10: onFailed/completed handlers on the real worker (no duplicate worker)
  ragMainWorker?.on?.('failed', (job: any, err: any) => {
    log.error(`RAG job ${job?.id} failed: ${err?.message}`);
    workerHealthMonitor.recordError(WORKER_NAME, err?.message || 'Unknown RAG job failure');
  });
  ragMainWorker?.on?.('completed', () => {
    workerHealthMonitor.recordSuccess(WORKER_NAME);
  });

  log.info(`✅ BullMQ worker listening on [${ragQueue.name}]`);

  // ── Health heartbeat ──────────────────────────────────────────────────────
  startHeartbeat('rag-worker');

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    log.info(`🛑 ${signal} — shutting down RAG Worker service...`);
    try { await serviceRegistry.deregister(); } catch (_e) {}
    try { await ragMainWorker.close(); } catch (_e) {}
    process.exit(0);
  };
  process.on('SIGTERM', async () => { await shutdown('SIGTERM'); });
  process.on('SIGINT',  async () => { await shutdown('SIGINT'); });

  log.info('🚀 RAG Worker Service fully online');
}

startRagService().catch(err => {
  console.error('[RAG-WORKER] Fatal startup error:', err);
  process.exit(1);
});
