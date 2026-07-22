import { startWorkerHealthServer } from "@services/api-gateway/src/core/worker-health-server.js";
import { startHeartbeat } from "@shared/lib/monitoring/health-heartbeat.js";
import { ServiceRegistry } from "@shared/lib/monitoring/service-registry.js";
import { connectMySql, ensureTables } from "@shared/lib/mysql.js";
import { LeadRecoveryWorker } from "./src/worker.js";

// ─── Global Process Safety Net ─────────────────────────────────────────────
process.on('unhandledRejection', (reason: any) => {
  console.error('🚨 [LeadRecovery] unhandledRejection', reason?.message || String(reason));
});
process.on('uncaughtException', (err: Error) => {
  console.error('🚨 [LeadRecovery] uncaughtException — shutting down', err.message);
  setTimeout(() => process.exit(1), 1500);
});

const serviceRegistry = new ServiceRegistry(process.env.REDIS_URL || 'redis://localhost:6379', 'lead-recovery-worker');

async function startRecoveryService() {
  await serviceRegistry.register({ version: '1.0.0' });
  const port = parseInt(process.env.LEAD_RECOVERY_WORKER_PORT || process.env.PORT || "8095", 10);
  const worker = new LeadRecoveryWorker();

  startWorkerHealthServer("lead-recovery", port);

  await connectMySql();
  await ensureTables();
  console.log("[LeadRecoveryWorker] ✅ MySQL tables ensured");

  await worker.start();
  startHeartbeat('lead-recovery-worker');
}

export { startRecoveryService };

if (process.env.UNIFIED_MODE !== 'true') {
  let worker: LeadRecoveryWorker;

  async function shutdown(signal: string) {
    console.log(`[LeadRecoveryWorker] ${signal} received. Shutting down...`);
    try { await serviceRegistry.deregister(); } catch (_e) {}
    if (worker) await worker.stop();
    process.exit(0);
  }

  process.on("SIGTERM", async () => { await shutdown("SIGTERM"); });
  process.on("SIGINT", async () => { await shutdown("SIGINT"); });

  async function main() {
    try {
      await connectMySql();
      await ensureTables();
      console.log("[LeadRecoveryWorker] ✅ MySQL tables ensured");
      worker = new LeadRecoveryWorker();
      await worker.start();
    } catch (error) {
      console.error("[LeadRecoveryWorker] Fatal startup failure", error);
      process.exit(1);
    }
  }
  main();
}
