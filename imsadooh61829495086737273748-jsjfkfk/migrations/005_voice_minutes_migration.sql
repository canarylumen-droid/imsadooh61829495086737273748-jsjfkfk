-- Migration: Voice Minutes System
-- Update from voice seconds to voice minutes with balance tracking

-- Add new columns for voice minutes tracking
ALTER TABLE users ADD COLUMN IF NOT EXISTS voice_minutes_used REAL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS voice_minutes_topup REAL DEFAULT 0;

-- Migrate existing data from seconds to minutes (if voice_seconds_used column exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'voice_seconds_used'
  ) THEN
    -- Convert seconds to minutes for existing users
    UPDATE users SET voice_minutes_used = voice_seconds_used / 60.0 WHERE voice_seconds_used > 0;
    
    -- Drop old seconds column after migration
    ALTER TABLE users DROP COLUMN IF EXISTS voice_seconds_used;
  END IF;
END $$;

-- Create usage_topups table for audit trail if it doesn't exist
CREATE TABLE IF NOT EXISTS usage_topups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('leads', 'voice')),
  amount INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create index for faster queries on voice usage
CREATE INDEX IF NOT EXISTS idx_users_voice_minutes ON users(voice_minutes_used, voice_minutes_topup);
CREATE INDEX IF NOT EXISTS idx_usage_topups_user ON usage_topups(user_id, created_at DESC);

-- Add comments for documentation
COMMENT ON COLUMN users.voice_minutes_used IS 'Total voice minutes consumed by user';
COMMENT ON COLUMN users.voice_minutes_topup IS 'Additional voice minutes purchased via top-ups';
COMMENT ON TABLE usage_topups IS 'Audit log of all top-up purchases for compliance and analytics';
