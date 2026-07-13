-- Migration: Fix deals status enum to match code usage
-- Created: 2025-11-14
-- Description: Updates deals.status constraint to include 'open', 'closed_won', 'closed_lost', 'pending'

-- Drop old constraint if it exists
ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_status_check;

-- Add new constraint with correct enum values
ALTER TABLE deals ADD CONSTRAINT deals_status_check 
  CHECK (status IN ('open', 'closed_won', 'closed_lost', 'pending'));
