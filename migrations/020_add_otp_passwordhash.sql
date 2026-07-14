-- Add missing columns to otp_codes table for signup flow
-- This ensures password hashes are stored and retrieved during OTP verification

ALTER TABLE otp_codes
ADD COLUMN IF NOT EXISTS password_hash TEXT,
ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'login';

-- Create index for faster lookups by email and purpose
CREATE INDEX IF NOT EXISTS idx_otp_codes_email_purpose ON otp_codes(email, purpose);

-- Update existing records to have the 'login' purpose
UPDATE otp_codes SET purpose = 'login' WHERE purpose IS NULL;
