-- Admin Whitelist Configuration
-- This migration creates a table for whitelisted admin emails

CREATE TABLE IF NOT EXISTS admin_whitelist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add default whitelisted admin emails
-- Replace these with your actual admin emails
INSERT INTO admin_whitelist (email, status) 
VALUES 
  ('admin@audnixai.com', 'active'),
  ('admin@audnixai.com', 'active'),
  ('ceo@audnixai.com', 'active')
ON CONFLICT (email) DO NOTHING;

-- Create index for fast email lookups
CREATE INDEX IF NOT EXISTS idx_admin_whitelist_email ON admin_whitelist(email);
CREATE INDEX IF NOT EXISTS idx_admin_whitelist_status ON admin_whitelist(status);
