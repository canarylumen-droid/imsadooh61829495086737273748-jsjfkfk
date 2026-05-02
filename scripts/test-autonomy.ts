import { config } from 'dotenv';
config();
import { db } from '@shared/lib/db/db.js';
import { leads, users, aiActionLogs, followUpQueue } from '@audnix/shared';
import { FollowUpWorker } from '@services/brain-worker/src/ai-lib/core/follow-up-worker.js';

async function runTest() {
  console.log('🧪 Starting End-to-End Autonomy Test...');

  // Create mock user
  const [user] = await db.insert(users).values({
    email: `test-autonomy-${Date.now()}@example.com`,
    password: 'mockpassword',
    company: 'Autonomy Tester Inc',
    metadata: { isAutonomous: false } // We use draft mode for safety
  }).returning();

  // Create mock lead
  const [lead] = await db.insert(leads).values({
    userId: user.id,
    name: 'Autonomy Lead',
    channel: 'email',
    email: 'fake-lead@example.com',
    status: 'pending',
    sentiment: 'positive',
    aiPaused: false, // Ensure not paused
    metadata: {
      follow_up_count: 0,
      behavior_pattern: { engagementScore: 85 }
    }
  }).returning();

  // Create a pending job
  const [job] = await db.insert(followUpQueue).values({
    userId: user.id,
    leadId: lead.id,
    channel: 'email',
    scheduledAt: new Date(Date.now() - 1000), // In the past
    status: 'pending'
  }).returning();

  console.log(`✅ Created mock user, lead, and pending job (${job.id})`);

  console.log('🤖 Triggering FollowUpWorker...');
  
  const worker = new FollowUpWorker();
  
  // Directly process the job
  await worker.processJob({
    id: job.id,
    userId: user.id,
    leadId: lead.id,
    channel: 'email',
    context: {},
    retryCount: 0
  });

  console.log('✅ FollowUpWorker completed job processing.');

  // Verify the AI action logs
  const logs = await db.select().from(aiActionLogs).where(
    (logs) => logs.leadId === lead.id
  );
  
  console.log('\n📊 AI Action Logs for Lead:');
  logs.forEach(log => {
    console.log(`- Action: [${log.decision.toUpperCase()}] Reasoning: "${log.reasoning}" Outcome: "${log.outcome}"`);
  });

  if (logs.length > 0) {
    console.log('\n✅ Autonomy logic successfully logged its reasoning.');
  } else {
    console.warn('\n⚠️ No AI Action Logs found. The engine did not log its reasoning correctly.');
  }

  console.log('\n🏁 Test complete.');
  process.exit(0);
}

runTest().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
