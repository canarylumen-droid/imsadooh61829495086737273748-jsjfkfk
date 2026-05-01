import { db } from './db.js';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { quotaService } from '@shared/lib/monitoring/quota-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Runs database migrations using the active Neon serverless connection.
 * This method is safer for Vercel environments than spawning a child process.
 */
export async function runDatabaseMigrations() {
    console.log("🚀 Starting database migrations (direct integration)...");

    // Find migrations folder relative to this file
    // In source: server/lib/db/migrator.ts -> ../../migrations
    // In dist: dist/server/lib/db/migrator.js -> ../../migrations (likely)
    const possiblePaths = [
        path.join(process.cwd(), "migrations"),
        path.join(__dirname, "..", "..", "..", "migrations"),
        path.join(__dirname, "..", "..", "..", "..", "migrations"),
    ];

    let migrationsFolder = "";
    for (const p of possiblePaths) {
        if (fs.existsSync(p) && fs.existsSync(path.join(p, "meta", "_journal.json"))) {
            migrationsFolder = p;
            break;
        }
    }

    if (!migrationsFolder) {
        console.warn("⚠️ Migrations folder not found! Searched in:", possiblePaths);
        // Continue to emergency fallback instead of returning
    } else {
        console.log(`📂 Using migrations from: ${migrationsFolder}`);
        try {
            if (!db) {
                console.warn("⚠️ Database not initialized. Skipping migrations.");
                return;
            }

            // 1. First, attempt the Drizzle-managed migration
            await migrate(db, { migrationsFolder });
            console.log("✨ Database migrations completed successfully");
        } catch (error: any) {
            console.warn("⚠️ Drizzle migration reported an issue:", error.message || error);
        }
    }

    if (!db) return;

    if (quotaService.isRestricted()) {
        console.warn("⚠️ Skipping emergency schema synchronization: Database quota restricted.");
        return;
    }

    // 2. Emergency fallback: Directly ensure critical columns exist
    // This handles cases where the migration journal might be out of sync or missing in Vercel
    console.log("🛠️ Running emergency schema synchronization...");
    try {
        await db.execute(sql`
            DO $$ 
            BEGIN
                -- Leads: archived
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='archived') THEN
                    ALTER TABLE leads ADD COLUMN archived BOOLEAN NOT NULL DEFAULT false;
                END IF;
                
                -- Outreach: stats
                IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='outreach_campaigns') THEN
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='outreach_campaigns' AND column_name='stats') THEN
                        ALTER TABLE outreach_campaigns ADD COLUMN stats jsonb DEFAULT '{"total": 0, "sent": 0, "replied": 0, "bounced": 0}'::jsonb;
                    END IF;
                END IF;

                -- Deals: deal_value
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deals' AND column_name='deal_value') THEN
                    ALTER TABLE deals ADD COLUMN deal_value INTEGER DEFAULT 0;
                END IF;

                -- Messages: thread_id
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='thread_id') THEN
                    ALTER TABLE "messages" ADD COLUMN "thread_id" uuid;
                END IF;

                -- Integration ID fixes for critical tables
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='integration_id') THEN
                    ALTER TABLE leads ADD COLUMN integration_id UUID REFERENCES integrations(id) ON DELETE SET NULL;
                END IF;

                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='integration_id') THEN
                    ALTER TABLE messages ADD COLUMN integration_id UUID REFERENCES integrations(id) ON DELETE SET NULL;
                END IF;

                -- Leads: bant
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='bant') THEN
                    ALTER TABLE leads ADD COLUMN bant jsonb DEFAULT '{}'::jsonb;
                END IF;
                
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='integration_id') THEN
                    ALTER TABLE notifications ADD COLUMN integration_id UUID REFERENCES integrations(id) ON DELETE SET NULL;
                END IF;

                -- Domain Verifications Table
                IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='domain_verifications') THEN
                    CREATE TABLE domain_verifications (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        domain TEXT NOT NULL,
                        verification_result JSONB NOT NULL,
                        created_at TIMESTAMP NOT NULL DEFAULT NOW()
                    );
                END IF;

                -- Users: config and filtered_leads_count
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='config') THEN
                    ALTER TABLE users ADD COLUMN config jsonb DEFAULT '{"autonomousMode": false}'::jsonb;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='filtered_leads_count') THEN
                    ALTER TABLE users ADD COLUMN filtered_leads_count INTEGER DEFAULT 0;
                END IF;

                -- Users: Calendly columns
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='calendly_access_token') THEN
                    ALTER TABLE users ADD COLUMN calendly_access_token TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='calendly_refresh_token') THEN
                    ALTER TABLE users ADD COLUMN calendly_refresh_token TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='calendly_expires_at') THEN
                    ALTER TABLE users ADD COLUMN calendly_expires_at TIMESTAMP;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='calendly_user_uri') THEN
                    ALTER TABLE users ADD COLUMN calendly_user_uri TEXT;
                END IF;

                -- Users: Brand and Calendar links
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='calendar_link') THEN
                    ALTER TABLE users ADD COLUMN calendar_link TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='brand_guideline_pdf_url') THEN
                    ALTER TABLE users ADD COLUMN brand_guideline_pdf_url TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='brand_guideline_pdf_text') THEN
                    ALTER TABLE users ADD COLUMN brand_guideline_pdf_text TEXT;
                END IF;

                -- Leads: warm, last_message_at, ai_paused
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='warm') THEN
                    ALTER TABLE leads ADD COLUMN warm BOOLEAN NOT NULL DEFAULT false;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='last_message_at') THEN
                    ALTER TABLE leads ADD COLUMN last_message_at TIMESTAMP;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='ai_paused') THEN
                    ALTER TABLE leads ADD COLUMN ai_paused BOOLEAN NOT NULL DEFAULT true;
                END IF;

                -- Email Messages: campaign_id, target_url
                IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='email_messages') THEN
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='email_messages' AND column_name='campaign_id') THEN
                        ALTER TABLE email_messages ADD COLUMN campaign_id UUID REFERENCES outreach_campaigns(id) ON DELETE SET NULL;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='email_messages' AND column_name='target_url') THEN
                        ALTER TABLE email_messages ADD COLUMN target_url TEXT;
                    END IF;
                END IF;

                -- Ensure session table exists if missing
                IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='user_sessions') THEN
                     CREATE TABLE "user_sessions" (
                      "sid" varchar NOT NULL COLLATE "default",
                      "sess" json NOT NULL,
                      "expire" timestamp(6) NOT NULL,
                      CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("sid")
                    ) WITH (OIDS=FALSE);
                    CREATE INDEX "IDX_session_expire" ON "user_sessions" ("expire");
                END IF;

                -- PERFORMANCE INDICES (Latency reduction to 20-50ms)
                -- Leads
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'leads_user_id_idx') THEN
                    CREATE INDEX leads_user_id_idx ON leads(user_id);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'leads_integration_id_idx') THEN
                    CREATE INDEX leads_integration_id_idx ON leads(integration_id);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'leads_status_idx') THEN
                    CREATE INDEX leads_status_idx ON leads(status);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'leads_archived_idx') THEN
                    CREATE INDEX leads_archived_idx ON leads(archived);
                END IF;

                -- Messages
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'msgs_user_id_idx') THEN
                    CREATE INDEX msgs_user_id_idx ON messages(user_id);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'msgs_lead_id_idx') THEN
                    CREATE INDEX msgs_lead_id_idx ON messages(lead_id);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'msgs_integration_id_idx') THEN
                    CREATE INDEX msgs_integration_id_idx ON messages(integration_id);
                END IF;

                -- Integrations: health, failure_count, daily_limit, etc.
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='integrations' AND column_name='health_status') THEN
                    ALTER TABLE integrations ADD COLUMN health_status TEXT NOT NULL DEFAULT 'connected';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='integrations' AND column_name='failure_count') THEN
                    ALTER TABLE integrations ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='integrations' AND column_name='daily_limit') THEN
                    ALTER TABLE integrations ADD COLUMN daily_limit INTEGER NOT NULL DEFAULT 50;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='integrations' AND column_name='mailbox_pause_until') THEN
                    ALTER TABLE integrations ADD COLUMN mailbox_pause_until TIMESTAMP;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='integrations' AND column_name='spam_risk_score') THEN
                    ALTER TABLE integrations ADD COLUMN spam_risk_score REAL NOT NULL DEFAULT 0;
                END IF;

                -- User Outreach Settings Table
                IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='user_outreach_settings') THEN
                    CREATE TABLE user_outreach_settings (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        daily_limit INTEGER NOT NULL DEFAULT 50,
                        warmup_enabled BOOLEAN NOT NULL DEFAULT true,
                        auto_redistribute BOOLEAN NOT NULL DEFAULT true,
                        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
                    );
                ELSE
                    -- Ensure auto_redistribute exists if table was created earlier without it
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_outreach_settings' AND column_name='auto_redistribute') THEN
                        ALTER TABLE user_outreach_settings ADD COLUMN auto_redistribute BOOLEAN NOT NULL DEFAULT true;
                    END IF;
                END IF;

                -- Bounce Tracker Integration ID
                IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='bounce_tracker') THEN
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bounce_tracker' AND column_name='integration_id') THEN
                        ALTER TABLE bounce_tracker ADD COLUMN integration_id UUID REFERENCES integrations(id) ON DELETE CASCADE;
                    END IF;
                END IF;

                -- PERFORMANCE INDICES (Latency reduction to 20-50ms)
                -- Leads
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'leads_user_id_idx') THEN
                    CREATE INDEX leads_user_id_idx ON leads(user_id);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'leads_integration_id_idx') THEN
                    CREATE INDEX leads_integration_id_idx ON leads(integration_id);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'leads_status_idx') THEN
                    CREATE INDEX leads_status_idx ON leads(status);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'leads_archived_idx') THEN
                    CREATE INDEX leads_archived_idx ON leads(archived);
                END IF;

                -- Messages
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'msgs_user_id_idx') THEN
                    CREATE INDEX msgs_user_id_idx ON messages(user_id);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'msgs_lead_id_idx') THEN
                    CREATE INDEX msgs_lead_id_idx ON messages(lead_id);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'msgs_integration_id_idx') THEN
                    CREATE INDEX msgs_integration_id_idx ON messages(integration_id);
                END IF;

                -- Integrations
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'integrations_user_id_idx') THEN
                    CREATE INDEX integrations_user_id_idx ON integrations(user_id);
                END IF;

                -- Outreach Campaigns
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'campaigns_user_id_idx') THEN
                    CREATE INDEX campaigns_user_id_idx ON outreach_campaigns(user_id);
                END IF;

                -- Email Messages (High Volume)
                IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='email_messages') THEN
                    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'email_msgs_user_id_idx') THEN
                        CREATE INDEX email_msgs_user_id_idx ON email_messages(user_id);
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'email_msgs_lead_id_idx') THEN
                        CREATE INDEX email_msgs_lead_id_idx ON email_messages(lead_id);
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'email_msgs_thread_id_idx') THEN
                        CREATE INDEX email_msgs_thread_id_idx ON email_messages(thread_id);
                    END IF;
                END IF;

                -- Threads
                IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='threads') THEN
                    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'threads_user_id_idx') THEN
                        CREATE INDEX threads_user_id_idx ON threads(user_id);
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'threads_lead_id_idx') THEN
                        CREATE INDEX threads_lead_id_idx ON threads(lead_id);
                    END IF;
                END IF;

                -- Notifications
                IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='notifications') THEN
                    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'notif_user_id_idx') THEN
                        CREATE INDEX notif_user_id_idx ON notifications(user_id);
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'notif_read_idx') THEN
                        CREATE INDEX notif_read_idx ON notifications(user_id, is_read);
                    END IF;
                END IF;

            END $$;
        `);
        console.log("✅ Emergency schema synchronization completed.");
    } catch (emergencyError: any) {
        console.error("❌ Emergency schema synchronization failed:", emergencyError.message || emergencyError);
        quotaService.reportDbError(emergencyError);
    }
}



