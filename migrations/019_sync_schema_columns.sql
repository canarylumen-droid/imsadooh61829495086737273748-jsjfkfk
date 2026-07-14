-- Sync users table with schema.ts
-- whatsapp_connected removed
ALTER TABLE users ADD COLUMN IF NOT EXISTS pdf_confidence_threshold REAL DEFAULT 0.7;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_insight_generated_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'none';
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_payment_plan TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_payment_amount REAL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_payment_date TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_approved_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;

-- Sync leads table
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ai_paused BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS pdf_confidence REAL;

-- Ensure metadata columns exist and have proper defaults
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'metadata') THEN
    ALTER TABLE users ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'metadata column already exists or error: %', SQLERRM;
END $$;
