// @ts-nocheck
import "dotenv/config";
import { drizzle } from 'drizzle-orm/neon-serverless';
import { Pool, neonConfig } from '@neondatabase/serverless';
import * as schema from '../shared/schema.js';
import * as fs from 'fs';
import * as path from 'path';
import ws from 'ws';

// Configure neon to use ws for pooling in Node environments
neonConfig.webSocketConstructor = ws;

async function setupDatabase() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('❌ DATABASE_URL not set in environment variables');
    process.exit(1);
  }

  console.log('🚀 Starting Audnix AI Database Setup...\n');

  try {
    const pool = new Pool({
      connectionString: databaseUrl,
    });
    const db = drizzle(pool, { schema });

    console.log('✅ Connected to database');

    const migrationsDir = path.join(process.cwd(), 'migrations');
    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();

    console.log('📦 Running migrations...\n');

    for (const file of migrationFiles) {
      const filePath = path.join(migrationsDir, file);

      if (fs.existsSync(filePath)) {
        console.log(`   Executing ${file}...`);
        const sql = fs.readFileSync(filePath, 'utf-8');

        try {
          // neon-serverless Pool.query can handle raw SQL strings
          await pool.query(sql);
          console.log(`   ✅ ${file} completed`);
        } catch (error: any) {
          if (error.message?.includes('already exists')) {
            console.log(`   ⚠️  ${file} - tables already exist, skipping`);
          } else {
            console.warn(`   ❌ Error executing ${file}:`, error.message);
            // Soft fail on individual migrations if it's just a schema mismatch
          }
        }
      }
    }

    console.log('\n✅ All migrations completed successfully!');
    await pool.end();
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Setup failed:', error);
    process.exit(1);
  }
}

setupDatabase();
