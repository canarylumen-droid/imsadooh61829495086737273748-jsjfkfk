-- Email Tracking Tables for Open/Click Analytics

-- Main email tracking table
CREATE TABLE IF NOT EXISTS email_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
    recipient_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    sent_at TIMESTAMP NOT NULL,
    first_opened_at TIMESTAMP,
    first_clicked_at TIMESTAMP,
    open_count INTEGER DEFAULT 0,
    click_count INTEGER DEFAULT 0,
    target_url TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Email events table for detailed tracking
CREATE TABLE IF NOT EXISTS email_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('open', 'click')),
    ip_address TEXT,
    user_agent TEXT,
    link_url TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Domain verifications cache
CREATE TABLE IF NOT EXISTS domain_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    domain TEXT NOT NULL,
    verification_result JSONB NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, domain)
);

-- Instagram webhook logs for debugging
CREATE TABLE IF NOT EXISTS instagram_webhook_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    processed BOOLEAN DEFAULT false,
    error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_email_tracking_user_sent ON email_tracking(user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_tracking_lead ON email_tracking(lead_id);
CREATE INDEX IF NOT EXISTS idx_email_tracking_token ON email_tracking(token);
CREATE INDEX IF NOT EXISTS idx_email_events_token ON email_events(token);
CREATE INDEX IF NOT EXISTS idx_email_events_created ON email_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_domain_verifications_user ON domain_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_instagram_webhook_logs_user ON instagram_webhook_logs(user_id, created_at DESC);
