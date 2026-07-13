-- Migration 046: Fix Missing integration_id columns
-- This migration adds the integration_id column to tables that are missing it
-- based on the current shared/schema.ts but were skipped in previous migrations.

DO $$ 
BEGIN
    -- 1. Leads table
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='integration_id') THEN
        ALTER TABLE leads ADD COLUMN integration_id UUID REFERENCES integrations(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_leads_integration_id ON leads(integration_id);
    END IF;

    -- 2. Messages table
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='integration_id') THEN
        ALTER TABLE messages ADD COLUMN integration_id UUID REFERENCES integrations(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_messages_integration_id ON messages(integration_id);
    END IF;

    -- 3. Notifications table
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='integration_id') THEN
        ALTER TABLE notifications ADD COLUMN integration_id UUID REFERENCES integrations(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_notifications_integration_id ON notifications(integration_id);
    END IF;

    -- 4. Prospects table
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='prospects' AND column_name='integration_id') THEN
        ALTER TABLE prospects ADD COLUMN integration_id UUID REFERENCES integrations(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_prospects_integration_id ON prospects(integration_id);
    END IF;

    -- 5. Audit Trail table
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_trail' AND column_name='integration_id') THEN
        ALTER TABLE audit_trail ADD COLUMN integration_id UUID REFERENCES integrations(id) ON DELETE CASCADE;
        CREATE INDEX IF NOT EXISTS idx_audit_trail_integration_id ON audit_trail(integration_id);
    END IF;

END $$;
