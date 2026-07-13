-- Migration 023: Add automation_rules, content_library, and conversation_events tables
-- Intelligence-governed automation system

-- Automation rules (intelligence-governed, not trigger-based)
CREATE TABLE IF NOT EXISTS automation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rule_type TEXT NOT NULL DEFAULT 'follow_up' CHECK (rule_type IN ('follow_up', 'objection_handler', 'meeting_booking', 're_engagement')),
  channel TEXT NOT NULL CHECK (channel IN ('instagram', 'email', 'all')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  min_intent_score INTEGER NOT NULL DEFAULT 50,
  max_intent_score INTEGER NOT NULL DEFAULT 100,
  min_confidence REAL NOT NULL DEFAULT 0.6,
  allowed_actions JSONB NOT NULL DEFAULT '["reply"]'::jsonb,
  cooldown_minutes INTEGER NOT NULL DEFAULT 60,
  max_actions_per_day INTEGER NOT NULL DEFAULT 10,
  escalate_on_low_confidence BOOLEAN NOT NULL DEFAULT true,
  require_human_approval BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_rules_user_id ON automation_rules(user_id);
CREATE INDEX IF NOT EXISTS idx_automation_rules_channel ON automation_rules(channel);
CREATE INDEX IF NOT EXISTS idx_automation_rules_active ON automation_rules(is_active);

-- Content library for AI to choose from
CREATE TABLE IF NOT EXISTS content_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('reply', 'objection', 'cta', 'video')),
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  intent_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  objection_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  channel_restriction TEXT NOT NULL DEFAULT 'all' CHECK (channel_restriction IN ('instagram', 'email', 'all')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  usage_count INTEGER NOT NULL DEFAULT 0,
  success_rate REAL,
  linked_video_id UUID,
  linked_cta_link TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_library_user_id ON content_library(user_id);
CREATE INDEX IF NOT EXISTS idx_content_library_type ON content_library(type);
CREATE INDEX IF NOT EXISTS idx_content_library_active ON content_library(is_active);

-- Conversation events for unified message ingestion pipeline
CREATE TABLE IF NOT EXISTS conversation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('instagram', 'email')),
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  content TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'text' CHECK (content_type IN ('text', 'image', 'video', 'audio', 'file')),
  external_id TEXT,
  thread_id TEXT,
  signals JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_by_engine BOOLEAN NOT NULL DEFAULT false,
  engine_decision TEXT CHECK (engine_decision IN ('act', 'wait', 'skip', 'escalate')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversation_events_user_id ON conversation_events(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_events_lead_id ON conversation_events(lead_id);
CREATE INDEX IF NOT EXISTS idx_conversation_events_channel ON conversation_events(channel);
CREATE INDEX IF NOT EXISTS idx_conversation_events_processed ON conversation_events(processed_by_engine);
CREATE INDEX IF NOT EXISTS idx_conversation_events_created_at ON conversation_events(created_at DESC);
