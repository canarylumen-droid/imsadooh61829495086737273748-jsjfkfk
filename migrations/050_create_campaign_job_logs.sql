-- Migration: Create campaign_job_logs table (Self-Healing Watchdog source-of-truth)
-- Purpose: PostgreSQL-backed job state for every BullMQ campaign job.
-- The Watchdog queries this table hourly to detect and re-queue missing jobs.
-- Safe to re-run: uses IF NOT EXISTS for table and indexes.

CREATE TABLE IF NOT EXISTS campaign_job_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_bullmq_id TEXT NOT NULL UNIQUE,
    campaign_id UUID NOT NULL REFERENCES outreach_campaigns(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    integration_id TEXT,
    campaign_lead_id TEXT,
    job_type TEXT NOT NULL,
    step_index INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',
    job_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    scheduled_at TIMESTAMP NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Hot paths for the Watchdog query:
-- SELECT * FROM campaign_job_logs
-- WHERE status IN ('pending','processing')
--   AND scheduled_at < NOW() - INTERVAL '1 hour'
--   AND attempt_count < 3;
CREATE INDEX IF NOT EXISTS cjl_status_scheduled_idx
    ON campaign_job_logs(status, scheduled_at);

-- Campaign-level status lookups
CREATE INDEX IF NOT EXISTS cjl_campaign_status_idx
    ON campaign_job_logs(campaign_id, status);

-- BullMQ id lookups
CREATE INDEX IF NOT EXISTS cjl_bullmq_id_idx
    ON campaign_job_logs(job_bullmq_id);
