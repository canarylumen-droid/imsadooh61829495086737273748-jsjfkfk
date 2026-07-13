import "dotenv/config";
import { db } from "@shared/lib/db/db.js";
import { sql } from "drizzle-orm";

async function test() {
  try {
    console.log("Testing DB connection...");
    const result = await db.execute(sql`SELECT 1 as result`);
    console.log("Success:", result.rows);
    process.exit(0);
  } catch (err) {
    console.error("DB Error:", err);
    process.exit(1);
  }
}

test();
