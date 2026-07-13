import { db } from "@shared/lib/db/db.js";
import { sql } from "drizzle-orm";

async function patchTargetUrlColumns() {
  console.log("🛠️ Starting database schema patch for 'target_url' columns...");

  const tables = ["messages", "email_messages", "email_tracking"];

  for (const tableName of tables) {
    try {
      // Check if column exists
      const columnExists = await db.execute(sql`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = ${tableName} 
        AND column_name = 'target_url'
      `);

      if (columnExists.rowCount === 0) {
        console.log(`➕ Adding 'target_url' column to '${tableName}' table...`);
        await db.execute(sql`
          ALTER TABLE ${sql.identifier(tableName)} 
          ADD COLUMN target_url TEXT
        `);
        console.log(`✅ Column added to '${tableName}' successfully.`);
      } else {
        console.log(`ℹ️ Column 'target_url' already exists in '${tableName}'. Skipping.`);
      }
    } catch (error) {
      console.error(`❌ Failed to patch table '${tableName}':`, error);
    }
  }

  console.log("🎉 Schema patch complete.");
  process.exit(0);
}

patchTargetUrlColumns().catch(err => {
  console.error("🚨 Fatal patch error:", err);
  process.exit(1);
});
