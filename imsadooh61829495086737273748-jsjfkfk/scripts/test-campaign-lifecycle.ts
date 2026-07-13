import 'dotenv/config';
import { DrizzleStorage } from '@shared/lib/storage/drizzle-storage.js';
import { db } from '@shared/lib/db/db.js';
import { outreachCampaigns, campaignLeads, leads, users } from '../shared/schema.js';
import { eq, and } from 'drizzle-orm';
import { isValidUUID } from '@shared/lib/utils/validation.js';

async function testCampaignLifecycle() {
  const storage = new DrizzleStorage();
  
  // 1. Setup - Find a test user
  console.log('🔍 Finding test user...');
  const [testUser] = await db.select().from(users).limit(1);
  if (!testUser) {
    console.error('❌ No user found for testing.');
    process.exit(1);
  }
  const userId = testUser.id;
  console.log(`✅ Using user: ${testUser.email} (${userId})`);

  // 2. Setup - Ensure we have at least one lead
  console.log('🔍 Ensuring test lead exists...');
  let [testLead] = await db.select().from(leads).where(eq(leads.userId, userId)).limit(1);
  if (!testLead) {
    [testLead] = await db.insert(leads).values({
      userId,
      name: 'Test Lead',
      email: `test-${Date.now()}@example.com`,
      status: 'new',
      channel: 'email'
    }).returning();
  }
  console.log(`✅ Using lead: ${testLead.email} (${testLead.id})`);

  // 3. Create Campaign
  console.log('🚀 Creating test campaign...');
  const campaignName = `Test Campaign ${Date.now()}`;
  const [campaign] = await db.insert(outreachCampaigns).values({
    userId,
    name: campaignName,
    status: 'active',
    config: { dailyLimit: 50, minDelayMinutes: 2 },
    template: { subject: 'Hello', body: 'World', followups: [] }
  } as any).returning();
  console.log(`✅ Campaign created: ${campaign.id}`);

  // 4. Link Lead
  console.log('🔗 Linking lead to campaign...');
  await db.insert(campaignLeads).values({
    campaignId: campaign.id,
    leadId: testLead.id,
    status: 'pending'
  });
  // Mark lead as assigned in main leads table
  await db.update(leads).set({ integrationId: '00000000-0000-0000-0000-000000000001' }).where(eq(leads.id, testLead.id));
  console.log('✅ Lead linked and integrationId set.');

  // 5. Verify Excluded from Fetch
  console.log('👀 Verifying lead is excluded from available pool...');
  const availableLeadsBefore = await storage.getLeads({ userId, excludeActiveCampaignLeads: true });
  const isExcluded = !availableLeadsBefore.some(l => l.id === testLead.id);
  if (isExcluded) {
    console.log('✅ Successfully excluded from fetch.');
  } else {
    console.error('❌ FAILED: Lead should be excluded but was found!');
  }

  // 6. Abort Campaign
  console.log('🛑 Aborting campaign...');
  // Simulate abort logic
  await db.update(outreachCampaigns).set({ status: 'aborted' }).where(eq(outreachCampaigns.id, campaign.id));
  
  // Release leads (logic from outreach.ts)
  const pendingLeads = await db.select({ leadId: campaignLeads.leadId })
    .from(campaignLeads)
    .where(and(eq(campaignLeads.campaignId, campaign.id), eq(campaignLeads.status, 'pending')));

  if (pendingLeads.length > 0) {
    const leadIds = pendingLeads.map((l: { leadId: string | null }) => l.leadId);
    await db.update(leads).set({ integrationId: null }).where(eq(leads.id, testLead.id));
    await db.update(campaignLeads).set({ status: 'aborted' }).where(eq(campaignLeads.campaignId, campaign.id));
  }
  console.log('✅ Campaign aborted and lead released.');

  // 7. Verify Re-available
  console.log('🔄 Verifying lead is re-available after abort...');
  const availableLeadsAfter = await storage.getLeads({ userId, excludeActiveCampaignLeads: true });
  const isReavailable = availableLeadsAfter.some(l => l.id === testLead.id);
  if (isReavailable) {
    console.log('✅ Successfully re-available in fetch!');
  } else {
    console.error('❌ FAILED: Lead should be re-available but was NOT found!');
  }

  // 8. Delete Campaign
  console.log('🗑️ Deleting campaign...');
  await db.delete(outreachCampaigns).where(eq(outreachCampaigns.id, campaign.id));
  
  // Verify deletion
  const [deletedCampaign] = await db.select().from(outreachCampaigns).where(eq(outreachCampaigns.id, campaign.id));
  const [deletedLinks] = await db.select().from(campaignLeads).where(eq(campaignLeads.campaignId, campaign.id));
  
  if (!deletedCampaign && !deletedLinks) {
    console.log('✅ Campaign and associations deleted (cascade works).');
  } else {
    console.error('❌ FAILED: Deletion was incomplete!');
  }

  console.log('\n✨ END-TO-END TEST COMPLETE ✨');
  process.exit(0);
}

testCampaignLifecycle().catch(err => {
  console.error('❌ TEST ERROR:', err);
  process.exit(1);
});
