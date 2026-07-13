
import 'dotenv/config';
import { db, pool } from "../shared/lib/db/db.js";
import { sql } from "drizzle-orm";

async function clearDb() {
  console.log("🗑️ Clearing database tables...");

  try {
    // Get all public tables
    const result = await db.execute(sql`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public';
    `);

    // Handle different driver result formats
    const rows = (result as any).rows || result;

    if (!rows || rows.length === 0) {
        console.log("No tables found.");
        return;
    }

    const tables = rows
      .map((r: any) => r.tablename)
      .filter((t: string) => !t.startsWith('_') && !t.includes('drizzle'));

    if (tables.length === 0) {
      console.log("No tables to clear.");
    } else {
        console.log(`Found ${tables.length} tables to clear.`);
        
        // Truncate all in one go
        const truncateQuery = `TRUNCATE TABLE ${tables.map((t: string) => `"${t}"`).join(', ')} CASCADE;`;
        await db.execute(sql.raw(truncateQuery));
        console.log("✅ All tables truncated.");
    }
  } catch (error) {
    console.error("❌ Error clearing database:", error);
  } finally {
    // Close pool if possible
    process.exit(0);
  }
}

clearDb();
