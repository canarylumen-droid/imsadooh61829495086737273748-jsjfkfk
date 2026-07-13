CREATE TABLE IF NOT EXISTS "admin_whitelist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"role" text DEFAULT 'admin' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "admin_whitelist_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_learning_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"pattern_key" text NOT NULL,
	"strength" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp DEFAULT now(),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_process_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"total_items" integer DEFAULT 0 NOT NULL,
	"processed_items" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "brand_pdf_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_size" integer NOT NULL,
	"file_hash" text NOT NULL,
	"pdf_content" "bytea",
	"extracted_text" text,
	"brand_context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"analysis_score" integer DEFAULT 0,
	"analysis_items" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaign_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"subject" text,
	"body" text,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"step_index" integer DEFAULT 0 NOT NULL,
	"target_url" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaign_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"next_action_at" timestamp,
	"sent_at" timestamp,
	"error" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"integration_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "domain_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"verification_result" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"event_type" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"link_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"lead_id" uuid,
	"message_id" text NOT NULL,
	"thread_id" text,
	"campaign_id" uuid,
	"subject" text,
	"from_address" text NOT NULL,
	"to_address" text NOT NULL,
	"body" text,
	"html_body" text,
	"direction" text NOT NULL,
	"provider" text NOT NULL,
	"sent_at" timestamp NOT NULL,
	"target_url" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_messages_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_reply_store" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" text NOT NULL,
	"in_reply_to" text NOT NULL,
	"campaign_id" uuid,
	"lead_id" uuid,
	"user_id" uuid NOT NULL,
	"from_address" text NOT NULL,
	"subject" text,
	"body" text,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "email_reply_store_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_tracking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"lead_id" uuid,
	"recipient_email" text NOT NULL,
	"subject" text,
	"token" text NOT NULL,
	"sent_at" timestamp NOT NULL,
	"first_opened_at" timestamp,
	"first_clicked_at" timestamp,
	"open_count" integer DEFAULT 0 NOT NULL,
	"click_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_tracking_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"intent" text,
	"intent_score" integer DEFAULT 0 NOT NULL,
	"summary" text,
	"next_step" text,
	"competitors" jsonb DEFAULT '[]'::jsonb,
	"pain_points" jsonb DEFAULT '[]'::jsonb,
	"budget" text,
	"timeline" text,
	"last_analyzed_at" timestamp,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "lead_insights_lead_id_unique" UNIQUE("lead_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_social_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"profile_url" text NOT NULL,
	"handle" text,
	"followers_count" integer,
	"bio" text,
	"last_activity_at" timestamp,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verified" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_timezone_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"detected_timezone" text,
	"detected_city" text,
	"niche" text,
	"niche_category" text,
	"preferred_contact_start" integer DEFAULT 10,
	"preferred_contact_end" integer DEFAULT 18,
	"preferred_days" jsonb DEFAULT '["Monday","Tuesday","Wednesday","Thursday","Friday"]'::jsonb,
	"detection_confidence" real DEFAULT 0,
	"detection_source" text DEFAULT 'none',
	"last_updated_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "lead_timezone_profiles_lead_id_unique" UNIQUE("lead_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outreach_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"exclude_weekends" boolean DEFAULT false NOT NULL,
	"stats" jsonb DEFAULT '{"total": 0, "sent": 0, "replied": 0, "bounced": 0}'::jsonb,
	"template" jsonb NOT NULL,
	"config" jsonb DEFAULT '{"dailyLimit": 50, "minDelayMinutes": 2}'::jsonb NOT NULL,
	"reply_email" text,
	"ai_autonomous_mode" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"keys" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "smtp_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"user" text NOT NULL,
	"pass" text NOT NULL,
	"secure" boolean DEFAULT true NOT NULL,
	"daily_sent_count" integer DEFAULT 0 NOT NULL,
	"yesterday_sent_count" integer DEFAULT 0 NOT NULL,
	"last_reset_at" timestamp DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"subject" text,
	"last_message_at" timestamp DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_outreach_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"daily_limit" integer DEFAULT 50 NOT NULL,
	"warmup_enabled" boolean DEFAULT true NOT NULL,
	"auto_redistribute" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_trail" ALTER COLUMN "lead_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ALTER COLUMN "ai_paused" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "processed_comments" ALTER COLUMN "id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "processed_comments" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "video_monitors" ALTER COLUMN "id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "video_monitors" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "video_monitors" ALTER COLUMN "cta_text" SET DEFAULT 'Check it out';--> statement-breakpoint
ALTER TABLE "video_monitors" ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "video_monitors" ALTER COLUMN "metadata" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_trail' AND column_name='integration_id') THEN
        ALTER TABLE "audit_trail" ADD COLUMN "integration_id" uuid;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bounce_tracker' AND column_name='integration_id') THEN
        ALTER TABLE "bounce_tracker" ADD COLUMN "integration_id" uuid;
    END IF;
END $$;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "deal_value" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "calendar_link" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'manual';--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "ai_analysis" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "health_status" text DEFAULT 'connected' NOT NULL;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "last_health_error" text;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "last_health_check_at" timestamp;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "mailbox_pause_until" timestamp;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "failure_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "daily_limit" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "spam_risk_score" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "ai_autonomous_mode" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "reputation_score" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "warmup_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "company" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "role" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "bio" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "snippet" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "reply_email" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "archived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='integration_id') THEN
        ALTER TABLE "leads" ADD COLUMN "integration_id" uuid;
    END IF;
END $$;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "timezone" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "calendly_link" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "fathom_meeting_id" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "thread_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "subject" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "tracking_id" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "external_id" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "opened_at" timestamp;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "clicked_at" timestamp;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "replied_at" timestamp;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "is_read" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='integration_id') THEN
        ALTER TABLE "messages" ADD COLUMN "integration_id" uuid;
    END IF;
END $$;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "target_url" text;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='integration_id') THEN
        ALTER TABLE "notifications" ADD COLUMN "integration_id" uuid;
    END IF;
END $$;--> statement-breakpoint
ALTER TABLE "oauth_accounts" ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "processed_comments" ADD COLUMN IF NOT EXISTS "video_monitor_id" uuid;--> statement-breakpoint
ALTER TABLE "processed_comments" ADD COLUMN IF NOT EXISTS "commenter_username" text NOT NULL;--> statement-breakpoint
ALTER TABLE "processed_comments" ADD COLUMN IF NOT EXISTS "comment_text" text NOT NULL;--> statement-breakpoint
ALTER TABLE "processed_comments" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'dm_sent' NOT NULL;--> statement-breakpoint
ALTER TABLE "processed_comments" ADD COLUMN IF NOT EXISTS "lead_id" uuid;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='prospects' AND column_name='integration_id') THEN
        ALTER TABLE "prospects" ADD COLUMN "integration_id" uuid;
    END IF;
END $$;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "calendar_link" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "brand_guideline_pdf_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "brand_guideline_pdf_text" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "config" jsonb DEFAULT '{"autonomousMode":false}'::jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "filtered_leads_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "calendly_access_token" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "calendly_refresh_token" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "calendly_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "calendly_user_uri" text;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_learning_patterns_user_id_users_id_fk') THEN
        ALTER TABLE "ai_learning_patterns" ADD CONSTRAINT "ai_learning_patterns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_process_logs_user_id_users_id_fk') THEN
        ALTER TABLE "ai_process_logs" ADD CONSTRAINT "ai_process_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_pdf_cache_user_id_users_id_fk') THEN
        ALTER TABLE "brand_pdf_cache" ADD CONSTRAINT "brand_pdf_cache_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_emails_campaign_id_outreach_campaigns_id_fk') THEN
        ALTER TABLE "campaign_emails" ADD CONSTRAINT "campaign_emails_campaign_id_outreach_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."outreach_campaigns"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_emails_lead_id_leads_id_fk') THEN
        ALTER TABLE "campaign_emails" ADD CONSTRAINT "campaign_emails_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_emails_user_id_users_id_fk') THEN
        ALTER TABLE "campaign_emails" ADD CONSTRAINT "campaign_emails_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_leads_campaign_id_outreach_campaigns_id_fk') THEN
        ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_campaign_id_outreach_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."outreach_campaigns"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_leads_lead_id_leads_id_fk') THEN
        ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_leads_integration_id_integrations_id_fk') THEN
        ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE set null ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'domain_verifications_user_id_users_id_fk') THEN
        ALTER TABLE "domain_verifications" ADD CONSTRAINT "domain_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_messages_user_id_users_id_fk') THEN
        ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_messages_lead_id_leads_id_fk') THEN
        ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_messages_campaign_id_outreach_campaigns_id_fk') THEN
        ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_campaign_id_outreach_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."outreach_campaigns"("id") ON DELETE set null ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_reply_store_campaign_id_outreach_campaigns_id_fk') THEN
        ALTER TABLE "email_reply_store" ADD CONSTRAINT "email_reply_store_campaign_id_outreach_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."outreach_campaigns"("id") ON DELETE set null ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_reply_store_lead_id_leads_id_fk') THEN
        ALTER TABLE "email_reply_store" ADD CONSTRAINT "email_reply_store_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_reply_store_user_id_users_id_fk') THEN
        ALTER TABLE "email_reply_store" ADD CONSTRAINT "email_reply_store_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_tracking_user_id_users_id_fk') THEN
        ALTER TABLE "email_tracking" ADD CONSTRAINT "email_tracking_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_tracking_lead_id_leads_id_fk') THEN
        ALTER TABLE "email_tracking" ADD CONSTRAINT "email_tracking_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_insights_lead_id_leads_id_fk') THEN
        ALTER TABLE "lead_insights" ADD CONSTRAINT "lead_insights_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_insights_user_id_users_id_fk') THEN
        ALTER TABLE "lead_insights" ADD CONSTRAINT "lead_insights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_social_details_lead_id_leads_id_fk') THEN
        ALTER TABLE "lead_social_details" ADD CONSTRAINT "lead_social_details_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_timezone_profiles_lead_id_leads_id_fk') THEN
        ALTER TABLE "lead_timezone_profiles" ADD CONSTRAINT "lead_timezone_profiles_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_timezone_profiles_user_id_users_id_fk') THEN
        ALTER TABLE "lead_timezone_profiles" ADD CONSTRAINT "lead_timezone_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outreach_campaigns_user_id_users_id_fk') THEN
        ALTER TABLE "outreach_campaigns" ADD CONSTRAINT "outreach_campaigns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_subscriptions_user_id_users_id_fk') THEN
        ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'smtp_settings_user_id_users_id_fk') THEN
        ALTER TABLE "smtp_settings" ADD CONSTRAINT "smtp_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'threads_user_id_users_id_fk') THEN
        ALTER TABLE "threads" ADD CONSTRAINT "threads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'threads_lead_id_leads_id_fk') THEN
        ALTER TABLE "threads" ADD CONSTRAINT "threads_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_outreach_settings_user_id_users_id_fk') THEN
        ALTER TABLE "user_outreach_settings" ADD CONSTRAINT "user_outreach_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_pattern_idx" ON "ai_learning_patterns" USING btree ("user_id","pattern_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "brand_pdf_cache_user_id_hash_idx" ON "brand_pdf_cache" USING btree ("user_id","file_hash");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_lead_idx" ON "campaign_leads" USING btree ("campaign_id","lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_leads_next_action_idx" ON "campaign_leads" USING btree ("campaign_id","status","next_action_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_leads_integration_idx" ON "campaign_leads" USING btree ("integration_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_msgs_user_id_idx" ON "email_messages" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_msgs_lead_id_idx" ON "email_messages" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_msgs_thread_id_idx" ON "email_messages" USING btree ("thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lead_platform_idx" ON "lead_social_details" USING btree ("lead_id","platform");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tz_profile_lead_idx" ON "lead_timezone_profiles" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tz_profile_user_idx" ON "lead_timezone_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaigns_user_id_idx" ON "outreach_campaigns" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaigns_status_idx" ON "outreach_campaigns" USING btree ("status");--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_trail_integration_id_integrations_id_fk') THEN
        ALTER TABLE "audit_trail" ADD CONSTRAINT "audit_trail_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bounce_tracker_integration_id_integrations_id_fk') THEN
        ALTER TABLE "bounce_tracker" ADD CONSTRAINT "bounce_tracker_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_integration_id_integrations_id_fk') THEN
        ALTER TABLE "leads" ADD CONSTRAINT "leads_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE set null ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_integration_id_integrations_id_fk') THEN
        ALTER TABLE "messages" ADD CONSTRAINT "messages_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE set null ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_integration_id_integrations_id_fk') THEN
        ALTER TABLE "notifications" ADD CONSTRAINT "notifications_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE set null ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'processed_comments_video_monitor_id_video_monitors_id_fk') THEN
        ALTER TABLE "processed_comments" ADD CONSTRAINT "processed_comments_video_monitor_id_video_monitors_id_fk" FOREIGN KEY ("video_monitor_id") REFERENCES "public"."video_monitors"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'processed_comments_lead_id_leads_id_fk') THEN
        ALTER TABLE "processed_comments" ADD CONSTRAINT "processed_comments_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prospects_integration_id_integrations_id_fk') THEN
        ALTER TABLE "prospects" ADD CONSTRAINT "prospects_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE set null ON UPDATE no action;
    END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cal_events_start_time_idx" ON "calendar_events" USING btree ("start_time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cal_events_user_id_idx" ON "calendar_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "follow_up_scheduled_status_idx" ON "follow_up_queue" USING btree ("scheduled_at","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "follow_up_user_id_idx" ON "follow_up_queue" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_user_id_idx" ON "leads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_integration_id_idx" ON "leads" USING btree ("integration_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_status_idx" ON "leads" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_archived_idx" ON "leads" USING btree ("archived");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_user_status_idx" ON "leads" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_last_msg_idx" ON "leads" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msgs_user_id_idx" ON "messages" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msgs_lead_id_idx" ON "messages" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "msgs_integration_id_idx" ON "messages" USING btree ("integration_id");--> statement-breakpoint
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='processed_comments' AND column_name='action') THEN
        ALTER TABLE "processed_comments" DROP COLUMN "action";
    END IF;
END $$;
