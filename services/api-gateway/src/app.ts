import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { quotaService } from "@shared/lib/monitoring/quota-service.js";
import { apiLimiter, authLimiter } from "@services/api-gateway/src/middleware/rate-limit.js";
import { securityHeaders } from "@services/api-gateway/src/middleware/security-headers.js";
import { pool } from "@shared/lib/db/db.js";
import hpp from "hpp";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { doubleCsrf } from "csrf-csrf";

function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

export function createApp() {
  const app = express();

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', mode: 'starting', timestamp: new Date().toISOString() });
  });

  app.use(quotaService.getSentinelMiddleware());
  app.use(hpp());
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'", "https://www.audnixai.com", "wss://www.audnixai.com"],
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  }));
  app.use(securityHeaders);

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowedOriginsStr = process.env.ALLOWED_ORIGINS || '';
    let allowedOrigins = allowedOriginsStr.split(',').map(o => o.trim()).filter(Boolean);

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

  const nodeEnv = process.env.NODE_ENV || "development";
  app.set("env", nodeEnv);
  app.set("trust proxy", 1);

  if (process.env.NODE_ENV === "production") {
    if (!process.env.SESSION_SECRET || !process.env.ENCRYPTION_KEY) {
      console.error("CRITICAL ERROR: SESSION_SECRET or ENCRYPTION_KEY missing in production.");
      process.exit(1);
    }
  } else {
    if (!process.env.SESSION_SECRET) {
      console.warn("SESSION_SECRET not set - using development fallback");
      process.env.SESSION_SECRET = "audnix-dev-secret-do-not-use-in-prod";
    }
    if (!process.env.ENCRYPTION_KEY) {
      console.warn("ENCRYPTION_KEY not set - using development fallback");
      process.env.ENCRYPTION_KEY = "audnix-dev-key-32-chars-long-!!!";
    }
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

  app.use((req, res, next) => {
    // Auth/signup routes get a longer timeout — bcrypt + session save under DB load
    // can legitimately take >30s on cold-start Railway deployments.
    const isAuthRoute = req.path.startsWith('/api/user/auth') || req.path.startsWith('/api/auth');
    const timeoutMs = isAuthRoute ? 60000 : 30000;

    res.setTimeout(timeoutMs, () => {
      if (!res.headersSent) {
        console.warn(`[TIMEOUT] ${req.method} ${req.path} timed out after ${timeoutMs / 1000}s`);
        res.status(503).json({
          error: "Request Timeout",
          message: "The request took too long to complete. Please try again.",
          code: "REQUEST_TIMEOUT"
        });
      }
    });
    next();
  });

  const sessionSecret = process.env.SESSION_SECRET!;
  const PgSession = connectPgSimple(session);
  let sessionStore: session.Store | undefined;

  if ((process.env.DATABASE_URL_POOL || process.env.DATABASE_URL) && pool) {
    sessionStore = new PgSession({
      pool: pool,
      tableName: "user_sessions",
      createTableIfMissing: true,
      pruneSessionInterval: 60 * 30,
      schemaName: "public",
    });

    (sessionStore as any).on('error', (err: any) => {
      console.error("SESSION STORE ERROR", err);
      quotaService.reportDbError(err);
    });

    pool.query('SELECT 1').then(() => {
      log("PostgreSQL session store connectivity verified", "session");
    }).catch((err: any) => {
      console.error("SESSION Failed initial connectivity check:", err);
    });

    console.log("Using PostgreSQL session store (Shared Pool)");
  }

  const sessionConfig: session.SessionOptions = {
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    name: "audnix.sid",
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 30,
      sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
      path: "/",
    },
    store: sessionStore,
    rolling: true,
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

  app.use(cookieParser());

  const { doubleCsrfProtection, generateCsrfToken } = doubleCsrf({
    getSecret: () => process.env.CSRF_SECRET || process.env.SESSION_SECRET || 'fallback-secret',
    getSessionIdentifier: (req) => req.session?.userId || req.ip || 'anonymous',
    cookieName: "XSRF-TOKEN",
    cookieOptions: {
      sameSite: "strict",
      path: "/",
      secure: process.env.NODE_ENV === "production",
    },
    size: 64,
    getCsrfTokenFromRequest: (req) => req.headers["x-csrf-token"] as string,
    ignoredMethods: ["GET", "HEAD", "OPTIONS"],
  });

  const skipPaths = [
    "/index.html", "/assets", "/api/webhooks", "/api/webhook",
    "/api/instagram/callback", "/api/instagram/webhook", "/api/outreach",
    "/api/facebook/webhook", "/api/user/auth", "/api/auth",
    "/api/auth/login", "/api/auth/signup", "/api/auth/register",
    "/api/auth/check", "/api/auth/me", "/api/auth/logout",
    "/api/user/auth/login", "/api/user/auth/signup", "/api/user/auth/register",
    "/api/user/auth/check", "/api/custom-email", "/api/brand-pdf",
    "/api/pdf/upload", "/api/prospecting", "/api/user/avatar",
    "/api/user/profile", "/api/video", "/api/expert-chat",
    "/auth/instagram", "/api/health", "/api/automation/content",
    "/api/video-automation", "/api/prospecting/v2",
    "/api/oauth/instagram/callback", "/api/oauth/instagram/webhook",
    "/api/oauth/facebook/webhook", "/api/oauth/gmail/callback",
    "/api/oauth/google-redirect/gmail/callback",
    "/api/oauth/google-calendar/callback", "/api/oauth/google/callback",
    "/api/oauth/calendly/callback", "/api/oauth/outlook/callback",
    "/api/messages", "/api/notifications", "/api/dns/verify",
    "/api/leads", "/api/bulk",
  ];

  app.use((req, res, next) => {
    if (process.env.NODE_ENV !== 'production') return next();
    const origin = req.headers.origin;
    if (!origin) return next();
    const isAllowed = ALLOWED_ORIGINS.some(allowed =>
      origin === allowed || origin.endsWith(allowed)
    );
    const isSkip = skipPaths.some(p => req.path.startsWith(p));
    if (!isAllowed && !isSkip) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  });

  app.use((req, res, next) => {
    if (skipPaths.some(p => req.path.startsWith(p))) return next();
    doubleCsrfProtection(req, res, next);
  });

  app.get("/api/csrf-token", (req, res) => {
    const token = generateCsrfToken(req, res);
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

  return app;
}
