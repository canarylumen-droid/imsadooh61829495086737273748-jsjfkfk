import 'dotenv/config';
import { getRedisClient } from "@shared/lib/redis/redis.js";

async function clearRedis() {
  console.log("🔄 Connecting to Redis to wipe all keys...");
  try {
    const client = await getRedisClient();
    if (!client) {
      console.warn("⚠️ Redis is not configured or disabled (REDIS_URL is empty). Skipping.");
      process.exit(0);
    }

    console.log("🧹 Flushing all Redis databases...");
    await client.flushAll();
    console.log("✅ Redis successfully flushed and cleared of all keys!");
  } catch (error: any) {
    console.error("❌ Error clearing Redis:", error.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

clearRedis();
