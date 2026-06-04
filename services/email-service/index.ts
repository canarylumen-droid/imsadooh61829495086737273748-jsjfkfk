import '@services/api-gateway/src/core/bootstrap.js';
import { createLogger } from '@services/api-gateway/src/core/logger.js';
import { startWorkerHealthServer } from '@services/api-gateway/src/core/worker-health-server.js';
import { workerHealthMonitor } from '@shared/lib/monitoring/worker-health.js';
import { createWorker } from '@shared/lib/worker';
import { mailSyncQueue } from '@shared/lib/queue';
import { subscribe } from '@services/event-bus/src/redis-pubsub.js';
import { startHeartbeat, HealthMonitor } from '@shared/lib/monitoring/health-heartbeat.js';
import { WorkerDiscoveryRegistry, MailboxReassignmentWatchdog } from '@shared/lib/monitoring/index.js';
import { startMemoryWatchdog } from '@shared/lib/monitoring/memory-watchdog.js';
import { ServiceRegistry } from '@shared/lib/monitoring/service-registry.js';

const log = createLogger('EMAIL-SYNC');

// ─── Global Process Safety Net ─────────────────────────────────────────────
process.on('unhandledRejection', (reason: any) => {
  log.error('🚨 unhandledRejection', { reason: reason?.message || String(reason) });
});
process.on('uncaughtException', (err: Error) => {
  log.error('🚨 uncaughtException — shutting down gracefully', { error: err.message, stack: err.stack });
  setTimeout(() => process.exit(1), 1500);
});

const discoveryRegistry = new WorkerDiscoveryRegistry('email-service');
const mailboxWatchdog = new MailboxReassignmentWatchdog();
const serviceRegistry = new ServiceRegistry(process.env.REDIS_URL || 'redis://localhost:6379', 'email-service');

async function startEmailService() {
  await serviceRegistry.register({ version: '1.0.0' });
  // Start ECS-safe memory watchdog (logs only, no hard exit on ECS)
  startMemoryWatchdog();

  log.info('📬 Email Sync Service starting...');

  // Expose /health endpoint for Railway/ECS healthchecks
  startWorkerHealthServer('email-sync', parseInt(process.env.EMAIL_WORKER_PORT || process.env.PORT || '8081', 10), {
    checkDb: true,
    checkRedis: true,
    checkImap: async () => {
      const conns = (imapIdleManager as any)?.connections;
      let activeConnections = 0;
      if (conns) {
        for (const folderMap of conns.values()) {
          activeConnections += folderMap?.size || 0;
        }
      }
      return {
        ok: imapIdleManager?.getRunningStatus?.() || false,
        activeConnections,
      };
    },
  });

  // ── Register workers with the health monitor ──────────────────────────────
  ['IMAP IDLE', 'Email Sync', 'Mailbox Health', 'Lead Redistribution',
   'Email Verification', 'Email Routing', 'Spam Rescue', 'Inbound Sweep']
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
    { mailboxHealthService },
    { redistributionWorker },
    { imapIdleManager },
    { PushNotificationService },
    { spamRescueWorker },
    { inboundSweepWorker },
  ] = await Promise.all([
    import('@services/email-service/src/email/email-sync-worker.js'),
    import('@services/email-service/src/email/mailbox-health-service.js'),
    import('@services/email-service/src/email/redistribution-worker.js'),
    import('@services/email-service/src/email/imap-idle-manager.js'),
    import('@services/email-service/src/email/push-notification-service.js'),
    import('@services/email-service/src/imap/spam-rescue.js'),
    import('@services/email-service/src/imap/inbound-sweep.js'),
  ]);

  await startWorkerModule('Email Sync',            () => emailSyncWorker.start());
  await startWorkerModule('Mailbox Health',        () => mailboxHealthService.start());
  await startWorkerModule('Lead Redistribution',   () => redistributionWorker.start());
  await startWorkerModule('IMAP IDLE Manager',     () => imapIdleManager.start());
  await startWorkerModule('Native Push',           () => PushNotificationService.initializeAll());
  await startWorkerModule('Spam Rescue',           () => spamRescueWorker.start());
  await startWorkerModule('Inbound Sweep',         () => inboundSweepWorker.start());

  // ── Worker Discovery Registry ───────────────────────────────────────────
  await discoveryRegistry.register();
  mailboxWatchdog.start();
  log.info('Worker Discovery Registry ✅ Online', { taskId: discoveryRegistry.getTaskId() });

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

  // ── Zombie Watchdog — restarts IMAP if it silently stalls (event‑driven) ────────────────
  // Listen for an 'imapIdleCheck' event to verify the IMAP idle manager is alive.
  // Other services should emit this event when appropriate (e.g., after processing mail).
  subscribe('imapIdleCheck', async () => {
    try {
      if (!imapIdleManager.getRunningStatus()) {
        log.warn('🛡️ [WATCHDOG] IMAP Idle Manager stalled — restarting...');
        imapIdleManager.start();
      }
    } catch (_e) {}
  });

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

  // ── Health heartbeat & SRE monitoring ───────────────────────────────────
  startHeartbeat('email-service', () => ({
    imapActive: imapIdleManager?.getRunningStatus?.() || false,
  }));
  const healthMonitor = new HealthMonitor();
  healthMonitor.startMonitoring();

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    log.info(`🛑 ${signal} — shutting down Email Sync service...`);
    try { await serviceRegistry.deregister(); } catch (_e) {}
    try { await discoveryRegistry.releaseAll(); } catch (_e) {}
    try { mailboxWatchdog.stop(); }      catch (_e) {}
    try { imapIdleManager.stop(); }     catch (_e) {}
    try { mailboxHealthService.stop(); } catch (_e) {}
    try { emailSyncWorkerModule && await (emailSyncWorkerModule as any).close(); } catch (_e) {}
    try { verificationWorker && await verificationWorker.close(); } catch (_e) {}
    try { routingWorker      && await routingWorker.close();      } catch (_e) {}
    try { reassignWorker     && await reassignWorker.close();     } catch (_e) {}
    if (process.env.UNIFIED_MODE !== 'true') setTimeout(() => process.exit(0), 5000);
  };
  if (process.env.UNIFIED_MODE !== 'true') {
    process.on('SIGTERM', async () => { await shutdown('SIGTERM'); });
    process.on('SIGINT',  async () => { await shutdown('SIGINT'); });
  }

  log.info('🚀 Email Sync Service fully online');
}

export { startEmailService };

if (process.env.UNIFIED_MODE !== 'true') {
  startEmailService().catch(err => {
    console.error('[EMAIL-SYNC] Fatal startup error:', err);
    process.exit(1);
  });
}
