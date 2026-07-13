import "dotenv/config";
import { db } from "@shared/lib/db/db.js";
import { users } from "@audnix/shared";
import { eq, inArray } from "drizzle-orm";

async function updateToEnterprise() {
  const emails = ["team.replyflow@gmail.com", "fortunechinedu708@gmail.com"];
  
  console.log(`Updating users ${emails.join(", ")} to enterprise plan...`);
  
  try {
    const result = await db
      .update(users)
      .set({ 
        plan: "enterprise",
        subscriptionTier: "enterprise"
      })
      .where(inArray(users.email, emails))
      .returning();
    
    console.log("Update successful!");
    console.log(result.map((u: any) => ({ id: u.id, email: u.email, plan: u.plan })));
  } catch (error) {
    console.error("Failed to update users:", error);
  } finally {
    process.exit(0);
  }
}

updateToEnterprise();
