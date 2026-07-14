
import pg from 'pg';

async function fix() {
    // Hardcoded connection string from .env
    const connectionString = "postgresql://neondb_owner:npg_y1WCRm9QsVJh@ep-wispy-frost-ahj6lqe0-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require";
    
    console.log('🔌 Connecting directly...');
    const pool = new pg.Pool({ 
        connectionString,
        ssl: { rejectUnauthorized: false }
    });

    try {
        const client = await pool.connect();
        console.log('✅ Connected. Patching tables...');

        await client.query('ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS campaign_id uuid;');
        await client.query('ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;');
        await client.query('ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS next_action_at timestamp;');
        await client.query('ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS current_step integer NOT NULL DEFAULT 0;');

        console.log('✨ Success!');
        client.release();
    } catch (err) {
        console.error('❌ Failed:', err);
    } finally {
        await pool.end();
    }
}

fix();
