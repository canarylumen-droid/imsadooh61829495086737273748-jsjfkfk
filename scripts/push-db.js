import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function push() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        console.error('❌ DATABASE_URL not set');
        process.exit(1);
    }

    const migrationFile = path.resolve(__dirname, '../migrations/0001_curious_mother_askani.sql');
    if (!fs.existsSync(migrationFile)) {
        console.error('❌ Migration file not found');
        process.exit(1);
    }

    console.log('🔌 Connecting to database...');
    const pool = new pg.Pool({ connectionString: databaseUrl });

    try {
        const sql = fs.readFileSync(migrationFile, 'utf8');
        const statements = sql.split('--> statement-breakpoint');

        console.log(`🚀 Applying ${statements.length} statements...`);
        for (const statement of statements) {
            const trimmed = statement.trim();
            if (trimmed) {
                console.log(`Executing: ${trimmed.substring(0, 50)}...`);
                await pool.query(trimmed);
            }
        }
        console.log('✅ Base migration applied successfully');

        // Also ensure ai_action_logs is created if it missing
        console.log('🔍 Checking for ai_action_logs...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS "ai_action_logs" (
                "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                "user_id" uuid NOT NULL,
                "lead_id" uuid,
                "action" text NOT NULL,
                "status" text NOT NULL,
                "prompt_tokens" integer,
                "completion_tokens" integer,
                "cost" real,
                "error" text,
                "metadata" jsonb DEFAULT '{}'::jsonb,
                "created_at" timestamp DEFAULT now()
            );
        `);
        console.log('✅ ai_action_logs verified');

    } catch (error) {
        console.error('❌ Error during push:', error.message);
    } finally {
        await pool.end();
    }
}

push();
