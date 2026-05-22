import { startWorkerHealthServer } from "@services/api-gateway/src/core/worker-health-server.js";
import { LeadRecoveryWorker } from "./src/worker.js";

const port = parseInt(process.env.LEAD_RECOVERY_WORKER_PORT || process.env.PORT || "8095", 10);
const worker = new LeadRecoveryWorker();

startWorkerHealthServer("lead-recovery", port);

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
