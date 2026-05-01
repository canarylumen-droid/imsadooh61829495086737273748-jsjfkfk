import "dotenv/config";
import { db } from "@shared/lib/db/db.js";
import { leads, integrations, outreachCampaigns, campaignLeads, messages, users } from "../shared/schema.js";
import { drizzleStorage } from "@shared/lib/storage/drizzle-storage.js";
import { eq, and, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";

async function verifyLeadSharing() {
  console.log("🚀 Starting Lead Sharing Verification...");

  const testUserId = randomUUID();
  let campaignId: string | undefined;
  
  try {
    // 1. Setup Test User
    await db.insert(users).values({
      id: testUserId,
      email: `test-${testUserId}@example.com`,
      name: "Test User",
    });

    // 2. Setup Integrations (Mailboxes)
    const integrationA = randomUUID();
    const integrationB = randomUUID();

    await db.insert(integrations).values([
      { id: integrationA, userId: testUserId, provider: "custom_email", connected: true, encryptedMeta: "test" },
      { id: integrationB, userId: testUserId, provider: "custom_email", connected: true, encryptedMeta: "test" }
    ]);

    // 3. Setup Campaign
    campaignId = randomUUID();
    await db.insert(outreachCampaigns).values({
      id: campaignId,
      userId: testUserId,
      name: "Shared Campaign",
      status: "active",
      template: { subject: "Hello", body: "World", followups: [] },
      config: { dailyLimit: 50, minDelayMinutes: 2 }
    });

    // 4. Setup Leads
    const lead1 = randomUUID();
    const lead2 = randomUUID();

    await db.insert(leads).values([
      { id: lead1, userId: testUserId, name: "Lead 1", channel: "email", email: "lead1@example.com", integrationId: integrationA },
      { id: lead2, userId: testUserId, name: "Lead 2", channel: "email", email: "lead2@example.com", integrationId: integrationB }
    ]);

    // 5. Assign to Campaign
    await db.insert(campaignLeads).values([
      { campaignId, leadId: lead1, integrationId: integrationA },
      { campaignId, leadId: lead2, integrationId: integrationB }
    ]);

    // 6. Verify Sharing Logic
    console.log("🔍 Verifying queries...");

    const leadsForA = await drizzleStorage.getLeads({ userId: testUserId, integrationId: integrationA });
    console.log(`Leads for Integration A: ${leadsForA.length} (Expected: 2 because of shared campaign)`);

    const leadsForB = await drizzleStorage.getLeads({ userId: testUserId, integrationId: integrationB });
    console.log(`Leads for Integration B: ${leadsForB.length} (Expected: 2 because of shared campaign)`);

    // 7. Verify Message Sharing
    const msg1 = randomUUID();
    await db.insert(messages).values({
      id: msg1,
      userId: testUserId,
      leadId: lead2, // Lead 2 is assigned to Integration B
      integrationId: integrationB,
      provider: "email",
      direction: "inbound",
      body: "Reply from Lead 2",
    });

    const messagesForA = await drizzleStorage.getAllMessages(testUserId, { integrationId: integrationA });
    const hasMsgFromLead2 = messagesForA.some(m => m.id === msg1);
    console.log(`Message from Lead 2 visible to Integration A: ${hasMsgFromLead2} (Expected: true)`);

    if (leadsForA.length === 2 && leadsForB.length === 2 && hasMsgFromLead2) {
      console.log("✅ Lead Sharing Verification PASSED!");
    } else {
      console.error("❌ Lead Sharing Verification FAILED!");
      process.exit(1);
    }

  } catch (error) {
    console.error("error during verification:", error);
    process.exit(1);
  } finally {
    // Cleanup
    console.log("🧹 Cleaning up test data...");
    await db.delete(messages).where(eq(messages.userId, testUserId));
    if (campaignId) await db.delete(campaignLeads).where(eq(campaignLeads.campaignId, campaignId));
    await db.delete(outreachCampaigns).where(eq(outreachCampaigns.userId, testUserId));
    await db.delete(leads).where(eq(leads.userId, testUserId));
    await db.delete(integrations).where(eq(integrations.userId, testUserId));
    await db.delete(users).where(eq(users.id, testUserId));
  }
}

verifyLeadSharing();
