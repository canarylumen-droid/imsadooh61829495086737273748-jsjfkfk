-- Migration 041: Fix Production Schema Mismatches
-- Synchronizes database with shared/schema.ts

DO $$ 
BEGIN
    -- 1. Leads table: add missing columns
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='archived') THEN
        ALTER TABLE leads ADD COLUMN archived BOOLEAN NOT NULL DEFAULT false;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='role') THEN
        ALTER TABLE leads ADD COLUMN role TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='bio') THEN
        ALTER TABLE leads ADD COLUMN bio TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='snippet') THEN
        ALTER TABLE leads ADD COLUMN snippet TEXT;
    END IF;

    -- 2. Create outreach_campaigns if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='outreach_campaigns') THEN
        CREATE TABLE outreach_campaigns (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name text NOT NULL,
            status text NOT NULL DEFAULT 'draft',
            stats jsonb DEFAULT '{"total": 0, "sent": 0, "replied": 0, "bounced": 0}'::jsonb,
            template jsonb NOT NULL,
            config jsonb NOT NULL DEFAULT '{"dailyLimit": 50, "minDelayMinutes": 2}'::jsonb,
            reply_email text,
            created_at timestamp NOT NULL DEFAULT now(),
            updated_at timestamp NOT NULL DEFAULT now()
        );
    ELSE
        -- If it exists, check for stats column
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='outreach_campaigns' AND column_name='stats') THEN
            ALTER TABLE outreach_campaigns ADD COLUMN stats jsonb DEFAULT '{"total": 0, "sent": 0, "replied": 0, "bounced": 0}'::jsonb;
        END IF;
    END IF;

    -- 3. Create campaign_leads if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='campaign_leads') THEN
        CREATE TABLE campaign_leads (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            campaign_id uuid NOT NULL REFERENCES outreach_campaigns(id) ON DELETE CASCADE,
            lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
            status text NOT NULL DEFAULT 'pending',
            current_step integer NOT NULL DEFAULT 0,
            next_action_at timestamp,
            sent_at timestamp,
            error text,
            retry_count integer NOT NULL DEFAULT 0,
            metadata jsonb DEFAULT '{}'::jsonb
        );
        CREATE UNIQUE INDEX IF NOT EXISTS campaign_lead_idx ON campaign_leads(campaign_id, lead_id);
    END IF;

    -- 4. Create campaign_emails if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='campaign_emails') THEN
        CREATE TABLE campaign_emails (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            campaign_id uuid NOT NULL REFERENCES outreach_campaigns(id) ON DELETE CASCADE,
            lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
            message_id text,
            provider text,
            sent_at timestamp NOT NULL DEFAULT now(),
            metadata jsonb DEFAULT '{}'::jsonb
        );
    END IF;

    -- 5. Create email_messages if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='email_messages') THEN
        CREATE TABLE email_messages (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
            message_id text NOT NULL UNIQUE,
            thread_id text,
            campaign_id uuid REFERENCES outreach_campaigns(id) ON DELETE SET NULL,
            subject text,
            from_address text NOT NULL,
            to_address text NOT NULL,
            body text,
            html_body text,
            direction text NOT NULL,
            provider text NOT NULL,
            sent_at timestamp NOT NULL,
            metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
            created_at timestamp NOT NULL DEFAULT now()
        );
    END IF;

    -- 6. Create user_outreach_settings if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='user_outreach_settings') THEN
        CREATE TABLE user_outreach_settings (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            daily_limit integer NOT NULL DEFAULT 50,
            warmup_enabled boolean NOT NULL DEFAULT true,
            created_at timestamp NOT NULL DEFAULT now(),
            updated_at timestamp NOT NULL DEFAULT now()
        );
    END IF;

    -- 7. Fix Users table: missing columns from schema.ts
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='calendar_link') THEN
        ALTER TABLE users ADD COLUMN calendar_link TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='brand_guideline_pdf_url') THEN
        ALTER TABLE users ADD COLUMN brand_guideline_pdf_url TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='brand_guideline_pdf_text') THEN
        ALTER TABLE users ADD COLUMN brand_guideline_pdf_text TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='config') THEN
        ALTER TABLE users ADD COLUMN config JSONB DEFAULT '{}'::jsonb;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='filtered_leads_count') THEN
        ALTER TABLE users ADD COLUMN filtered_leads_count INTEGER NOT NULL DEFAULT 0;
    END IF;

    -- 8. Fix Messages table: missing columns
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='subject') THEN
        ALTER TABLE messages ADD COLUMN subject TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='tracking_id') THEN
        ALTER TABLE messages ADD COLUMN tracking_id TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='opened_at') THEN
        ALTER TABLE messages ADD COLUMN opened_at TIMESTAMP;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='clicked_at') THEN
        ALTER TABLE messages ADD COLUMN clicked_at TIMESTAMP;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='replied_at') THEN
        ALTER TABLE messages ADD COLUMN replied_at TIMESTAMP;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='is_read') THEN
        ALTER TABLE messages ADD COLUMN is_read BOOLEAN NOT NULL DEFAULT false;
    END IF;

    -- 9. Fix Deals table: missing columns
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deals' AND column_name='deal_value') THEN
        ALTER TABLE deals ADD COLUMN deal_value INTEGER DEFAULT 0;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deals' AND column_name='source') THEN
        ALTER TABLE deals ADD COLUMN source TEXT DEFAULT 'manual';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deals' AND column_name='closed_at') THEN
        ALTER TABLE deals ADD COLUMN closed_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='deals' AND column_name='ai_analysis') THEN
        ALTER TABLE deals ADD COLUMN ai_analysis JSONB DEFAULT '{}'::jsonb;
    END IF;

END $$;
