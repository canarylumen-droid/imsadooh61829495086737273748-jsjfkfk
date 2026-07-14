
import pg from 'pg';

async function stabilize() {
    const connectionString = "postgresql://neondb_owner:npg_y1WCRm9QsVJh@ep-wispy-frost-ahj6lqe0-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require";
    
    console.log('🔌 Connecting to stabilize database...');
    const pool = new pg.Pool({ 
        connectionString,
        ssl: { rejectUnauthorized: false }
    });

    try {
        const client = await pool.connect();
        console.log('✅ Connected. Patching missing columns and tables...');

        // 1. Leads table patches
        await client.query('ALTER TABLE leads ADD COLUMN IF NOT EXISTS reply_email text;');
        
        // 2. Outreach Campaigns patches
        await client.query('ALTER TABLE outreach_campaigns ADD COLUMN IF NOT EXISTS reply_email text;');

        // 3. AI Process Logs Table
        await client.query(`
            CREATE TABLE IF NOT EXISTS ai_process_logs (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id uuid NOT NULL,
                type text NOT NULL,
                status text NOT NULL DEFAULT 'processing',
                total_items integer NOT NULL DEFAULT 0,
                processed_items integer NOT NULL DEFAULT 0,
                metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
                error text,
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now()
            );
        `);

        // 4. AI Action Logs Table (Ensuring it exists)
        await client.query(`
            CREATE TABLE IF NOT EXISTS ai_action_logs (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id uuid NOT NULL,
                lead_id uuid,
                action_type text NOT NULL,
                decision text NOT NULL,
                intent_score integer,
                timing_score integer,
                confidence real,
                reasoning text,
                asset_id uuid,
                metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now()
            );
        `);

        console.log('✨ Database stabilization complete!');
        client.release();
    } catch (err) {
        console.error('❌ Stabilization failed:', err);
    } finally {
        await pool.end();
    }
}

stabilize();
