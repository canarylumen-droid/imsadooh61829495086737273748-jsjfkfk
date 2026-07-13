ALTER TABLE "bounce_tracker" ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}';
