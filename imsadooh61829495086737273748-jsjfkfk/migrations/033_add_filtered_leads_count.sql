ALTER TABLE users ADD COLUMN IF NOT EXISTS filtered_leads_count integer NOT NULL DEFAULT 0;
