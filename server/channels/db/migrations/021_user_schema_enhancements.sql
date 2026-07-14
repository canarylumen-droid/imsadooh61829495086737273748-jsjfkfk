-- Migration 021: Add subscription_tier, whatsapp_connected, pdf_confidence_threshold to users table
-- These fields enable better user state tracking and platform features

-- Add subscription_tier column (replaces plan for clearer subscription tracking)
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_tier TEXT DEFAULT 'free';

-- Add whatsapp_connected boolean for quick WhatsApp integration status check
ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_connected BOOLEAN NOT NULL DEFAULT false;

-- Add pdf_confidence_threshold for user-customizable PDF processing sensitivity
ALTER TABLE users ADD COLUMN IF NOT EXISTS pdf_confidence_threshold REAL DEFAULT 0.7;

-- Create index for fast subscription tier queries
CREATE INDEX IF NOT EXISTS idx_users_subscription_tier ON users(subscription_tier);

-- Create index for WhatsApp connected users (for targeted feature availability)
CREATE INDEX IF NOT EXISTS idx_users_whatsapp_connected ON users(whatsapp_connected) WHERE whatsapp_connected = true;
