-- Migration: Create otp_codes table
-- Created: 2025-11-14
-- Description: Stores one-time password codes for email verification and sign-in

CREATE TABLE IF NOT EXISTS otp_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create index for faster email lookups
CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_codes(email);

-- Create index for cleanup of expired codes
CREATE INDEX IF NOT EXISTS idx_otp_expires_at ON otp_codes(expires_at);
