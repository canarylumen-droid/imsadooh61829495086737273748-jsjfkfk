/**
 * ─── WORKER HEALTH HTTP SERVER ────────────────────────────────────────────────
 * 
 * All worker services expose a lightweight HTTP server on a configurable port.
 * This allows Railway health checks to work and lets you hit each worker's
 * /health endpoint to inspect its live status without tailing logs.
 * 
 * Usage: call startWorkerHealthServer(workerName, port) from any service index.ts
 * ─────────────────────────────────────────────────────────────────────────────
 */

import http from 'http';
import { workerHealthMonitor } from '@shared/lib/monitoring/worker-health.js';
import { getQueueHealthStatus } from './queues.js';
import { createLogger } from './logger.js';
import { getRedisClient } from '@shared/lib/redis/redis.js';
import { pool } from '@shared/lib/db/db.js';

const sysLog = createLogger('HEALTH-SERVER');

interface HealthCheckOptions {
  checkDb?: boolean;
  checkRedis?: boolean;
  checkImap?: () => Promise<{ ok: boolean; activeConnections: number; error?: string }>;
}

async function checkDb(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    if (!pool) return { ok: false, latencyMs: 0, error: 'pool_not_initialized' };
    await pool.query('SELECT 1');
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err: any) {
    return { ok: false, latencyMs: Date.now() - start, error: err.message };
  }
}

async function checkRedis(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    const client = await getRedisClient();
    if (!client) return { ok: false, latencyMs: 0, error: 'client_not_initialized' };
    const pong = await client.ping();
    return { ok: pong === 'PONG', latencyMs: Date.now() - start };
  } catch (err: any) {
    return { ok: false, latencyMs: Date.now() - start, error: err.message };
  }
}

export function startWorkerHealthServer(serviceName: string, port?: number, opts?: HealthCheckOptions): void {
  const PORT = port || parseInt(process.env.PORT || '8080', 10);
  const doDb = opts?.checkDb ?? true;
  const doRedis = opts?.checkRedis ?? true;

  const server = http.createServer(async (req, res) => {
    if (req.url === '/health' || req.url === '/') {
      let queues: Record<string, any> = {};
      try {
        queues = await getQueueHealthStatus();
      } catch (_e) {
        queues = { error: 'unavailable' };
      }

      const dbResult = doDb ? await checkDb() : { ok: true, latencyMs: 0 };
      const redisResult = doRedis ? await checkRedis() : { ok: true, latencyMs: 0 };
      const imapResult = opts?.checkImap ? await opts.checkImap() : { ok: true, activeConnections: 0 };
      const isHealthy = dbResult.ok && redisResult.ok && imapResult.ok;

      const body = JSON.stringify({
        status: isHealthy ? 'ok' : 'degraded',
        service: serviceName,
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        db: dbResult,
        redis: redisResult,
        imap: imapResult,
        queues,
      });

      res.writeHead(isHealthy ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(body);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    sysLog.info(`Health server listening`, { service: serviceName, port: PORT });
  });

  server.on('error', (err) => {
    sysLog.warn('Health server error', { error: (err as any).message });
  });
}
