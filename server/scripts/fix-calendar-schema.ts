import { db } from "@shared/lib/db/db.js";
import { sql } from "drizzle-orm";

async function fixSchema() {
  console.log("🛠️ Starting database schema repair...");
  
  try {
    // Add attendee_email if missing
    await (db as any).execute(sql`
      ALTER TABLE calendar_bookings 
      ADD COLUMN IF NOT EXISTS attendee_email TEXT;
    `);
    console.log("✅ attendee_email column verified/added to calendar_bookings");

    // Add any other potentially missing columns for mailbox monitoring
    // integrations table health monitoring fields (check schema.ts lines 290-300)
    await (db as any).execute(sql`
      ALTER TABLE integrations 
      ADD COLUMN IF NOT EXISTS health_status TEXT NOT NULL DEFAULT 'connected',
      ADD COLUMN IF NOT EXISTS last_health_error TEXT,
      ADD COLUMN IF NOT EXISTS last_health_check_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS failure_count INTEGER NOT NULL DEFAULT 0;
    `);
    console.log("✅ mailbox health columns verified/added to integrations");

  } catch (error) {
    console.error("❌ Schema repair failed:", error);
    process.exit(1);
  }

  console.log("✨ Schema repair completed successfully.");
  process.exit(0);
}

fixSchema();
