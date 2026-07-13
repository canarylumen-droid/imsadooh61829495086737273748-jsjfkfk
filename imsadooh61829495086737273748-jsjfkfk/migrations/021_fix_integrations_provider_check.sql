-- Fix integrations provider check constraint to include custom_email
-- This migration updates the constraint to match the schema definition

-- Drop the existing constraint
ALTER TABLE integrations DROP CONSTRAINT IF EXISTS integrations_provider_check;

-- Add the corrected constraint with all valid provider values
ALTER TABLE integrations ADD CONSTRAINT integrations_provider_check 
CHECK (provider IN ('instagram', 'gmail', 'outlook', 'manychat', 'custom_email', 'google_calendar', 'calendly'));
