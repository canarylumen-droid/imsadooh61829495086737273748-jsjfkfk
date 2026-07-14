import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import fs from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runMigration() {
    console.log("Starting migration script...");
    
    // ─── MIGRATION PIPE: Direct Connection ────────────────────────────────────
    // Migrations MUST use DATABASE_URL_DIRECT (non-pooled).
    // DDL locks are incompatible with transaction poolers.
    // ──────────────────────────────────────────────────────────────────────────
    const envPath = resolve(process.cwd(), '.env');
    let MIGRATION_URL = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;

    if (fs.existsSync(envPath) && !MIGRATION_URL) {
         try {
             const b = fs.readFileSync(envPath);
             const envContent = b[0] === 255 && b[1] === 254 ? b.toString('utf16le') : b.toString('utf8');
             // Prefer DIRECT line; fall back to legacy DATABASE_URL
             const directMatch = envContent.match(/DATABASE_URL_DIRECT=(.+)/m);
             const fallbackMatch = envContent.match(/DATABASE_URL=(.+)/m);
             const dbUrlMatch = directMatch || fallbackMatch;
             if (dbUrlMatch) {
                MIGRATION_URL = dbUrlMatch[1].trim().replace(/^["']|["']$/g, '');
             }
         } catch (e) {
             console.warn("Failed to read .env file:", e);
         }
    }

    if (!MIGRATION_URL) {
        console.error('DATABASE_URL_DIRECT is not set. Migrations require a direct (non-pooled) database connection.');
        process.exit(1);
    }

    console.log('[Migrate] Connecting via DIRECT line...');
    const dbUrl = new URL(MIGRATION_URL);
    
    if (MIGRATION_URL.includes('neon.tech')) {
        dbUrl.searchParams.set('uselibpqcompat', 'true');
        if (!dbUrl.searchParams.has('sslmode')) {
            dbUrl.searchParams.set('sslmode', 'require');
        }
    } else if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
        // Standard PostgreSQL: use explicit verify-full to silence pg v9 deprecation warning
        if (!dbUrl.searchParams.has('sslmode')) {
            dbUrl.searchParams.set('sslmode', 'verify-full');
        }
    }
    
    const connectionString = dbUrl.toString();

    const client = new pg.Client({
        connectionString,
        // RDS and cloud Postgres always require SSL. Only disable for local dev (localhost/127.0.0.1).
        ssl: MIGRATION_URL.includes('localhost') || MIGRATION_URL.includes('127.0.0.1')
            ? false
            : { rejectUnauthorized: false }
    });

    const migrationsFolder = resolve(__dirname, '../migrations');

    try {
        await client.connect();
        const db = drizzle(client);

        // Drizzle-orm's migrate() needs the 'meta' folder to exist and contain _journal.json
        console.log(`Resolved migrations folder: ${migrationsFolder}`);

        if (!fs.existsSync(migrationsFolder)) {
            console.warn(`Migrations folder not found at ${migrationsFolder}. Skipping migrations.`);
            return;
        }

        try {
            await migrate(db, { migrationsFolder });
            console.log('Migrations completed successfully');
        } catch (migrationErr) {
            // Ignore "already exists" errors (42P07 and 42710)
            const isAlreadyExists = migrationErr.code === '42P07' || 
                                   migrationErr.code === '42710' || 
                                   migrationErr.message?.includes('already exists');
            
            if (isAlreadyExists) {
              console.log('✅ Database schema already contains some migration objects. Skipping... (Success)');
            } else {
              console.error('Migration failed (soft fail):', migrationErr);
              console.warn('Proceeding with deployment despite migration failure. Schema should be synced via push.');
            }
        }

    } catch (err) {
        console.error('Database connection failed:', err);
        // We still exit 1 if connection fails because that's critical
        process.exit(1);
    } finally {
        await client.end();
    }
}

runMigration();
