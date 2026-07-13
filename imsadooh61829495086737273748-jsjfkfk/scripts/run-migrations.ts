import { pgTable, text, serial } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as fs from 'fs';
import { resolve } from 'path';

async function runMigration() {
    const envPath = resolve(process.cwd(), '.env');
    const b = fs.readFileSync(envPath);
    // [255, 254] is UTF-16LE BOM
    const envContent = b[0] === 255 && b[1] === 254
        ? b.toString('utf16le')
        : b.toString('utf8');

    const dbUrlMatch = envContent.match(/DATABASE_URL=(.+)/m);
    const DATABASE_URL = dbUrlMatch ? dbUrlMatch[1].trim() : process.env.DATABASE_URL;

    if (!DATABASE_URL) {
        throw new Error('DATABASE_URL is not set');
    }

    const client = new pg.Client({
        connectionString: DATABASE_URL,
    });

    await client.connect();
    const db = drizzle(client);

    console.log('Running migrations...');

    await migrate(db, { migrationsFolder: './migrations' });

    console.log('Migrations completed successfully');
    await client.end();
}

runMigration().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
});
