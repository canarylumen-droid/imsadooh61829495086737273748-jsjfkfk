-- Migration 022: Remove remaining WhatsApp fields and indexes
-- This ensures the database is fully in sync with the updated schema.ts

-- Drop index if it exists
DROP INDEX IF EXISTS idx_users_whatsapp_connected;

-- Drop column from users table if it exists
ALTER TABLE users DROP COLUMN IF EXISTS whatsapp_connected;
