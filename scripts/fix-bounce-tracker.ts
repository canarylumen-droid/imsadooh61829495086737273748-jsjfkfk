
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

const CONNECTION_STRING = process.env.DATABASE_URL;
if (!CONNECTION_STRING) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

async function run() {
    console.log('Running migration (TS)...');
    const pool = new Pool({ connectionString: CONNECTION_STRING, ssl: { rejectUnauthorized: false } });
    try {
        await pool.query(`ALTER TABLE "bounce_tracker" ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}';`);
        console.log('Success! Column added.');
    } catch (e) {
        console.error('Migration failed:', e);
    } finally {
        await pool.end();
    }
}
run();
