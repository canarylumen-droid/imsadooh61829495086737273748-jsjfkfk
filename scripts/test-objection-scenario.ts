import { config } from 'dotenv';
config();
import { db } from '@shared/lib/db/db.js';
import { leads, users, messages, aiActionLogs } from '@audnix/shared';
import { eq } from 'drizzle-orm';
import MultiChannelOrchestrator from '@shared/lib/multi-channel-orchestrator.js';

async function runTest() {
  console.log('🧪 Starting Mock Objection Scenario Test...');

  // Create mock user
  const [user] = await db.insert(users).values({
    email: `test-objection-${Date.now()}@example.com`,
    password: 'mockpassword',
    company: 'Test Audnix Inc',
  }).returning();

  // Create mock lead
  const [lead] = await db.insert(leads).values({
    userId: user.id,
    name: 'Objection Tester',
    channel: 'email',
    status: 'pending',
    metadata: {
      behavior_pattern: { engagementScore: 20 }
    }
  }).returning();

  console.log(`✅ Created mock user (${user.id}) and lead (${lead.id})`);

  // Insert an incoming objection message
  const objectionText = "This looks cool, but it's way too expensive for our budget right now. Do you have a discount?";
  await db.insert(messages).values({
    userId: user.id,
    leadId: lead.id,
    body: objectionText,
    direction: 'inbound',
    provider: 'email',
  });

  console.log(`✅ Injected objection message: "${objectionText}"`);

  console.log('🤖 Dispatching to MultiChannelOrchestrator...');
  
  // Create an instance and process message
  const orchestrator = MultiChannelOrchestrator.getInstance();
  
  // We simulate a webhook receiving the message
  await orchestrator.processIncomingMessage({
    userId: user.id,
    leadId: lead.id,
    channel: 'email',
    content: objectionText,
    metadata: {
      isAutonomous: false // force draft
    }
  });

  // Wait a few seconds for the agent to process
  console.log('⏳ Waiting for Agent processing...');
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Check the messages table for a draft response
  const recentMessages = await db.select().from(messages).where(eq(messages.leadId, lead.id));
  
  const aiResponse = recentMessages.find(m => m.direction === 'outbound');
  
  if (aiResponse) {
    console.log('\n✅ AI generated a draft response successfully:');
    console.log(`"${aiResponse.body}"`);
  } else {
    console.warn('\n⚠️ No AI draft response found. The objection agent may not be active or failed.');
  }
  
  console.log('\n🏁 Test complete.');
  process.exit(0);
}

runTest().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
