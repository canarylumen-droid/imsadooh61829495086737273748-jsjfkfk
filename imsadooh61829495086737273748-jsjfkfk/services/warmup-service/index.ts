/**
 * P2P Email Warmup Microservice — Entry Point
 * Ghost layer. Zero visibility to users. Runs 24/7.
 */

import { createOutboundWorker } from './src/workers/outbound-worker.js';
import { createInboundWorker } from './src/workers/inbound-worker.js';
import { warmupScheduler } from './src/workers/scheduler-worker.js';
import { imapStealth } from './src/lib/imap-stealth.js';
import { provisionSeedsOnStartup } from './src/init/seeds.js';
import { startWarmupInternalServer } from './src/internal-api.js';

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

  // Provision platform seeds from env (retries 3x internally, falls back gracefully)
  try {
    await provisionSeedsOnStartup();
  } catch (err: any) {
    console.error('[Warmup Service] Unexpected error in seed provisioning:', err.message);
    console.warn('[Warmup Service] Continuing without platform seeds.');
  }

  // Start 24/7 scheduler
  await warmupScheduler.start();

  // Start health check endpoint for Docker / Railway
  startHealthServer();

  // Start internal API for other Audnix services (deliverability service, etc.)
  startWarmupInternalServer();

  console.log('✅ [Warmup Service] All systems active. Running 24/7.');
}

if (process.env.UNIFIED_MODE !== 'true') {
  (async () => {
    const MAX_ATTEMPTS = 5;
    const BASE_DELAY_MS = 10_000; // 10s
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await startWarmupService();
        return; // success — stay alive
      } catch (err: any) {
        const isAuthError = err?.message?.includes('password authentication') ||
          err?.cause?.message?.includes('password authentication');
        const isDbDown = err?.message?.includes('ECONNREFUSED') ||
          err?.message?.includes('Could not connect') ||
          err?.cause?.message?.includes('ECONNREFUSED');

        if (isAuthError) {
          // Auth errors are config bugs — no point retrying, fail fast with clear message
          console.error(
            '[Warmup Service] ❌ DATABASE AUTH FAILURE — check DATABASE_URL password encoding in .env.',
            err?.cause?.message || err?.message
          );
          process.exit(1);
        }

        const delayMs = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), 120_000);
        console.error(
          `[Warmup Service] Startup error (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${delayMs / 1000}s:`,
          err?.message || err
        );
        if (attempt === MAX_ATTEMPTS) {
          console.error('[Warmup Service] Max retries exceeded. Exiting.');
          process.exit(1);
        }
        await new Promise(r => setTimeout(r, delayMs));
        started = false; // allow re-entry
      }
    }
  })();
}
