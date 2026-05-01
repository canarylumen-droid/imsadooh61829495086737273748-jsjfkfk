import { db } from "@shared/lib/db/db.js";
import { sql } from "drizzle-orm";

async function wipeDatabase() {
  console.log("🧨 CAUTION: Wiping database...");
  
  try {
    // 1. Drop public schema
    console.log("🔥 Dropping public schema...");
    await (db as any).execute(sql`DROP SCHEMA public CASCADE;`);
    
    // 2. Recreate public schema
    console.log("🏗️ Recreating public schema...");
    await (db as any).execute(sql`CREATE SCHEMA public;`);
    await (db as any).execute(sql`GRANT ALL ON SCHEMA public TO public;`);
    await (db as any).execute(sql`COMMENT ON SCHEMA public IS 'standard public schema';`);

    // 3. Flush Redis Memory
    const { getRedisClient } = await import("@shared/lib/redis/redis.js");
    const redis = await getRedisClient();
    if (redis) {
      console.log("🧹 Flushing Redis memory...");
      await redis.flushAll();
      console.log("✅ Redis memory flushed.");
    } else {
      console.log("ℹ️ Redis not configured, skipping memory flush.");
    }

    console.log("✨ Full System Reset (DB + Memory) completed.");
  } catch (error) {
    console.error("❌ Wipe failed:", error);
    process.exit(1);
  }

  process.exit(0);
}

wipeDatabase();

