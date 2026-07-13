-- Add prospecting engine support
CREATE TABLE IF NOT EXISTS prospects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity TEXT NOT NULL,
  industry TEXT,
  location TEXT,
  email TEXT NOT NULL,
  phone TEXT,
  website TEXT,
  platforms JSONB DEFAULT '[]'::jsonb,
  wealth_signal TEXT,
  verified BOOLEAN DEFAULT false,
  verified_at TIMESTAMPTZ,
  status TEXT DEFAULT 'found',
  source TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add last_prospect_scan_at to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_prospect_scan_at TIMESTAMPTZ;

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_prospects_user_id ON prospects(user_id);
CREATE INDEX IF NOT EXISTS idx_prospects_email ON prospects(email);
CREATE INDEX IF NOT EXISTS idx_prospects_status ON prospects(status);

-- Enable RLS
ALTER TABLE prospects ENABLE ROW LEVEL SECURITY;

-- Add RLS policy
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'prospects' AND policyname = 'Users can manage own prospects'
  ) THEN
    CREATE POLICY "Users can manage own prospects" ON prospects
      FOR ALL USING (user_id = current_setting('app.current_user_id', true)::uuid);
  END IF;
END $$;
