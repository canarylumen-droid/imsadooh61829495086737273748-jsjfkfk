import { enqueueFathomMeeting, fathomQueue } from '../shared/lib/queues/fathom-queue.js';

async function verifyQueuing() {
  console.log('🚀 Testing Fathom Job Queuing...');

  const mockPayload = {
    event: 'meeting.finished',
    data: {
      id: `verify-scale-${Date.now()}`,
      title: 'Enterprise Scalability Test',
      attendees: [{ name: 'Test User', email: 'test@example.com' }],
      transcript: 'Scaling to millions of calls!'
    }
  };

  try {
    const job = await enqueueFathomMeeting(mockPayload as any);
    console.log(`✅ Job enqueued successfully! Job ID: ${job.id}`);
    
    const count = await fathomQueue.count();
    console.log(`📊 Current jobs in fathom-processing queue: ${count}`);

    if (job.id) {
      console.log('🎉 Verification PASSED: Fathom integration is now asynchronous and queue-ready.');
    } else {
      console.error('❌ Verification FAILED: Job ID not returned.');
    }
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Error during queuing verification:', err);
    process.exit(1);
  }
}

verifyQueuing();
