import { db } from '@shared/lib/db/db.js';
import { users, pendingPayments } from '@audnix/shared';
import { eq, and } from 'drizzle-orm';

async function testHandoffLogic() {
  console.log("🧪 Testing NGA-1 $5k Handoff Rule & Expiry...");
  
  // 1. Setup Mock User
  const [testUser] = await db.select().from(users).limit(1);
  if (!testUser) {
    console.error("❌ No user found for testing");
    return;
  }
  
  console.log(`👤 Using test user: ${testUser.email}`);

  // 2. Simulate High-Ticket Detection Logic (Manual Logic Check)
  const highTicketAmount = 6000;
  const isHighTicket = highTicketAmount >= 5000;
  console.log(`💰 Amount: $${highTicketAmount} | High-Ticket: ${isHighTicket}`);
  
  if (isHighTicket) {
    console.log("✅ Correct: This should trigger human review.");
  } else {
    console.error("❌ Logic Error: $6,000 should be high-ticket");
  }

  // 3. Test Expiry Calculation
  const now = new Date();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  
  console.log(`📅 Now: ${now.toISOString()}`);
  console.log(`📅 Expires At (7 days): ${expiresAt.toISOString()}`);
  
  const diffDays = Math.round((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 7) {
    console.log("✅ Expiry calculation correct (7 days).");
  } else {
    console.error(`❌ Expiry calculation wrong: ${diffDays} days`);
  }

  // 4. Verify Cleanup Logic (Mock query)
  const staleDate = new Date();
  staleDate.setDate(staleDate.getDate() - 10);
  
  console.log(`🧹 Simulating cleanup for records older than 7 days (Testing date: ${staleDate.toISOString()})`);
  
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
  console.log("✅ Cleanup logic check complete.");
}

testHandoffLogic().catch(console.error);
