-- Migration: Add high-throughput index on campaignEmails(status, sent_at)
-- Purpose: Support 1M+ scale status scans for watchdog, analytics, and duplicate-send checks
-- Safe to re-run: uses IF NOT EXISTS

CREATE INDEX IF NOT EXISTS ce_status_sent_at_idx
  ON campaign_emails(status, sent_at);
