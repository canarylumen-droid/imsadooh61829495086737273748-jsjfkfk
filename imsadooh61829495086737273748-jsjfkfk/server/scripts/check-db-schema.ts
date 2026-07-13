/**
 * DB Schema Audit Script
 * Compares what exists in the LIVE Neon PostgreSQL database
 * against the full schema defined in shared/schema.ts
 * Run: npx tsx server/scripts/check-db-schema.ts
 */
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

const EXPECTED_SCHEMA: Record<string, string[]> = {
  users: [
    'id','email','name','password','plan','created_at','updated_at',
    'config','calendar_link','instagram_connected','instagram_page_id',
    'instagram_access_token','inbound_email_address','company','role',
    'onboarding_complete','default_cta_link','reply_tone','brand_colors',
    'email_signature','sender_name','video_thumbnail_url','subscription_id',
    'stripe_customer_id','trial_ends_at','plan_expires_at','brand_voice',
    'ai_auto_reply','website','domain_verified','spf_verified','mx_record',
    'verified_domain','whitelabel_domain','brand_snippets','calendly_access_token',
    'calendly_refresh_token','calendly_user_uri','calendly_connected',
    'business_logo','intelligence_metadata','timezone','payment_link',
    'has_voice_enabled','bant_framework',
  ],
  leads: [
    'id','user_id','name','email','phone','company','channel','status',
    'tags','score','metadata','source','created_at','updated_at',
    'last_message_at','follow_up_count','external_id','warm','ai_paused',
    'bant','timezone','video_thumbnail','subscription_id',
  ],
  messages: [
    'id','user_id','lead_id','direction','body','provider','metadata',
    'created_at','updated_at','ai_generated','subject','email_message_id',
    'thread_id','in_reply_to','references','read','status','tracking_id',
  ],
  integrations: [
    'id','user_id','provider','connected','config','created_at','updated_at',
    'ai_autonomous_mode','daily_limit','sent_today','last_reset_at',
    'access_token','refresh_token','page_id','page_name','warmup_enabled',
    'warmup_day','credentials',
  ],
  follow_up_queue: [
    'id','user_id','lead_id','channel','status','scheduled_at',
    'processed_at','context','error_message','retry_count',
  ],
  brand_embeddings: [
    'id','user_id','content','embedding','file_name','chunk_index',
    'created_at','document_id','version',
  ],
  brand_pdf_cache: [
    'id','user_id','file_hash','brand_context','created_at','updated_at',
    'file_name','file_size','pages','processing_time','company_name',
    'industry','status',
  ],
  audit_trail: [
    'id','user_id','lead_id','integration_id','action','details',
    'created_at','updated_at',
  ],
  ai_action_logs: [
    'id','user_id','lead_id','action_type','decision','intent_score',
    'confidence','reasoning','outcome','created_at','metadata',
    'email_subject','email_body','channel',
  ],
  fathom_calls: [
    'id','user_id','lead_id','fathom_call_id','title','summary',
    'transcript','video_url','video_thumbnail','status','duration',
    'recorded_at','created_at',
  ],
  prospect_objections: [
    'id','user_id','prospect_id','objection','response','status',
    'created_at','updated_at',
  ],
  outreach_campaigns: [
    'id','user_id','name','status','channel','created_at','updated_at',
    'config','sent_count','reply_count','bounce_count',
    'total_leads','open_count',
  ],
  campaign_leads: [
    'id','campaign_id','lead_id','user_id','status','sequence_step',
    'next_action_at','created_at','updated_at','sent_at',
    'opened_at','replied_at','last_error',
  ],
  campaign_emails: [
    'id','campaign_id','step_number','subject','body','delay_days',
    'user_id','created_at','updated_at','channel','ai_generated',
    'metadata',
  ],
  deals: [
    'id','user_id','lead_id','campaign_id','title','value','status',
    'stage','probability','expected_close','created_at','updated_at',
    'notes','currency','closed_at',
  ],
  calendar_bookings: [
    'id','user_id','lead_id','title','start_time','end_time','status',
    'provider','meeting_url','notes','created_at','updated_at',
    'confirmed_at','cancelled_at','reminder_sent','external_event_id',
    'attendee_email','attendee_name','is_ai_scheduled',
  ],
  notifications: [
    'id','user_id','lead_id','type','title','message','read',
    'created_at','metadata',
  ],
  smtp_settings: [
    'id','user_id','host','port','username','password','from_email',
    'from_name','use_ssl','created_at','updated_at','is_verified','reply_to',
  ],
  prospects: [
    'id','user_id','name','email','phone','company','website','city',
    'state','country','industry','employee_count','revenue','linkedin_url',
    'source','status','score','enriched','tags','metadata',
    'created_at','updated_at','scraped_at',
  ],
};

async function main() {
  console.log('\n🔍 Auditing live database schema vs. schema.ts...\n');

  // Get all tables + columns from live DB
  const liveColumns = await sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, column_name
  `;

  const liveMap: Record<string, Set<string>> = {};
  for (const row of liveColumns) {
    if (!liveMap[row.table_name]) liveMap[row.table_name] = new Set();
    liveMap[row.table_name].add(row.column_name);
  }

  const liveTables = new Set(Object.keys(liveMap));
  const expectedTables = new Set(Object.keys(EXPECTED_SCHEMA));

  let totalMissing = 0;

  // 1. Missing entire tables
  const missingTables: string[] = [];
  for (const table of expectedTables) {
    if (!liveTables.has(table)) {
      missingTables.push(table);
      totalMissing++;
    }
  }
  if (missingTables.length > 0) {
    console.log('❌ MISSING TABLES (entire tables not in DB):');
    missingTables.forEach(t => console.log(`   - ${t}`));
    console.log('');
  } else {
    console.log('✅ All expected tables exist in the database.\n');
  }

  // 2. Missing columns in existing tables
  const missingColumns: Record<string, string[]> = {};
  for (const [table, expectedCols] of Object.entries(EXPECTED_SCHEMA)) {
    if (!liveMap[table]) continue; // already reported as missing table
    const missing = expectedCols.filter(col => !liveMap[table].has(col));
    if (missing.length > 0) {
      missingColumns[table] = missing;
      totalMissing += missing.length;
    }
  }

  if (Object.keys(missingColumns).length > 0) {
    console.log('❌ MISSING COLUMNS (columns in schema.ts but NOT in live DB):');
    for (const [table, cols] of Object.entries(missingColumns)) {
      console.log(`\n   📋 Table: ${table}`);
      cols.forEach(col => console.log(`      - ${col}`));
    }
    console.log('');
  } else {
    console.log('✅ All expected columns exist in each table.\n');
  }

  if (totalMissing === 0) {
    console.log('🎉 DATABASE IS FULLY SYNCHRONIZED. No missing tables or columns.\n');
  } else {
    console.log(`\n⚠️  Total missing items: ${totalMissing}`);
    console.log('Run the SQL fixes below to patch your production DB:\n');

    // Generate the SQL automatically
    for (const table of missingTables) {
      console.log(`-- CREATE TABLE ${table} (run drizzle-kit push --accept-data-loss to create it)\n`);
    }
    for (const [table, cols] of Object.entries(missingColumns)) {
      for (const col of cols) {
        console.log(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${col}" TEXT;`);
      }
    }
    console.log('\n ⚠️  NOTE: Column types above default to TEXT. Review and adjust types before running in production.');
  }
}

main().catch(err => {
  console.error('Schema audit failed:', err.message);
  process.exit(1);
});
