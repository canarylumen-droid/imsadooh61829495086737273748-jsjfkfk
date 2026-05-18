import '@services/api-gateway/src/core/bootstrap.js';
import { createLogger } from '@services/api-gateway/src/core/logger.js';
import { startWorkerHealthServer } from '@services/api-gateway/src/core/worker-health-server.js';
import { workerHealthMonitor } from '@shared/lib/monitoring/worker-health.js';
import { createWorker } from '@shared/lib/worker';
import { mailSyncQueue } from '@shared/lib/queue';

const log = createLogger('EMAIL-SYNC');

async function startEmailService() {
  log.info('📬 Email Sync Service starting...');

  // Expose /health endpoint for Railway healthchecks
  startWorkerHealthServer('email-sync', parseInt(process.env.EMAIL_WORKER_PORT || process.env.PORT || '8081', 10));

  // ── Register workers with the health monitor ──────────────────────────────
  ['IMAP IDLE', 'Email Sync', 'Email Warmup', 'Mailbox Health', 'Lead Redistribution',
   'Email Verification', 'Email Routing']
    .forEach(n => workerHealthMonitor.registerWorker(n));

  const startWorkerModule = async (name: string, startFn: () => any) => {
    try {
      const result = startFn();
      if (result instanceof Promise) {
        result.catch((err: any) =>
          log.error(`${name} async startup failed`, { error: err?.message })
        );
      }
      log.info(`${name} ✅ Online`);
    } catch (err: any) {
      log.error(`${name} ❌ Failed to start`, { error: err?.message });
    }
  };

  // ── Load all email-domain workers from lib/ ───────────────────────────────
  const [
    { emailSyncWorker },
    { emailWarmupWorker },
    { mailboxHealthService },
    { redistributionWorker },
    { imapIdleManager },
    { PushNotificationService },
  ] = await Promise.all([
    import('@services/email-service/src/email/email-sync-worker.js'),
    import('@services/email-service/src/email/email-warmup-worker.js'),
    import('@services/email-service/src/email/mailbox-health-service.js'),
    import('@services/email-service/src/email/redistribution-worker.js'),
    import('@services/email-service/src/email/imap-idle-manager.js'),
    import('@services/email-service/src/email/push-notification-service.js'),
  ]);

  await startWorkerModule('Email Sync',            () => emailSyncWorker.start());
  await startWorkerModule('Email Warmup',          () => emailWarmupWorker.start());
  await startWorkerModule('Mailbox Health',        () => mailboxHealthService.start());
  await startWorkerModule('Lead Redistribution',   () => redistributionWorker.start());
  await startWorkerModule('IMAP IDLE Manager',     () => imapIdleManager.start());
  await startWorkerModule('Native Push',           () => PushNotificationService.initializeAll());

  // ── Verification + Routing BullMQ Workers ────────────────────────────────
  const { startVerificationWorker, startRoutingWorker, startReassignWorker, startMailboxEventListener } =
    await import('@shared/lib/queues/verification-routing-queue.js');
  const { startEmailSyncWorker } =
    await import('@shared/lib/queues/email-sync-queue.js');

  const emailSyncWorkerModule = startEmailSyncWorker();
  const verificationWorker = startVerificationWorker();
  const routingWorker      = startRoutingWorker();
  const reassignWorker     = startReassignWorker();
  await startMailboxEventListener();

  if (emailSyncWorkerModule) log.info('Email Sync Worker ✅ Online (concurrency: 50)');
  if (verificationWorker) log.info('Email Verification ✅ Online (concurrency: 50)');
  if (routingWorker)      log.info('Email Routing ✅ Online (concurrency: 20)');
  if (reassignWorker)     log.info('Email Reassign ✅ Online (concurrency: 10, P0 priority)');

  // ── Zombie Watchdog — restarts IMAP if it silently stalls ────────────────
  setInterval(async () => {
    try {
      if (!imapIdleManager.getRunningStatus()) {
        log.warn('🛡️ [WATCHDOG] IMAP Idle Manager stalled — restarting...');
        imapIdleManager.start();
      }
    } catch (_e) {}
  }, 5 * 60_000);

  // ── BullMQ Worker — processes queue-dispatched jobs with retry support ────
  createWorker(mailSyncQueue.name, async (job) => {
    const { action, accountId, provider, cursor } = job.data;
    log.info('Processing mail sync job', { action, accountId, jobId: job.id });

    switch (action) {
      case 'sync_inbox':
        // Handle inbox sync logic
        break;
      case 'sync_sent':
        // Handle sent sync logic
        break;
      default:
        log.warn('Unknown job action', { action, jobId: job.id });
    }
  });

  log.info(`✅ BullMQ worker listening on [${mailSyncQueue.name}]`);

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    log.info(`🛑 ${signal} — shutting down Email Sync service...`);
    try { imapIdleManager.stop(); }     catch (_e) {}
    try { mailboxHealthService.stop(); } catch (_e) {}
    try { emailSyncWorkerModule && await (emailSyncWorkerModule as any).close(); } catch (_e) {}
    try { verificationWorker && await verificationWorker.close(); } catch (_e) {}
    try { routingWorker      && await routingWorker.close();      } catch (_e) {}
    try { reassignWorker     && await reassignWorker.close();     } catch (_e) {}
    setTimeout(() => process.exit(0), 5000);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  log.info('🚀 Email Sync Service fully online');
}

startEmailService().catch(err => {
  console.error('[EMAIL-SYNC] Fatal startup error:', err);
  process.exit(1);
});
