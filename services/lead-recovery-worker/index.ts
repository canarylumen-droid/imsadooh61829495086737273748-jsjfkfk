import { startWorkerHealthServer } from "@services/api-gateway/src/core/worker-health-server.js";
import { LeadRecoveryWorker } from "./src/worker.js";

async function startRecoveryService() {
  const port = parseInt(process.env.LEAD_RECOVERY_WORKER_PORT || process.env.PORT || "8095", 10);
  const worker = new LeadRecoveryWorker();

  startWorkerHealthServer("lead-recovery", port);

  await worker.start();
}

export { startRecoveryService };

if (process.env.UNIFIED_MODE !== 'true') {
  const worker = new LeadRecoveryWorker();

  async function shutdown(signal: string) {
    console.log(`[LeadRecoveryWorker] ${signal} received. Shutting down...`);
    await worker.stop();
    process.exit(0);
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  worker.start().catch((error) => {
    console.error("[LeadRecoveryWorker] Fatal startup failure", error);
    process.exit(1);
  });
}
