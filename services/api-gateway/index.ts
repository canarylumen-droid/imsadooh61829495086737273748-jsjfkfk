import "@services/api-gateway/src/core/bootstrap.js";
import "dotenv/config";
import * as Sentry from '@sentry/node';
import "@shared/lib/media/pdf-polyfills.js";
try {
  import("@napi-rs/canvas");
} catch (e) {
  console.warn("@napi-rs/canvas load warning:", (e as any).message);
}

import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "@services/api-gateway/src/routes/index.js";
import { workerHealthMonitor } from "@shared/lib/monitoring/worker-health.js";
import { getQueueHealthStatus } from "@services/api-gateway/src/core/queues.js";
import { quotaService } from "@shared/lib/monitoring/quota-service.js";
import { sentinel } from "@services/api-gateway/src/middleware/sentinel.js";
import { advancedStorage } from "@shared/lib/storage/advanced-storage.js";
import { pubsubService } from "@shared/lib/realtime/pubsub-service.js";
import { fileURLToPath } from "url";
import fs from "fs";
import * as path from "path";
import crypto from "crypto";
import { sql } from "drizzle-orm";
import { users } from "@audnix/shared";
import { db } from "@shared/lib/db/db.js";
import { ServiceRegistry } from "@shared/lib/monitoring/service-registry.js";
import { createApp } from "./src/app.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  try {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log("Created uploads directory");
  } catch (err) {
    console.warn("Could not create uploads directory, using memory storage fallback");
  }
}

if (!process.env.VERCEL) {
  const dirs = ["public/uploads", "public/uploads/voice", "public/uploads/pdf", "public/uploads/avatars"];
  dirs.forEach((dir) => {
    try {
      const fullPath = path.join(process.cwd(), dir);
      if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
    } catch (err) {
      console.warn(`Could not create directory ${dir}:`, err);
    }
  });
}

const app = createApp();

function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

async function runMigrations() {
  try {
    const { runDatabaseMigrations } = await import("@shared/lib/db/migrator.js");
    await runDatabaseMigrations();
  } catch (e: any) {
    const errorMessage = e?.message || String(e);
    if (errorMessage.toLowerCase().includes('quota') || errorMessage.toLowerCase().includes('maintenance')) {
      console.error("[Boot] Database quota exceeded - skipping migration. Server will start in READ-ONLY mode if possible.");
      quotaService.reportDbError(e);
    } else {
      throw e;
    }
  }
}

(async () => {
  const criticalEnv = [
    { name: 'DATABASE_URL_POOL or DATABASE_URL', present: Boolean(process.env.DATABASE_URL_POOL || process.env.DATABASE_URL) },
    { name: 'REDIS_URL', present: Boolean(process.env.REDIS_URL) },
    { name: 'GEMINI_API_KEY', present: Boolean(process.env.GEMINI_API_KEY) },
    { name: 'ENCRYPTION_KEY', present: Boolean(process.env.ENCRYPTION_KEY) },
  ];
  const missing = criticalEnv.filter(({ present }) => !present).map(({ name }) => name);
  if (missing.length > 0) {
    console.error(`CRITICAL FAILURE: Missing required environment variables: ${missing.join(', ')}`);
    if (process.env.NODE_ENV === 'production') process.exit(1);
  }

  if (!process.env.GOOGLE_PUB_SUB_TOPIC) {
    console.log("GOOGLE_PUB_SUB_TOPIC not set. Real-time push notifications will be disabled.");
  }

  const serviceRegistry = new ServiceRegistry(process.env.REDIS_URL || 'redis://localhost:6379', 'api-gateway');
  await serviceRegistry.register({
    port: process.env.PORT || 5000,
    startTime: new Date().toISOString()
  });

  const _storage = advancedStorage;
  const _pubsub = pubsubService;

  app.get("/health", async (_req, res) => {
    try {
      const checks: Record<string, string> = {};
      let allHealthy = true;

      // DB check
      if (process.env.DATABASE_URL_POOL || process.env.DATABASE_URL) {
        try {
          await Promise.race([
            db.execute(sql`SELECT 1`),
            new Promise((_, reject) => setTimeout(() => reject(new Error('DB Timeout')), 5000))
          ]);
          checks.database = 'connected';
        } catch (e) {
          checks.database = 'unreachable';
          allHealthy = false;
        }
      } else {
        checks.database = 'not_configured';
      }

      // Redis check
      try {
        const { getRedisClient } = await import('@shared/lib/redis/redis.js');
        const redis = await getRedisClient();
        if (redis) {
          await Promise.race([
            redis.ping(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Redis Timeout')), 3000))
          ]);
          checks.redis = 'connected';
        } else {
          checks.redis = 'not_configured';
        }
      } catch (e) {
        checks.redis = 'unreachable';
        allHealthy = false;
      }

      // BullMQ queues status
      let queues: Record<string, any> = {};
      try { queues = await getQueueHealthStatus(); } catch (e) { queues = { error: 'unavailable' }; console.warn('[APIGateway] Queue health check failed:', (e as Error)?.message); }

      const statusCode = allHealthy ? 200 : 503;
      res.status(statusCode).json({
        status: allHealthy ? "ok" : "degraded",
        service: "api-gateway",
        checks,
        queues,
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0'
      });
    } catch (error) {
      console.error("Health Check Failed:", error);
      res.status(503).json({ status: "error", message: "Health check failed" });
    }
  });

  app.get("/metrics", async (_req, res) => {
    try {
      await getQueueHealthStatus();
      const { metricsService } = await import('@shared/lib/monitoring/metrics-service.js');
      res.set('Content-Type', metricsService.getContentType());
      res.end(await metricsService.getMetrics());
    } catch (error: any) {
      res.status(500).send(error?.message || 'metrics unavailable');
    }
  });

  const server = await registerRoutes(app);

  if (process.env.API_DISABLE_SOCKET !== 'true') {
    try {
      const { socketService } = await import('@shared/lib/realtime/socket-service.js');
      socketService.init(server);
    } catch (e) {
      log(`[System] Socket.io broadcaster could not be started: ${(e as any)?.message}`, 'error');
    }
  }

  const isProduction = process.env.NODE_ENV === "production" || !!process.env.RAILWAY_ENVIRONMENT || !!process.env.RAILWAY_PROJECT_ID;

  if (!isProduction) {
    const vitePath = './vit' + 'e.js';
    try {
      const { setupVite } = await import(vitePath);
      await setupVite(app, server);
    } catch (e) {
      if (!process.env.VERCEL) log(`[System] Vite dev server not loaded: ${(e as any)?.message}`);
    }
  } else {
    const { serveStatic } = await import("@shared/lib/utils/static.js");
    serveStatic(app);
  }

  if (!process.env.VERCEL) {
    const appRole = process.env.APP_ROLE || 'api';
    const PORT = parseInt(process.env.PORT || "5000", 10);

    if (appRole !== 'worker') {
      server.listen(PORT, "0.0.0.0", () => {
        log(`[${appRole.toUpperCase()}] API Server running at http://0.0.0.0:${PORT}`);
      });
    } else {
      log("[WORKER] Starting background synchronization node...");
    }

    (async () => {
      if (process.env.DATABASE_URL_POOL || process.env.DATABASE_URL) {
        try {
          log("Initializing database & migrations...");
          const { acquireDistributedLock } = await import('@shared/lib/redis/redis.js');
          const migrationLock = await acquireDistributedLock('db:migrations', 300);
          if (migrationLock) {
            log("[Migration] Lock acquired. Running migrations...");
            await runMigrations();
            log("[Migration] Database ready");
          } else {
            log("[Migration] Another node is handling migrations. Skipping.");
          }
        } catch (e) {
          log(`Migration failed: ${e instanceof Error ? e.message : String(e)}`, "error");
          quotaService.reportDbError(e);
        }
        log("[API Gateway] HTTP server ready.", "api");
        if (process.env.UNIFIED_MODE === 'true') {
          try {
            const { startUnifiedWorkers } = await import('./src/core/unified-worker-starter.js');
            await startUnifiedWorkers();
          } catch (err: any) { log(`Unified worker starter failed: ${err.message}`, "error"); }
        } else { log("Worker services are isolated (UNIFIED_MODE=false).", "api"); }
      }
    })();

    const shutdown = async (signal: string) => {
      log(`Received ${signal}. Starting graceful shutdown...`);

      // 1. Stop accepting new connections (load balancer health check will fail)
      server.close();
      log("HTTP server stopped accepting new connections.");

      // 2. Close BullMQ queues so no new jobs are picked up
      try { const { closeQueues } = await import("@shared/lib/queue.js"); await closeQueues(); } catch {}
      try { const { campaignWorker } = await import("@shared/lib/queues/campaign-queue.js"); if (campaignWorker) await campaignWorker.close(); } catch {}
      try { const { aiProcessingQueue } = await import("./src/core/queues.js"); if (aiProcessingQueue) await aiProcessingQueue.close(); } catch {}

      // 3. Stop background workers
      try { const { imapIdleManager } = await import("@services/email-service/src/email/imap-idle-manager.js"); imapIdleManager.stop(); } catch {}
      try { const { mailboxHealthService } = await import("@services/email-service/src/email/mailbox-health-service.js"); mailboxHealthService.stop(); } catch {}
      try { const { instagramSyncWorker } = await import("@services/social-worker/src/social/workers/instagram-sync-worker.js"); instagramSyncWorker.stop(); } catch {}

      // 4. Wait for active requests to finish (up to 30s)
      log("Waiting for active requests to complete (max 30s)...");
      const drainStart = Date.now();
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          server.getConnections((err, count) => {
            if (err) { clearInterval(check); resolve(); return; }
            if (count === 0 || Date.now() - drainStart > 30000) {
              clearInterval(check);
              if (count > 0) log(`Forcing shutdown with ${count} active connections.`);
              resolve();
            }
          });
        }, 500);
      });

      // 5. Deregister from service registry so load balancer stops sending traffic
      try { await serviceRegistry.deregister(); } catch {}

      log("Graceful shutdown complete. Exiting.");
      process.exit(0);
    };

    // Docker/Railway sends SIGTERM on deploy
    process.on('SIGTERM', shutdown.bind(null, 'SIGTERM'));
    process.on('SIGINT', shutdown.bind(null, 'SIGINT'));
  }
})();

Sentry.setupExpressErrorHandler(app);

app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  const status = err.status || err.statusCode || 500;
  log(`[FATAL ERROR] ${req.method} ${req.path}: ${err.message || err}`, "error");
  if (err.stack && process.env.NODE_ENV !== 'production') console.error(err.stack);
  if (process.env.OBSERVABILITY_SENTRY_DSN) Sentry.captureException(err);
  if (res.headersSent) return next(err);
  const isQuotaError = String(err.code) === 'XX000' || (err.message && (
    err.message.toLowerCase().includes('quota') || err.message.includes('XX000') || err.message.toLowerCase().includes('capacity limit')
  ));
  if (isQuotaError) {
    quotaService.reportDbError(err);
    return res.status(503).json({
      error: "Service Temporarily Unavailable",
      message: "Database capacity limit reached. We are automatically throttling requests to restore service. Please try again in 15 minutes.",
      code: "XX000"
    });
  }
  res.status(status).json({
    error: "Internal Server Error",
    message: process.env.NODE_ENV === 'production' ? "An unexpected error occurred. Please try again later." : err.message,
    code: err.code || "INTERNAL_ERROR"
  });
});

export default app;
