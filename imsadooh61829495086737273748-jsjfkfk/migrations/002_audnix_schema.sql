-- This migration is for Supabase only
-- Skip if not using Supabase (migration 000 handles standard PostgreSQL)
-- All functionality is already provided by 000_SETUP_SUPABASE.sql

-- audnixai.com Production Database Schema
-- Run this migration in Supabase SQL Editor after enabling pgvector extension

-- Enable pgvector extension for embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Users table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS users (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 supabase_id TEXT UNIQUE,
 email TEXT UNIQUE NOT NULL,
 name TEXT,
 username TEXT,
 plan TEXT DEFAULT 'trial' CHECK (plan IN ('trial', 'starter', 'pro', 'enterprise')),
 trial_expires_at TIMESTAMPTZ,
 trial_active BOOLEAN DEFAULT false,
 stripe_customer_id TEXT,
 stripe_subscription_id TEXT,
 leads_limit INTEGER DEFAULT 500,
 voice_seconds_limit INTEGER DEFAULT 0,
 usage_leads NUMERIC DEFAULT 0,
 usage_voice_seconds NUMERIC DEFAULT 0,
 autopilot_default BOOLEAN DEFAULT true,
 voice_enabled_default BOOLEAN DEFAULT false,
 created_at TIMESTAMPTZ DEFAULT NOW(),
 updated_at TIMESTAMPTZ DEFAULT NOW(),
 last_login TIMESTAMPTZ
);

-- 2. Admin whitelist
CREATE TABLE IF NOT EXISTS admin_whitelist (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 email TEXT UNIQUE NOT NULL,
 added_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Integrations (encrypted provider tokens)
CREATE TABLE IF NOT EXISTS integrations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID REFERENCES users(id) ON DELETE CASCADE,
 provider TEXT NOT NULL CHECK (provider IN ('instagram', 'gmail', 'outlook', 'manychat')),
 encrypted_meta TEXT NOT NULL, -- encrypted tokens and metadata as string (iv:tag:ciphertext)
 connected BOOLEAN DEFAULT false,
 account_type TEXT CHECK (account_type IN ('personal', 'creator', 'business')),
 last_sync TIMESTAMPTZ,
 created_at TIMESTAMPTZ DEFAULT NOW(),
 UNIQUE(user_id, provider)
);

-- 4. Leads
CREATE TABLE IF NOT EXISTS leads (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID REFERENCES users(id) ON DELETE CASCADE,
 external_id TEXT,
 name TEXT NOT NULL,
 channel TEXT NOT NULL CHECK (channel IN ('instagram', 'email')),
 email TEXT,
 phone TEXT,
 status TEXT DEFAULT 'new' CHECK (status IN ('new', 'open', 'replied', 'converted', 'not_interested', 'cold')),
 score NUMERIC DEFAULT 0,
 warm BOOLEAN DEFAULT false,
 last_message_at TIMESTAMPTZ,
 tags TEXT[] DEFAULT '{}',
 metadata JSONB DEFAULT '{}',
 created_at TIMESTAMPTZ DEFAULT NOW(),
 updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Messages
CREATE TABLE IF NOT EXISTS messages (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
 user_id UUID REFERENCES users(id) ON DELETE CASCADE,
 provider TEXT NOT NULL,
 direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
 body TEXT NOT NULL,
 audio_url TEXT,
 metadata JSONB DEFAULT '{}',
 created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Follow-up jobs
CREATE TABLE IF NOT EXISTS followup_jobs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
 user_id UUID REFERENCES users(id) ON DELETE CASCADE,
 scheduled_at TIMESTAMPTZ NOT NULL,
 attempt INTEGER DEFAULT 0,
 channel TEXT NOT NULL CHECK (channel IN ('instagram', 'email')),
 stage INTEGER DEFAULT 0,
 status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'sent', 'failed', 'cancelled')),
 params JSONB DEFAULT '{}',
 last_error TEXT,
 created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Automations
CREATE TABLE IF NOT EXISTS automations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID REFERENCES users(id) ON DELETE CASCADE,
 title TEXT NOT NULL,
 trigger JSONB NOT NULL,
 steps JSONB NOT NULL,
 jitter_percent FLOAT DEFAULT 0.2,
 active BOOLEAN DEFAULT true,
 created_at TIMESTAMPTZ DEFAULT NOW(),
 updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Uploads
CREATE TABLE IF NOT EXISTS uploads (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID REFERENCES users(id) ON DELETE CASCADE,
 type TEXT NOT NULL CHECK (type IN ('pdf', 'voice', 'csv')),
 storage_path TEXT NOT NULL,
 metadata JSONB DEFAULT '{}',
 ingestion_status TEXT DEFAULT 'queued' CHECK (ingestion_status IN ('queued', 'processing', 'done', 'failed')),
 created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Brand embeddings (pgvector)
CREATE TABLE IF NOT EXISTS brand_embeddings (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID REFERENCES users(id) ON DELETE CASCADE,
 source TEXT NOT NULL,
 embedding vector(1536), -- OpenAI text-embedding-3-small dimension
 snippet TEXT NOT NULL,
 created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. Semantic memory (pgvector)
CREATE TABLE IF NOT EXISTS semantic_memory (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID REFERENCES users(id) ON DELETE CASCADE,
 source TEXT NOT NULL,
 embedding vector(1536),
 snippet TEXT NOT NULL,
 created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. Memory (key-value store)
CREATE TABLE IF NOT EXISTS memory (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID REFERENCES users(id) ON DELETE CASCADE,
 key TEXT NOT NULL,
 value JSONB NOT NULL,
 expires_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ DEFAULT NOW(),
 UNIQUE(user_id, key)
);

-- 12. Usage metrics (monthly aggregated)
CREATE TABLE IF NOT EXISTS usage_metrics (
 user_id UUID REFERENCES users(id) ON DELETE CASCADE,
 month_year TEXT NOT NULL, -- format: '2025-01'
 leads_used INTEGER DEFAULT 0,
 messages_used INTEGER DEFAULT 0,
 voice_seconds_used INTEGER DEFAULT 0,
 PRIMARY KEY (user_id, month_year)
);

-- 13. Usage top-ups
CREATE TABLE IF NOT EXISTS usage_topups (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID REFERENCES users(id) ON DELETE CASCADE,
 type TEXT NOT NULL CHECK (type IN ('leads', 'voice')),
 amount INTEGER NOT NULL,
 stripe_session_id TEXT,
 stripe_payment_status TEXT,
 created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 14. Usage purchases
CREATE TABLE IF NOT EXISTS usage_purchases (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 topup_id UUID REFERENCES usage_topups(id) ON DELETE CASCADE,
 stripe_event JSONB,
 processed BOOLEAN DEFAULT false,
 processed_at TIMESTAMPTZ
);

-- 15. Usage logs
CREATE TABLE IF NOT EXISTS usage_logs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID REFERENCES users(id) ON DELETE CASCADE,
 feature TEXT NOT NULL,
 amount NUMERIC NOT NULL,
 metadata JSONB DEFAULT '{}',
 created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 16. Auth events
CREATE TABLE IF NOT EXISTS auth_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID REFERENCES users(id) ON DELETE SET NULL,
 event_type TEXT NOT NULL,
 payload JSONB,
 created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 17. API keys
CREATE TABLE IF NOT EXISTS api_keys (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL,
 masked_key TEXT NOT NULL,
 key_hash TEXT NOT NULL,
 revoked BOOLEAN DEFAULT false,
 created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 18. Admin metrics
CREATE TABLE IF NOT EXISTS admin_metrics (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 key TEXT UNIQUE NOT NULL,
 value JSONB NOT NULL,
 last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_leads_user_id ON leads(user_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_last_message_at ON leads(last_message_at);
CREATE INDEX IF NOT EXISTS idx_leads_tags ON leads USING GIN(tags);

CREATE INDEX IF NOT EXISTS idx_messages_lead_id ON messages(lead_id);
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

CREATE INDEX IF NOT EXISTS idx_followup_jobs_user_id ON followup_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_followup_jobs_scheduled_at ON followup_jobs(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_followup_jobs_status ON followup_jobs(status);

CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id ON usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at ON usage_logs(created_at);

-- Vector indexes for similarity search
DO $$
BEGIN
  -- Ensure pgvector extension exists
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    
    -- Fix brand_embeddings.embedding type if necessary
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'brand_embeddings' AND column_name = 'embedding' AND data_type != 'USER-DEFINED'
    ) THEN
      BEGIN
        ALTER TABLE brand_embeddings 
        ALTER COLUMN embedding TYPE vector(1536) 
        USING (
          CASE 
            WHEN substring(embedding::text, 1, 1) = '[' THEN embedding::text::vector 
            ELSE NULL 
          END
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Could not convert brand_embeddings.embedding to vector: %', SQLERRM;
      END;
    END IF;

    -- Fix semantic_memory.embedding type if necessary
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'semantic_memory' AND column_name = 'embedding' AND data_type != 'USER-DEFINED'
    ) THEN
      BEGIN
        ALTER TABLE semantic_memory 
        ALTER COLUMN embedding TYPE vector(1536) 
        USING (
          CASE 
            WHEN substring(embedding::text, 1, 1) = '[' THEN embedding::text::vector 
            ELSE NULL 
          END
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Could not convert semantic_memory.embedding to vector: %', SQLERRM;
      END;
    END IF;

    -- Create/Recreate indexes
    -- We drop first to ensure fresh creation with correct operator class
    DROP INDEX IF EXISTS idx_brand_embeddings_vector;
    CREATE INDEX IF NOT EXISTS idx_brand_embeddings_vector ON brand_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
    
    DROP INDEX IF EXISTS idx_semantic_memory_vector;
    CREATE INDEX IF NOT EXISTS idx_semantic_memory_vector ON semantic_memory USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
    
  ELSE
    RAISE NOTICE 'pgvector not available, skipping vector indexes in 002';
  END IF;
END $$;

-- Row Level Security (RLS) Policies
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE followup_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE semantic_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_topups ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access their own data
-- These policies are Supabase-specific and should be removed or adapted for standard PostgreSQL
-- CREATE POLICY "Users can view own data" ON users FOR SELECT USING (auth.uid()::text = supabase_id);
-- CREATE POLICY "Users can update own data" ON users FOR UPDATE USING (auth.uid()::text = supabase_id);
--
-- CREATE POLICY "Users can manage own integrations" ON integrations FOR ALL USING (user_id IN (SELECT id FROM users WHERE supabase_id = auth.uid()::text));
-- CREATE POLICY "Users can manage own leads" ON leads FOR ALL USING (user_id IN (SELECT id FROM users WHERE supabase_id = auth.uid()::text));
-- CREATE POLICY "Users can manage own messages" ON messages FOR ALL USING (user_id IN (SELECT id FROM users WHERE supabase_id = auth.uid()::text));
-- CREATE POLICY "Users can manage own jobs" ON followup_jobs FOR ALL USING (user_id IN (SELECT id FROM users WHERE supabase_id = auth.uid()::text));
-- CREATE POLICY "Users can manage own automations" ON automations FOR ALL USING (user_id IN (SELECT id FROM users WHERE supabase_id = auth.uid()::text));
-- CREATE POLICY "Users can manage own uploads" ON uploads FOR ALL USING (user_id IN (SELECT id FROM users WHERE supabase_id = auth.uid()::text));
-- CREATE POLICY "Users can manage own brand embeddings" ON brand_embeddings FOR ALL USING (user_id IN (SELECT id FROM users WHERE supabase_id = auth.uid()::text));
-- CREATE POLICY "Users can manage own semantic memory" ON semantic_memory FOR ALL USING (user_id IN (SELECT id FROM users WHERE supabase_id = auth.uid()::text));
-- CREATE POLICY "Users can manage own memory" ON memory FOR ALL USING (user_id IN (SELECT id FROM users WHERE supabase_id = auth.uid()::text));
-- CREATE POLICY "Users can view own usage metrics" ON usage_metrics FOR SELECT USING (user_id IN (SELECT id FROM users WHERE supabase_id = auth.uid()::text));
-- CREATE POLICY "Users can view own topups" ON usage_topups FOR SELECT USING (user_id IN (SELECT id FROM users WHERE supabase_id = auth.uid()::text));
-- CREATE POLICY "Users can view own usage logs" ON usage_logs FOR SELECT USING (user_id IN (SELECT id FROM users WHERE supabase_id = auth.uid()::text));
-- CREATE POLICY "Users can manage own API keys" ON api_keys FOR ALL USING (user_id IN (SELECT id FROM users WHERE supabase_id = auth.uid()::text));

-- Admin whitelist bypass (service role key has full access)
-- No additional policies needed for admin_whitelist, auth_events, admin_metrics (service role only)

-- Functions and triggers
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_leads_updated_at ON leads;
CREATE TRIGGER update_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_automations_updated_at ON automations;
CREATE TRIGGER update_automations_updated_at
  BEFORE UPDATE ON automations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
