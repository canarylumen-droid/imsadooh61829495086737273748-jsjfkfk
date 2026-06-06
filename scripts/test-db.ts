
import 'dotenv/config';
import { db } from "@shared/lib/db/db.js";
import { users } from "../shared/schema.js";
import { sql } from "drizzle-orm";

async function test() {
  console.log("Testing DB connection...");
  try {
    const result = await db.select({ count: sql`count(*)` }).from(users);
    console.log("DB Connection OK! User count:", result[0].count);
  } catch (e) {
    console.error("DB Connection FAILED:", e);
  }
}
test();
