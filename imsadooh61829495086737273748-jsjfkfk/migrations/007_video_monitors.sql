
-- Video Monitors for comment automation (safe migration)
-- Skip if already created in migration 006

DO $$ 
BEGIN
  -- Only create if doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'video_monitors') THEN
    CREATE TABLE video_monitors (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
    
    CREATE INDEX idx_video_monitors_user ON video_monitors(user_id, is_active);
  END IF;

  -- Processed comments table
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'processed_comments') THEN
    CREATE TABLE processed_comments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      comment_id TEXT NOT NULL UNIQUE,
      video_monitor_id UUID REFERENCES video_monitors(id) ON DELETE CASCADE,
      commenter_username TEXT NOT NULL,
      comment_text TEXT NOT NULL,
      intent_type TEXT NOT NULL,
      status TEXT DEFAULT 'dm_sent' CHECK (status IN ('dm_sent', 'ignored', 'failed')),
      lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
      processed_at TIMESTAMPTZ DEFAULT NOW()
    );
    
    CREATE INDEX idx_processed_comments_video ON processed_comments(video_monitor_id);
    CREATE INDEX idx_processed_comments_comment_id ON processed_comments(comment_id);
  END IF;
END $$;
