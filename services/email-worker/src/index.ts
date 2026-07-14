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
import { pool } from '@shared/lib/db/db.js';
import crypto from 'crypto';

const app = express();
const port = process.env.PORT || 3001;

// ── Sharding Configuration ────────────────────────────────────────────────────
// Railway:  RAILWAY_REPLICA_ID + TOTAL_REPLICAS  (static hash ring)
// K8s/EKS:  IMAP_DYNAMIC_SHARDING=true           (all pods compete via Redis claim)
//
// Dynamic mode is REQUIRED for HPA/KEDA autoscaling because TOTAL_REPLICAS
// changes at runtime. Static hash rings break when pods spin up/down.

const DYNAMIC_SHARDING = process.env.IMAP_DYNAMIC_SHARDING === 'true';
// POD_ORDINAL in K8s StatefulSet comes from metadata.name = "pod-name-3".
// We need to extract the trailing number, e.g. "audnix-imap-worker-3" → 3.
function extractOrdinal(raw: string | undefined): number {
  if (!raw) return 0;
  const m = raw.match(/-(\d+)$/);
  return m ? parseInt(m[1], 10) : parseInt(raw, 10) || 0;
}
const REPLICA_ID       = parseInt(process.env.RAILWAY_REPLICA_ID || '0', 10) || extractOrdinal(process.env.POD_ORDINAL);
const TOTAL_REPLICAS   = parseInt(process.env.TOTAL_REPLICAS || '1', 10);
const WORKER_ID        = process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || `worker-${process.pid}`;

const connectionManager = new ImapConnectionManager();
const mailboxWorker     = createMailboxWorker(connectionManager);

// BullMQ queue handle for enqueuing orphan reconnects
const imapTaskQueue = hasRedis ? new Queue('imap-idle-tasks', {
  connection: redisConnection as any,
  defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
} as any) : null;

/**
 * Returns true if this pod should attempt to claim the given integration.
 *
 * Static mode (Railway): uses deterministic hash ring for even distribution.
 * Dynamic mode (K8s):    ALL pods try to claim — Redis Lua atomic claim
 *                        prevents double-connect. Pods self-limit via MAX_SOCKETS.
 */
function isResponsibleFor(id: string): boolean {
  if (DYNAMIC_SHARDING) return true;          // Everyone competes
  if (TOTAL_REPLICAS <= 1) return true;        // Single pod
  const hash = crypto.createHash('md5').update(id).digest().readUInt32BE(0);
  return (hash % TOTAL_REPLICAS) === REPLICA_ID;
}

// ── Health & Metrics Endpoints ─────────────────────────────────────────────────

app.get('/health', async (_req, res) => {
  const checks: Record<string, any> = {};
  let allOk = true;

  // DB check
  const dbStart = Date.now();
  try {
    if (pool) {
      await pool.query('SELECT 1');
      checks.db = { ok: true, latencyMs: Date.now() - dbStart };
    } else {
      checks.db = { ok: false, error: 'pool_not_initialized' };
      allOk = false;
    }
  } catch (err: any) {
    checks.db = { ok: false, error: err.message, latencyMs: Date.now() - dbStart };
    allOk = false;
  }

  // Redis check
  const redisStart = Date.now();
  try {
    const redis = await getRedisClient();
    const pong = redis ? await redis.ping() : null;
    checks.redis = { ok: pong === 'PONG', latencyMs: Date.now() - redisStart };
    if (!checks.redis.ok) allOk = false;
  } catch (err: any) {
    checks.redis = { ok: false, error: err.message, latencyMs: Date.now() - redisStart };
    allOk = false;
  }

  // IMAP pool check
  checks.imap = {
    ok: connectionManager.connectionCount <= parseInt(process.env.IMAP_MAX_SOCKETS || '50', 10),
    connections: connectionManager.connectionCount,
    maxSockets: parseInt(process.env.IMAP_MAX_SOCKETS || '50', 10),
  };

  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'degraded',
    service: 'email-worker',
    replicaId: REPLICA_ID,
    totalReplicas: TOTAL_REPLICAS,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    ...checks,
  });
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
      // No Redis → connect directly
      connectionManager.connectMailbox(integration.id).catch((err: any) =>
        console.error(`[Boot] Direct connect failed for ${integration.id}:`, err.message)
      );
    }

    claimed++;
  }

  // 5. Drain the imap:orphans list — integrations pushed here by the global watchdog
  //    (from dead workers) or by _signalCapReached (capacity signals).
  if (redis) {
    let orphanEntry: string | null;
    let orphansFromList = 0;
    while ((orphanEntry = await redis.lPop(IMAP_KEYS.orphans()).catch(() => null)) !== null) {
      try {
        const parsed = JSON.parse(orphanEntry!);
        const orphanId = parsed.integrationId;
        if (!orphanId) continue;
        if (!isResponsibleFor(orphanId)) continue;

        if (imapTaskQueue) {
          await imapTaskQueue.add('CONNECT_MAILBOX', {
            type: 'CONNECT_MAILBOX',
            integrationId: orphanId,
          }, { priority: 1 });
        } else {
          connectionManager.connectMailbox(orphanId);
        }
        orphansFromList++;
      } catch {
        // Ignore malformed entries
      }
    }
    if (orphansFromList > 0) {
      console.log(`[Boot] Processed ${orphansFromList} orphans from imap:orphans list.`);
    }
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
 * Also drains the imap:orphans list from the global watchdog.
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

    // Drain the imap:orphans list from the global watchdog
    if (redis) {
      let orphanEntry: string | null;
      let orphansFromList = 0;
      while ((orphanEntry = await redis.lPop(IMAP_KEYS.orphans()).catch(() => null)) !== null) {
        try {
          const parsed = JSON.parse(orphanEntry!);
          const orphanId = parsed.integrationId;
          if (!orphanId) continue;
          if (!isResponsibleFor(orphanId)) continue;

          if (imapTaskQueue) {
            await imapTaskQueue.add('CONNECT_MAILBOX', {
              type: 'CONNECT_MAILBOX',
              integrationId: orphanId,
            }, { priority: 2 });
          }
          reclaims++;
        } catch {
          // Ignore malformed entries
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
  // Run watchdog every 5 minutes to reclaim orphaned mailboxes from crashed pods.
  // This is critical: without it, if a pod dies mid-session its mailboxes go dark
  // permanently until the entire service restarts.
  const WATCHDOG_INTERVAL_MS = 5 * 60 * 1000;
  setTimeout(() => {
    // First sweep after 2 min (let other pods settle on startup)
    watchdog();
    setInterval(watchdog, WATCHDOG_INTERVAL_MS);
  }, 2 * 60 * 1000);
  console.log(`[Boot] Watchdog armed — sweeps every ${WATCHDOG_INTERVAL_MS / 60000} min.`);
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
