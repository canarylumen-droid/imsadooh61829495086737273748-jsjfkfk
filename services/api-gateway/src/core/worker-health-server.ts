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

const sysLog = createLogger('HEALTH-SERVER');

export function startWorkerHealthServer(serviceName: string, port?: number): void {
  const PORT = port || parseInt(process.env.PORT || '8080', 10);

  const server = http.createServer(async (req, res) => {
    if (req.url === '/health' || req.url === '/') {
      let queues: Record<string, any> = {};
      try {
        queues = await getQueueHealthStatus();
      } catch (_e) {
        queues = { error: 'unavailable' };
      }

      const body = JSON.stringify({
        status: 'ok',
        service: serviceName,
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        queues,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
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
