import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import crypto from "crypto";
import { quotaService } from "@shared/lib/monitoring/quota-service.js";
import { apiLimiter, authLimiter } from "@services/api-gateway/src/middleware/rate-limit.js";
import { securityHeaders } from "@services/api-gateway/src/middleware/security-headers.js";
import { pool } from "@shared/lib/db/db.js";
import hpp from "hpp";
import helmet from "helmet";
import { SESSION_COOKIE_NAME } from "./config/session.js";


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

  app.get('/api/csrf-token', (_req, res) => {
    const token = crypto.randomBytes(32).toString('hex');
    res.status(200).json({ csrfToken: token });
  });

  app.use(quotaService.getSentinelMiddleware());
  app.use(hpp());
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:", "https://*.s3.amazonaws.com", "https://*.s3.us-east-1.amazonaws.com"],
        connectSrc: ["'self'", "https://www.audnixai.com", "wss://www.audnixai.com", "https://audnixai.com", "wss://audnixai.com"],
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  }));
  app.use(securityHeaders);

  // Enforce HTTPS in production
  if (process.env.NODE_ENV === 'production') {
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.headers['x-forwarded-proto'] === 'http' || req.headers['x-forwarded-proto'] === 'https' && !req.secure) {
        const host = req.headers['x-forwarded-host'] || req.headers.host || 'audnixai.com';
        return res.redirect(301, `https://${host}${req.originalUrl}`);
      }
      next();
    });
  }

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowedOrigins = [
      "https://www.audnixai.com",
      "https://audnixai.com",
      "http://localhost:5173",
      "http://localhost:5000",
      ...(process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()).filter(Boolean) || []),
      ...(process.env.RAILWAY_STATIC_URL ? [`https://${process.env.RAILWAY_STATIC_URL}`] : []),
    ];

    if (origin && (allowedOrigins.includes(origin) || origin.endsWith('.audnixai.com'))) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }

    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
    res.setHeader("Access-Control-Max-Age", "86400");

    if (req.method === "OPTIONS") return res.sendStatus(204);

    if (process.env.NODE_ENV === "production" && origin && !allowedOrigins.includes(origin) && !origin.endsWith('.audnixai.com')) {
      return res.status(403).json({ error: "Forbidden" });
    }

    next();
  });

  const nodeEnv = process.env.NODE_ENV || "development";
  app.set("env", nodeEnv);
  app.set("trust proxy", 1);

  // Auto-generate SESSION_SECRET if missing
  if (!process.env.SESSION_SECRET) {
    if (process.env.NODE_ENV === 'production') {
      console.error("CRITICAL: SESSION_SECRET is not set in production. All sessions will be invalidated on restart.");
      // Generate one anyway so the server can start, but warn aggressively
    }
    const generated = crypto.randomBytes(32).toString('hex');
    console.warn(`SESSION_SECRET not set — auto-generated. Set SESSION_SECRET in environment variables for persistence across restarts.`);
    process.env.SESSION_SECRET = generated;
  }
  
  // Auto-generate ENCRYPTION_KEY if missing
  if (!process.env.ENCRYPTION_KEY) {
    if (process.env.NODE_ENV === 'production') {
      console.error("CRITICAL: ENCRYPTION_KEY must be set in production. Data cannot be decrypted without it.");
      process.exit(1);
    }
    const generated = crypto.randomBytes(32).toString('hex');
    console.warn("ENCRYPTION_KEY not set — auto-generated. Set it in env for persistence across restarts.");
    process.env.ENCRYPTION_KEY = generated;
  }

  app.use('/uploads', express.static('public/uploads'));

  app.use("/api/", apiLimiter);
  app.use(["/api/auth/", "/api/admin/auth/"], authLimiter);
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
    name: SESSION_COOKIE_NAME,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 30,
      sameSite: "lax",
      path: "/",
    },
    store: sessionStore,
    rolling: true,
    proxy: true,
  };

  app.use(session(sessionConfig));

  return app;
}
