// @ts-nocheck
import 'dotenv/config';
import { db } from '../server/db';
import { sql } from 'drizzle-orm';

async function fixDatabase() {
  console.log('🔧 Starting Database Repair...');

  try {
    // 1. Add 'subject' to 'messages'
    console.log("Checking 'messages' table for 'subject' column...");
    await db.execute(sql`
      ALTER TABLE messages 
      ADD COLUMN IF NOT EXISTS subject text;
    `);
    console.log("✅ 'subject' column ensures on 'messages'.");

    // 2. Add 'reply_email' to 'outreach_campaigns'
    console.log("Checking 'outreach_campaigns' table for 'reply_email' column...");
    await db.execute(sql`
      ALTER TABLE outreach_campaigns 
      ADD COLUMN IF NOT EXISTS reply_email text;
    `);
    console.log("✅ 'reply_email' column ensures on 'outreach_campaigns'.");

    // 3. Add 'reply_email' to 'campaign_leads' just in case (the error might have been ambiguous)
    // Wait, the error for 'OutreachEngine' line 123 was referencing outreachCampaigns select.
    // But let's be safe.
    // Actually, schema.ts implies campaignLeads does NOT have reply_email. 
    // outreachCampaigns DOES. So sticking to that.

    console.log('🎉 Database repair completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Database repair failed:', err);
    process.exit(1);
  }
}

fixDatabase();
