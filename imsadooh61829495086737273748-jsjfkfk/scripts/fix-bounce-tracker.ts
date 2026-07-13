
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

const CONNECTION_STRING = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_y1WCRm9QsVJh@ep-wispy-frost-ahj6lqe0-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';

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
