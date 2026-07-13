
-- Video Monitoring & Comment Automation System
-- This migration adds tables for Instagram comment detection and auto-DM
-- Compatible with both Supabase and Neon PostgreSQL

-- Video monitors table - tracks which videos to monitor for comments
CREATE TABLE IF NOT EXISTS video_monitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  video_url TEXT NOT NULL,
  product_link TEXT NOT NULL,
  cta_text TEXT DEFAULT 'Check it out',
  is_active BOOLEAN DEFAULT true,
  auto_reply_enabled BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Processed comments table - prevents duplicate DMs
CREATE TABLE IF NOT EXISTS processed_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id TEXT UNIQUE NOT NULL,
  video_monitor_id UUID REFERENCES video_monitors(id) ON DELETE CASCADE,
  commenter_username TEXT NOT NULL,
  comment_text TEXT NOT NULL,
  intent_type TEXT NOT NULL,
  status TEXT DEFAULT 'dm_sent' CHECK (status IN ('dm_sent', 'ignored', 'failed')),
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Deals table source column update (if needed)
DO $$ 
BEGIN
  -- Check if deals table exists first
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'deals') THEN
    -- Add source column if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'deals' AND column_name = 'source'
    ) THEN
      ALTER TABLE deals ADD COLUMN source TEXT DEFAULT 'manual' 
        CHECK (source IN ('manual', 'instagram', 'email', 'comment_automation'));
    END IF;
    
    -- Add closed_at column if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'deals' AND column_name = 'closed_at'
    ) THEN
      ALTER TABLE deals ADD COLUMN closed_at TIMESTAMPTZ;
    END IF;
  END IF;
END $$;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_video_monitors_user ON video_monitors(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_processed_comments_video ON processed_comments(video_monitor_id);
CREATE INDEX IF NOT EXISTS idx_processed_comments_comment_id ON processed_comments(comment_id);
CREATE INDEX IF NOT EXISTS idx_deals_user ON deals(user_id);
CREATE INDEX IF NOT EXISTS idx_deals_status ON deals(status);
CREATE INDEX IF NOT EXISTS idx_deals_closed_at ON deals(closed_at);

-- Enable RLS
ALTER TABLE video_monitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_comments ENABLE ROW LEVEL SECURITY;

-- RLS policies (compatible with Neon - uses users table instead of auth.users)
DROP POLICY IF EXISTS "Users can manage own video monitors" ON video_monitors;
CREATE POLICY "Users can manage own video monitors" ON video_monitors
  FOR ALL USING (user_id = current_setting('app.current_user_id', true)::uuid);

DROP POLICY IF EXISTS "Users can view own processed comments" ON processed_comments;
CREATE POLICY "Users can view own processed comments" ON processed_comments
  FOR SELECT USING (video_monitor_id IN (
    SELECT id FROM video_monitors WHERE user_id = current_setting('app.current_user_id', true)::uuid
  ));

-- Trigger for updated_at (reuse existing function)
DROP TRIGGER IF EXISTS update_video_monitors_updated_at ON video_monitors;
CREATE TRIGGER update_video_monitors_updated_at
  BEFORE UPDATE ON video_monitors
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE video_monitors IS 'Tracks Instagram videos for comment automation';
COMMENT ON TABLE processed_comments IS 'Prevents duplicate DMs by tracking processed comments';
