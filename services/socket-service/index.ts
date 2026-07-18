import '@services/api-gateway/src/core/bootstrap.js';

import express from 'express';
import http from 'http';
import { createLogger } from '@services/api-gateway/src/core/logger.js';
import { socketService } from '@shared/lib/realtime/socket-service.js';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';
import '@shared/lib/realtime/redis-pubsub.js';
import { ServiceRegistry } from '@shared/lib/monitoring/service-registry.js';
import { getSharedRedisConnection } from '@shared/lib/queues/redis-config.js';

const DNS_RESULT_QUEUE = process.env.DNS_RESULT_QUEUE_NAME || 'dns-verify-results';

async function startDnsResultConsumer() {
  try {
    const { storage } = await import('@shared/lib/storage/storage.js');
    const redis = getSharedRedisConnection();
    while (true) {
      const result = await redis.brpop(DNS_RESULT_QUEUE, 2);
      if (!result) continue;
      try {
        const data = JSON.parse(result[1]);
        if (data.error) { log.warn(`[DNS] Rust verification error: ${data.error}`, { jobId: data.job_id }); continue; }
        const { user_id, result: dnsResult } = data;
        if (!user_id || !dnsResult) continue;
        await storage.createDomainVerification(user_id, {
          domain: dnsResult.domain,
          verificationResult: {
            spf: { found: dnsResult.spf.found, valid: dnsResult.spf.valid, record: dnsResult.spf.record, issues: dnsResult.spf.issues },
            dkim: { found: dnsResult.dkim.found, valid: dnsResult.dkim.valid, selector: dnsResult.dkim.selector, record: dnsResult.dkim.record, issues: dnsResult.dkim.issues },
            dmarc: { found: dnsResult.dmarc.found, valid: dnsResult.dmarc.valid, policy: dnsResult.dmarc.policy, record: dnsResult.dmarc.record, issues: dnsResult.dmarc.issues },
            mx: { found: dnsResult.mx_found, ips: dnsResult.mx },
            blacklist: { isBlacklisted: dnsResult.blacklist.is_blacklisted, listedOn: dnsResult.blacklist.listed_on },
            overallScore: dnsResult.overall_score,
            overallStatus: dnsResult.overall_status,
          },
        });
        wsSync.notifyDnsVerified(user_id, {
          domain: dnsResult.domain,
          score: dnsResult.overall_score,
          spf: dnsResult.spf.valid,
          dkim: dnsResult.dkim.valid,
          dmarc: dnsResult.dmarc.valid,
          mx: dnsResult.mx_found,
          blacklist: dnsResult.blacklist.is_blacklisted,
        });
        wsSync.notifyStatsUpdated(user_id);
        log.info(`[DNS] Rust verified ${dnsResult.domain} for user ${user_id} (score: ${dnsResult.overall_score}, status: ${dnsResult.overall_status})`);
      } catch (e: any) {
        log.error(`[DNS] Failed to process Rust DNS result: ${e.message}`);
      }
    }
  } catch (e: any) {
    log.error(`[DNS] Failed to start Rust DNS consumer: ${e.message}`);
  }
}

const log = createLogger('SOCKET');
const serviceRegistry = new ServiceRegistry(process.env.REDIS_URL || 'redis://localhost:6379', 'socket-service');

const app = express();
const port = parseInt(process.env.SOCKET_PORT || process.env.PORT || '8087', 10);
const server = http.createServer(app);

serviceRegistry.register({ version: '1.0.0' }).catch(err => console.warn('[SocketService] Service registry registration failed:', err.message));

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

if (process.env.ENABLE_RUST_DNS === 'true') {
  startDnsResultConsumer();
  log.info('[DNS] Rust DNS result consumer started', { queue: DNS_RESULT_QUEUE });
}

server.listen(port, '0.0.0.0', () => {
  log.info('Socket service listening', { port, paths: ['/socket.io', '/ws'] });
});

const shutdown = async (signal: string) => {
  log.info(`${signal} — shutting down Socket service`);

  // 1. Deregister from service registry immediately
  try { await serviceRegistry.deregister(); } catch {}

  // 2. Stop accepting new socket connections
  server.close(() => {
    log.info('HTTP server closed. Socket service exiting.');
    process.exit(0);
  });

  // 3. Force close remaining connections after 30s
  const forceExit = setTimeout(() => {
    log.warn('Forceful shutdown after timeout');
    process.exit(1);
  }, 30_000).unref();

  // 4. Track active socket connections and drain them
  let drainCheck: any;
  drainCheck = setInterval(() => {
    server.getConnections((_err, count) => {
      if (count === 0) {
        clearInterval(drainCheck);
        clearTimeout(forceExit);
        log.info('All connections drained. Exiting.');
        process.exit(0);
      }
    });
  }, 500);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Global error handlers for stability
process.on('unhandledRejection', (reason) => {
  console.error('[SOCKET] Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[SOCKET] Uncaught Exception:', err);
});
