-- Migration 026: User settings table for SMTP configuration and preferences
-- Persistent storage for user-configurable settings (survives reloads, stored forever until changed)

CREATE TABLE IF NOT EXISTS user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  
  -- SMTP Configuration (full custom SMTP support)
  smtp_host TEXT,
  smtp_port INTEGER DEFAULT 587,
  smtp_username TEXT,
  smtp_password_encrypted TEXT,
  smtp_from_email TEXT,
  smtp_from_name TEXT,
  smtp_secure BOOLEAN DEFAULT true,
  smtp_verified BOOLEAN DEFAULT false,
  smtp_last_tested_at TIMESTAMP,
  
  -- Email Provider Selection
  email_provider TEXT DEFAULT 'sendgrid' CHECK (email_provider IN ('sendgrid', 'custom_smtp', 'ses', 'mailgun')),
  
  -- API Keys (encrypted)
  sendgrid_api_key_encrypted TEXT,
  custom_api_key_encrypted TEXT,
  custom_api_endpoint TEXT,
  
  -- Notification Preferences
  email_notifications_enabled BOOLEAN DEFAULT true,
  daily_digest_enabled BOOLEAN DEFAULT true,
  weekly_report_enabled BOOLEAN DEFAULT true,
  
  -- Automation Preferences
  auto_respond_enabled BOOLEAN DEFAULT true,
  auto_book_meetings BOOLEAN DEFAULT true,
  voice_notes_enabled BOOLEAN DEFAULT true,
  
  -- Real-time Sync Settings
  sync_interval_seconds INTEGER DEFAULT 30,
  last_sync_at TIMESTAMP,
  
  -- Timestamps
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_user_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_user_settings_updated_at ON user_settings;
CREATE TRIGGER trigger_user_settings_updated_at
  BEFORE UPDATE ON user_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_user_settings_updated_at();
