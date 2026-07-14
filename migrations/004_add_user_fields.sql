-- Add missing user fields for business and voice configuration
ALTER TABLE users ADD COLUMN IF NOT EXISTS business_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS voice_rules TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reply_tone TEXT DEFAULT 'professional';
ALTER TABLE users ADD COLUMN IF NOT EXISTS voice_clone_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_insight_generated_at TIMESTAMPTZ;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_business_name ON users(business_name);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_expires ON oauth_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_follow_up_queue_scheduled ON follow_up_queue(scheduled_at, status);
CREATE INDEX IF NOT EXISTS idx_leads_external_id ON leads(external_id);
