import 'dotenv/config';
import { db } from '@shared/lib/db/db.js';
import { pagedEmailImport } from '@shared/lib/imports/paged-email-importer.js';
import { leads, campaignLeads, notifications, followUpQueue, users, outreachCampaigns } from '@audnix/shared';
import { eq, desc, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { campaignQueue, hasRedis } from '@shared/lib/queues/campaign-queue.js';

async function runTest() {
    console.log('🧪 Starting Positive Sequence Kill Verification...');

    // 1. Get a test user
    let user = await db.query.users.findFirst();
    if (!user) {
        console.log('⚠️ No user found in DB. Creating a mock test user...');
        const [newUser] = await db.insert(users).values({
            email: 'test.user@audnixai.com',
            name: 'Test Agent User',
            timezone: 'America/New_York',
            config: { autonomousMode: true }
        }).returning();
        user = newUser;
    }
    console.log(`👤 Using user: ${user.email} (${user.id})`);

    // 2. Create/Get a test lead
    const testEmail = `test.lead.${Date.now()}@example.com`;
    console.log(`📧 Creating test lead: ${testEmail}`);

    const [lead] = await db.insert(leads).values({
        userId: user.id,
        email: testEmail,
        name: 'Test Positive Lead',
        channel: 'email',
        status: 'new',
        aiPaused: false,
        metadata: { source: 'test_script' }
    }).returning();

    // 3. Create a fake campaign first to satisfy FK constraints
    const [campaign] = await db.insert(outreachCampaigns).values({
        userId: user.id,
        name: `Test Campaign ${Date.now()}`,
        status: 'active',
        config: { dailyLimit: 50, minDelayMinutes: 2 },
        template: { subject: 'Hello', body: 'World', followups: [] }
    } as any).returning();
    console.log(`🚀 Created fake campaign: ${campaign.id}`);

    const [campLead] = await db.insert(campaignLeads).values({
        campaignId: campaign.id,
        leadId: lead.id,
        status: 'pending' as any,
        metadata: {}
    }).returning();
    console.log(`📧 Created fake campaignLeads row: ${campLead.id} (status: pending)`);

    // 4. Queue a fake BullMQ delayed job for this lead (if Redis is connected)
    // hasRedis is already the connectivity flag; the add() call will throw if Redis is down (caught below)
    if (campaignQueue && hasRedis) {
        try {
            await campaignQueue.add(
                'test-followup',
                { leadId: lead.id, userId: user.id, email: testEmail } as any,
                { delay: 1000 * 60 * 10 } // 10 minutes delay
            );
            console.log(`🤖 Enqueued delayed BullMQ job for lead: ${lead.id}`);
        } catch (e) {
            console.log(`⚠️ Redis/BullMQ offline or timed out, skipping delayed job queueing:`, (e as Error).message);
        }
    }

    // 5. Simulate Inbound Positive Email
    const inboundEmail = {
        from: testEmail,
        to: user.email,
        subject: 'Interested in booking a call!',
        text: 'Hi, I read your email and I would love to schedule a demo to get started with your service! Let me know when you are free.',
        date: new Date(),
        messageId: `<${randomUUID()}@example.com>`
    };

    console.log('📨 Simulating inbound email import with positive intent...');
    const result = await pagedEmailImport(user.id, [inboundEmail], undefined, 'inbound');
    console.log('📊 Import Result:', result);

    if (result.imported === 0) {
        console.error('❌ Email was not imported!');
        process.exit(1);
    }

    // Wait a brief moment for async jobs (like sequence killer) to resolve
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('\n🔍 Verifying Sequence Kill Results:');

    // Verification A: Lead status and aiPaused flag
    const [updatedLead] = await db.select().from(leads).where(eq(leads.id, lead.id));
    console.log(`- Lead status: ${updatedLead.status} (Expected: qualified)`);
    console.log(`- Lead aiPaused: ${updatedLead.aiPaused} (Expected: true)`);

    const passedLead = updatedLead.status === 'qualified' && updatedLead.aiPaused === true;

    // Verification B: campaignLeads status
    const [updatedCampLead] = await db.select().from(campaignLeads).where(eq(campaignLeads.id, campLead.id));
    console.log(`- Campaign Lead status: ${updatedCampLead.status} (Expected: replied)`);

    const passedCamp = updatedCampLead.status === 'replied';

    // Verification C: BullMQ job removal
    let jobRemoved = true;
    if (campaignQueue) {
        const delayedJobs = await campaignQueue.getDelayed();
        const leadJobs = delayedJobs.filter((j: any) => j.data?.leadId === lead.id);
        console.log(`- Delayed BullMQ jobs remaining: ${leadJobs.length} (Expected: 0)`);
        jobRemoved = leadJobs.length === 0;
    }

    // Verification D: Hand-off notification created
    const userNotifs = await db.select().from(notifications)
        .where(and(eq(notifications.userId, user.id), eq(notifications.type, 'conversion')))
        .orderBy(desc(notifications.createdAt));
    
    const targetNotif = userNotifs.find((n: any) => (n.metadata as any)?.leadId === lead.id);
    console.log(`- Hand-off Notification created: ${targetNotif ? 'YES' : 'NO'} (Expected: YES)`);
    if (targetNotif) {
        console.log(`  Title: ${targetNotif.title}`);
        console.log(`  Message: ${targetNotif.message}`);
    }

    const passedNotif = !!targetNotif;

    // Verification E: No automated reply job scheduled in followUpQueue
    const jobs = await db.select().from(followUpQueue)
        .where(eq(followUpQueue.leadId, lead.id));
    console.log(`- followUpQueue jobs scheduled: ${jobs.length} (Expected: 0)`);

    const passedFollowup = jobs.length === 0;

    const overallPassed = passedLead && passedCamp && jobRemoved && passedNotif && passedFollowup;
    if (overallPassed) {
        console.log('\n🎉 ALL VERIFICATION CHECKS PASSED SUCCESSFULLY! Sequence kill is fully functioning.');
        process.exit(0);
    } else {
        console.error('\n❌ FAILURE: Some sequence kill verification checks failed!');
        process.exit(1);
    }
}

runTest().catch(console.error);
