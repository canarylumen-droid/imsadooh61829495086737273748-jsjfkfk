#!/bin/bash
cd /home/ubuntu/app
RAW_URL=$(grep DATABASE_URL .env | head -1 | cut -d= -f2-)
CLEAN_URL="${RAW_URL%%\?*}"
psql "$CLEAN_URL" -c "\d outreach_campaigns" | head -40
