ALTER TABLE "brand_embeddings" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_embeddings" ADD COLUMN IF NOT EXISTS "document_id" uuid DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "business_logo" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "intelligence_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;