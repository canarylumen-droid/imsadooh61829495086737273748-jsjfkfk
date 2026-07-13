-- Migration 044: Add exclude_weekends to outreach_campaigns
ALTER TABLE outreach_campaigns ADD COLUMN IF NOT EXISTS exclude_weekends BOOLEAN NOT NULL DEFAULT FALSE;
