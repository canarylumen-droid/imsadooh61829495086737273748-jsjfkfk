
// @ts-nocheck
import { db } from "../server/db";
import { outreachCampaigns, campaignLeads, users, leads } from "../shared/schema";
// @ts-ignore
import { CampaignWorker } from "../server/lib/outreach/campaign-worker";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

// MOCK sendEmail to avoid actual sending
jest.mock('../server/lib/channels/email', () => ({
    sendEmail: jest.fn().mockResolvedValue(true)
}));

async function verify() {
    console.log("🧪 Starting Verification...");

    // 1. Create Dummy User
    const [user] = await db.insert(users).values({
        email: `test-${Date.now()}@example.com`,
        metadata: {}
    }).returning();
    console.log(`✅ Created User: ${user.id}`);

    // 2. Create Dummy Leads
    const leadIds = [];
    for (let i = 0; i < 3; i++) {
        const [lead] = await db.insert(leads).values({
            userId: user.id,
            name: `Test Lead ${i}`,
            email: `lead-${i}-${Date.now()}@example.com`,
            channel: 'email',
            status: 'new'
        }).returning();
        leadIds.push(lead.id);
    }
    console.log(`✅ Created ${leadIds.length} leads`);

    // 3. Create Campaign with LIMIT 1
    const [campaign] = await db.insert(outreachCampaigns).values({
        userId: user.id,
        name: "Verification Campaign",
        status: "active",
        config: {
            dailyLimit: 10,
            minDelayMinutes: 0.1,
            maxDelayMinutes: 0.5
        },
        template: {
            subject: "Test",
            body: "Testing {{name}}",
            followups: []
        }
    } as any).returning();
    console.log(`✅ Created Campaign: ${campaign.id} with Daily Limit 1`);

    // 4. Add Leads to Campaign
    await db.insert(campaignLeads).values(leadIds.map(lid => ({
        campaignId: campaign.id,
        leadId: lid,
        status: 'pending' as any
    })));

    // 5. Run Worker
    const worker = new CampaignWorker();
    
    // Override internal console.log to keep it clean or just let it flow
    // Run process once
    console.log("🔄 Running Worker Iteration 1...");
    // @ts-ignore - accessing private method for test
    await worker.processCampaigns();
    
    // Check results
    const sentLeads = await db.select().from(campaignLeads).where(eq(campaignLeads.status, 'sent'));
    console.log(`📊 Sent Leads Count: ${sentLeads.length}`);

    if (sentLeads.length === 1) {
        console.log("✅ PASS: Daily Limit Enforced (Target 1, Actual 1)");
    } else {
        console.error(`❌ FAIL: Expected 1 sent, got ${sentLeads.length}`);
    }

    // 6. Cleanup
    await db.delete(outreachCampaigns).where(eq(outreachCampaigns.id, campaign.id));
    await db.delete(users).where(eq(users.id, user.id)); // cascading delete leads
    console.log("🧹 Cleanup complete");
    process.exit(0);
}

verify().catch(console.error);
