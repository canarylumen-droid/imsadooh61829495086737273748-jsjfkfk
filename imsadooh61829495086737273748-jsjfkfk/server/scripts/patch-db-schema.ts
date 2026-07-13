/**
 * DB Migration Patcher — Production-Safe
 * Applies ALL missing columns to the live Neon DB with correct types.
 * Run: npx tsx server/scripts/patch-db-schema.ts
 */
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

const PATCHES: string[] = [
  // ========== USERS ==========
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "default_cta_link" TEXT`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "brand_colors" TEXT`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_signature" TEXT`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "sender_name" TEXT`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "video_thumbnail_url" TEXT`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "trial_ends_at" TIMESTAMPTZ`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "plan_expires_at" TIMESTAMPTZ`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "brand_voice" TEXT`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "ai_auto_reply" BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "website" TEXT`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "domain_verified" BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "spf_verified" BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mx_record" TEXT`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "verified_domain" TEXT`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "whitelabel_domain" TEXT`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "brand_snippets" JSONB DEFAULT '[]'::jsonb`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "calendly_connected" BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "business_logo" TEXT`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "intelligence_metadata" JSONB DEFAULT '{}'::jsonb`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "payment_link" TEXT`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "has_voice_enabled" BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bant_framework" JSONB DEFAULT '{}'::jsonb`,

  // ========== LEADS ==========
  `ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "source" TEXT`,
  `ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "follow_up_count" INTEGER DEFAULT 0`,
  `ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "bant" JSONB DEFAULT '{}'::jsonb`,
  `ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "video_thumbnail" TEXT`,
  `ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "subscription_id" TEXT`,

  // ========== MESSAGES ==========
  `ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ DEFAULT NOW()`,
  `ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "ai_generated" BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "email_message_id" TEXT`,
  `ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "in_reply_to" TEXT`,
  `ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "references" TEXT`,
  `ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "read" BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "status" TEXT DEFAULT 'sent'`,

  // ========== INTEGRATIONS ==========
  `ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "config" JSONB DEFAULT '{}'::jsonb`,
  `ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "sent_today" INTEGER DEFAULT 0`,
  `ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "last_reset_at" TIMESTAMPTZ`,
  `ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "access_token" TEXT`,
  `ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "refresh_token" TEXT`,
  `ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "page_id" TEXT`,
  `ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "page_name" TEXT`,
  `ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "warmup_enabled" BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "warmup_day" INTEGER DEFAULT 0`,
  `ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "credentials" JSONB DEFAULT '{}'::jsonb`,

  // ========== FOLLOW UP QUEUE ==========
  `ALTER TABLE "follow_up_queue" ADD COLUMN IF NOT EXISTS "retry_count" INTEGER DEFAULT 0`,

  // ========== BRAND EMBEDDINGS ==========
  `ALTER TABLE "brand_embeddings" ADD COLUMN IF NOT EXISTS "content" TEXT`,
  `ALTER TABLE "brand_embeddings" ADD COLUMN IF NOT EXISTS "file_name" TEXT`,
  `ALTER TABLE "brand_embeddings" ADD COLUMN IF NOT EXISTS "chunk_index" INTEGER DEFAULT 0`,
  `ALTER TABLE "brand_embeddings" ADD COLUMN IF NOT EXISTS "document_id" UUID`,
  `ALTER TABLE "brand_embeddings" ADD COLUMN IF NOT EXISTS "version" INTEGER DEFAULT 1`,

  // ========== BRAND PDF CACHE ==========
  `ALTER TABLE "brand_pdf_cache" ADD COLUMN IF NOT EXISTS "pages" INTEGER`,
  `ALTER TABLE "brand_pdf_cache" ADD COLUMN IF NOT EXISTS "processing_time" INTEGER`,
  `ALTER TABLE "brand_pdf_cache" ADD COLUMN IF NOT EXISTS "company_name" TEXT`,
  `ALTER TABLE "brand_pdf_cache" ADD COLUMN IF NOT EXISTS "industry" TEXT`,
  `ALTER TABLE "brand_pdf_cache" ADD COLUMN IF NOT EXISTS "status" TEXT DEFAULT 'processed'`,

  // ========== AUDIT TRAIL ==========
  `ALTER TABLE "audit_trail" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ DEFAULT NOW()`,

  // ========== AI ACTION LOGS ==========
  `ALTER TABLE "ai_action_logs" ADD COLUMN IF NOT EXISTS "email_subject" TEXT`,
  `ALTER TABLE "ai_action_logs" ADD COLUMN IF NOT EXISTS "email_body" TEXT`,
  `ALTER TABLE "ai_action_logs" ADD COLUMN IF NOT EXISTS "channel" TEXT DEFAULT 'email'`,

  // ========== FATHOM CALLS ==========
  `ALTER TABLE "fathom_calls" ADD COLUMN IF NOT EXISTS "fathom_call_id" TEXT`,
  `ALTER TABLE "fathom_calls" ADD COLUMN IF NOT EXISTS "status" TEXT DEFAULT 'completed'`,
  `ALTER TABLE "fathom_calls" ADD COLUMN IF NOT EXISTS "duration" INTEGER`,
  `ALTER TABLE "fathom_calls" ADD COLUMN IF NOT EXISTS "recorded_at" TIMESTAMPTZ`,

  // ========== OUTREACH CAMPAIGNS ==========
  `ALTER TABLE "outreach_campaigns" ADD COLUMN IF NOT EXISTS "channel" TEXT DEFAULT 'email'`,
  `ALTER TABLE "outreach_campaigns" ADD COLUMN IF NOT EXISTS "sent_count" INTEGER DEFAULT 0`,
  `ALTER TABLE "outreach_campaigns" ADD COLUMN IF NOT EXISTS "reply_count" INTEGER DEFAULT 0`,
  `ALTER TABLE "outreach_campaigns" ADD COLUMN IF NOT EXISTS "bounce_count" INTEGER DEFAULT 0`,
  `ALTER TABLE "outreach_campaigns" ADD COLUMN IF NOT EXISTS "total_leads" INTEGER DEFAULT 0`,
  `ALTER TABLE "outreach_campaigns" ADD COLUMN IF NOT EXISTS "open_count" INTEGER DEFAULT 0`,

  // ========== CAMPAIGN LEADS ==========
  `ALTER TABLE "campaign_leads" ADD COLUMN IF NOT EXISTS "user_id" UUID REFERENCES "users"("id") ON DELETE CASCADE`,
  `ALTER TABLE "campaign_leads" ADD COLUMN IF NOT EXISTS "sequence_step" INTEGER DEFAULT 0`,
  `ALTER TABLE "campaign_leads" ADD COLUMN IF NOT EXISTS "opened_at" TIMESTAMPTZ`,
  `ALTER TABLE "campaign_leads" ADD COLUMN IF NOT EXISTS "replied_at" TIMESTAMPTZ`,
  `ALTER TABLE "campaign_leads" ADD COLUMN IF NOT EXISTS "last_error" TEXT`,

  // ========== CAMPAIGN EMAILS ==========
  `ALTER TABLE "campaign_emails" ADD COLUMN IF NOT EXISTS "step_number" INTEGER DEFAULT 1`,
  `ALTER TABLE "campaign_emails" ADD COLUMN IF NOT EXISTS "delay_days" INTEGER DEFAULT 0`,
  `ALTER TABLE "campaign_emails" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMPTZ DEFAULT NOW()`,
  `ALTER TABLE "campaign_emails" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ DEFAULT NOW()`,
  `ALTER TABLE "campaign_emails" ADD COLUMN IF NOT EXISTS "channel" TEXT DEFAULT 'email'`,
  `ALTER TABLE "campaign_emails" ADD COLUMN IF NOT EXISTS "ai_generated" BOOLEAN DEFAULT FALSE`,

  // ========== DEALS ==========
  `ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "campaign_id" UUID`,
  `ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "title" TEXT`,
  `ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "stage" TEXT DEFAULT 'discovery'`,
  `ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "probability" INTEGER DEFAULT 0`,
  `ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "expected_close" TIMESTAMPTZ`,
  `ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ DEFAULT NOW()`,
  `ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "currency" TEXT DEFAULT 'USD'`,

  // ========== CALENDAR BOOKINGS ==========
  `ALTER TABLE "calendar_bookings" ADD COLUMN IF NOT EXISTS "notes" TEXT`,
  `ALTER TABLE "calendar_bookings" ADD COLUMN IF NOT EXISTS "confirmed_at" TIMESTAMPTZ`,
  `ALTER TABLE "calendar_bookings" ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMPTZ`,
  `ALTER TABLE "calendar_bookings" ADD COLUMN IF NOT EXISTS "reminder_sent" BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE "calendar_bookings" ADD COLUMN IF NOT EXISTS "is_ai_scheduled" BOOLEAN DEFAULT FALSE`,

  // ========== NOTIFICATIONS ==========
  `ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "lead_id" UUID REFERENCES "leads"("id") ON DELETE SET NULL`,
  `ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "read" BOOLEAN DEFAULT FALSE`,

  // ========== SMTP SETTINGS ==========
  `ALTER TABLE "smtp_settings" ADD COLUMN IF NOT EXISTS "username" TEXT`,
  `ALTER TABLE "smtp_settings" ADD COLUMN IF NOT EXISTS "password" TEXT`,
  `ALTER TABLE "smtp_settings" ADD COLUMN IF NOT EXISTS "from_email" TEXT`,
  `ALTER TABLE "smtp_settings" ADD COLUMN IF NOT EXISTS "from_name" TEXT`,
  `ALTER TABLE "smtp_settings" ADD COLUMN IF NOT EXISTS "use_ssl" BOOLEAN DEFAULT TRUE`,
  `ALTER TABLE "smtp_settings" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ DEFAULT NOW()`,
  `ALTER TABLE "smtp_settings" ADD COLUMN IF NOT EXISTS "is_verified" BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE "smtp_settings" ADD COLUMN IF NOT EXISTS "reply_to" TEXT`,

  // ========== PROSPECTS ==========
  `ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "name" TEXT`,
  `ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "company" TEXT`,
  `ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "city" TEXT`,
  `ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "state" TEXT`,
  `ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "country" TEXT`,
  `ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "employee_count" INTEGER`,
  `ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "revenue" TEXT`,
  `ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "linkedin_url" TEXT`,
  `ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "score" INTEGER DEFAULT 0`,
  `ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "enriched" BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "tags" JSONB DEFAULT '[]'::jsonb`,
  `ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ DEFAULT NOW()`,
  `ALTER TABLE "prospects" ADD COLUMN IF NOT EXISTS "scraped_at" TIMESTAMPTZ`,

  // ========== prospect_objections TABLE (new table) ==========
  `CREATE TABLE IF NOT EXISTS "prospect_objections" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "prospect_id" UUID REFERENCES "prospects"("id") ON DELETE CASCADE,
    "objection" TEXT NOT NULL,
    "response" TEXT,
    "status" TEXT DEFAULT 'open',
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
  )`,
];

async function main() {
  console.log(`\n🚀 Applying ${PATCHES.length} schema patches to production DB...\n`);
  let success = 0;
  let failed = 0;

  for (const patch of PATCHES) {
    const short = patch.trim().split('\n')[0].substring(0, 80);
    try {
      await sql.unsafe(patch);
      console.log(`  ✅ ${short}`);
      success++;
    } catch (err: any) {
      // Already exists errors are fine (IF NOT EXISTS handles most)
      if (err.message?.includes('already exists')) {
        console.log(`  ⏭️  SKIP (already exists): ${short}`);
        success++;
      } else {
        console.error(`  ❌ FAILED: ${short}`);
        console.error(`     Reason: ${err.message}`);
        failed++;
      }
    }
  }

  console.log(`\n📊 Summary: ${success} applied, ${failed} failed`);
  if (failed === 0) {
    console.log('🎉 Database is now fully synchronized!\n');
  } else {
    console.log(`⚠️  ${failed} patch(es) failed. Review errors above.\n`);
  }
}

main().catch(err => {
  console.error('Patcher failed:', err.message);
  process.exit(1);
});
