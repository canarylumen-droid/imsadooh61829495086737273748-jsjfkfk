-- Migration: Add password field for direct email/password authentication
-- This allows users to sign up without Supabase

-- Add password column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS password TEXT;

-- Add comment for documentation
COMMENT ON COLUMN users.password IS 'Hashed password for direct email/password authentication (bcrypt). NULL for Supabase OAuth users.';
