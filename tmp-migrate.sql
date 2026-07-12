ALTER TABLE campaign_emails ADD COLUMN IF NOT EXISTS opened_at timestamp with time zone;
ALTER TABLE campaign_emails ADD COLUMN IF NOT EXISTS clicked_at timestamp with time zone;
ALTER TABLE campaign_emails ADD COLUMN IF NOT EXISTS replied_at timestamp with time zone;
