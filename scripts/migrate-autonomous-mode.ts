import { db } from "@shared/lib/db/db.js";
import { sql } from "drizzle-orm";
import { users } from "../shared/schema.js";

async function main() {
  console.log("Starting migration to set all existing users' AI Engine to OFF...");
  try {
    const allUsers = await db.select().from(users);
    let count = 0;
    for (const user of allUsers) {
      const config = (user.config as any) || {};
      if (config.autonomousMode !== false) {
        config.autonomousMode = false;
        await db.update(users).set({ config }).where(sql`${users.id} = ${user.id}`);
        count++;
      }
    }
    console.log(`Successfully migrated ${count} users. AI Engine defaults to OFF for existing accounts.`);
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
}

main();
