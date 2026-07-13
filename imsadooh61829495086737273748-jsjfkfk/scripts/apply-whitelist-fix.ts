// @ts-nocheck
import { db, pool } from "../server/db";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";

async function main() {
  console.log("Applying admin_whitelist fix...");
  try {
    const sqlContent = fs.readFileSync(path.join(process.cwd(), "fix-admin-whitelist.sql"), "utf-8");
    
    // Split statements and execute individually just in case
    const statements = sqlContent.split(";").map(s => s.trim()).filter(s => s.length > 0);
    
    for (const stmt of statements) {
      if (stmt.startsWith("--")) continue; // Skip pure comment blocks if any
      console.log(`Executing: ${stmt.split('\n')[0].substring(0, 50)}...`);
      await db.execute(sql.raw(stmt));
    }
    
    console.log("✅ Fix applied successfully.");
  } catch (error) {
    console.error("❌ Failed to apply fix:", error);
  } finally {
    process.exit(0);
  }
}

main();
