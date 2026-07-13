import { db } from "@shared/lib/db/db.js";
import { sql } from "drizzle-orm";

async function patchSchema() {
  console.log("🛠️ Starting email_tracking schema patch...");

  try {
    // Check if column exists
    const columnExists = await db.execute(sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'email_tracking' 
      AND column_name = 'target_url'
    `);

    if (columnExists.rowCount === 0) {
      console.log("➕ Adding 'target_url' column to 'email_tracking' table...");
      await db.execute(sql`
        ALTER TABLE email_tracking 
        ADD COLUMN target_url TEXT
      `);
      console.log("✅ Column added successfully.");
    } else {
      console.log("ℹ️ Column 'target_url' already exists. Skipping.");
    }

  } catch (error) {
    console.error("❌ Failed to patch schema:", error);
    process.exit(1);
  }

  console.log("🎉 Schema patch complete.");
  process.exit(0);
}

patchSchema();
