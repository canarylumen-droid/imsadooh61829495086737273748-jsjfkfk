import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { seedResults, reputationSnapshots } from './schema.js';
import { config } from '../config.js';

const connectionString = config.database.url;
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required');
}
const client = postgres(connectionString);
export const db = drizzle(client, { schema: { seedResults, reputationSnapshots } });

export async function runMigrations() {
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS seed_results (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      campaign_id TEXT NOT NULL,
      test_id TEXT NOT NULL,
      seed_account_ref TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'other',
      folder_found TEXT,
      checked_at TEXT,
      created_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    ALTER TABLE seed_results ADD COLUMN IF NOT EXISTS user_id TEXT;
    ALTER TABLE seed_results ALTER COLUMN created_at SET DEFAULT (NOW()::text);

    CREATE INDEX IF NOT EXISTS idx_seed_results_campaign ON seed_results(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_seed_results_test ON seed_results(test_id);
    CREATE INDEX IF NOT EXISTS idx_seed_results_pending ON seed_results(folder_found) WHERE folder_found IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_seed_results_test_seed ON seed_results(test_id, seed_account_ref);

    CREATE TABLE IF NOT EXISTS reputation_snapshots (
      id TEXT PRIMARY KEY,
      domain TEXT NOT NULL,
      source TEXT NOT NULL,
      spam_rate DOUBLE PRECISION,
      ip_reputation TEXT,
      blacklisted BOOLEAN,
      checked_at TEXT NOT NULL DEFAULT (NOW()::text)
    );

    CREATE INDEX IF NOT EXISTS idx_rep_domain ON reputation_snapshots(domain);
    CREATE INDEX IF NOT EXISTS idx_rep_checked ON reputation_snapshots(checked_at);
  `);
  console.log('[DB] Migrations applied');
}
