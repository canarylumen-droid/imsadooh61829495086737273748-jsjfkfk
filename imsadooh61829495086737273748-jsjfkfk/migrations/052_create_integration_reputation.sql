-- Migration: Create integration_reputation table
-- Purpose: Per-integration reputation score from multiple external sources.
-- Spamhaus DNSBL, AbuseIPDB, Cisco Talos, Gmail Postmaster, MS SNDS.
-- One row per integration (unique constraint on integration_id).
-- Safe to re-run: uses IF NOT EXISTS for table and indexes.

CREATE TABLE IF NOT EXISTS integration_reputation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id UUID NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
    score INTEGER NOT NULL DEFAULT 100,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    sources JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_checked_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT integration_reputation_integration_id_key UNIQUE (integration_id)
);

-- Fast lookup by integration_id (for upsert and per-integration queries)
CREATE INDEX IF NOT EXISTS rep_integration_id_idx
    ON integration_reputation(integration_id);

-- Fast lookup by score (for admin dashboards and alerting)
CREATE INDEX IF NOT EXISTS rep_score_idx
    ON integration_reputation(score);
