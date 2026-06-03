/**
 * Unified Worker Starter — runs all background workers inside the API gateway process.
 * This allows Railway Free tier to deploy a single service while keeping all features functional.
 */

import { createLogger } from './logger.js';

const log = createLogger('UNIFIED');

export async function startUnifiedWorkers() {
  if (process.env.UNIFIED_MODE !== 'true') {
    log.info('UNIFIED_MODE not enabled — workers must run as separate services');
    return;
  }

  log.info('🚀 Starting unified workers inside API gateway process...');

  // Give the API server a moment to fully bind before workers start consuming resources
  await new Promise(r => setTimeout(r, 2000));

  const workers: Array<{ name: string; start: () => Promise<void> }> = [];

  // ── Brain Worker (AI Agent) ───────────────────────────────────────────────
  try {
    const { startAIService } = await import('@services/brain-worker/index.js');
    workers.push({
      name: 'AI Agent',
      start: async () => {
        log.info('🤖 Starting AI Agent workers...');
        await startAIService();
      }
    });
  } catch (err: any) {
    log.error('Failed to load AI Agent starter', { error: err.message });
  }

  // ── Email Service ───────────────────────────────────────────────────────
  try {
    const { startEmailService } = await import('@services/email-service/index.js');
    workers.push({
      name: 'Email Sync',
      start: async () => {
        log.info('📬 Starting Email Sync workers...');
        await startEmailService();
      }
    });
  } catch (err: any) {
    log.error('Failed to load Email Sync starter', { error: err.message });
  }

  // ── Outreach Worker ─────────────────────────────────────────────────────
  try {
    const { startOutreachService } = await import('@services/outreach-worker/index.js');
    workers.push({
      name: 'Outreach',
      start: async () => {
        log.info('🚀 Starting Outreach workers...');
        await startOutreachService();
      }
    });
  } catch (err: any) {
    log.error('Failed to load Outreach starter', { error: err.message });
  }

  // ── Billing Service ───────────────────────────────────────────────────────
  try {
    const billing = await import('@services/billing-service/src/billing/index.js');
    if (typeof billing.startBillingService === 'function') {
      workers.push({
        name: 'Billing',
        start: async () => {
          log.info('💳 Starting Billing workers...');
          await billing.startBillingService();
        }
      });
    }
  } catch (err: any) {
    log.warn('Billing service not exportable as unified worker', { error: err.message });
  }

  // ── Lead Recovery Worker ────────────────────────────────────────────────
  try {
    const { startRecoveryService } = await import('@services/lead-recovery-worker/index.js');
    workers.push({
      name: 'Lead Recovery',
      start: async () => {
        log.info('♻️ Starting Lead Recovery workers...');
        await startRecoveryService();
      }
    });
  } catch (err: any) {
    log.warn('Lead Recovery service not exportable as unified worker', { error: err.message });
  }

  // ── Warmup Worker ─────────────────────────────────────────────────────────
  try {
    const { startWarmupService } = await import('@services/warmup-service/index.js');
    workers.push({
      name: 'Warmup',
      start: async () => {
        log.info('🔥 Starting Warmup workers...');
        await startWarmupService();
      }
    });
  } catch (err: any) {
    log.warn('Warmup service not exportable as unified worker', { error: err.message });
  }

  // Start all workers concurrently — they each have their own BullMQ connections
  const results = await Promise.allSettled(
    workers.map(async ({ name, start }) => {
      try {
        await start();
        log.info(`✅ ${name} worker online`);
      } catch (err: any) {
        log.error(`❌ ${name} worker failed`, { error: err.message });
      }
    })
  );

  const online = results.filter(r => r.status === 'fulfilled').length;
  log.info(`🎯 Unified workers initialized: ${online}/${workers.length} online`);
}
