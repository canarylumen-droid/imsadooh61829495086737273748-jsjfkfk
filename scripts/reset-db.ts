/**
 * DB Reset Script — Drops all tables and recreates from Drizzle schema
 * 
 * Uses DATABASE_URL_DIRECT (or DATABASE_URL) from .env
 * 
 * Usage: npx tsx scripts/reset-db.ts
 *   or:  npm run db:reset
 */

import pg from 'pg';
const { Client } = pg;

const connectionString = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('❌ DATABASE_URL_DIRECT or DATABASE_URL not set');
  process.exit(1);
}

async function main() {
  console.log('🔌 Connecting to database...');
  const client = new Client({ connectionString });
  await client.connect();
  console.log('✅ Connected');

  // Confirm
  const { rows: dbInfo } = await client.query('SELECT current_database(), version()');
  console.log(`   Database: ${dbInfo[0].current_database}`);
  console.log(`   Version: ${dbInfo[0].version.split(',')[0]}`);

  // Drop all tables, types, enums in public schema
  console.log('\n🗑️  Dropping all tables (CASCADE)...');
  await client.query(`
    DO $$ DECLARE
      r RECORD;
    BEGIN
      -- Drop all tables
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != 'user_sessions') LOOP
        EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
      -- Drop all enum types
      FOR r IN (SELECT t.typname FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid GROUP BY t.typname) LOOP
        EXECUTE 'DROP TYPE IF EXISTS public.' || quote_ident(r.typname) || ' CASCADE';
      END LOOP;
    END $$;
  `);
  console.log('✅ All tables dropped');

  await client.end();

  // Run Drizzle push to recreate schema
  console.log('\n🏗️  Running drizzle-kit push...');
  const { execSync } = await import('child_process');
  execSync('npx drizzle-kit push', {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: connectionString,
      DATABASE_URL_DIRECT: connectionString,
    }
  });

  console.log('\n✅ Database reset complete! Schema is fresh.');
}

main().catch(e => {
  console.error(`\n❌ Reset failed: ${e.message}`);
  process.exit(1);
});
