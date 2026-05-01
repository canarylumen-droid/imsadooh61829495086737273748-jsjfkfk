import '@services/api-gateway/src/core/bootstrap.js';
import { createLogger } from '@services/api-gateway/src/core/logger.js';
import { startWorkerHealthServer } from '@services/api-gateway/src/core/worker-health-server.js';
import { createWorker } from '@shared/lib/worker';
import { ragQueue, vectorOpsQueue } from '@shared/lib/queue';

const log = createLogger('RAG-WORKER');

async function startRagService() {
  log.info('🧠 RAG Worker Service starting...');

  startWorkerHealthServer('rag-worker', parseInt(process.env.RAG_WORKER_PORT || process.env.PORT || '8083', 10));

  // ── BullMQ Worker — processes RAG tasks (indexing, embedding) ────
  createWorker(ragQueue.name, async (job) => {
    const { action, documentId, content, metadata } = job.data;
    log.info('Processing RAG job', { action, documentId, jobId: job.id });

    switch (action) {
      case 'index':
        // 1. Generate embeddings using AI service
        // 2. Add job to vectorOpsQueue to store it
        log.info(`Generating embeddings for document ${documentId}`);
        await vectorOpsQueue.add('upsert', {
          action: 'upsert',
          documentId,
          vector: [/* mock vector */],
          metadata
        });
        break;
      case 'delete':
        await vectorOpsQueue.add('delete', {
          action: 'delete',
          documentId
        });
        break;
      case 'update':
        break;
      default:
        log.warn('Unknown RAG job action', { action });
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
