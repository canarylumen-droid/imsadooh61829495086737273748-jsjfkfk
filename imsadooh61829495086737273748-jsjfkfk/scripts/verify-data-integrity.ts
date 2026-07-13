import { db } from "@shared/lib/db/db.js";
import { users, leads } from "../shared/schema.js";
import { isNull, or, eq } from "drizzle-orm";

async function verifyDataIntegrity() {
  console.log("🔍 Starting Data Integrity Audit...");
  
  try {
    // 1. Check for users with NULL critical fields
    console.log("\n--- Checking USERS Table ---");
    const incompleteUsers = await db.select({
      id: users.id,
      email: users.email,
      username: users.username,
      company: users.company
    })
    .from(users)
    .where(
      or(
        isNull(users.email),
        isNull(users.username),
        isNull(users.company),
        eq(users.email, ""),
        eq(users.company, "")
      )
    );

    if (incompleteUsers.length === 0) {
      console.log("✅ All users have email, username, and company fields populated.");
    } else {
      console.log(`⚠️ Found ${incompleteUsers.length} users with missing critical data:`);
      incompleteUsers.forEach((u: any) => {
        console.log(`  - User ID: ${u.id} | Email: ${u.email || "MISSING"} | Username: ${u.username || "MISSING"} | Company: ${u.company || "MISSING"}`);
      });
    }

    // 2. Check for leads with NULL critical fields
    console.log("\n--- Checking LEADS Table ---");
    const incompleteLeads = await db.select({
      id: leads.id,
      email: leads.email,
      userId: leads.userId,
      name: leads.name
    })
    .from(leads)
    .where(
      or(
        isNull(leads.email),
        isNull(leads.userId),
        eq(leads.email, "")
      )
    );

    if (incompleteLeads.length === 0) {
      console.log("✅ All leads have email and user_id fields populated.");
    } else {
      console.log(`⚠️ Found ${incompleteLeads.length} leads with missing critical data:`);
      // Only show first 10 if there are many
      incompleteLeads.slice(0, 10).forEach((l: any) => {
        console.log(`  - Lead ID: ${l.id} | Email: ${l.email || "MISSING"} | UserID: ${l.userId || "MISSING"}`);
      });
      if (incompleteLeads.length > 10) console.log(`  ... and ${incompleteLeads.length - 10} more.`);
    }

    console.log("\n--- Summary ---");
    console.log(`Total Incomplete Users: ${incompleteUsers.length}`);
    console.log(`Total Incomplete Leads: ${incompleteLeads.length}`);
    
  } catch (error) {
    console.error("❌ Audit failed:", error);
  } finally {
    process.exit(0);
  }
}

verifyDataIntegrity();
