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

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn(`⚠️ [${serviceName}] DATABASE_URL not set. Database operations will fail.`);
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
      max: process.env.NODE_ENV === "production" ? 5 : 10, // Lower max connections per service
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      maxUses: 7500,
    });

    _pool.on('error', (err: any) => {
      console.error(`🚨 [${serviceName}] [DB POOL ERROR]`, err);
    });

    _db = drizzle(_pool, { schema });
    console.log(`✅ [${serviceName}] [DB] PostgreSQL initialized`);
    
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
