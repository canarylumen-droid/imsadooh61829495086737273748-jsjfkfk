import { onScheduledTask as eventScheduler } from '@services/event-bus/src/utils/eventScheduler.js';
import { createLogger } from '@services/api-gateway/src/core/logger.js';
import { startWorkerHealthServer } from '@services/api-gateway/src/core/worker-health-server.js';
import { workerHealthMonitor } from '@shared/lib/monitoring/worker-health.js';
import { createWorker } from '@shared/lib/worker';
import { outreachQueue } from '@shared/lib/queue';
import { ServiceRegistry } from '@shared/lib/monitoring/service-registry.js';
import { startHeartbeat } from '@shared/lib/monitoring/health-heartbeat.js';

const log = createLogger('OUTREACH-WORKER');

// ─── Global Process Safety Net ─────────────────────────────────────────────
// At 1M+ scale, a single unhandled promise rejection or uncaught exception
// must NEVER crash the entire worker pod. Log it and keep running.
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  log.error('🚨 unhandledRejection', { reason: reason?.message || String(reason), promise });
});
process.on('uncaughtException', (err: Error) => {
  log.error('🚨 uncaughtException — shutting down', { error: err.message, stack: err.stack });
  process.exit(1);
});

/**
 * Handle a priority reply: generate AI reply and send to lead.
 * This runs when a lead replies and the fast-track analyzer says shouldAutoReply.
 */
async function handlePriorityReply(data: any): Promise<void> {
  const { userId, leadId } = data;
  if (!userId || !leadId) return;

  try {
    // Get the last inbound message for context
    const { storage } = await import('@shared/lib/storage/storage.js');
    const { generateAIReply } = await import('@services/brain-worker/src/ai-lib/core/conversation-ai.js');

    const lead = await storage.getLeadById(leadId);
    if (!lead?.email) return;

    const messages = await storage.getMessagesByLeadId(leadId);
    const recentMessages = messages.slice(-5);

    // Use generateAIReply from campaign-queue's processAutoReply path
    const aiReply = await generateAIReply(lead, recentMessages as any, 'email');
    const replyBody = aiReply.text || '';

    if (!replyBody) {
      console.warn(`[PriorityReply] AI generated empty reply for lead ${leadId}`);
      return;
    }

    // Send the reply via sendEmail
    const { sendEmail } = await import('@shared/lib/channels/email.js');
    await sendEmail(userId, lead.email, replyBody, `Re: ${recentMessages[recentMessages.length - 1]?.subject || 'Your message'}`, {
      isRaw: true,
      isHtml: false,
      leadId,
      isPriorityReply: true,
    });

    // Save to messages table
    await storage.createMessage({
      userId,
      leadId,
      provider: 'email',
      direction: 'outbound',
      subject: `Re: ${recentMessages[recentMessages.length - 1]?.subject || 'Your message'}`,
      body: replyBody,
      metadata: { aiGenerated: true, source: 'priority_reply' },
    });

    // Notify UI
    const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
    wsSync.notifyMessagesUpdated(userId, { leadId, direction: 'outbound' });
    wsSync.notifyLeadsUpdated(userId, { leadId, status: 'replied' });
    wsSync.notifyStatsUpdated(userId);

    console.log(`✅ [PriorityReply] AI auto-reply sent to ${lead.email}`);
  } catch (err: any) {
    console.error(`❌ [PriorityReply] Failed for lead ${leadId}:`, err.message);
  }
}

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
  ['Outreach Engine', 'Autonomous Outreach', 'Campaign Engine', 'Meeting Reminders', 'Lead Governance', 'Reputation Monitor', 'Consumer Distribution', 'Verification Pipeline', 'Active Watchdog', 'Fleet Auditor', 'Daily Checkpoint', 'Hourly Distribution']
    .forEach(n => workerHealthMonitor.registerWorker(n));

  const startWorkerModule = async (name: string, startFn: () => any) => {
    try {
      const result = startFn();
      if (result instanceof Promise) {
        await result.catch((err: any) => {
          log.error(`${name} async startup failed`, { error: err?.message });
          throw err;
        });
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
    consumerDistributionModule,
    verificationPipelineModule,
    activeWatchdogModule,
    fleetAuditorModule,
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
    import('@shared/lib/queues/consumer-distribution.js').catch(() => ({ startConsumerWorker: null as any })),
    import('@shared/lib/queues/verification-pipeline.js').catch(() => ({ startVerificationWorker: null as any })),
    import('@shared/lib/queues/active-watchdog.js').catch(() => ({ startActiveWatchdog: null as any })),
    import('@shared/lib/queues/fleet-auditor.js').catch(() => ({ fleetAuditor: { start: () => {}, stop: () => {} } })),
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

  await startWorkerModule('Consumer Distribution', () => consumerDistributionModule?.startConsumerWorker?.());
  await startWorkerModule('Verification Pipeline', () => verificationPipelineModule?.startVerificationWorker?.());
  await startWorkerModule('Active Watchdog',       () => activeWatchdogModule?.startActiveWatchdog?.());
  await startWorkerModule('Fleet Auditor',         () => fleetAuditorModule?.fleetAuditor?.start?.());
  await startWorkerModule('Daily Checkpoint',      async () => {
    const { dailyCheckpoint } = await import('@shared/lib/queues/daily-checkpoint.js');
    dailyCheckpoint?.start?.();
  });
  await startWorkerModule('Hourly Distribution',   async () => {
    const { hourlyDistribution } = await import('@shared/lib/queues/hourly-distribution.js');
    hourlyDistribution?.start?.();
  });

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
          await handlePriorityReply(job.data);
          break;
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
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`🛑 ${signal} — shutting down Outreach Worker service...`);

    // Force exit after 10s regardless of what's happening
    const forceExit = setTimeout(() => process.exit(0), 10000);
    forceExit.unref();

    try {
      const results = await Promise.allSettled([
        Promise.resolve(outreachEngine.stop?.()),
        Promise.resolve(autonomousOutreachWorker.stop?.()),
        Promise.resolve(meetingReminderWorker.stop?.()),
      ]);
      for (const result of results) {
        if (result.status === 'rejected') {
          log.warn('Worker stop error (non-fatal)', { error: result.reason?.message });
        }
      }
    } catch (_e: any) {
      log.warn('Shutdown error (non-fatal)', { error: _e?.message });
    }

    // Close BullMQ worker gracefully
    if (outreachBullWorker) {
      try {
        await outreachBullWorker.close(false);
        log.info('BullMQ worker closed gracefully');
      } catch (_e: any) {
        log.warn('BullMQ worker close error', { error: _e?.message });
      }
    }

    log.info('Outreach Worker shutdown complete');
    clearTimeout(forceExit);
    if (process.env.UNIFIED_MODE !== 'true') process.exit(0);
  };

  if (process.env.UNIFIED_MODE !== 'true') {
    const onSignal = async (signal: string) => {
      try {
        await serviceRegistry.deregister();
      } catch (_e: any) {
        log.warn('ServiceRegistry deregister error', { error: _e?.message });
      }
      await shutdown(signal);
    };
    process.on('SIGTERM', () => onSignal('SIGTERM'));
    process.on('SIGINT', () => onSignal('SIGINT'));
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
