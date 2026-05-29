import { onScheduledTask as eventScheduler } from '@services/event-bus/src/utils/eventScheduler.js';
import { createLogger } from '@services/api-gateway/src/core/logger.js';
import { startWorkerHealthServer } from '@services/api-gateway/src/core/worker-health-server.js';
import { workerHealthMonitor } from '@shared/lib/monitoring/worker-health.js';
import { createWorker } from '@shared/lib/worker';
import { outreachQueue } from '@shared/lib/queue';
import { ServiceRegistry } from '@shared/lib/monitoring/service-registry.js';
import { startHeartbeat } from '@shared/lib/monitoring/health-heartbeat.js';

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
  ['Outreach Engine', 'Autonomous Outreach', 'Campaign Engine', 'Meeting Reminders', 'Lead Governance', 'Reputation Monitor']
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
    { reputationWorker },
    { autonomousOutreachWorker },
    campaignQueueModule,
    autonomousScalerModule,
  ] = await Promise.all([
    import('./workers/outreach-engine.js').catch(() => ({ outreachEngine: null as any })),
    import('./workers/meeting-reminder-worker.js').catch(() => ({ meetingReminderWorker: { start: () => {}, stop: () => {} } })),
    import('./workers/lead-governance-worker.js').catch(() => ({ leadGovernanceWorker: { start: () => {}, stop: () => {} } })),
    import('./workers/reputation-worker.js').catch(() => ({ reputationWorker: { start: () => {}, stop: () => {} } })),
    import('./workers/outreach-worker.js').catch(() => ({ autonomousOutreachWorker: { start: () => {}, stop: () => {} } })),
    import('@shared/lib/queues/campaign-queue.js').catch((err) => {
      log.error('Failed to load Campaign Queue', { error: err.message });
      return null;
    }),
    import('./src/outreach-lib/autonomous-scaler.js').catch(() => ({ AutonomousScalerService: null as any })),
  ]);

  const { AutonomousScalerService } = autonomousScalerModule;

  const outreachEngine = outreachEngineModule.outreachEngine;

  await startWorkerModule('Outreach Engine',       () => outreachEngine.start());
  await startWorkerModule('Autonomous Outreach',   () => autonomousOutreachWorker.start());
  await startWorkerModule('Meeting Reminders',     () => meetingReminderWorker.start());
  await startWorkerModule('Lead Governance',       () => leadGovernanceWorker.start());
  await startWorkerModule('Reputation Monitor',    () => reputationWorker.start());

  if (campaignQueueModule) {
    log.info('Campaign Engine BullMQ Worker ✅ Initialized');
  }

  // ── Self-Healing Job Watchdog ───────────────────────────────────────────────
  // Sweeps campaign_job_logs every hour for jobs stuck in 'pending'/'processing'
  // that are missing from BullMQ, and re-queues them automatically.
  try {
    const { startJobWatchdog } = await import('@shared/lib/queues/job-watchdog.js');
    startJobWatchdog();
    log.info('Job Watchdog ✅ Armed (1h sweep interval)');
  } catch (err: any) {
    log.error('Job Watchdog failed to start (non-fatal)', { error: err.message });
  }

  // ── Activate Autonomous Neural Scaler ──────────────────────────────
  if (AutonomousScalerService) {
    log.info('Autonomous Scaler ✅ Active (Cycle: 12h)');
eventScheduler('autonomous-scaler', async () => {
  AutonomousScalerService.runOptimizationCycle().catch((err: any) => log.error('Daily Scaler Cycle failed', { error: err.message }));
});
  }

  // ── BullMQ Worker — processes queue-dispatched jobs with retry support ────
  const outreachBullWorker = createWorker(outreachQueue.name, async (job) => {
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

  // ── Health heartbeat ──────────────────────────────────────────────────────
  startHeartbeat('outreach-worker', () => ({
    campaignQueueReady: !!campaignQueueModule,
    outreachEngineActive: !!outreachEngine,
  }));

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    log.info(`🛑 ${signal} — shutting down Outreach Worker service...`);
    try { outreachEngine.stop(); }             catch (_e) {}
    try { autonomousOutreachWorker.stop(); }   catch (_e) {}
    try { meetingReminderWorker.stop(); }      catch (_e) {}
    // Wait for active BullMQ jobs to finish before exiting
    try {
      if (outreachBullWorker) {
        await outreachBullWorker.close(false);
        log.info('BullMQ worker closed gracefully');
      }
    } catch (_e: any) {
      log.warn('BullMQ worker close error', { error: _e?.message });
    }
    log.info('Outreach Worker shutdown complete');
    if (process.env.UNIFIED_MODE !== 'true') process.exit(0);
  };
  if (process.env.UNIFIED_MODE !== 'true') {
    process.on('SIGTERM', async () => {
      await serviceRegistry.deregister();
      await shutdown('SIGTERM');
    });
    process.on('SIGINT', async () => {
      await serviceRegistry.deregister();
      await shutdown('SIGINT');
    });
  }

  log.info('🚀 Outreach Worker Service fully online');
}

export { startOutreachService };

if (process.env.UNIFIED_MODE !== 'true') {
  startOutreachService().catch(err => {
    console.error('[OUTREACH-WORKER] Fatal startup error:', err);
    process.exit(1);
  });
}
