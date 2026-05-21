/**
 * Email Worker — Boot Entry Point
 *
 * Startup sequence:
 * 1. Register this replica in Redis worker load tracker
 * 2. Query DB for active integrations assigned to this shard
 * 3. For each: if Redis imap:active key is missing → it's an orphan → enqueue CONNECT_MAILBOX
 * 4. Listen for BullMQ imap-idle-tasks commands (CONNECT / DISCONNECT / RECYCLE)
 * 5. On SIGTERM: flush all Redis state, gracefully disconnect all IMAP clients
 */

import express from 'express';
import { subscribe } from '@services/event-bus/src/redis-pubsub.js';
import { storage } from '@shared/lib/storage/storage.js';
import { ImapConnectionManager } from './imap/imap-connection-manager.js';
import { createMailboxWorker } from './imap/mailbox-worker.js';
import { metricsService } from '@shared/lib/monitoring/metrics-service.js';
import { getRedisClient } from '@shared/lib/redis/redis.js';
import { IMAP_KEYS } from '@shared/lib/redis/imap-keys.js';
import { Queue } from 'bullmq';
import { redisConnection, hasRedis } from '@shared/lib/queues/redis-config.js';
import crypto from 'crypto';

const app = express();
const port = process.env.PORT || 3001;

// Deterministic sharding via Railway replica ID
const REPLICA_ID    = parseInt(process.env.RAILWAY_REPLICA_ID || '0', 10);
const TOTAL_REPLICAS = parseInt(process.env.TOTAL_REPLICAS || '1', 10);
const WORKER_ID     = process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || `worker-${process.pid}`;

const connectionManager = new ImapConnectionManager();
const mailboxWorker     = createMailboxWorker(connectionManager);

// BullMQ queue handle for enqueuing orphan reconnects
const imapTaskQueue = hasRedis ? new Queue('imap-idle-tasks', {
  connection: redisConnection as any,
  defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
} as any) : null;

/** Returns true if this replica is responsible for the given integration ID */
function isResponsibleFor(id: string): boolean {
  if (TOTAL_REPLICAS <= 1) return true;
  const hash = crypto.createHash('md5').update(id).digest().readUInt32BE(0);
  return (hash % TOTAL_REPLICAS) === REPLICA_ID;
}

// ── Health & Metrics Endpoints ─────────────────────────────────────────────────

app.get('/health', async (_req, res) => {
  try {
    const redis = await getRedisClient();
    const redisPing = redis ? await redis.ping() : 'SKIP';
    res.json({
      status: 'ok',
      replicaId: REPLICA_ID,
      totalReplicas: TOTAL_REPLICAS,
      connections: connectionManager.connectionCount,
      redis: redisPing === 'PONG' ? 'ok' : 'unavailable',
    });
  } catch {
    res.status(500).json({ status: 'error' });
  }
});

app.get('/metrics', async (_req, res) => {
  try {
    res.set('Content-Type', metricsService.getContentType());
    res.end(await metricsService.getMetrics());
  } catch (ex) {
    res.status(500).end(String(ex));
  }
});

// ── Boot: Register + Orphan Rebalance ─────────────────────────────────────────

async function boot() {
  console.log(`🚀 Email Worker Replica ${REPLICA_ID}/${TOTAL_REPLICAS} (${WORKER_ID}) booting...`);

  // 1. Register this worker in Redis load tracker
  await connectionManager.registerWorker();

  // 2. Query active integrations from DB
  let integrations: { id: string; connected: boolean }[] = [];
  try {
    integrations = await storage.getActiveImapIntegrations() as any[];
    console.log(`[Boot] Found ${integrations.length} active IMAP integrations. Filtering for shard ${REPLICA_ID}...`);
  } catch (err: any) {
    console.error('[Boot] DB query for active integrations failed:', err.message);
  }

  const redis = await getRedisClient();
  let claimed = 0;
  let orphaned = 0;

  for (const integration of integrations) {
    if (!isResponsibleFor(integration.id)) continue;

    // 3. Check if already live in Redis (another replica or surviving process has it)
    const isAlive = redis
      ? Boolean(await redis.exists(IMAP_KEYS.active(integration.id)).catch(() => false))
      : false;

    if (isAlive) {
      console.log(`[Boot] ${integration.id} already live — skipping.`);
      continue;
    }

    // 4. Not in Redis → orphan → reconnect immediately
    orphaned++;
    if (imapTaskQueue) {
      // Enqueue via BullMQ so backpressure + retries are handled
      await imapTaskQueue.add('CONNECT_MAILBOX', {
        type: 'CONNECT_MAILBOX',
        integrationId: integration.id,
      }, { priority: 1 }).catch((err: any) =>
        console.error(`[Boot] Failed to enqueue orphan reconnect for ${integration.id}:`, err.message)
      );
    } else {
      // Autonomous scaler now runs via BullMQ repeatable job (see autonomous-scaler queue).{
      // No Redis → connect directly
      connectionManager.connectMailbox(integration.id).catch((err: any) =>
        console.error(`[Boot] Direct connect failed for ${integration.id}:`, err.message)
      );
    }

    claimed++;
  }

  console.log(`[Boot] Replica ${REPLICA_ID}: ${claimed} mailboxes claimed, ${orphaned} orphans re-queued.`);
}

// ── HTTP Server ────────────────────────────────────────────────────────────────

app.listen(port, () => {
  console.log(`📊 Email Worker metrics/health on port ${port}`);
});

/**
 * Watchdog — Periodically scans for dead shards or missing connections
 * and enqueues reconnections for orphans assigned to THIS replica.
 */
async function watchdog() {
  try {
    const integrations = await storage.getActiveImapIntegrations() as any[];
    const redis = await getRedisClient();
    let reclaims = 0;

    for (const integration of integrations) {
      if (!isResponsibleFor(integration.id)) continue;

      const isAlive = redis
        ? Boolean(await redis.exists(IMAP_KEYS.active(integration.id)).catch(() => false))
        : false;

      if (!isAlive) {
        // Shard is dead or connection lost -> Reclaim
        reclaims++;
        if (imapTaskQueue) {
          await imapTaskQueue.add('RECLAIM_MAILBOX', {
            type: 'CONNECT_MAILBOX',
            integrationId: integration.id,
            reason: 'watchdog_orphan_detected'
          }, { priority: 2 });
        }
      }
    }

    if (reclaims > 0) {
      console.log(`[Watchdog] 🐕 Reclaimed ${reclaims} orphaned mailboxes for replica ${REPLICA_ID}`);
    }
  } catch (err: any) {
    console.error('[Watchdog] Scan failed:', err.message);
  }
}

// ── Start ──────────────────────────────────────────────────────────────────────

boot().then(() => {
  // Run watchdog every 5 minutes
  // Removed polling; rely on event-driven orphan detection via Redis Pub/Sub
}).catch((err) => {
  console.error('[Boot] Fatal boot error:', err);
});

// ── Graceful Shutdown ──────────────────────────────────────────────────────────

process.on('SIGTERM', async () => {
  console.log('[SIGTERM] Graceful shutdown started...');
  try {
    // Give BullMQ worker time to finish current job
    await mailboxWorker.close();
    // Disconnect all IMAP clients + flush Redis state
    await connectionManager.disconnectAll();
    // Close task queue handle
    if (imapTaskQueue) await imapTaskQueue.close();
    console.log('[SIGTERM] Clean shutdown complete.');
  } catch (err: any) {
    console.error('[SIGTERM] Shutdown error:', err.message);
  }
  process.exit(0);
});
