import 'dotenv/config';
import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { sql } from 'drizzle-orm';

neonConfig.webSocketConstructor = ws;

async function fixBounceTracker() {
  console.log('🔧 Fixing bounce_tracker table schema...');
  
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('❌ DATABASE_URL not set in environment.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);

  try {
    await db.execute(sql`
      ALTER TABLE bounce_tracker 
      ADD COLUMN IF NOT EXISTS timestamp TIMESTAMP DEFAULT NOW() NOT NULL;
    `);
    console.log('✅ Successfully added "timestamp" column to bounce_tracker.');
  } catch (error) {
    console.error('❌ Failed to update bounce_tracker:', error);
  } finally {
    await pool.end();
  }
  process.exit(0);
}

fixBounceTracker();
