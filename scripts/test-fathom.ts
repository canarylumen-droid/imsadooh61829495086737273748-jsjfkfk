import { processFathomWebhook } from '@services/brain-worker/src/ai-lib/specialized/fathom-integration.js';
import { db } from '@shared/lib/db/db.js';
import { users, leads } from '@audnix/shared';

async function testFathom() {
  console.log('Testing Fathom Webhook Flow...');
  
  // 1. Find a test user and lead
  const testUser = await db.query.users.findFirst();
  if (!testUser) {
    console.error('No users found in DB.');
    process.exit(1);
  }
  
  const testLead = await db.query.leads.findFirst({
    where: (leads, { eq }) => eq(leads.userId, testUser.id)
  });
  
  if (!testLead) {
    console.error('No leads found for user.');
    process.exit(1);
  }

  console.log(`Using Test User: ${testUser.id}`);
  console.log(`Using Test Lead: ${testLead.id} (${testLead.email})`);

  // 2. Mock Fathom Webhook Payload
  const payload = {
    event: 'meeting.finished',
    data: {
      id: `test-meeting-${Date.now()}`,
      title: 'Discovery Call with Audnix AI',
      status: 'completed',
      attendees: [
        { email: testUser.email }, // Host
        { email: testLead.email || 'test-lead@example.com' }  // Attendee
      ],
      transcript: "So I'm really looking to automate my outreach and close more deals. I love what you guys have shown me. Can we get started?",
      actionItems: [
        { task: "Send payment link", status: "pending" }
      ],
      summary: "Lead expressed strong buying intent and asked to get started. Promised to send payment link."
    }
  };

  try {
    const result = await processFathomWebhook(payload);
    console.log('Webhook processed successfully:', result);
    process.exit(0);
  } catch (err) {
    console.error('Webhook processing failed:', err);
    process.exit(1);
  }
}

testFathom();
