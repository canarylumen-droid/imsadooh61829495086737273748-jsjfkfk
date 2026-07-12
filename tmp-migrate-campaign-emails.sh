#!/bin/bash
cd /home/ubuntu/app
RAW_URL=$(grep '^DATABASE_URL_DIRECT\b' .env | head -1 | cut -d= -f2-)
if [ -z "$RAW_URL" ]; then
  RAW_URL=$(grep '^DATABASE_URL\b' .env | head -1 | cut -d= -f2-)
fi
CLEAN_URL="${RAW_URL%%\?*}"
psql "$CLEAN_URL" << 'SQL'
ALTER TABLE campaign_emails ADD COLUMN IF NOT EXISTS opened_at timestamp with time zone;
ALTER TABLE campaign_emails ADD COLUMN IF NOT EXISTS clicked_at timestamp with time zone;
ALTER TABLE campaign_emails ADD COLUMN IF NOT EXISTS replied_at timestamp with time zone;
\dt+ campaign_emails
SQL
