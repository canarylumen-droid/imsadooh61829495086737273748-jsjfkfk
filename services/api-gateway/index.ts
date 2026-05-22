// Bootstrap MUST be first â€” applies global DNS IPv4 fix + Sentry init
import "@services/api-gateway/src/core/bootstrap.js";

import "dotenv/config";
import * as Sentry from '@sentry/node';
import "@shared/lib/media/pdf-polyfills.js";
try {
  // Ensure @napi-rs/canvas is loadable if needed by dependencies
  import("@napi-rs/canvas");
} catch (e) {
  console.warn("âš ï¸ @napi-rs/canvas load warning:", (e as any).message);
}

import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import { registerRoutes } from "@services/api-gateway/src/routes/index.js";
import { workerHealthMonitor } from "@shared/lib/monitoring/worker-health.js";
import { getQueueHealthStatus } from "@services/api-gateway/src/core/queues.js";
import { quotaService } from "@shared/lib/monitoring/quota-service.js";
import { apiLimiter, authLimiter } from "@services/api-gateway/src/middleware/rate-limit.js";
import { sentinel } from "@services/api-gateway/src/middleware/sentinel.js";
import { advancedStorage } from "@shared/lib/storage/advanced-storage.js";
import { pubsubService } from "@shared/lib/realtime/pubsub-service.js";
import { fileURLToPath } from "url";
import fs from "fs";
import * as path from "path";
import crypto from "crypto";
import hpp from "hpp";
import csrf from "csurf";
import { sql } from "drizzle-orm";
import { users } from "@audnix/shared";
import { db, pool } from "@shared/lib/db/db.js";
import { ServiceRegistry } from "@shared/lib/monitoring/service-registry.js";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  try {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log("âœ… Created uploads directory");
  } catch (err) {
    console.warn(
      "âš ï¸ Could not create uploads directory, using memory storage fallback",
    );
  }
}

if (!process.env.VERCEL) {
  const uploadDirs = [
    "public/uploads",
    "public/uploads/voice",
    "public/uploads/pdf",
    "public/uploads/avatars",
  ];
  uploadDirs.forEach((dir) => {
    try {
      const fullPath = path.join(process.cwd(), dir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
    } catch (err) {
      console.warn(`Could not create directory ${dir}:`, err);
    }
  });
}

const app = express();

// 1. [EMERGENCY] Move Quota Sentinel to the absolute top to protect all requests (including session store)
app.use(quotaService.getSentinelMiddleware());

app.use(hpp());

// Unified CORS middleware for Railway deployment
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOriginsStr = process.env.ALLOWED_ORIGINS || '';
  const allowedOrigins = allowedOriginsStr.split(',').map(o => o.trim()).filter(Boolean);
  
  if (process.env.NODE_ENV !== 'production' && allowedOrigins.length === 0) {
    allowedOrigins.push('http://localhost:5000', 'http://www.audnixai.com', 'http://audnixai.com');
  }
  
  const isAllowedOrigin = origin && (
    origin.endsWith('.up.railway.app') || 
    allowedOrigins.includes(origin)
  );

  if (origin && isAllowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS,PATCH');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

const nodeEnv = process.env.NODE_ENV || "development";
app.set("env", nodeEnv);
// Trust one hop of proxy (Railway/Load Balancers)
app.set("trust proxy", 1);

if (process.env.NODE_ENV === "production") {
  if (!process.env.SESSION_SECRET || !process.env.ENCRYPTION_KEY) {
    console.error("âŒ CRITICAL ERROR: SESSION_SECRET or ENCRYPTION_KEY missing in production.");
    process.exit(1);
  }
} else {
  // In development, we can fallback but with a warning
  if (!process.env.SESSION_SECRET) {
    console.warn("âš ï¸ SESSION_SECRET not set - using development fallback");
    process.env.SESSION_SECRET = "audnix-dev-secret-do-not-use-in-prod";
  }
  if (!process.env.ENCRYPTION_KEY) {
    console.warn("âš ï¸ ENCRYPTION_KEY not set - using development fallback");
    process.env.ENCRYPTION_KEY = "audnix-dev-key-32-chars-long-!!!";
  }
}

const hasSupabaseUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
const hasSupabaseKey = Boolean(process.env.SUPABASE_ANON_KEY);

if (hasSupabaseUrl && hasSupabaseKey) {
  console.log("âœ… Supabase Auth configured");
}

const hasEmailKey = Boolean(process.env.TWILIO_SENDGRID_API_KEY);
const senderEmail = process.env.TWILIO_EMAIL_FROM;
console.log(`ðŸ“§ Email Configuration Check:
  - API Key Present: ${hasEmailKey ? "YES âœ…" : "NO âŒ"}
  - Sender Email: ${senderEmail || "Default (auth@audnixai.com)"}
`);

if (!hasEmailKey) {
  console.error(
    "âŒ CRITICAL: TWILIO_SENDGRID_API_KEY is missing! Emails will fail.",
  );
}

app.use("/api/", apiLimiter);
app.use("/api/auth/", authLimiter);
app.use("/*/webhook/*", express.json({
  verify: (req: any, _res, buf) => {
    req.rawBody = buf;
  }
}));

app.use(
  "/api/instagram/callback",
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

// Trust proxy already set globally above
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use((req, res, next) => {
  const start = Date.now();
  const currentPath = req.path;
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (
      res.statusCode >= 400 ||
      duration > 1000 ||
      currentPath.startsWith("/api")
    ) {
      log(`${req.method} ${currentPath} ${res.statusCode} in ${duration}ms`);
    }
  });
  next();
});

// Phase 9: Global Request Timeout Middleware (15s)
// Prevents slow DB queries or hanging AI streams from exhausting active sockets
app.use((req, res, next) => {
  res.setTimeout(30000, () => {
    if (!res.headersSent) {
      console.warn(`[TIMEOUT] ${req.method} ${req.path} timed out after 30s`);
      res.status(503).json({
        error: "Service Temporarily Unavailable",
        message: "The request took too long to complete. This may be due to high system load or slow provider response.",
        code: "GATEWAY_TIMEOUT"
      });
    }
  });
  next();
});

const sessionSecret = process.env.SESSION_SECRET!;
const PgSession = connectPgSimple(session);
let sessionStore: session.Store | undefined;

if (process.env.DATABASE_URL && pool) {
  sessionStore = new PgSession({
    pool: pool,
    tableName: "user_sessions",
    createTableIfMissing: true,
    pruneSessionInterval: 60 * 30, // Less frequent pruning
    schemaName: "public",
  });

  // Handle session store errors to prevent server-wide 500s
  (sessionStore as any).on('error', (err: any) => {
    console.error("ðŸš¨ [SESSION STORE ERROR]", err);
    quotaService.reportDbError(err);
  });

  // [NEW] Startup connectivity check
  pool.query('SELECT 1').then(() => {
    log("âœ… PostgreSQL session store connectivity verified", "session");
  }).catch((err: any) => {
    console.error("ðŸš¨ [SESSION] Failed initial connectivity check:", err);
  });

  console.log("âœ… Using PostgreSQL session store (Shared Pool)");
}

const sessionConfig: session.SessionOptions = {
  secret: sessionSecret,
  resave: false, // HARDENED: Only save session if modified to reduce DB pressure
  saveUninitialized: false,
  name: "audnix.sid",
  cookie: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
    sameSite: "lax",
    path: "/",
  },
  store: sessionStore,
  rolling: true, // HARDENED: Reset maxAge on every response to keep session alive during active use
  proxy: true,
};

app.use(session(sessionConfig));

const ALLOWED_ORIGINS = [
  "https://www.audnixai.com",
  "https://audnixai.com",
  "http://localhost:5173",
  "http://localhost:5000",
  process.env.RAILWAY_STATIC_URL
    ? `https://${process.env.RAILWAY_STATIC_URL}`
    : null,
]
  .flat()
  .filter(Boolean) as string[];

const csrfProtection = csrf({ cookie: false });

app.use((req, res, next) => {
  const skipPaths = [
    "/",
    "/index.html",
    "/assets",
    "/api/webhooks",
    "/api/webhook",
    "/api/instagram/callback",
    "/api/instagram/webhook",
    "/api/outreach",
    "/api/facebook/webhook",
    "/api/user/auth",
    "/api/auth",
    "/api/auth/login",
    "/api/auth/signup",
    "/api/auth/register",
    "/api/auth/check",
    "/api/auth/me",
    "/api/auth/logout",
    "/api/user/auth/login",
    "/api/user/auth/signup",
    "/api/user/auth/register",
    "/api/user/auth/check",
    "/api/custom-email",
    "/api/brand-pdf",
    "/api/pdf/upload",
    "/api/prospecting",
    "/api/user/avatar",
    "/api/user/profile",
    "/api/video",
    "/api/expert-chat",
    "/auth/instagram",
    "/api/health",
    "/api/automation/content",
    "/api/video-automation",
    "/api/prospecting/v2",
    "/api/oauth/instagram/callback",
    "/api/oauth/instagram/webhook",
    "/api/oauth/facebook/webhook",
    "/api/oauth/gmail/callback",
    "/api/oauth/google-redirect/gmail/callback",
    "/api/oauth/google-calendar/callback",
    "/api/oauth/google/callback",
    "/api/oauth/calendly/callback",
    "/api/oauth/outlook/callback",
    "/api/messages",
    "/api/notifications",
    "/api/dns/verify",
    "/api/leads",
    "/api/bulk",
  ];

  const requestPath = req.path;
  // Skip security checks for:
  // 1. Non-API routes (React frontend routing handles its own logic)
  // 2. Local development
  // 3. Static assets
  const isApiRoute = requestPath.startsWith("/api/");
  const isStaticAsset =
    /\.(png|jpg|jpeg|gif|svg|ico|css|js|woff2?|ttf|otf|map|json|webp|webmanifest|txt|xml)$/i.test(
      requestPath,
    ) || requestPath.includes("/assets/");
  const isSkippableRoute = skipPaths.some(
    (p) => requestPath === p || requestPath.startsWith(p + "/"),
  );

  if (
    !isApiRoute ||
    isSkippableRoute ||
    process.env.NODE_ENV === "development" ||
    isStaticAsset
  ) {
    return next();
  }

  const origin = req.get("origin") || req.get("referer");
  const host = req.get("host");

  if (origin && process.env.NODE_ENV === "production") {
    try {
      const originUrl = new URL(origin);
      const isAllowed = ALLOWED_ORIGINS.some((allowed) => {
        try {
          const allowedUrl = new URL(allowed);
          return originUrl.host === allowedUrl.host;
        } catch {
          return originUrl.host === allowed;
        }
      });

      // Allow standard subdomains and common deployment platforms
      const isAllowedSuffix =
        originUrl.hostname.endsWith(".railway.app") ||
        originUrl.hostname === "audnixai.com" ||
        originUrl.hostname.endsWith(".audnixai.com") ||
        originUrl.hostname === (host?.split(":")[0] || "");

      if (!isAllowed && !isAllowedSuffix) {
        console.warn(`âš ï¸ Origin validation failed for: ${origin} on path: ${req.path}`);
        console.warn(`  Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
        console.warn(`  Host: ${host}`);
        return res
          .status(403)
          .json({ error: "Forbidden", message: "Invalid request origin" });
      }
    } catch (e) {
      return res
        .status(403)
        .json({ error: "Forbidden", message: "Invalid origin header" });
    }
  }

  csrfProtection(req as any, res as any, (err: any) => {
    if (err) {
      return res
        .status(403)
        .json({
          error: "Forbidden",
          message: "Invalid CSRF token",
          code: "EBADCSRFTOKEN",
        });
    }
    next();
  });
});

app.get("/api/csrf-token", (req, res) => {
  const token = (req as any).csrfToken();
  res.cookie("XSRF-TOKEN", token, {
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  });
  res.json({ csrfToken: token });
});

app.use((req, res, next) => {
  const origin = req.get("origin");
  const isAllowedDomain =
    !origin ||
    ALLOWED_ORIGINS.includes(origin) ||
    origin.endsWith(".railway.app") ||
    origin.endsWith(".up.railway.app") ||
    origin.endsWith(".audnixai.com");

  if (isAllowedDomain && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  } else if (!origin) {
    // SECURITY: Use a specific origin instead of mirroring or a wildcard in production
    res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGINS[0]);
  }
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS, PATCH",
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-CSRF-Token, X-Requested-With",
  );
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

async function runMigrations() {
  try {
    const { runDatabaseMigrations } = await import("@shared/lib/db/migrator.js");
    await runDatabaseMigrations();
  } catch (e: any) {
    const errorMessage = e?.message || String(e);
    if (errorMessage.toLowerCase().includes('quota') || errorMessage.toLowerCase().includes('maintenance')) {
      console.error("âš ï¸ [Boot] Database quota exceeded - skipping migration for now. Server will start in READ-ONLY mode if possible.");
      quotaService.reportDbError(e);
    } else {
       throw e; // Rethrow actual structural errors
    }
  }
}

(async () => {
  // Step 0: Validate Critical Environment Variables for Production Readiness
  const criticalEnv = ['DATABASE_URL', 'REDIS_URL', 'GEMINI_API_KEY', 'ENCRYPTION_KEY'];
  const missing = criticalEnv.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error(`âŒ [Advanced Infra] CRITICAL FAILURE: Missing required environment variables: ${missing.join(', ')}`);
    if (process.env.NODE_ENV === 'production') {
      console.error('ðŸ›‘ System cannot start in production without these keys. Exiting.');
      process.exit(1);
    }
  }

  if (!process.env.GOOGLE_PUB_SUB_TOPIC) {
    console.log("?? [Advanced Infra] GOOGLE_PUB_SUB_TOPIC not set. Real-time push notifications will be disabled.");
  }
  
  // Step 1: Register Service for Discovery (Senior Engineering)
  const serviceRegistry = new ServiceRegistry(process.env.REDIS_URL || 'redis://localhost:6379', 'api-gateway');
  await serviceRegistry.register({
    port: process.env.PORT || 5000,
    startTime: new Date().toISOString()
  });

  // Initialize services
  const _storage = advancedStorage;
  const _pubsub = pubsubService;

  app.get("/health", async (_req, res) => {
    try {
      // â”€â”€ DB ping â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      if (process.env.DATABASE_URL) {
        await Promise.race([
          db.execute(sql`SELECT 1`),
          new Promise((_, reject) => setTimeout(() => reject(new Error('DB Timeout')), 5000))
        ]);
      }

      // â”€â”€ Queue depths (from Redis/BullMQ) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      let queues: Record<string, any> = {};
      try {
        queues = await getQueueHealthStatus();
      } catch (_e) {
        queues = { error: 'unavailable' };
      }

      res.status(200).json({
        status: "ok",
        service: "api-gateway",
        database: "connected",
        architecture: "microservices",
        queues,
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("ðŸš¨ Health Check Failed:", error);
      res.status(503).json({ status: "error", message: "Database unreachable" });
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

  // Phase 8: Initialize real-time event broadcaster unless the API is running
  // as the API-only Railway service. Dedicated sockets boot via start:socket.
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
    // SECURITY/RAILWAY WORKAROUND: Hide the actual string import to prevent 
    // @vercel/nft from statically analyzing and bundling vite + rollout native dependencies
    // into the production container which crashes on startup.
    const vitePath = './vit' + 'e.js'; 
    try {
      const { setupVite } = await import(/* @vite-ignore */ vitePath);
      await setupVite(app, server);
    } catch (e) {
      if (!process.env.VERCEL) {
        log(`[System] Vite dev server not loaded: ${(e as any)?.message}`);
      }
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
        log(`ðŸš€ [${appRole.toUpperCase()}] API Server running at http://0.0.0.0:${PORT}`);
      });
    } else {
      log(`âš™ï¸ [WORKER] Starting background synchronization node...`);
    }

    // Post-startup initialization (Non-blocking)
    (async () => {
        if (process.env.DATABASE_URL) {
          try {
            log("ðŸ“¦ Initializing database & migrations...");
            
            // Phase 55: Distributed Migration Lock
            // Only one node in the entire cluster should attempt migrations
            const { acquireDistributedLock } = await import('@shared/lib/redis/redis.js');
            const migrationLock = await acquireDistributedLock('db:migrations', 300); // 5 minute lock
            
            if (migrationLock) {
              log("ðŸ›¡ï¸ [Migration] Lock acquired. Running migrations...");
              await runMigrations();
              log("âœ… [Migration] Database ready");
            } else {
              log("â³ [Migration] Another node is handling migrations. Skipping.");
            }
          } catch (e) {
            log(`âŒ Migration failed: ${e instanceof Error ? e.message : String(e)}`, "error");
            quotaService.reportDbError(e);
          }

          // â”€â”€ API Gateway Role â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          // This process ONLY serves HTTP + WebSocket traffic.
          // All background processing runs in dedicated Railway worker services:
          //   - start:worker:email  â†’ server/services/email/index.ts
          //   - start:worker:ai     â†’ server/services/ai/index.ts
          //   - start:worker:outreach â†’ server/services/outreach/index.ts
          //   - start:worker:social â†’ server/services/social/index.ts
          //   - start:worker:billing â†’ server/services/billing/index.ts
          //
          // Jobs are dispatched via Redis (BullMQ) queues defined in server/core/queues.ts
          // If any worker service crashes, this API continues serving users unaffected.
          log("âœ… [API Gateway] HTTP server ready. Worker services are isolated.", "api");
        }
      })();

    // Graceful Shutdown Handlers
    const shutdown = async (signal: string) => {
      log(`ðŸ›‘ Received ${signal}. Shutting down gracefully...`);

      // 1. Stop accepting new requests immediately
      server.close(() => {
        log("ðŸ‘‹ HTTP server closed. Process exiting.");
        process.exit(0);
      });

      // 2. Stop background services to release sockets and DB connections
      try {
        const { imapIdleManager } = await import("@services/email-service/src/email/imap-idle-manager.js");
        imapIdleManager.stop();
      } catch (e) { /* service may not have started */ }

      try {
        const { mailboxHealthService } = await import("@services/email-service/src/email/mailbox-health-service.js");
        mailboxHealthService.stop();
      } catch (e) { /* service may not have started */ }

      try {
        const { instagramSyncWorker } = await import("@services/social-worker/src/social/workers/instagram-sync-worker.js");
        instagramSyncWorker.stop();
      } catch (e) { /* service may not have started */ }

      // 3. Force exit after 10s if graceful shutdown fails
      setTimeout(() => {
        log("âš ï¸ Forceful shutdown triggered");
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', async () => {
      await serviceRegistry.deregister();
      shutdown('SIGTERM');
    });
    process.on('SIGINT', async () => {
      await serviceRegistry.deregister();
      shutdown('SIGINT');
    });

  }
})();

Sentry.setupExpressErrorHandler(app);

// GLOBAL ERROR HANDLER - Catch anything that bubbled up and log it
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  const status = err.status || err.statusCode || 500;
  log(`ðŸš¨ [FATAL ERROR] ${req.method} ${req.path}: ${err.message || err}`, "error");
  
  if (err.stack && process.env.NODE_ENV !== 'production') {
    console.error(err.stack);
  }

  // Sentry report if configured
  if (process.env.OBSERVABILITY_SENTRY_DSN) {
    Sentry.captureException(err);
  }

  if (res.headersSent) {
    return next(err);
  }

  // Specialized response for database quota issues
  const isQuotaError = 
    String(err.code) === 'XX000' || 
    (err.message && (
      err.message.toLowerCase().includes('quota') || 
      err.message.includes('XX000') ||
      err.message.toLowerCase().includes('capacity limit')
    ));
  if (isQuotaError) {
    quotaService.reportDbError(err); // Ensure service tracks it
    return res.status(503).json({
      error: "Service Temporarily Unavailable",
      message: "Database capacity limit reached. We are automatically throttling requests to restore service. Please try again in 15 minutes.",
      code: "XX000"
    });
  }

  res.status(status).json({
    error: "Internal Server Error",
    message: process.env.NODE_ENV === 'production' 
      ? "An unexpected error occurred. Please try again later."
      : err.message,
    code: err.code || "INTERNAL_ERROR"
  });
});

export default app;


