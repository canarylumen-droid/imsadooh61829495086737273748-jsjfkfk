/**
 * P2P Email Warmup Microservice — Entry Point
 * Ghost layer. Zero visibility to users. Runs 24/7.
 */

import { createOutboundWorker } from './src/workers/outbound-worker.js';
import { createInboundWorker } from './src/workers/inbound-worker.js';
import { warmupScheduler } from './src/workers/scheduler-worker.js';
import { imapStealth } from './src/lib/imap-stealth.js';

// Health check server (lazy-import so unified-mode doesn't crash if api-gateway isn't built)
async function startHealthServer() {
  try {
    const { startWorkerHealthServer } = await import('@services/api-gateway/src/core/worker-health-server.js');
    startWorkerHealthServer('warmup', undefined, {
      checkDb: true,
      checkRedis: true,
    });
  } catch (err: any) {
    console.warn('[Warmup Service] Health server unavailable:', err.message);
  }
}

console.log('🔥 [Warmup Service] Starting P2P Email Warmup Microservice...');

// Graceful shutdown handlers
let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n[Warmup Service] Received ${signal}. Shutting down gracefully...`);

  warmupScheduler.stop();
  await imapStealth.disconnectAll();

  console.log('[Warmup Service] Cleanup complete. Exiting.');
  process.exit(0);
}

function registerShutdownHandlers() {
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    console.error('[Warmup Service] Uncaught Exception:', err);
    gracefulShutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[Warmup Service] Unhandled Rejection:', reason);
  });
}

let started = false;

export async function startWarmupService() {
  if (started) {
    console.log('[Warmup Service] Already started, skipping.');
    return;
  }
  started = true;

  registerShutdownHandlers();

  // Start workers
  const outboundWorker = createOutboundWorker();
  const inboundWorker = createInboundWorker();

  // Worker error handlers
  outboundWorker.on('failed', (job, err) => {
    console.error(`[Warmup][Outbound] Job ${job?.id} failed:`, err.message);
  });
  outboundWorker.on('completed', (job) => {
    console.log(`[Warmup][Outbound] Job ${job.id} completed`);
  });

  inboundWorker.on('failed', (job, err) => {
    console.error(`[Warmup][Inbound] Job ${job?.id} failed:`, err.message);
  });
  inboundWorker.on('completed', (job) => {
    console.log(`[Warmup][Inbound] Job ${job.id} completed`);
  });

  // Start 24/7 scheduler
  await warmupScheduler.start();

  // Start health check endpoint for Docker / Railway
  startHealthServer();

  console.log('✅ [Warmup Service] All systems active. Running 24/7.');
}

if (process.env.UNIFIED_MODE !== 'true') {
  startWarmupService().catch((err) => {
    console.error('[Warmup Service] Fatal startup error:', err);
    process.exit(1);
  });
}
