
DO $$ BEGIN
    ALTER TYPE "status" ADD VALUE 'booked';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TYPE "type" ADD VALUE 'lead_import';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
