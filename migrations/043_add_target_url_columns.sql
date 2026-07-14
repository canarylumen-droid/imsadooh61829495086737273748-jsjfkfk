-- Add target_url column to email_tracking table for secure redirect validation
ALTER TABLE email_tracking ADD COLUMN IF NOT EXISTS target_url TEXT;

-- Add target_url column to messages table (if not already added by drizzle push)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS target_url TEXT;

-- Add target_url column to campaign_emails table (if not already added by drizzle push)
ALTER TABLE campaign_emails ADD COLUMN IF NOT EXISTS target_url TEXT;

-- Add target_url column to email_messages table for secure redirect validation
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS target_url TEXT;
