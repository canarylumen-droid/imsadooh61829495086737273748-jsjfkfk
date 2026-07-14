
import 'dotenv/config';
import pg from 'pg';

async function cleanup() {
    console.log('🔌 Connecting to database to clear leads...');

    const CONNECTION_STRING = process.env.DATABASE_URL;
    if (!CONNECTION_STRING) {
      console.error('DATABASE_URL environment variable is required');
      process.exit(1);
    }

    const pool = new pg.Pool({
        connectionString: CONNECTION_STRING,
        ssl: true
    });

    try {
        const client = await pool.connect();

        console.log('🧹 Clearing prospects table...');
        const resProspects = await client.query('DELETE FROM prospects');
        console.log(`✅ Deleted ${resProspects.rowCount} rows from prospects table.`);

        console.log('🧹 Clearing scraping_sessions table...');
        const resSessions = await client.query('DELETE FROM scraping_sessions');
        console.log(`✅ Deleted ${resSessions.rowCount} rows from scraping_sessions table.`);

        console.log('🧹 Clearing leads table...');
        const resLeads = await client.query('DELETE FROM leads');
        console.log(`✅ Deleted ${resLeads.rowCount} rows from leads table.`);

        console.log('✨ All lead data cleared.');

        client.release();
    } catch (err: any) {
        console.error('❌ Failed to clear leads:', err.message);
    } finally {
        await pool.end();
    }
}

cleanup();
