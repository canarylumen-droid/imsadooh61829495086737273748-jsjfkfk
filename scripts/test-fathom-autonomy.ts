import 'dotenv/config';
import { db, pool } from '@shared/lib/db/db.js';
import { leads, fathomCalls, followUpQueue } from '../shared/schema.js';
import { processFathomWebhook } from '@services/brain-worker/src/ai-lib/specialized/fathom-integration.js';
import { eq, desc } from 'drizzle-orm';

async function test() {
  console.log('--- STARTING FATHOM AUTONOMY TEST ---');
  
  // 1. Find a sample lead for the test
  const sampleLeads = await db.select().from(leads).limit(1);
  if (sampleLeads.length === 0) {
    console.error('No leads found in database. Create a lead first.');
    process.exit(1);
  }
  const lead = sampleLeads[0];
  console.log(`Testing with lead: ${lead.name} (${lead.email})`);

  // 2. Mock Fathom Webhook Payload
  const mockPayload = {
    event: 'meeting.finished',
    data: {
      id: "fathom_test_" + Date.now(),
      meeting_url: "https://app.fathom.ai/test-call",
      title: "Strategic Partnership Discussion",
      occurred_at: new Date().toISOString(),
      attendees: [{ name: lead.name, email: lead.email }],
      summary: "The prospect is interested in the enterprise plan but wants to see a ROI comparison. We discussed the $5,000 yearly tier. They asked for a follow-up email with the case study.",
      transcript: "Speaker 1: Thanks for joining. Speaker 2: I like the automation and the Fathom integration. I'm concerned about the price point though. Can you show me how this pays for itself? Speaker 1: Absolutely. I'll send over our ROI calculator and some similar case studies in my follow-up today. Speaker 2: Great, let's touch base again once I've seen those."
    }
  };

  console.log('Processing mock webhook...');
  await processFathomWebhook(mockPayload as any);

  // 3. Verify fathom_calls record
  console.log('Verifying fathom_calls entry...');
  const calls = await db.select().from(fathomCalls)
    .where(eq(fathomCalls.leadId, lead.id))
    .orderBy(desc(fathomCalls.createdAt))
    .limit(1);

  if (calls.length > 0 && calls[0].analysis) {
    console.log('✅ Success: Fathom call record found with autonomous analysis:');
    console.log(JSON.stringify(calls[0].analysis, null, 2));
  } else {
    console.warn('❌ Failure: Fathom call record or analysis missing.');
  }

  // 4. Verify follow-up queue
  console.log('Verifying follow-up queue...');
  const queue = await db.select().from(followUpQueue)
    .where(eq(followUpQueue.leadId, lead.id))
    .orderBy(desc(followUpQueue.scheduledAt))
    .limit(1);

  if (queue.length > 0 && queue[0].context && (queue[0].context as any).source === 'fathom_autonomous_engine') {
    console.log('✅ Success: Autonomous follow-up queued successfully:');
    console.log(`Action: ${(queue[0].context as any).intent}`);
    console.log(`Reasoning: ${(queue[0].context as any).reasoning}`);
  } else {
    console.warn('❌ Failure: No autonomous follow-up found in queue.');
  }

  console.log('--- TEST COMPLETE ---');
  if (pool) {
    console.log('Closing database connection pool...');
    await pool.end();
  }
  process.exit(0);
}

test().catch(async err => {
  console.error('Test failed with error:', err);
  if (pool) await pool.end();
  process.exit(1);
});
