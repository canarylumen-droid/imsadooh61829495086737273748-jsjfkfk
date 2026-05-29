import '@services/api-gateway/src/core/bootstrap.js';

import express from 'express';
import http from 'http';
import { createLogger } from '@services/api-gateway/src/core/logger.js';
import { socketService } from '@shared/lib/realtime/socket-service.js';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';
import '@shared/lib/realtime/redis-pubsub.js';
import { ServiceRegistry } from '@shared/lib/monitoring/service-registry.js';

const log = createLogger('SOCKET');
const serviceRegistry = new ServiceRegistry(process.env.REDIS_URL || 'redis://localhost:6379', 'socket-service');

const app = express();
const port = parseInt(process.env.SOCKET_PORT || process.env.PORT || '8087', 10);
const server = http.createServer(app);

serviceRegistry.register({ version: '1.0.0' }).catch(() => {});

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'socket',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.get('/', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'socket' });
});

wsSync.initialize(server);
socketService.init(server);

server.listen(port, '0.0.0.0', () => {
  log.info('Socket service listening', { port, paths: ['/socket.io', '/ws'] });
});

const shutdown = async (signal: string) => {
  log.info(`${signal} - shutting down Socket service`);
  try { await serviceRegistry.deregister(); } catch (_e) {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
