CREATE TABLE IF NOT EXISTS "ai_sticker_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"sticker_id" text NOT NULL,
	"provider" text DEFAULT 'giphy' NOT NULL,
	"url" text NOT NULL,
	"associated_niche" text,
	"sentiment" text,
	"conversion_weight" real DEFAULT 1 NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pending_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"fathom_meeting_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"ready_to_go_email" text,
	"custom_payment_link" text,
	"amount_detected" real,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "default_payment_link" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ai_sticker_followups_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_sticker_metrics_user_id_users_id_fk') THEN
        ALTER TABLE "ai_sticker_metrics" ADD CONSTRAINT "ai_sticker_metrics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pending_payments_user_id_users_id_fk') THEN
        ALTER TABLE "pending_payments" ADD CONSTRAINT "pending_payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pending_payments_lead_id_leads_id_fk') THEN
        ALTER TABLE "pending_payments" ADD CONSTRAINT "pending_payments_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_sticker_metrics_user_sticker_idx" ON "ai_sticker_metrics" USING btree ("user_id","sticker_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pending_payments_lead_idx" ON "pending_payments" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pending_payments_user_status_idx" ON "pending_payments" USING btree ("user_id","status");
