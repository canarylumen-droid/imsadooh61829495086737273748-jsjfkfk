import { startWorkerHealthServer } from "@services/api-gateway/src/core/worker-health-server.js";
import { startHeartbeat } from "@shared/lib/monitoring/health-heartbeat.js";
import { ServiceRegistry } from "@shared/lib/monitoring/service-registry.js";
import { LeadRecoveryWorker } from "./src/worker.js";

const serviceRegistry = new ServiceRegistry(process.env.REDIS_URL || 'redis://localhost:6379', 'lead-recovery-worker');

async function startRecoveryService() {
  await serviceRegistry.register({ version: '1.0.0' });
  const port = parseInt(process.env.LEAD_RECOVERY_WORKER_PORT || process.env.PORT || "8095", 10);
  const worker = new LeadRecoveryWorker();

  startWorkerHealthServer("lead-recovery", port);

  await worker.start();
  startHeartbeat('lead-recovery-worker');
}

export { startRecoveryService };

if (process.env.UNIFIED_MODE !== 'true') {
  const worker = new LeadRecoveryWorker();

  async function shutdown(signal: string) {
    console.log(`[LeadRecoveryWorker] ${signal} received. Shutting down...`);
    try { await serviceRegistry.deregister(); } catch (_e) {}
    await worker.stop();
    process.exit(0);
  }

  process.on("SIGTERM", async () => { await shutdown("SIGTERM"); });
  process.on("SIGINT", async () => { await shutdown("SIGINT"); });

  worker.start().catch((error) => {
    console.error("[LeadRecoveryWorker] Fatal startup failure", error);
    process.exit(1);
  });
}
