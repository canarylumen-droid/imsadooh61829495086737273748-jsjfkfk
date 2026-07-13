
import pg from 'pg';
import 'dotenv/config';

async function fixSchema() {
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
        console.log('🔌 Connected to database. Applying fixes...');

        // Fix email_messages: add campaign_id (and check if campaignId existed and rename or add)
        console.log('⚙️ Checking email_messages table...');
        
        // Add campaign_id if it doesn't exist
        await client.query(`
            ALTER TABLE email_messages 
            ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES outreach_campaigns(id) ON DELETE SET NULL;
        `);
        console.log('✅ email_messages.campaign_id ensured');

        // Fix campaign_leads: add retry_count
        console.log('⚙️ Checking campaign_leads table...');
        await client.query(`
            ALTER TABLE campaign_leads 
            ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;
        `);
        console.log('✅ campaign_leads.retry_count ensured');

        // Also check for camelCase columns that might cause issues and add them as snake_case if missing
        // For campaign_leads, ensure current_step is there (maps to currentStep in Drizzle)
        await client.query(`
            ALTER TABLE campaign_leads 
            ADD COLUMN IF NOT EXISTS current_step integer NOT NULL DEFAULT 0;
        `);
        
        await client.query(`
            ALTER TABLE campaign_leads 
            ADD COLUMN IF NOT EXISTS next_action_at timestamp;
        `);

        console.log('✨ All manual fixes applied.');
        
        client.release();
    } catch (err) {
        console.error('❌ Migration failed:', err);
    } finally {
        await pool.end();
    }
}

fixSchema();
