-- Remove duplicate dealValue column (keep value instead)
-- Check if column exists before dropping to avoid errors
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name='deals' AND column_name='deal_value') THEN
        ALTER TABLE deals DROP COLUMN deal_value;
    END IF;
END $$;
