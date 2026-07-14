-- Migration: Add metadata JSONB column to users table
-- Created: 2025-11-14
-- Description: Adds metadata column for storing flexible user data like WhatsApp connection status

ALTER TABLE users ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Create index on metadata for better query performance
CREATE INDEX IF NOT EXISTS idx_users_metadata ON users USING GIN (metadata);
