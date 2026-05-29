/**
 * ─── MAILBOX REASSIGNMENT WATCHDOG ────────────────────────────────────────────
 *
 * Periodically scans the worker:assignment:* keys in Redis.
 * If a worker's heartbeat key has expired (TTL gone), it is dead.
 * The watchdog:
 *   1. Identifies orphaned mailboxes (mailbox:owner pointing to dead worker)
 *   2. Clears the dead ownership records
 *   3. Enqueues each orphaned mailbox for immediate reassignment via BullMQ
 *
 * Runs every 60 seconds inside the email-service.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { getRedisClient } from '@shared/lib/redis/redis.js';
import { createStructuredLogger } from './structured-logger.js';
import { emailSyncQueue } from '@shared/lib/queues/email-sync-queue.js';

const log = createStructuredLogger('MAILBOX-WATCHDOG');

export interface OrphanedMailbox {
  integrationId: string;
  deadTaskId: string;
}

export class MailboxReassignmentWatchdog {
  private interval?: NodeJS.Timeout;
  private readonly CHECK_INTERVAL_MS = 60_000;
  private isRunning = false;

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    log.info('Mailbox Reassignment Watchdog started', { intervalMs: this.CHECK_INTERVAL_MS });

    // First run after 30s warm-up
    setTimeout(() => this.runCheck(), 30_000);
    this.interval = setInterval(() => this.runCheck(), this.CHECK_INTERVAL_MS);
  }

  stop(): void {
    this.isRunning = false;
    if (this.interval) clearInterval(this.interval);
    log.info('Mailbox Reassignment Watchdog stopped');
  }

  private async runCheck(): Promise<void> {
    if (!this.isRunning) return;

    const redis = await getRedisClient();
    if (!redis) {
      log.warn('Redis unavailable — skipping watchdog scan');
      return;
    }

    try {
      // 1. Find all active workers
      const workerKeys = await redis.keys('worker:assignment:*');
      const aliveTaskIds = new Set<string>();
      for (const key of workerKeys) {
        const raw = await redis.get(key);
        if (raw) {
          const assignment = JSON.parse(raw);
          aliveTaskIds.add(assignment.taskId);
        }
      }

      // 2. Find all mailbox ownership records
      const ownerKeys = await redis.keys('mailbox:owner:*');
      const orphaned: OrphanedMailbox[] = [];

      for (const key of ownerKeys) {
        const raw = await redis.get(key);
        if (!raw) continue;

        const owner = JSON.parse(raw);
        if (!aliveTaskIds.has(owner.taskId)) {
          const integrationId = key.replace('mailbox:owner:', '');
          orphaned.push({ integrationId, deadTaskId: owner.taskId });
        }
      }

      if (orphaned.length === 0) return;

      log.warn(`Watchdog found ${orphaned.length} orphaned mailbox(es)`, {
        deadWorkers: [...new Set(orphaned.map(o => o.deadTaskId))],
      });

      // 3. Clean up dead ownership + enqueue for reassignment
      for (const { integrationId, deadTaskId } of orphaned) {
        await redis.del(`mailbox:owner:${integrationId}`);
        log.info('Cleared dead mailbox ownership', { integrationId, deadTaskId });

        // Enqueue high-priority discovery job so a healthy worker picks it up
        try {
          await emailSyncQueue.add('discovery-orphan', {
            type: 'discovery-orphan',
            integrationId,
            reason: 'worker_death',
            deadTaskId,
          }, {
            priority: 1, // Highest priority
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
          });
        } catch (err: any) {
          log.error('Failed to enqueue orphan reassignment', { integrationId, error: err.message });
        }
      }
    } catch (err: any) {
      log.error('Watchdog scan failed', { error: err.message });
    }
  }
}
