-- Migration 034: Add missing columns to users and leads tables
-- This fixes the "column company does not exist" error in follow-up-worker and dashboard stats

DO $$
BEGIN
    -- Add company column to users table if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'company'
    ) THEN
        ALTER TABLE users ADD COLUMN company TEXT;
        RAISE NOTICE 'Added company column to users table';
    ELSE
        RAISE NOTICE 'company column already exists in users table';
    END IF;

    -- Add company column to leads table if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'leads' AND column_name = 'company'
    ) THEN
        ALTER TABLE leads ADD COLUMN company TEXT;
        RAISE NOTICE 'Added company column to leads table';
    ELSE
        RAISE NOTICE 'company column already exists in leads table';
    END IF;

    -- Add role column to leads table if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'leads' AND column_name = 'role'
    ) THEN
        ALTER TABLE leads ADD COLUMN role TEXT;
        RAISE NOTICE 'Added role column to leads table';
    ELSE
        RAISE NOTICE 'role column already exists in leads table';
    END IF;

    -- Add bio column to leads table if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'leads' AND column_name = 'bio'
    ) THEN
        ALTER TABLE leads ADD COLUMN bio TEXT;
        RAISE NOTICE 'Added bio column to leads table';
    ELSE
        RAISE NOTICE 'bio column already exists in leads table';
    END IF;

END $$;
