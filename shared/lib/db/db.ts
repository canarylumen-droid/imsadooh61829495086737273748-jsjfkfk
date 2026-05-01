import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import pgPkg from "pg";
const { Pool } = pgPkg;
import * as schema from "@audnix/shared";
import { quotaService } from '@shared/lib/monitoring/quota-service.js';
import dns from "dns";

// Database singleton instances
let _db: NodePgDatabase<typeof schema> | null = null;
let _pool: pgPkg.Pool | null = null;

/**
 * Initializes and returns the database connection pool.
 * Implements a strict singleton pattern to prevent connection exhaustion.
 */
export function initializeDb() {
  if (_db && _pool) return { db: _db, pool: _pool };

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn('⚠️ [DB] DATABASE_URL not set. Database operations will fail.');
    return { db: null, pool: null };
  }

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
    } else if (process.env.NODE_ENV === "production") {
      if (!dbUrl.searchParams.has('sslmode')) {
        dbUrl.searchParams.set('sslmode', 'verify-full');
      }
    }

    connectionString = dbUrl.toString();
  } catch (urlError) {
    console.error('❌ [DB] Invalid DATABASE_URL format');
    connectionString = url;
  }

  const isProduction = url.includes('neon.tech') || process.env.NODE_ENV === "production";
  
  try {
    _pool = new Pool({
      connectionString,
      ssl: isProduction ? { rejectUnauthorized: false } : false,
      max: process.env.NODE_ENV === "production" ? 10 : 20, 
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      maxUses: 7500,
    });

    _pool.on('error', (err: any) => {
      const errorMessage = (err?.message || String(err)).toLowerCase();
      console.error('🚨 [DB POOL ERROR]', errorMessage);
      quotaService.reportDbError(err);
    });

    _db = drizzle(_pool, { schema });
    console.log('✅ [DB] PostgreSQL initialized (Singleton Pool)');
    
    return { db: _db, pool: _pool };
  } catch (error: any) {
    console.error('❌ [DB] Initialization failed:', error.message || error);
    quotaService.reportDbError(error);
    return { db: null, pool: null };
  }
}

// Immediate initialization for top-level exports
const { db, pool } = initializeDb() as { db: NodePgDatabase<typeof schema>, pool: pgPkg.Pool };

export { db, pool };

/**
 * Safe accessor for the database instance.
 */
export function getDatabase(): NodePgDatabase<typeof schema> {
  if (!_db) return (initializeDb().db as NodePgDatabase<typeof schema>);
  return _db;
}

