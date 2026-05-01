
import { FollowUpWorker } from '@services/brain-worker/src/ai-lib/core/follow-up-worker.js';

async function main() {
  console.log('Force processing follow-up queue...');
  const worker = new FollowUpWorker();
  await worker.processQueue();
  console.log('Done.');
  process.exit(0);
}

main().catch(console.error);
