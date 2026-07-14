
import pg from 'pg';
import 'dotenv/config';
import fs from 'fs';

async function checkSchema() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error('DATABASE_URL is not set');
        process.exit(1);
    }

    const pool = new pg.Pool({
        connectionString,
        ssl: { rejectUnauthorized: false }
    });

    try {
        const client = await pool.connect();
        
        const tables = ['email_messages', 'campaign_leads', 'outreach_campaigns'];
        const diagnosticResults: Record<string, any> = {};
        
        for (const table of tables) {
            const res = await client.query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = '${table}'
                ORDER BY column_name;
            `);
            diagnosticResults[table] = res.rows;
        }
        
        fs.writeFileSync('schema_out.json', JSON.stringify(diagnosticResults, null, 2));
        console.log('✅ Diagnostics written to schema_out.json');
        
        client.release();
    } catch (err) {
        console.error('Diagnostic failed:', err);
    } finally {
        await pool.end();
    }
}

checkSchema();
