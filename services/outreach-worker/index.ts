import '@services/api-gateway/src/core/bootstrap.js';
import { createLogger } from '@services/api-gateway/src/core/logger.js';
import { startWorkerHealthServer } from '@services/api-gateway/src/core/worker-health-server.js';
import { workerHealthMonitor } from '@shared/lib/monitoring/worker-health.js';
import { createWorker } from '@shared/lib/worker';
import { outreachQueue } from '@shared/lib/queue';
import { ServiceRegistry } from '@shared/lib/monitoring/service-registry.js';

const log = createLogger('OUTREACH-WORKER');

async function startOutreachService() {
  const serviceRegistry = new ServiceRegistry(process.env.REDIS_URL || 'redis://localhost:6379', 'outreach-worker');
  await serviceRegistry.register({
    version: '1.2.0',
    capabilities: ['email', 'governance', 'reputation']
  });

  log.info('🚀 Outreach Worker Service starting...');

  // Expose /health endpoint for Railway healthchecks
  startWorkerHealthServer('outreach-worker', parseInt(process.env.OUTREACH_WORKER_PORT || process.env.PORT || '8082', 10));

  // ── Register workers with the health monitor ──────────────────────────────
  ['Outreach Engine', 'Meeting Reminders', 'Lead Governance', 'Emoji Follow-up', 'Reputation Monitor']
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

  // ── Load all outreach workers ───────────────────────────────
  const [
    outreachEngineModule,
    { meetingReminderWorker },
    { leadGovernanceWorker },
    { emojiFollowupWorker },
    { reputationWorker },
  ] = await Promise.all([
    import('./workers/outreach-engine.js').catch(() => ({ outreachEngine: null as any })),
    import('./workers/meeting-reminder-worker.js').catch(() => ({ meetingReminderWorker: { start: () => {}, stop: () => {} } })),
    import('./workers/lead-governance-worker.js').catch(() => ({ leadGovernanceWorker: { start: () => {}, stop: () => {} } })),
    import('./workers/emoji-followup-worker.js').catch(() => ({ emojiFollowupWorker: { start: () => {}, stop: () => {} } })),
    import('./workers/reputation-worker.js').catch(() => ({ reputationWorker: { start: () => {}, stop: () => {} } })),
  ]);

  const outreachEngine = outreachEngineModule.outreachEngine;

  await startWorkerModule('Outreach Engine',       () => outreachEngine.start());
  await startWorkerModule('Meeting Reminders',     () => meetingReminderWorker.start());
  await startWorkerModule('Lead Governance',       () => leadGovernanceWorker.start());
  await startWorkerModule('Emoji Follow-up',       () => emojiFollowupWorker.start());
  await startWorkerModule('Reputation Monitor',    () => reputationWorker.start());

  // ── BullMQ Worker — processes queue-dispatched jobs with retry support ────
  createWorker(outreachQueue.name, async (job) => {
    log.info('Processing outreach job', { name: job.name, userId: job.data?.userId, leadId: job.data?.leadId, jobId: job.id });

    try {
      switch (job.name) {
        case 'engine-tick':
          await outreachEngine.tick();
          break;
        case 'priority-reply':
        case 'standard-send':
        case 'high-priority-send':
          await outreachEngine.processJob(job);
          break;
        case 'pulse-sweep-trigger':
          await outreachEngine.performGlobalPulseSweep();
          break;
        default:
          log.warn('Unknown outreach job name', { name: job.name });
      }
    } catch (err: any) {
      log.error('Outreach job processing failed', { name: job.name, error: err.message });
      throw err; // Allow BullMQ to retry
    }
  });

  log.info(`✅ BullMQ worker listening on [${outreachQueue.name}]`);

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    log.info(`🛑 ${signal} — shutting down Outreach Worker service...`);
    try { outreachEngine.stop(); }         catch (_e) {}
    try { meetingReminderWorker.stop(); }  catch (_e) {}
    setTimeout(() => process.exit(0), 5000);
  };
  process.on('SIGTERM', async () => {
    await serviceRegistry.deregister();
    shutdown('SIGTERM');
  });
  process.on('SIGINT', async () => {
    await serviceRegistry.deregister();
    shutdown('SIGINT');
  });

  log.info('🚀 Outreach Worker Service fully online');
}

startOutreachService().catch(err => {
  console.error('[OUTREACH-WORKER] Fatal startup error:', err);
  process.exit(1);
});
