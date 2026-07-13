-- Fix: Add missing columns to admin_whitelist table
-- Run this directly against the DB if drizzle-kit push doesn't apply it

-- Add status column if it doesn't exist
ALTER TABLE admin_whitelist ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

-- Add role column if it doesn't exist  
ALTER TABLE admin_whitelist ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin';

-- Add invited_by column if it doesn't exist
ALTER TABLE admin_whitelist ADD COLUMN IF NOT EXISTS invited_by TEXT;

-- Add created_at column if it doesn't exist
ALTER TABLE admin_whitelist ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();

-- Verify
SELECT column_name, data_type, column_default
FROM information_schema.columns 
WHERE table_name = 'admin_whitelist'
ORDER BY ordinal_position;
