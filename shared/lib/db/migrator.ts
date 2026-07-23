import { getDirectDatabase, closeDirectDatabase } from './db.js';
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

    const directDb = getDirectDatabase();

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
            if (!directDb) {
                console.warn("⚠️ Direct database not initialized. Skipping migrations.");
                return;
            }

            // 1. First, attempt the Drizzle-managed migration (via DIRECT connection)
            await migrate(directDb, { migrationsFolder });
            console.log("✨ Database migrations completed successfully");
        } catch (error: any) {
            console.warn("⚠️ Drizzle migration reported an issue:", error.message || error);
        }
    }

    if (!directDb) return;

    if (quotaService.isRestricted()) {
        console.warn("⚠️ Skipping emergency schema synchronization: Database quota restricted.");
        return;
    }

    // 2. Emergency fallback: Directly ensure critical columns exist
    // This handles cases where the migration journal might be out of sync or missing in Vercel
    console.log("🛠️ Running emergency schema synchronization...");
    try {
        await directDb.transaction(async (tx) => { await tx.execute(sql`
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

                -- High-throughput index for campaignEmails (status, sent_at) — hot path for 1M+ scale
                IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='campaign_emails') THEN
                    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='ce_status_sent_at_idx') THEN
                        CREATE INDEX ce_status_sent_at_idx ON campaign_emails(status, sent_at);
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
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_domain_verifications_user_domain') THEN
                    CREATE UNIQUE INDEX idx_domain_verifications_user_domain ON domain_verifications (user_id, domain);
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
                    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'bounce_tracker_composite_idx') THEN
                        CREATE INDEX bounce_tracker_composite_idx ON bounce_tracker(integration_id, bounce_type, created_at);
                    END IF;
                END IF;
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
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'leads_updated_at_idx') THEN
                    CREATE INDEX leads_updated_at_idx ON leads(updated_at);
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
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'msgs_thread_id_idx') THEN
                    CREATE INDEX msgs_thread_id_idx ON messages(thread_id);
                END IF;

                -- Integrations
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'integrations_user_id_idx') THEN
                    CREATE INDEX integrations_user_id_idx ON integrations(user_id);
                END IF;

                -- Outreach Campaigns
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'campaigns_user_id_idx') THEN
                    CREATE INDEX campaigns_user_id_idx ON outreach_campaigns(user_id);
                END IF;

                -- Bounce tracker composite index
                IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='bounce_tracker') THEN
                    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'bounce_tracker_composite_idx') THEN
                        CREATE INDEX bounce_tracker_composite_idx ON bounce_tracker(integration_id, bounce_type, created_at);
                    END IF;
                END IF;

                -- Campaign Leads (HIGH PRIORITY — 50-100K leads per campaign)
                -- Without these, every lead-fetch and stat-aggregate is a full table scan.
                IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='campaign_leads') THEN
                    -- Lead selection: WHERE campaign_id = X AND status IN (...) ORDER BY next_action_at
                    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'cl_campaign_status_action_idx') THEN
                        CREATE INDEX cl_campaign_status_action_idx ON campaign_leads(campaign_id, status, next_action_at);
                    END IF;
                    -- Mailbox-specific lead fetch: WHERE campaign_id = X AND integration_id = Y AND status IN (...)
                    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'cl_campaign_integration_status_idx') THEN
                        CREATE INDEX cl_campaign_integration_status_idx ON campaign_leads(campaign_id, integration_id, status);
                    END IF;
                    -- Stats GROUP BY: WHERE campaign_id = X GROUP BY status
                    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'cl_campaign_id_idx') THEN
                        CREATE INDEX cl_campaign_id_idx ON campaign_leads(campaign_id);
                    END IF;
                END IF;

                -- Messages sent-count query: WHERE user_id = X AND direction = 'outbound' AND integration_id = Y AND created_at >= today
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'msgs_sent_count_idx') THEN
                    CREATE INDEX msgs_sent_count_idx ON messages(user_id, direction, integration_id, created_at);
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

                -- Campaign Job Logs (Self-Healing Watchdog source-of-truth)
                IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='campaign_job_logs') THEN
                    CREATE TABLE campaign_job_logs (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        job_bullmq_id TEXT NOT NULL UNIQUE,
                        campaign_id UUID NOT NULL REFERENCES outreach_campaigns(id) ON DELETE CASCADE,
                        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        integration_id TEXT,
                        campaign_lead_id TEXT,
                        job_type TEXT NOT NULL,
                        step_index INTEGER,
                        status TEXT NOT NULL DEFAULT 'pending',
                        job_data JSONB NOT NULL DEFAULT '{}',
                        attempt_count INTEGER NOT NULL DEFAULT 0,
                        last_error TEXT,
                        scheduled_at TIMESTAMP NOT NULL DEFAULT NOW(),
                        processed_at TIMESTAMP,
                        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
                    );
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'cjl_status_scheduled_idx') THEN
                    CREATE INDEX cjl_status_scheduled_idx ON campaign_job_logs(status, scheduled_at);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'cjl_campaign_status_idx') THEN
                    CREATE INDEX cjl_campaign_status_idx ON campaign_job_logs(campaign_id, status);
                END IF;

                -- Job Attempts (per-attempt audit trail for 1M+ scale)
                IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='job_attempts') THEN
                    CREATE TABLE job_attempts (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        job_id TEXT NOT NULL,
                        job_name TEXT NOT NULL,
                        campaign_id UUID REFERENCES outreach_campaigns(id) ON DELETE CASCADE,
                        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                        integration_id TEXT,
                        campaign_lead_id TEXT,
                        attempt_number INTEGER NOT NULL DEFAULT 1,
                        status TEXT NOT NULL DEFAULT 'started',
                        error TEXT,
                        worker_id TEXT,
                        metadata JSONB NOT NULL DEFAULT '{}',
                        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
                    );
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ja_status_created_at_idx') THEN
                    CREATE INDEX ja_status_created_at_idx ON job_attempts(status, created_at);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ja_job_id_idx') THEN
                    CREATE INDEX ja_job_id_idx ON job_attempts(job_id);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ja_campaign_id_idx') THEN
                    CREATE INDEX ja_campaign_id_idx ON job_attempts(campaign_id);
                END IF;

                -- Campaign Emails idempotency guard (prevents duplicate sends at DB layer)
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ce_campaign_lead_step_idx') THEN
                    CREATE UNIQUE INDEX ce_campaign_lead_step_idx ON campaign_emails(campaign_id, lead_id, step_index);
                END IF;

                -- ========== P2P WARMUP SERVICE TABLES (Ghost Layer) ==========
                -- warmup_mailboxes
                IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='warmup_mailboxes') THEN
                    CREATE TABLE warmup_mailboxes (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        integration_id UUID NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
                        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
                        email TEXT NOT NULL,
                        provider TEXT NOT NULL CHECK (provider IN ('gmail', 'outlook', 'custom_email')),
                        status TEXT NOT NULL DEFAULT 'paused' CHECK (status IN ('active', 'paused', 'unenrolled', 'error')),
                        pause_reason TEXT,
                        pool_type TEXT NOT NULL DEFAULT 'global' CHECK (pool_type IN ('enterprise', 'global')),
                        daily_sent_count INTEGER NOT NULL DEFAULT 0,
                        daily_received_count INTEGER NOT NULL DEFAULT 0,
                        last_reset_at TIMESTAMP NOT NULL DEFAULT NOW(),
                        hidden_folder_path TEXT,
                        hidden_folder_created_at TIMESTAMP,
                        active_thread_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
                        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
                    );
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'wm_status_idx') THEN
                    CREATE INDEX wm_status_idx ON warmup_mailboxes(status);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'wm_pool_type_idx') THEN
                    CREATE INDEX wm_pool_type_idx ON warmup_mailboxes(pool_type);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'wm_org_idx') THEN
                    CREATE INDEX wm_org_idx ON warmup_mailboxes(organization_id);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'wm_provider_idx') THEN
                    CREATE INDEX wm_provider_idx ON warmup_mailboxes(provider);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'wm_integration_idx') THEN
                    CREATE UNIQUE INDEX wm_integration_idx ON warmup_mailboxes(integration_id);
                END IF;

                -- warmup_threads
                IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='warmup_threads') THEN
                    CREATE TABLE warmup_threads (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        sender_mailbox_id UUID NOT NULL REFERENCES warmup_mailboxes(id) ON DELETE CASCADE,
                        recipient_mailbox_id UUID NOT NULL REFERENCES warmup_mailboxes(id) ON DELETE CASCADE,
                        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'stalled', 'error')),
                        message_count INTEGER NOT NULL DEFAULT 0,
                        max_messages INTEGER NOT NULL DEFAULT 3,
                        subject TEXT NOT NULL,
                        root_message_id TEXT,
                        last_message_id TEXT,
                        references JSONB NOT NULL DEFAULT '[]'::jsonb,
                        next_send_at TIMESTAMP,
                        next_expected_reply_at TIMESTAMP,
                        last_interaction_at TIMESTAMP,
                        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
                    );
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'wt_status_next_send_idx') THEN
                    CREATE INDEX wt_status_next_send_idx ON warmup_threads(status, next_send_at);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'wt_sender_idx') THEN
                    CREATE INDEX wt_sender_idx ON warmup_threads(sender_mailbox_id);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'wt_recipient_idx') THEN
                    CREATE INDEX wt_recipient_idx ON warmup_threads(recipient_mailbox_id);
                END IF;

                -- warmup_interactions
                IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='warmup_interactions') THEN
                    CREATE TABLE warmup_interactions (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        thread_id UUID NOT NULL REFERENCES warmup_threads(id) ON DELETE CASCADE,
                        direction TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
                        from_mailbox_id UUID NOT NULL REFERENCES warmup_mailboxes(id) ON DELETE CASCADE,
                        to_mailbox_id UUID NOT NULL REFERENCES warmup_mailboxes(id) ON DELETE CASCADE,
                        subject TEXT NOT NULL,
                        body TEXT NOT NULL,
                        message_id TEXT NOT NULL UNIQUE,
                        in_reply_to TEXT,
                        references JSONB NOT NULL DEFAULT '[]'::jsonb,
                        x_audnix_warmup BOOLEAN NOT NULL DEFAULT true,
                        expunged_from_sent BOOLEAN NOT NULL DEFAULT false,
                        moved_to_hidden_folder BOOLEAN NOT NULL DEFAULT false,
                        placement TEXT NOT NULL DEFAULT 'unknown' CHECK (placement IN ('unknown', 'inbox', 'spam', 'promotions')),
                        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'bounced', 'expunged')),
                        error_message TEXT,
                        sent_at TIMESTAMP,
                        delivered_at TIMESTAMP,
                        created_at TIMESTAMP NOT NULL DEFAULT NOW()
                    );
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'wi_thread_idx') THEN
                    CREATE INDEX wi_thread_idx ON warmup_interactions(thread_id);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'wi_status_idx') THEN
                    CREATE INDEX wi_status_idx ON warmup_interactions(status);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'wi_message_id_idx') THEN
                    CREATE INDEX wi_message_id_idx ON warmup_interactions(message_id);
                END IF;

                -- warmup_pool_state
                IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='warmup_pool_state') THEN
                    CREATE TABLE warmup_pool_state (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        pool_type TEXT NOT NULL CHECK (pool_type IN ('enterprise', 'global')),
                        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
                        total_mailboxes INTEGER NOT NULL DEFAULT 0,
                        active_mailboxes INTEGER NOT NULL DEFAULT 0,
                        paused_mailboxes INTEGER NOT NULL DEFAULT 0,
                        last_snapshot_at TIMESTAMP NOT NULL DEFAULT NOW(),
                        is_healthy BOOLEAN NOT NULL DEFAULT false,
                        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
                    );
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'wps_pool_type_org_idx') THEN
                    CREATE UNIQUE INDEX wps_pool_type_org_idx ON warmup_pool_state(pool_type, organization_id);
                END IF;

                -- Domain clustering: add columns to warmup_mailboxes
                IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='warmup_mailboxes') THEN
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='warmup_mailboxes' AND column_name='registered_domain') THEN
                        ALTER TABLE warmup_mailboxes ADD COLUMN registered_domain TEXT;
                        CREATE INDEX IF NOT EXISTS wm_domain_idx ON warmup_mailboxes(registered_domain);
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='warmup_mailboxes' AND column_name='anchor_role') THEN
                        ALTER TABLE warmup_mailboxes ADD COLUMN anchor_role TEXT NOT NULL DEFAULT 'member'
                            CHECK (anchor_role IN ('anchor', 'member', 'seed'));
                        CREATE INDEX IF NOT EXISTS wm_anchor_role_idx ON warmup_mailboxes(anchor_role);
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='warmup_mailboxes' AND column_name='anchor_mailbox_id') THEN
                        ALTER TABLE warmup_mailboxes ADD COLUMN anchor_mailbox_id UUID REFERENCES warmup_mailboxes(id) ON DELETE SET NULL;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='warmup_mailboxes' AND column_name='daily_limit') THEN
                        ALTER TABLE warmup_mailboxes ADD COLUMN daily_limit INTEGER;
                    END IF;
                    -- Make integration_id nullable for seed mailboxes (seeds have no user integration)
                    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='warmup_mailboxes' AND column_name='integration_id' AND is_nullable = 'NO') THEN
                        ALTER TABLE warmup_mailboxes ALTER COLUMN integration_id DROP NOT NULL;
                    END IF;
                    -- Make user_id text to accept 'system' for seeds
                    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='warmup_mailboxes' AND column_name='user_id' AND data_type = 'uuid') THEN
                        ALTER TABLE warmup_mailboxes ALTER COLUMN user_id TYPE TEXT;
                    END IF;
                    -- Drop unique index on integration_id (seeds have null)
                    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'wm_integration_idx') THEN
                        DROP INDEX IF EXISTS wm_integration_idx;
                        CREATE INDEX IF NOT EXISTS wm_integration_idx ON warmup_mailboxes(integration_id);
                    END IF;
                END IF;

                -- Domain clusters table
                IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='warmup_domain_clusters') THEN
                    CREATE TABLE warmup_domain_clusters (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        registered_domain TEXT NOT NULL,
                        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
                        anchor_mailbox_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
                        seed_mailbox_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
                        member_mailbox_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
                        mode TEXT NOT NULL DEFAULT 'internal_only'
                            CHECK (mode IN ('user_provided', 'platform_seed', 'internal_only')),
                        total_mailboxes INTEGER NOT NULL DEFAULT 0,
                        anchor_count INTEGER NOT NULL DEFAULT 0,
                        is_healthy BOOLEAN NOT NULL DEFAULT false,
                        last_activity_at TIMESTAMP,
                        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
                    );
                    CREATE UNIQUE INDEX wdc_domain_org_idx ON warmup_domain_clusters(registered_domain, organization_id);
                    CREATE INDEX wdc_mode_idx ON warmup_domain_clusters(mode);
                    CREATE INDEX wdc_health_idx ON warmup_domain_clusters(is_healthy);
                END IF;

                -- Seed accounts table
                IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='warmup_seed_accounts') THEN
                    CREATE TABLE warmup_seed_accounts (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        email TEXT NOT NULL UNIQUE,
                        provider TEXT NOT NULL CHECK (provider IN ('gmail', 'outlook')),
                        status TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'cooling', 'exhausted', 'error', 'retired')),
                        daily_sent_count INTEGER NOT NULL DEFAULT 0,
                        daily_limit INTEGER NOT NULL DEFAULT 400,
                        partner_count INTEGER NOT NULL DEFAULT 0,
                        max_partners INTEGER NOT NULL DEFAULT 10,
                        last_reset_at TIMESTAMP NOT NULL DEFAULT NOW(),
                        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                        assigned_domain_cluster_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
                        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
                    );
                    CREATE INDEX wsa_provider_idx ON warmup_seed_accounts(provider);
                    CREATE INDEX wsa_status_idx ON warmup_seed_accounts(status);
                END IF;

                -- Per-provider campaign limits
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='integrations' AND column_name='initial_outreach_limit') THEN
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='integrations' AND column_name='provider_limits') THEN
                        ALTER TABLE integrations ADD COLUMN provider_limits JSONB NOT NULL DEFAULT '{}'::jsonb;
                    END IF;
                END IF;

                -- KPI Isolation: is_warmup flag on messages and campaign_emails
                IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='messages') THEN
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='is_warmup') THEN
                        ALTER TABLE messages ADD COLUMN is_warmup BOOLEAN NOT NULL DEFAULT false;
                    END IF;
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='campaign_emails') THEN
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='campaign_emails' AND column_name='is_warmup') THEN
                        ALTER TABLE campaign_emails ADD COLUMN is_warmup BOOLEAN NOT NULL DEFAULT false;
                    END IF;
                END IF;

                -- Performance: Partial index for KPI outbound queries (avoids full scan at 50k+ scale)
                IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='messages') THEN
                    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'msgs_kpi_outbound_idx') THEN
                        CREATE INDEX msgs_kpi_outbound_idx ON messages(user_id, created_at)
                        WHERE direction = 'outbound' AND is_warmup = false;
                    END IF;
                END IF;

                -- Email Tracking: placement, integration_id, placement_updated_at
                IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='email_tracking') THEN
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='email_tracking' AND column_name='integration_id') THEN
                        ALTER TABLE email_tracking ADD COLUMN integration_id UUID REFERENCES integrations(id) ON DELETE SET NULL;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='email_tracking' AND column_name='placement') THEN
                        ALTER TABLE email_tracking ADD COLUMN placement TEXT DEFAULT 'unknown';
                    ELSE
                        -- Ensure default is 'unknown' not NULL
                        ALTER TABLE email_tracking ALTER COLUMN placement SET DEFAULT 'unknown';
                        UPDATE email_tracking SET placement = 'unknown' WHERE placement IS NULL;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='email_tracking' AND column_name='placement_updated_at') THEN
                        ALTER TABLE email_tracking ADD COLUMN placement_updated_at TIMESTAMP;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='email_tracking' AND column_name='message_id') THEN
                        ALTER TABLE email_tracking ADD COLUMN message_id TEXT;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'email_tracking_integration_id_idx') THEN
                        CREATE INDEX email_tracking_integration_id_idx ON email_tracking(integration_id);
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'email_tracking_placement_idx') THEN
                        CREATE INDEX email_tracking_placement_idx ON email_tracking(placement);
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'email_tracking_created_at_idx') THEN
                        CREATE INDEX email_tracking_created_at_idx ON email_tracking(created_at);
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'email_tracking_user_created_idx') THEN
                        CREATE INDEX email_tracking_user_created_idx ON email_tracking(user_id, created_at);
                    END IF;
                END IF;

                -- Warmup interactions: placement column
                IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='warmup_interactions') THEN
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='warmup_interactions' AND column_name='placement') THEN
                        ALTER TABLE warmup_interactions ADD COLUMN placement TEXT DEFAULT 'unknown';
                        ALTER TABLE warmup_interactions ADD CONSTRAINT warmup_interactions_placement_check CHECK (placement IN ('unknown', 'inbox', 'spam', 'promotions'));
                        CREATE INDEX wi_placement_idx ON warmup_interactions(placement);
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='warmup_interactions' AND column_name='opened_at') THEN
                        ALTER TABLE warmup_interactions ADD COLUMN opened_at TIMESTAMP;
                    END IF;
                END IF;

                -- Deleted accounts log for login messaging
                IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='deleted_accounts_log') THEN
                    CREATE TABLE deleted_accounts_log (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        email TEXT NOT NULL,
                        deleted_at TIMESTAMP NOT NULL DEFAULT NOW(),
                        reason TEXT
                    );
                    CREATE INDEX dal_email_idx ON deleted_accounts_log(email);
                END IF;

                -- MCP logs for API key usage tracking
                IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='mcp_logs') THEN
                    CREATE TABLE mcp_logs (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        user_id UUID,
                        api_key_id UUID,
                        tool_name TEXT,
                        input JSONB,
                        success BOOLEAN,
                        error TEXT,
                        created_at TIMESTAMP DEFAULT NOW()
                    );
                END IF;

            END $$;
        `); });
        console.log("✅ Emergency schema synchronization completed.");
    } catch (emergencyError: any) {
        console.error("❌ Emergency schema synchronization failed:", emergencyError.message || emergencyError);
        quotaService.reportDbError(emergencyError);
    } finally {
        // Always close the direct pool — migrations are one-shot.
        // Leaving it open leaks connections if this function is triggered repeatedly (e.g., admin panel).
        await closeDirectDatabase().catch(err => console.warn('[Migrator] Failed to close database after migration:', err.message));
    }
}



