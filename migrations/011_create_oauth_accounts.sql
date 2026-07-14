-- Migration: Create oauth_accounts table
-- Created: 2025-11-14
-- Description: Stores OAuth account linkages for GitHub, Google, LinkedIn authentication

CREATE TABLE IF NOT EXISTS oauth_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('github', 'google', 'linkedin', 'instagram', 'facebook')),
  provider_account_id TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMP WITH TIME ZONE,
  scope TEXT,
  token_type TEXT,
  id_token TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create unique index to prevent duplicate OAuth linkages
CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_provider_account 
  ON oauth_accounts(provider, provider_account_id);

-- Create index for faster user lookups
CREATE INDEX IF NOT EXISTS idx_oauth_user_id ON oauth_accounts(user_id);
