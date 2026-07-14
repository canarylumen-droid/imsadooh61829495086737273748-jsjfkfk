import { autonomousOutreachWorker } from "@services/outreach-worker/workers/outreach-worker.js";
import { reputationWorker } from "@services/outreach-worker/workers/reputation-worker.js";
import { OutreachEngine } from "@services/outreach-worker/workers/outreach-engine.js";

async function startWorkers() {
  console.log('👷 Starting Distributed Worker Node...');

  try {
    // Initialize Outreach Engine (Master Logic)
    const engine = new OutreachEngine();
    await engine.start();

    // Start BullMQ Worker Processors
    await autonomousOutreachWorker.start();

    // Start Reputation Monitoring
    reputationWorker.start();

    console.log('✅ All workers initialized and listening to BullMQ');
  } catch (err) {
    console.error('❌ Failed to start workers:', err);
    process.exit(1);
  }
}

// Global error handling for the worker process
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception in worker:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection in worker:', reason);
});

startWorkers();
