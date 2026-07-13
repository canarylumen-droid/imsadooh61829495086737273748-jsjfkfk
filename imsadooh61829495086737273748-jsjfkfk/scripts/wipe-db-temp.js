import pg from 'pg';
import fs from 'fs';
import { resolve } from 'path';

const { Client } = pg;

// Try to load .env if available
const envPath = resolve(process.cwd(), '.env');
let DATABASE_URL = 'postgresql://neondb_owner:npg_y1WCRm9QsVJh@ep-wispy-frost-ahj6lqe0-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require'; // Hardcoded fallback from prompt

if (fs.existsSync(envPath)) {
        try {
            const b = fs.readFileSync(envPath);
            const envContent = b[0] === 255 && b[1] === 254 ? b.toString('utf16le') : b.toString('utf8');
            const dbUrlMatch = envContent.match(/DATABASE_URL=(.+)/m);
            if (dbUrlMatch) {
            DATABASE_URL = dbUrlMatch[1].trim().replace(/^["']|["']$/g, '');
            }
        } catch (e) {}
}

const client = new Client({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  try {
    await client.connect();
    console.log('Connected to database.');
    
    // Drop public schema and recreate it
    await client.query('DROP SCHEMA public CASCADE;');
    await client.query('CREATE SCHEMA public;');
    await client.query('GRANT ALL ON SCHEMA public TO neondb_owner;');
    await client.query('GRANT ALL ON SCHEMA public TO public;');
    
    console.log('Database cleared successfully.');
  } catch (err) {
    console.error('Error clearing database:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
