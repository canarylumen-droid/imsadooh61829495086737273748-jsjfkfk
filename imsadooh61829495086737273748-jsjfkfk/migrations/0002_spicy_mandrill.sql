CREATE TABLE IF NOT EXISTS "scraping_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"niche" text NOT NULL,
	"location" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"total_found" integer DEFAULT 0 NOT NULL,
	"verified" integer DEFAULT 0 NOT NULL,
	"enriched" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"sources_scanned" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proxy_nodes_used" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"error_log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "prospects" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "session_id" uuid;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "snippet" text;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "social_profiles" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "lead_score" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "estimated_revenue" text;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "email_valid" boolean;--> statement-breakpoint
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scraping_sessions_user_id_users_id_fk') THEN 
        ALTER TABLE "scraping_sessions" ADD CONSTRAINT "scraping_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;
