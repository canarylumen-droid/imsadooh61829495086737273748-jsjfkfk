import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import pgPkg from "pg";
const { Pool } = pgPkg;
import * as schema from "@audnix/shared";
import dns from "dns";

// Database singleton instances
let _db: NodePgDatabase<typeof schema> | null = null;
let _pool: pgPkg.Pool | null = null;

export function initializeDb(serviceName: string) {
  if (_db && _pool) return { db: _db, pool: _pool };

  // APPLICATION / WORKERS: MUST use the pooler connection string.
  const url = process.env.DATABASE_URL_POOL || process.env.DATABASE_URL;
  if (!url) {
    console.warn(`⚠️ [${serviceName}] DATABASE_URL_POOL (or fallback DATABASE_URL) not set. Database operations will fail.`);
    return { db: null, pool: null };
  }

  const IS_WORKER = process.env.IS_WORKER === 'true';
  const POOL_MAX = IS_WORKER
    ? parseInt(process.env.DB_POOL_MAX_WORKER || '100', 10)
    : parseInt(process.env.DB_POOL_MAX_API || '20', 10);
  const ABSOLUTE_CAP = parseInt(process.env.DB_POOL_ABSOLUTE_CAP || '120', 10);
  const FINAL_POOL_MAX = Math.min(POOL_MAX, ABSOLUTE_CAP);

  // Normalize connection string for SSL compatibility
  let connectionString: string;
  try {
    const dbUrl = new URL(url);
    const isNeon = url.includes('neon.tech');

    if (isNeon) {
      dbUrl.searchParams.set('uselibpqcompat', 'true');
      if (!dbUrl.searchParams.has('sslmode')) {
        dbUrl.searchParams.set('sslmode', 'require');
      }
    }
    connectionString = dbUrl.toString();
  } catch (urlError) {
    connectionString = url;
  }

  const isProduction = url.includes('neon.tech') || process.env.NODE_ENV === "production";
  
  try {
    _pool = new Pool({
      connectionString,
      ssl: isProduction ? { rejectUnauthorized: false } : false,
      max: FINAL_POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
      maxUses: 10_000,
      options: '-c statement_timeout=30000 -c idle_in_transaction_session_timeout=60000',
    });

    _pool.on('error', (err: any) => {
      console.error(`🚨 [${serviceName}] [DB POOL ERROR]`, err);
    });

    _db = drizzle(_pool, { schema });
    console.log(`✅ [${serviceName}] [DB] PostgreSQL initialized (max=${FINAL_POOL_MAX}, worker=${IS_WORKER})`);
    
    return { db: _db, pool: _pool };
  } catch (error: any) {
    console.error(`❌ [${serviceName}] [DB] Initialization failed:`, error.message || error);
    return { db: null, pool: null };
  }
}

export function getDatabase(serviceName: string): NodePgDatabase<typeof schema> {
  if (!_db) return (initializeDb(serviceName).db as NodePgDatabase<typeof schema>);
  return _db;
}
