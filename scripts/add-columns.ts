// @ts-nocheck
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import * as schema from "../shared/schema";

async function main() {
  console.log("Starting database schema hotfix...");

  try {
    // Add reply_email to outreach_campaigns
    console.log("Checking outreach_campaigns table...");
    await db.execute(sql`
      ALTER TABLE outreach_campaigns 
      ADD COLUMN IF NOT EXISTS reply_email text;
    `);
    console.log("✅ Added/Verified reply_email in outreach_campaigns");

    // Add subject to messages
    console.log("Checking messages table...");
    await db.execute(sql`
      ALTER TABLE messages 
      ADD COLUMN IF NOT EXISTS subject text;
    `);
    console.log("✅ Added/Verified subject in messages");

    console.log("Schema hotfix completed successfully.");
    process.exit(0);
  } catch (error) {
    console.error("Error updating schema:", error);
    process.exit(1);
  }
}

main();
