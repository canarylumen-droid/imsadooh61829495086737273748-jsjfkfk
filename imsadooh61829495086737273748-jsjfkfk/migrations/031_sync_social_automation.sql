
-- Cleanup and Synchronization for Social Automation Tables
-- This script ensures video_monitors and processed_comments match the shared/schema.ts

DO $$ 
BEGIN
    -- Force refresh of these tables to ensure they match the latest schema
    DROP TABLE IF EXISTS processed_comments;
    DROP TABLE IF EXISTS video_monitors;

    -- Re-create video_monitors
    CREATE TABLE IF NOT EXISTS video_monitors (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      video_id TEXT NOT NULL,
      video_url TEXT NOT NULL,
      product_link TEXT NOT NULL,
      cta_text TEXT NOT NULL DEFAULT 'Check it out',
      is_active BOOLEAN NOT NULL DEFAULT true,
      auto_reply_enabled BOOLEAN NOT NULL DEFAULT true,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Re-create processed_comments
    CREATE TABLE IF NOT EXISTS processed_comments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      comment_id TEXT UNIQUE NOT NULL,
      video_monitor_id UUID REFERENCES video_monitors(id) ON DELETE CASCADE,
      commenter_username TEXT NOT NULL,
      comment_text TEXT NOT NULL,
      intent_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'dm_sent',
      lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Add indexes if they don't exist
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_video_monitors_user_active') THEN
        CREATE INDEX idx_video_monitors_user_active ON video_monitors(user_id, is_active);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_processed_comments_monitor') THEN
        CREATE INDEX idx_processed_comments_monitor ON processed_comments(video_monitor_id);
    END IF;

END $$;

-- Ensure an admin user exists for immediate access
INSERT INTO users (email, username, role, timezone, plan, subscription_tier)
VALUES ('admin@audnixai.com', 'admin', 'admin', 'America/New_York', 'enterprise', 'enterprise')
ON CONFLICT (email) DO UPDATE 
SET role = 'admin', plan = 'enterprise', subscription_tier = 'enterprise';

-- Add core automation rules if missing (Associate with the admin user)
DO $$
DECLARE
    admin_id UUID;
BEGIN
    SELECT id INTO admin_id FROM users WHERE email = 'admin@audnixai.com' LIMIT 1;

    IF admin_id IS NOT NULL THEN
        INSERT INTO automation_rules (user_id, name, rule_type, channel, is_active, min_intent_score, allowed_actions)
        VALUES 
        (admin_id, 'Friendly Follow-up', 'follow_up', 'all', true, 50, '["reply"]'::jsonb),
        (admin_id, 'Direct Pitch', 're_engagement', 'all', true, 80, '["reply", "video", "cta"]'::jsonb)
        ON CONFLICT DO NOTHING;
    END IF;
END $$;
