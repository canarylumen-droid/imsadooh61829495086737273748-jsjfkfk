import pgPkg from 'pg';
const { Client } = pgPkg;
import 'dotenv/config';

async function ensureTables() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const client = new Client({
    connectionString: url,
    ssl: url.includes('neon.tech') || process.env.NODE_ENV === 'production' 
      ? { rejectUnauthorized: false } 
      : false
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');

    // 1. Ensure user_sessions (for connect-pg-simple)
    console.log('Checking user_sessions table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS "user_sessions" (
        "sid" varchar NOT NULL COLLATE "default",
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL
      ) WITH (OIDS=FALSE);
    `);
    
    // Add primary key if not exists (handling potential error if already exists)
    try {
      await client.query(`ALTER TABLE "user_sessions" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;`);
      console.log('✅ Added primary key to user_sessions');
    } catch (e: any) {
      if (!e.message.includes('already exists')) console.warn('Warning adding PK to user_sessions:', e.message);
    }

    try {
      await client.query(`CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "user_sessions" ("expire");`);
      console.log('✅ Ensured index on user_sessions(expire)');
    } catch (e: any) {
      console.warn('Warning creating index on user_sessions:', e.message);
    }

    // 2. Ensure brand_pdf_cache (for admin-pdf-routes)
    console.log('Checking brand_pdf_cache table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS brand_pdf_cache (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        file_name TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        file_hash TEXT NOT NULL,
        extracted_text TEXT,
        brand_context JSONB,
        analysis_score INTEGER,
        analysis_items JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, file_hash)
      );
    `);
    console.log('✅ Ensured brand_pdf_cache table exists');

    console.log('🏁 All critical tables verified.');
  } catch (error) {
    console.error('❌ Error ensuring tables:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

ensureTables();
