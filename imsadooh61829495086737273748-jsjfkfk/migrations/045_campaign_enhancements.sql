-- Migration 045: Campaign Enhancements
-- Add integration_id to campaign_leads for mailbox assignment
ALTER TABLE campaign_leads ADD COLUMN IF NOT EXISTS integration_id UUID REFERENCES integrations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_campaign_leads_integration_id ON campaign_leads(integration_id);

-- Ensure auto_reply fields can be stored in the existing jsonb columns
-- No action needed for template and config fields inside jsonb for Postgres
