-- Migration: Create job_attempts table (Per-Attempt Audit Trail)
-- Purpose: Fine-grained observability at 1M+ scale.
-- Captures every worker entry, success, failure, and duplicate skip.
-- Safe to re-run: uses IF NOT EXISTS for table and indexes.

CREATE TABLE IF NOT EXISTS job_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id TEXT NOT NULL,
    job_name TEXT NOT NULL,
    campaign_id UUID REFERENCES outreach_campaigns(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    integration_id TEXT,
    campaign_lead_id TEXT,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'started',
    error TEXT,
    worker_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Hot query paths
CREATE INDEX IF NOT EXISTS ja_job_id_idx
    ON job_attempts(job_id);

CREATE INDEX IF NOT EXISTS ja_status_created_at_idx
    ON job_attempts(status, created_at);

CREATE INDEX IF NOT EXISTS ja_campaign_id_idx
    ON job_attempts(campaign_id);
