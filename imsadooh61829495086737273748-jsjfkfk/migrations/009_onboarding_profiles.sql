-- Onboarding Profiles Table
-- Stores user segmentation and onboarding flow data

CREATE TABLE IF NOT EXISTS onboarding_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  completed BOOLEAN NOT NULL DEFAULT false,
  user_role TEXT CHECK (user_role IN ('creator', 'founder', 'developer', 'agency', 'freelancer', 'other')),
  source TEXT,
  use_case TEXT,
  business_size TEXT CHECK (business_size IN ('solo', 'small_team', 'medium', 'enterprise')),
  tags JSONB DEFAULT '[]'::jsonb,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_onboarding_profiles_user_id ON onboarding_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_profiles_completed ON onboarding_profiles(completed);
