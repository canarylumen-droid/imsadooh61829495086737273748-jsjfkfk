-- Fix schema mismatches for notifications and onboarding_profiles
-- Safe migration that checks state before altering

-- 1. Fix notifications table: safely rename 'body' to 'message' if needed
DO $$
BEGIN
  -- Check if 'body' exists AND 'message' does NOT exist
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='body') 
     AND NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='message') THEN
    ALTER TABLE notifications RENAME COLUMN body TO message;
  END IF;

  -- Check if 'read' exists AND 'is_read' does NOT exist
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='read') 
     AND NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='is_read') THEN
    ALTER TABLE notifications RENAME COLUMN "read" TO is_read;
  END IF;
END $$;

-- 2. Recreate onboarding_profiles table to match current schema
DROP TABLE IF EXISTS onboarding_profiles CASCADE;

CREATE TABLE onboarding_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  completed boolean NOT NULL DEFAULT false,
  user_role text,
  source text,
  use_case text,
  business_size text,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  completed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
