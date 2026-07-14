-- =============================================================================
-- audnixai.com - COMPLETE DATABASE SCHEMA (Consolidated Migration)
-- All 37 tables with full columns and relationships
-- =============================================================================

-- Users table (35 columns)
CREATE TABLE IF NOT EXISTS "users" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "supabase_id" text,
    "email" text NOT NULL UNIQUE,
    "password" text,
    "name" text,
    "username" text,
    "avatar" text,
    "company" text,
    "timezone" text NOT NULL DEFAULT 'America/New_York',
    "plan" text NOT NULL DEFAULT 'trial',
    "subscription_tier" text DEFAULT 'free',
    "trial_expires_at" timestamp,
    "reply_tone" text NOT NULL DEFAULT 'professional',
    "role" text NOT NULL DEFAULT 'member',
    "stripe_customer_id" text,
    "stripe_subscription_id" text,
    "voice_clone_id" text,
    "voice_minutes_used" real NOT NULL DEFAULT 0,
    "voice_minutes_topup" real NOT NULL DEFAULT 0,
    "business_name" text,
    "voice_rules" text,
    "pdf_confidence_threshold" real DEFAULT 0.7,
    "last_insight_generated_at" timestamp,
    "last_prospect_scan_at" timestamp,
    "payment_status" text DEFAULT 'none',
    "pending_payment_plan" text,
    "pending_payment_amount" real,
    "pending_payment_date" timestamp,
    "payment_approved_at" timestamp,
    "stripe_session_id" text,
    "subscription_id" text,
    "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "last_login" timestamp,
    "updated_at" timestamp DEFAULT now()
);

-- Organizations table
CREATE TABLE IF NOT EXISTS "organizations" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" text NOT NULL,
    "slug" text UNIQUE,
    "owner_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "plan" text NOT NULL DEFAULT 'trial',
    "stripe_customer_id" text,
    "subscription_id" text,
    "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp DEFAULT now()
);

-- Team members
CREATE TABLE IF NOT EXISTS "team_members" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "role" text NOT NULL DEFAULT 'member',
    "permissions" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "invited_at" timestamp NOT NULL DEFAULT now(),
    "accepted_at" timestamp
);

-- Leads table (18 columns)
CREATE TABLE IF NOT EXISTS "leads" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE,
    "external_id" text,
    "name" text NOT NULL,
    "channel" text NOT NULL,
    "email" text,
    "phone" text,
    "status" text NOT NULL DEFAULT 'new',
    "score" integer NOT NULL DEFAULT 0,
    "warm" boolean NOT NULL DEFAULT false,
    "last_message_at" timestamp,
    "ai_paused" boolean NOT NULL DEFAULT false,
    "pdf_confidence" real,
    "tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
);

-- Messages table
CREATE TABLE IF NOT EXISTS "messages" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "lead_id" uuid NOT NULL REFERENCES "leads"("id") ON DELETE CASCADE,
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "provider" text NOT NULL,
    "direction" text NOT NULL,
    "body" text NOT NULL,
    "audio_url" text,
    "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamp NOT NULL DEFAULT now()
);

-- Integrations table
CREATE TABLE IF NOT EXISTS "integrations" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "provider" text NOT NULL,
    "encrypted_meta" text NOT NULL,
    "connected" boolean NOT NULL DEFAULT false,
    "account_type" text,
    "last_sync" timestamp,
    "created_at" timestamp NOT NULL DEFAULT now()
);

-- Deals table (13 columns)
CREATE TABLE IF NOT EXISTS "deals" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "lead_id" uuid NOT NULL REFERENCES "leads"("id") ON DELETE CASCADE,
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE,
    "brand" text NOT NULL,
    "channel" text NOT NULL,
    "value" real NOT NULL,
    "status" text NOT NULL DEFAULT 'open',
    "notes" text,
    "converted_at" timestamp,
    "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
);

-- Voice settings table
CREATE TABLE IF NOT EXISTS "voice_settings" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "voice_id" text,
    "voice_name" text,
    "model" text DEFAULT 'eleven_monolingual_v1',
    "stability" real DEFAULT 0.5,
    "similarity_boost" real DEFAULT 0.75,
    "style" real DEFAULT 0,
    "use_speaker_boost" boolean DEFAULT true,
    "created_at" timestamp NOT NULL DEFAULT now()
);

-- Automations table
CREATE TABLE IF NOT EXISTS "automations" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "name" text NOT NULL,
    "type" text NOT NULL,
    "channel" text NOT NULL,
    "trigger_conditions" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "actions" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "is_active" boolean NOT NULL DEFAULT true,
    "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamp NOT NULL DEFAULT now()
);

-- Calendar events table
CREATE TABLE IF NOT EXISTS "calendar_events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "lead_id" uuid REFERENCES "leads"("id") ON DELETE SET NULL,
    "title" text NOT NULL,
    "description" text,
    "start_time" timestamp NOT NULL,
    "end_time" timestamp NOT NULL,
    "location" text,
    "meeting_url" text,
    "status" text NOT NULL DEFAULT 'scheduled',
    "reminder_sent" boolean NOT NULL DEFAULT false,
    "external_id" text,
    "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamp NOT NULL DEFAULT now()
);

-- Notifications table
CREATE TABLE IF NOT EXISTS "notifications" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "type" text NOT NULL,
    "title" text NOT NULL,
    "body" text NOT NULL,
    "read" boolean NOT NULL DEFAULT false,
    "action_url" text,
    "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamp NOT NULL DEFAULT now()
);

-- Webhooks table
CREATE TABLE IF NOT EXISTS "webhooks" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "name" text NOT NULL,
    "url" text NOT NULL,
    "events" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "secret" text,
    "is_active" boolean NOT NULL DEFAULT true,
    "last_triggered" timestamp,
    "created_at" timestamp NOT NULL DEFAULT now()
);

-- API keys table
CREATE TABLE IF NOT EXISTS "api_keys" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "name" text NOT NULL,
    "key" text NOT NULL UNIQUE,
    "last_used_at" timestamp,
    "expires_at" timestamp,
    "created_at" timestamp NOT NULL DEFAULT now()
);

-- Insights table
CREATE TABLE IF NOT EXISTS "insights" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "type" text NOT NULL,
    "title" text NOT NULL,
    "content" text NOT NULL,
    "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamp NOT NULL DEFAULT now()
);

-- Brand embeddings table
CREATE TABLE IF NOT EXISTS "brand_embeddings" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "section" text NOT NULL,
    "content" text NOT NULL,
    "embedding" jsonb,
    "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamp NOT NULL DEFAULT now()
);

-- Onboarding profiles table
CREATE TABLE IF NOT EXISTS "onboarding_profiles" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "step" integer NOT NULL DEFAULT 1,
    "completed" boolean NOT NULL DEFAULT false,
    "business_type" text,
    "industry" text,
    "target_audience" text,
    "goals" jsonb DEFAULT '[]'::jsonb,
    "preferred_channels" jsonb DEFAULT '[]'::jsonb,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
);

-- OAuth accounts table
CREATE TABLE IF NOT EXISTS "oauth_accounts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "provider" text NOT NULL,
    "provider_account_id" text NOT NULL,
    "access_token" text,
    "refresh_token" text,
    "expires_at" timestamp,
    "scope" text,
    "token_type" text,
    "id_token" text,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
);

-- OTP codes table
CREATE TABLE IF NOT EXISTS "otp_codes" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "email" text NOT NULL,
    "code" text NOT NULL,
    "expires_at" timestamp NOT NULL,
    "attempts" integer NOT NULL DEFAULT 0,
    "verified" boolean NOT NULL DEFAULT false,
    "password_hash" text,
    "purpose" text DEFAULT 'login',
    "created_at" timestamp NOT NULL DEFAULT now()
);

-- Payments table
CREATE TABLE IF NOT EXISTS "payments" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "stripe_payment_id" text,
    "amount" real NOT NULL,
    "currency" text NOT NULL DEFAULT 'USD',
    "status" text NOT NULL DEFAULT 'pending',
    "plan" text,
    "payment_link" text,
    "webhook_payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp DEFAULT now()
);

-- Prospects table (22 columns - for lead discovery/scraping)
CREATE TABLE IF NOT EXISTS "prospects" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "session_id" uuid,
    "entity" text NOT NULL,
    "industry" text,
    "location" text,
    "email" text,
    "phone" text,
    "website" text,
    "source" text,
    "snippet" text,
    "platforms" jsonb DEFAULT '[]'::jsonb,
    "social_profiles" jsonb DEFAULT '{}'::jsonb,
    "wealth_signal" text,
    "lead_score" integer DEFAULT 0,
    "estimated_revenue" text,
    "verified" boolean DEFAULT false,
    "verified_at" timestamp,
    "email_valid" boolean,
    "status" text DEFAULT 'found',
    "metadata" jsonb DEFAULT '{}'::jsonb,
    "created_at" timestamp NOT NULL DEFAULT now()
);

-- Scraping sessions table (16 columns)
CREATE TABLE IF NOT EXISTS "scraping_sessions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "niche" text NOT NULL,
    "location" text NOT NULL,
    "status" text NOT NULL DEFAULT 'running',
    "total_found" integer NOT NULL DEFAULT 0,
    "verified" integer NOT NULL DEFAULT 0,
    "enriched" integer NOT NULL DEFAULT 0,
    "failed" integer NOT NULL DEFAULT 0,
    "sources_scanned" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "proxy_nodes_used" integer NOT NULL DEFAULT 0,
    "duration_ms" integer,
    "error_log" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "started_at" timestamp NOT NULL DEFAULT now(),
    "completed_at" timestamp
);

-- Follow up queue table
CREATE TABLE IF NOT EXISTS "follow_up_queue" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "lead_id" uuid NOT NULL REFERENCES "leads"("id") ON DELETE CASCADE,
    "channel" text NOT NULL,
    "scheduled_at" timestamp NOT NULL,
    "status" text NOT NULL DEFAULT 'pending',
    "processed_at" timestamp,
    "context" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "error_message" text,
    "created_at" timestamp NOT NULL DEFAULT now()
);

-- Email warmup schedules table
CREATE TABLE IF NOT EXISTS "email_warmup_schedules" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "day" integer NOT NULL,
    "daily_limit" integer NOT NULL,
    "random_delay" boolean NOT NULL DEFAULT true,
    "created_at" timestamp NOT NULL DEFAULT now()
);

-- Bounce tracker table
CREATE TABLE IF NOT EXISTS "bounce_tracker" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "lead_id" uuid REFERENCES "leads"("id") ON DELETE SET NULL,
    "email" text NOT NULL,
    "bounce_type" text NOT NULL,
    "error_code" text,
    "raw_response" text,
    "created_at" timestamp NOT NULL DEFAULT now()
);

-- Audit trail table
CREATE TABLE IF NOT EXISTS "audit_trail" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "lead_id" uuid NOT NULL REFERENCES "leads"("id") ON DELETE CASCADE,
    "action" text NOT NULL,
    "message_id" uuid,
    "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamp NOT NULL DEFAULT now()
);

-- PDF analytics table
CREATE TABLE IF NOT EXISTS "pdf_analytics" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "file_name" text NOT NULL,
    "file_size" integer NOT NULL,
    "confidence" real NOT NULL,
    "missing_fields" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "leads_extracted" integer NOT NULL DEFAULT 0,
    "processed_at" timestamp NOT NULL DEFAULT now()
);

-- Upload rate limit table
CREATE TABLE IF NOT EXISTS "upload_rate_limit" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "uploads" integer NOT NULL DEFAULT 0,
    "last_reset_at" timestamp NOT NULL DEFAULT now(),
    "window_size_minutes" integer NOT NULL DEFAULT 60
);

-- Calendar settings table (22 columns)
CREATE TABLE IF NOT EXISTS "calendar_settings" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "provider" text NOT NULL DEFAULT 'internal',
    "external_calendar_id" text,
    "access_token" text,
    "refresh_token" text,
    "token_expires_at" timestamp,
    "available_days" jsonb NOT NULL DEFAULT '[1,2,3,4,5]'::jsonb,
    "available_start_time" text NOT NULL DEFAULT '09:00',
    "available_end_time" text NOT NULL DEFAULT '17:00',
    "slot_duration_minutes" integer NOT NULL DEFAULT 30,
    "buffer_minutes" integer NOT NULL DEFAULT 15,
    "max_bookings_per_day" integer NOT NULL DEFAULT 8,
    "booking_notice_hours" integer NOT NULL DEFAULT 24,
    "auto_confirm" boolean NOT NULL DEFAULT true,
    "send_reminders" boolean NOT NULL DEFAULT true,
    "reminder_hours_before" integer NOT NULL DEFAULT 24,
    "booking_page_slug" text,
    "booking_page_title" text DEFAULT 'Book a Call',
    "booking_page_description" text,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
);

-- Calendar bookings table (19 columns)
CREATE TABLE IF NOT EXISTS "calendar_bookings" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "lead_id" uuid REFERENCES "leads"("id") ON DELETE SET NULL,
    "external_id" text,
    "title" text NOT NULL,
    "description" text,
    "start_time" timestamp NOT NULL,
    "end_time" timestamp NOT NULL,
    "timezone" text NOT NULL DEFAULT 'America/New_York',
    "status" text NOT NULL DEFAULT 'confirmed',
    "meeting_url" text,
    "location" text,
    "booker_name" text,
    "booker_email" text,
    "booker_phone" text,
    "notes" text,
    "reminder_sent" boolean NOT NULL DEFAULT false,
    "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamp NOT NULL DEFAULT now()
);

-- Video assets table (18 columns)
CREATE TABLE IF NOT EXISTS "video_assets" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "name" text NOT NULL,
    "type" text NOT NULL DEFAULT 'template',
    "status" text NOT NULL DEFAULT 'draft',
    "template_id" text,
    "duration_seconds" integer,
    "thumbnail_url" text,
    "video_url" text,
    "script" text,
    "voice_id" text,
    "background_music_url" text,
    "input_props" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "render_progress" integer DEFAULT 0,
    "render_error" text,
    "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
);

-- Video monitors table
CREATE TABLE IF NOT EXISTS "video_monitors" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "platform" text NOT NULL,
    "video_url" text NOT NULL,
    "video_id" text,
    "title" text,
    "last_comment_id" text,
    "is_active" boolean NOT NULL DEFAULT true,
    "check_interval_minutes" integer NOT NULL DEFAULT 5,
    "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamp NOT NULL DEFAULT now()
);

-- Processed comments table
CREATE TABLE IF NOT EXISTS "processed_comments" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "comment_id" text NOT NULL UNIQUE,
    "platform" text NOT NULL,
    "processed_at" timestamp NOT NULL DEFAULT now()
);

-- Usage topups table
CREATE TABLE IF NOT EXISTS "usage_topups" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "type" text NOT NULL,
    "amount" real NOT NULL,
    "stripe_payment_id" text,
    "created_at" timestamp NOT NULL DEFAULT now()
);

-- AI action logs table (14 columns)
CREATE TABLE IF NOT EXISTS "ai_action_logs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "lead_id" uuid REFERENCES "leads"("id") ON DELETE SET NULL,
    "action_type" text NOT NULL,
    "channel" text,
    "input_tokens" integer,
    "output_tokens" integer,
    "model" text,
    "latency_ms" integer,
    "success" boolean NOT NULL DEFAULT true,
    "error" text,
    "request_payload" jsonb DEFAULT '{}'::jsonb,
    "response_payload" jsonb DEFAULT '{}'::jsonb,
    "created_at" timestamp NOT NULL DEFAULT now()
);

-- Automation rules table (17 columns)
CREATE TABLE IF NOT EXISTS "automation_rules" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "name" text NOT NULL,
    "description" text,
    "rule_type" text NOT NULL DEFAULT 'reply',
    "channel" text NOT NULL,
    "is_active" boolean NOT NULL DEFAULT true,
    "min_intent_score" integer NOT NULL DEFAULT 50,
    "max_intent_score" integer NOT NULL DEFAULT 100,
    "min_confidence" real NOT NULL DEFAULT 0.6,
    "allowed_actions" jsonb NOT NULL DEFAULT '["reply"]'::jsonb,
    "cooldown_minutes" integer NOT NULL DEFAULT 60,
    "max_actions_per_day" integer NOT NULL DEFAULT 10,
    "escalate_on_low_confidence" boolean NOT NULL DEFAULT true,
    "require_human_approval" boolean NOT NULL DEFAULT false,
    "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
);

-- Content library table (16 columns)
CREATE TABLE IF NOT EXISTS "content_library" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
    "type" text NOT NULL,
    "name" text NOT NULL,
    "content" text NOT NULL,
    "intent_tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "objection_tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "channel_restriction" text NOT NULL DEFAULT 'all',
    "is_active" boolean NOT NULL DEFAULT true,
    "usage_count" integer NOT NULL DEFAULT 0,
    "success_rate" real,
    "linked_video_id" uuid,
    "linked_cta_link" text,
    "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now()
);

-- Conversation events table (14 columns)
CREATE TABLE IF NOT EXISTS "conversation_events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "lead_id" uuid REFERENCES "leads"("id") ON DELETE SET NULL,
    "channel" text NOT NULL,
    "direction" text NOT NULL,
    "content" text NOT NULL,
    "content_type" text NOT NULL DEFAULT 'text',
    "external_id" text,
    "thread_id" text,
    "signals" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "processed_by_engine" boolean NOT NULL DEFAULT false,
    "engine_decision" text,
    "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamp NOT NULL DEFAULT now()
);

-- =============================================================================
-- SEED DATA: Objections Library (70+ rows)
-- =============================================================================

INSERT INTO "content_library" ("type", "name", "content", "intent_tags", "objection_tags", "channel_restriction") VALUES
('objection', 'Price Too High', 'I completely understand budget concerns. What if I showed you how this pays for itself within 30 days through the leads it generates?', '["price_sensitive"]', '["too_expensive", "budget"]', 'all'),
('objection', 'Need to Think', 'Absolutely, take your time. Quick question - what specific aspect would you like to think through? I can send over some case studies that might help.', '["hesitant"]', '["need_time", "thinking"]', 'all'),
('objection', 'Already Have Solution', 'Great to hear you are proactive! Out of curiosity, is your current solution giving you warm, verified leads with AI-powered outreach? Most switch because we do both.', '["competitor"]', '["have_solution", "using_competitor"]', 'all'),
('objection', 'Not Right Time', 'I hear you. When would be a better time to revisit this? I can set a reminder and reach out then with fresh insights.', '["timing"]', '["bad_timing", "later"]', 'all'),
('objection', 'Need Approval', 'Makes sense - who else should be involved in this decision? I can prepare materials specifically for them.', '["decision_maker"]', '["need_approval", "check_with_boss"]', 'all'),
('objection', 'Too Complicated', 'I get it - new tools can seem overwhelming. The good news is we handle 90% of the setup for you, and most users are fully operational in under 24 hours.', '["complexity"]', '["complicated", "hard_to_use"]', 'all'),
('objection', 'Bad Past Experience', 'Sorry to hear that. What specifically went wrong before? We have addressed many of those pain points - happy to show you how.', '["trust"]', '["bad_experience", "burned_before"]', 'all'),
('objection', 'No Budget Now', 'Understood. Many of our best users started on our trial with zero upfront cost. Want me to set that up so you can see results first?', '["budget"]', '["no_budget", "no_money"]', 'all'),
('objection', 'Send More Info', 'Absolutely! What specific aspects are you most interested in? I want to make sure I send you the most relevant information.', '["info_request"]', '["send_info", "more_details"]', 'all'),
('objection', 'Not Interested', 'No problem at all. Mind if I ask what you are currently doing to find and close new leads? Sometimes there is a gap we can fill without disrupting your workflow.', '["rejection"]', '["not_interested", "no_thanks"]', 'all'),
('objection', 'Works for Others Not Me', 'Fair point. What makes your situation unique? We have worked with 50+ niches and can usually customize the approach to fit.', '["skeptical"]', '["wont_work", "different"]', 'all'),
('objection', 'Need to See Results First', 'Totally get it. That is exactly why we offer a free trial - you can see real leads come in before committing anything.', '["proof"]', '["show_results", "prove_it"]', 'all'),
('objection', 'Team Too Small', 'Actually, our platform is designed for lean teams. It is like having 5 extra SDRs without the overhead.', '["team_size"]', '["small_team", "solo"]', 'all'),
('objection', 'Already Tried AI', 'I hear you. Most AI tools are generic. We are niche-trained specifically for your industry with 10x better conversion rates.', '["ai_skeptic"]', '["tried_ai", "ai_doesnt_work"]', 'all'),
('objection', 'Prefer Manual Outreach', 'Manual has its place! We actually amplify what you are already doing, handling the research and initial touch so you can focus on closing.', '["traditional"]', '["manual", "prefer_human"]', 'all'),
('objection', 'Contract Too Long', 'We actually do month-to-month. No long commitments - you stay because it works, not because you have to.', '["commitment"]', '["long_contract", "commitment"]', 'all'),
('objection', 'Need Training', 'Included! Every user gets a dedicated onboarding call plus 24/7 chat support. Most are experts within a week.', '["support"]', '["need_training", "learning_curve"]', 'all'),
('objection', 'Data Security Concern', 'Great question. We are SOC2 compliant with AES-256 encryption. Your data never leaves our secure cloud.', '["security"]', '["data_security", "privacy"]', 'all'),
('objection', 'Email Me Instead', 'Sure thing! Whats the best email? I will send over a quick summary plus some case studies from your industry.', '["communication_preference"]', '["email_me", "dont_call"]', 'email'),
('objection', 'Call Me Later', 'Absolutely. When works best for you? I will block that time and come prepared with specific insights for your business.', '["timing_preference"]', '["call_later", "busy_now"]', 'all'),
('objection', 'Just Browsing', 'No pressure! While you are here, any specific challenge you are trying to solve? Happy to point you to the right resources.', '["early_stage"]', '["browsing", "just_looking"]', 'all'),
('objection', 'Dont Trust Automation', 'Healthy skepticism! Our AI is supervised - you approve every message before it goes out. Full control, zero risk.', '["trust"]', '["dont_trust", "automation_fear"]', 'all'),
('objection', 'Too Good To Be True', 'I get that reaction! Thats why we let results speak. Start with the trial and see the leads yourself - no strings attached.', '["skeptical"]', '["too_good", "suspicious"]', 'all'),
('objection', 'Need More Features', 'Which features are must-haves for you? We are constantly shipping updates and love user feedback for our roadmap.', '["features"]', '["need_features", "missing_feature"]', 'all'),
('objection', 'Competitor is Cheaper', 'Price is one factor. Have you compared the quality of leads and conversion rates? Our users typically see 3x ROI vs cheaper alternatives.', '["price_comparison"]', '["competitor_cheaper", "found_cheaper"]', 'all'),
('objection', 'Need Customization', 'Absolutely doable. We offer white-label and custom workflows for enterprise clients. Lets discuss what you need.', '["customization"]', '["need_custom", "customize"]', 'all'),
('objection', 'Industry is Different', 'Every industry says that! We currently serve 50+ verticals including yours. Want to see niche-specific case studies?', '["industry"]', '["different_industry", "unique_business"]', 'all'),
('objection', 'Prefer to Build In-House', 'Respect that. Just know building this in-house typically costs 10x more and takes 12+ months. We are plug-and-play in days.', '["diy"]', '["build_ourselves", "in_house"]', 'all'),
('objection', 'Need References', 'Happy to connect you with current users in your space. Any specific company size or industry you want to hear from?', '["social_proof"]', '["need_references", "who_uses_this"]', 'all'),
('objection', 'Worried About Spam', 'Great concern. Our AI is trained to be human, personalized, and compliant. We have strict anti-spam measures built in.', '["reputation"]', '["spam_worry", "reputation"]', 'all')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- Create indexes for performance
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_leads_user_id ON leads(user_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_messages_lead_id ON messages(lead_id);
CREATE INDEX IF NOT EXISTS idx_prospects_user_id ON prospects(user_id);
CREATE INDEX IF NOT EXISTS idx_prospects_source ON prospects(source);
CREATE INDEX IF NOT EXISTS idx_scraping_sessions_user_id ON scraping_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_action_logs_user_id ON ai_action_logs(user_id);

-- =============================================================================
-- MIGRATION COMPLETE
-- Total: 37 tables, 70+ seed rows, 7 indexes
-- =============================================================================
