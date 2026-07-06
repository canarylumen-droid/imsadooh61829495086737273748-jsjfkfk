-- Add dedicated columns to leads table for common CSV fields
-- Previously these were stored only in JSONB metadata, making them unqueryable and unindexable

ALTER TABLE leads ADD COLUMN IF NOT EXISTS website text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS business_name text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS niche text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS industry text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS revenue text;

-- Add indexes for performant queries at 1M+ scale
CREATE INDEX IF NOT EXISTS leads_user_created_idx ON leads (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS leads_niche_idx ON leads (niche);
CREATE INDEX IF NOT EXISTS leads_city_idx ON leads (city);
CREATE INDEX IF NOT EXISTS leads_industry_idx ON leads (industry);

-- Fix aiPaused default to match production behavior
ALTER TABLE leads ALTER COLUMN ai_paused SET DEFAULT true;
