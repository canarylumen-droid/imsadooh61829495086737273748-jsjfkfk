import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import pgPkg from "pg";
const { Pool } = pgPkg;
import * as schema from "@audnix/shared";
import { quotaService } from '@shared/lib/monitoring/quota-service.js';

// ─── Pooler-Direct Split Architecture ────────────────────────────────────────
// APPLICATION / WORKERS → DATABASE_URL_POOL (Transaction Pooler)
// MIGRATIONS / DDL      → DATABASE_URL_DIRECT (Direct connection)
//
// NEVER run migrations through the pooler — DDL uses ACCESS EXCLUSIVE locks
// that transaction poolers cannot hold. Always use the direct line.
//
// RDS t4.small ~200 max connections. If you run multiple worker pods,
// ensure DB_POOL_MAX_WORKER × pod_count + DB_POOL_MAX_API × api_count < 180
// to leave headroom for admin/migration connections.
// ───────────────────────────────────────────────────────────────────────────────

const IS_WORKER = process.env.IS_WORKER === 'true';

// High-throughput defaults: 100 for workers, 20 for API dashboard
// Override via env vars. Warning: these are PER-PROCESS limits.
const POOL_MAX = IS_WORKER
  ? parseInt(process.env.DB_POOL_MAX_WORKER || '100', 10)
  : parseInt(process.env.DB_POOL_MAX_API || '20', 10);

// Safety guard: never allow a single process to claim more than 120 connections
// (prevents accidentally exhausting an RDS t4.small ~200 limit in unified mode)
const ABSOLUTE_POOL_CAP = parseInt(process.env.DB_POOL_ABSOLUTE_CAP || '120', 10);
const FINAL_POOL_MAX = Math.min(POOL_MAX, ABSOLUTE_POOL_CAP);

if (POOL_MAX > ABSOLUTE_POOL_CAP) {
  console.warn(`[DB] ⚠️ Requested pool max ${POOL_MAX} exceeds absolute cap ${ABSOLUTE_POOL_CAP}. Capped to ${FINAL_POOL_MAX}. ` +
    `If you need more, raise DB_POOL_ABSOLUTE_CAP or upgrade RDS instance.`);
}

const IDLE_TIMEOUT_MS = 30_000;        // 30s — long-lived connections for background jobs
const CONNECTION_TIMEOUT_MS = 15_000;  // 15s — serverless DB warm-up / retry tolerance
const MAX_USES = 10_000;               // rotate connections before provider hard-close

// Transient Neon errors that should trigger a retry
const TRANSIENT_ERRORS = [
  'connection terminated unexpectedly',
  'server closed the connection unexpectedly',
  'timeout expired',
  'query_wait_timeout',
  'too many clients',
  'connection refused',
  'connection reset',
  'broken pipe',
  'econnrefused',
  'etimedout',
];

// Database singleton instances
let _db: NodePgDatabase<typeof schema> | null = null;
let _pool: pgPkg.Pool | null = null;

function isTransientError(err: any): boolean {
  const msg = (err?.message || String(err)).toLowerCase();
  return TRANSIENT_ERRORS.some(e => msg.includes(e));
}

/**
 * Retry wrapper for transient Neon/PostgreSQL errors.
 * All campaign-worker DB writes should go through this.
 */
export async function withDbRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 300
): Promise<T> {
  let lastErr: any;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      if (!isTransientError(err) || attempt === retries) throw err;
      const backoff = delayMs * Math.pow(2, attempt - 1);
      console.warn(`[DB] Transient error (attempt ${attempt}/${retries}), retrying in ${backoff}ms:`, err.message);
      await new Promise(r => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

/**
 * Initializes and returns the database connection pool.
 * Implements a strict singleton pattern to prevent connection exhaustion.
 */
export function initializeDb() {
  if (_db && _pool) return { db: _db, pool: _pool };

  // APPLICATION / WORKERS: MUST use the pooler connection string.
  // Migrations must use DATABASE_URL_DIRECT (see drizzle.config.ts).
  const rawUrl = process.env.DATABASE_URL_POOL || process.env.DATABASE_URL;
  if (!rawUrl) {
    console.warn('⚠️ [DB] DATABASE_URL_POOL (or fallback DATABASE_URL) not set. Database operations will fail.');
    return { db: null, pool: null };
  }

  // Normalize connection string for SSL compatibility
  let connectionString: string;
  try {
    const dbUrl = new URL(rawUrl);
    const isNeon = rawUrl.includes('neon.tech');

    if (isNeon) {
      dbUrl.searchParams.set('uselibpqcompat', 'true');
      if (!dbUrl.searchParams.has('sslmode')) {
        dbUrl.searchParams.set('sslmode', 'require');
      }
      // Force pooled port if using raw DATABASE_URL on Neon
      if (!process.env.DATABASE_URL_POOL && dbUrl.port === '5432') {
        console.warn('[DB] ⚠️ Using direct Neon port 5432 — switching to 6543 for pooled connections');
        dbUrl.port = '6543';
      }
    } else if (process.env.NODE_ENV === "production") {
      if (!dbUrl.searchParams.has('sslmode')) {
        dbUrl.searchParams.set('sslmode', 'verify-full');
      }
    }

    connectionString = dbUrl.toString();
  } catch (urlError) {
    console.error('❌ [DB] Invalid DATABASE_URL format');
    connectionString = rawUrl;
  }

  const isProduction = rawUrl.includes('neon.tech') || process.env.NODE_ENV === "production";

  console.log(`[DB] Initializing pool (max=${FINAL_POOL_MAX}, worker=${IS_WORKER}, timeout=${CONNECTION_TIMEOUT_MS}ms)`);

  try {
    _pool = new Pool({
      connectionString,
      ssl: isProduction ? { rejectUnauthorized: false } : false,
      max: FINAL_POOL_MAX,
      idleTimeoutMillis: IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
      maxUses: MAX_USES,
      // Hard limits: 30s query timeout, 60s idle-in-transaction timeout.
      // Critical for small RDS (1–2 GB) where one runaway query can freeze the instance.
      options: '-c statement_timeout=30000 -c idle_in_transaction_session_timeout=60000',
    });

    _pool.on('error', (err: any) => {
      const errorMessage = (err?.message || String(err)).toLowerCase();
      console.error('🚨 [DB POOL ERROR]', errorMessage);
      quotaService.reportDbError(err);
    });

    _pool.on('connect', () => {
      // Optional: log pool saturation for debugging at 1M+ scale
      if ((_pool?.totalCount || 0) > FINAL_POOL_MAX * 0.8) {
        console.warn(`[DB POOL] ⚠️ Saturation at ${(_pool?.totalCount || 0)}/${FINAL_POOL_MAX}`);
      }
    });

    _db = drizzle(_pool, { schema });
    console.log(`✅ [DB] PostgreSQL initialized (Singleton Pool, max=${FINAL_POOL_MAX})`);

    return { db: _db, pool: _pool };
  } catch (error: any) {
    console.error('❌ [DB] Initialization failed:', error.message || error);
    quotaService.reportDbError(error);
    return { db: null, pool: null };
  }
}

let _dbExported: NodePgDatabase<typeof schema> | null = null;
let _poolExported: pgPkg.Pool | null = null;

export function getDb(): NodePgDatabase<typeof schema> {
  if (!_dbExported) {
    const result = initializeDb();
    _dbExported = result.db as NodePgDatabase<typeof schema>;
    _poolExported = result.pool as pgPkg.Pool;
  }
  return _dbExported;
}

export function getPool(): pgPkg.Pool {
  if (!_poolExported) {
    const result = initializeDb();
    _dbExported = result.db as NodePgDatabase<typeof schema>;
    _poolExported = result.pool as pgPkg.Pool;
  }
  return _poolExported;
}

const db = new Proxy({} as NodePgDatabase<typeof schema>, {
  get(_target, prop) {
    const conn = getDb();
    const value = Reflect.get(conn, prop);
    return typeof value === 'function' ? value.bind(conn) : value;
  }
});

const pool = new Proxy({} as pgPkg.Pool, {
  get(_target, prop) {
    const conn = getPool();
    const value = Reflect.get(conn, prop);
    return typeof value === 'function' ? value.bind(conn) : value;
  }
});

export { db, pool };

/**
 * Safe accessor for the database instance.
 */
export function getDatabase(): NodePgDatabase<typeof schema> {
  if (!_db) return (initializeDb().db as NodePgDatabase<typeof schema>);
  return _db;
}

// ─── Direct Connection (Migrations / DDL only) ───────────────────────────────
let _directDb: NodePgDatabase<typeof schema> | null = null;
let _directPool: pgPkg.Pool | null = null;

export function getDirectDatabase(): NodePgDatabase<typeof schema> {
  if (_directDb) return _directDb;

  const rawUrl = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error(
      'DATABASE_URL_DIRECT (or fallback DATABASE_URL) is not set. ' +
      'Direct DB connection required for migrations/DDL.'
    );
  }

  let connectionString: string;
  try {
    const dbUrl = new URL(rawUrl);
    const isNeon = rawUrl.includes('neon.tech');
    if (isNeon) {
      dbUrl.searchParams.set('uselibpqcompat', 'true');
      if (!dbUrl.searchParams.has('sslmode')) {
        dbUrl.searchParams.set('sslmode', 'require');
      }
      if (dbUrl.port === '6543') {
        console.warn('[DB DIRECT] ⚠️ Pooler port 6543 detected in direct URL — switching to 5432');
        dbUrl.port = '5432';
      }
    } else if (process.env.NODE_ENV === 'production') {
      if (!dbUrl.searchParams.has('sslmode')) {
        dbUrl.searchParams.set('sslmode', 'verify-full');
      }
    }
    connectionString = dbUrl.toString();
  } catch {
    console.error('❌ [DB DIRECT] Invalid DATABASE_URL_DIRECT format');
    connectionString = rawUrl;
  }

  console.log('[DB DIRECT] Initializing direct pool (max=5) for migrations/DDL');

  _directPool = new Pool({
    connectionString,
    ssl: rawUrl.includes('neon.tech') || process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
    max: 5,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    maxUses: MAX_USES,
    options: '-c statement_timeout=30000 -c idle_in_transaction_session_timeout=60000',
  });

  _directPool.on('error', (err: any) => {
    console.error('🚨 [DB DIRECT POOL ERROR]', err?.message || String(err));
    quotaService.reportDbError(err);
  });

  _directDb = drizzle(_directPool, { schema });
  return _directDb;
}

export async function closeDirectDatabase(): Promise<void> {
  if (_directPool) {
    console.log('[DB DIRECT] Closing direct pool...');
    await _directPool.end();
    _directPool = null;
    _directDb = null;
    console.log('[DB DIRECT] Pool closed.');
  }
}

