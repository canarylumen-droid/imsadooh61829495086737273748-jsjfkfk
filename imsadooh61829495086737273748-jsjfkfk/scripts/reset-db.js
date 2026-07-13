
import pg from 'pg';
import fs from 'fs';
import { resolve } from 'path';

async function resetDb() {
    console.log("Starting database reset...");
    
    // Load .env
    const envPath = resolve(process.cwd(), '.env');
    let DATABASE_URL = process.env.DATABASE_URL;

    if (fs.existsSync(envPath) && !DATABASE_URL) {
         try {
             const b = fs.readFileSync(envPath);
             const envContent = b[0] === 255 && b[1] === 254 ? b.toString('utf16le') : b.toString('utf8');
             const dbUrlMatch = envContent.match(/DATABASE_URL=(.+)/m);
             if (dbUrlMatch) {
                DATABASE_URL = dbUrlMatch[1].trim().replace(/^["']|["']$/g, '');
             }
         } catch (e) {
             console.warn("Failed to read .env file:", e);
         }
    }

    if (!DATABASE_URL) {
        console.error('DATABASE_URL is not set.');
        process.exit(1);
    }

    const dbUrl = new URL(DATABASE_URL);
    if (DATABASE_URL.includes('neon.tech')) {
        dbUrl.searchParams.set('sslmode', 'verify-full');
    }
    const connectionString = dbUrl.toString();

    const client = new pg.Client({
        connectionString,
        ssl: DATABASE_URL.includes('neon.tech') ? { rejectUnauthorized: true } : { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        console.log('Connected to database. Dropping schema public...');
        
        await client.query('DROP SCHEMA IF EXISTS public CASCADE;');
        await client.query('CREATE SCHEMA public;');
        await client.query('GRANT ALL ON SCHEMA public TO public;');
        
        console.log('✅ Database cleared (public schema recreated).');
    } catch (err) {
        console.error('Reset failed:', err);
        process.exit(1);
    } finally {
        await client.end();
    }
}

resetDb();
