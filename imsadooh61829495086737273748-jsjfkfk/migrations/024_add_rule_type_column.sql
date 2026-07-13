-- Migration 024: Add rule_type column to automation_rules if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'automation_rules' AND column_name = 'rule_type'
  ) THEN
    ALTER TABLE automation_rules ADD COLUMN rule_type TEXT NOT NULL DEFAULT 'follow_up' CHECK (rule_type IN ('follow_up', 'objection_handler', 'meeting_booking', 're_engagement'));
  END IF;
END $$;
