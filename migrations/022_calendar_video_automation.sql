-- Calendar Settings & Video Assets for Calendar + Video Automation features
-- Safe migration - checks for existing tables

DO $$ 
BEGIN
  -- Calendar Settings for AI booking control
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'calendar_settings') THEN
    CREATE TABLE calendar_settings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
      calendly_token TEXT,
      calendly_username TEXT,
      calendly_event_type_uri TEXT,
      google_calendar_enabled BOOLEAN DEFAULT false,
      calendly_enabled BOOLEAN DEFAULT false,
      auto_booking_enabled BOOLEAN DEFAULT false,
      min_intent_score INTEGER DEFAULT 70,
      min_timing_score INTEGER DEFAULT 60,
      meeting_duration INTEGER DEFAULT 30,
      title_template TEXT DEFAULT '{{lead_name}} - Discovery Call',
      buffer_before INTEGER DEFAULT 10,
      buffer_after INTEGER DEFAULT 5,
      working_hours_start INTEGER DEFAULT 9,
      working_hours_end INTEGER DEFAULT 17,
      timezone TEXT DEFAULT 'America/New_York',
      availability_cache JSONB DEFAULT '[]',
      availability_cached_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    
    CREATE INDEX idx_calendar_settings_user ON calendar_settings(user_id);
  END IF;

  -- Video Assets for Instagram content intelligence
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'video_assets') THEN
    CREATE TABLE video_assets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform TEXT DEFAULT 'instagram',
      external_id TEXT NOT NULL,
      video_url TEXT NOT NULL,
      thumbnail_url TEXT,
      caption TEXT,
      purpose TEXT CHECK (purpose IN ('education', 'pitch', 'proof', 'entertainment', 'other')),
      cta_link TEXT,
      ai_context TEXT,
      enabled BOOLEAN DEFAULT true,
      impression_count INTEGER DEFAULT 0,
      dm_sent_count INTEGER DEFAULT 0,
      conversion_count INTEGER DEFAULT 0,
      last_used_at TIMESTAMPTZ,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, external_id)
    );
    
    CREATE INDEX idx_video_assets_user ON video_assets(user_id, enabled);
    CREATE INDEX idx_video_assets_platform ON video_assets(platform);
  END IF;

  -- AI Action Logs for intelligence transparency
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ai_action_logs') THEN
    CREATE TABLE ai_action_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
      action_type TEXT NOT NULL CHECK (action_type IN ('calendar_booking', 'video_sent', 'dm_sent', 'follow_up', 'objection_handled')),
      decision TEXT NOT NULL CHECK (decision IN ('act', 'wait', 'skip', 'escalate')),
      intent_score INTEGER,
      timing_score INTEGER,
      confidence REAL,
      reasoning TEXT,
      asset_id UUID,
      asset_type TEXT,
      outcome TEXT,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    
    CREATE INDEX IF NOT EXISTS idx_ai_action_logs_user ON ai_action_logs(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_action_logs_lead ON ai_action_logs(lead_id);
    CREATE INDEX IF NOT EXISTS idx_ai_action_logs_type ON ai_action_logs(action_type);
  END IF;

  -- Calendar Bookings for tracking AI-scheduled meetings
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'calendar_bookings') THEN
    CREATE TABLE calendar_bookings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
      provider TEXT NOT NULL CHECK (provider IN ('calendly', 'google', 'outlook')),
      external_event_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      start_time TIMESTAMPTZ NOT NULL,
      end_time TIMESTAMPTZ NOT NULL,
      meeting_url TEXT,
      attendee_email TEXT,
      attendee_name TEXT,
      status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
      is_ai_booked BOOLEAN DEFAULT false,
      intent_score_at_booking INTEGER,
      confidence_at_booking REAL,
      booking_reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    
    CREATE INDEX IF NOT EXISTS idx_calendar_bookings_user ON calendar_bookings(user_id, start_time);
    CREATE INDEX IF NOT EXISTS idx_calendar_bookings_lead ON calendar_bookings(lead_id);
    CREATE INDEX IF NOT EXISTS idx_calendar_bookings_status ON calendar_bookings(status);
  END IF;
END $$;
