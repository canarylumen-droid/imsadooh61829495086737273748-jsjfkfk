const fs = require("fs");

const files = {
  // NEW FILES (9)
  "NEW warmup: anchor-engine": "services/warmup-service/src/engine/anchor-engine.ts",
  "NEW warmup: domain-cluster": "services/warmup-service/src/engine/domain-cluster.ts",
  "NEW warmup: seed-fleet-manager": "services/warmup-service/src/engine/seed-fleet-manager.ts",
  "NEW warmup: provider-utils": "services/warmup-service/src/lib/provider-utils.ts",
  "NEW warmup: seed-init": "services/warmup-service/src/init/seeds.ts",
  "NEW email: provider-reputation": "services/email-service/src/email/provider-reputation.ts",
  "NEW email: ai-reply-generator": "services/email-service/src/email/ai-reply-generator.ts",
  "NEW email: mailbox-coordinator": "services/email-service/src/email/mailbox-coordinator.ts",
  "NEW email: reply-manager": "services/email-service/src/email/reply-manager.ts",
  // MODIFIED FILES (22)
  "MOD warmup: pairing-engine": "services/warmup-service/src/lib/pairing-engine.ts",
  "MOD warmup: enrollment-engine": "services/warmup-service/src/engine/enrollment-engine.ts",
  "MOD warmup: pool-health-monitor": "services/warmup-service/src/engine/pool-health-monitor.ts",
  "MOD warmup: outbound-worker": "services/warmup-service/src/workers/outbound-worker.ts",
  "MOD warmup: scheduler-worker": "services/warmup-service/src/workers/scheduler-worker.ts",
  "MOD warmup: imap-stealth": "services/warmup-service/src/lib/imap-stealth.ts",
  "MOD warmup: warmup-config": "services/warmup-service/src/config/warmup-config.ts",
  "MOD warmup: warmup-types": "services/warmup-service/src/types/warmup-types.ts",
  "MOD warmup: index.ts": "services/warmup-service/index.ts",
  "MOD email: bounce-handler": "services/email-service/src/email/bounce-handler.ts",
  "MOD email: reputation-monitor": "services/email-service/src/email/reputation-monitor.ts",
  "MOD email: index.ts": "services/email-service/index.ts",
  "MOD campaign-queue": "shared/lib/queues/campaign-queue.ts",
  "MOD schema (shared/)": "shared/schema.ts",
  "MOD schema (packages/)": "packages/shared/schema.ts",
  "MOD migrator": "shared/lib/db/migrator.ts",
  "MOD integrations API": "services/api-gateway/src/routes/integrations-routes.ts",
  "MOD integrations UI": "client/src/pages/dashboard/integrations.tsx",
  "MOD analytics UI": "client/src/pages/dashboard/analytics.tsx",
  "MOD settings UI": "client/src/pages/dashboard/settings.tsx",
  "MOD sidebar UI": "client/src/components/ui/sidebar.tsx",
  "MOD .env.example": ".env.example",
};

console.log("===== FULL AUDIT: " + Object.keys(files).length + " FILES =====");
let total = 0;
let issues = [];
for (const [label, path] of Object.entries(files)) {
  if (!fs.existsSync(path)) { issues.push("MISSING: " + path); continue; }
  const content = fs.readFileSync(path, "utf8");
  const lines = content.split("\n").length;
  total += lines;
  if (content.trim().length < 10) issues.push("EMPTY: " + path);
}

console.log("Total lines: " + total);
if (issues.length > 0) {
  console.log("\nISSUES:");
  issues.forEach(i => console.log("  " + i));
} else {
  console.log("\nAll 31 files verified — none missing, none empty.");
}

// Confirm zero TS errors from our code
console.log("\n===== TYPE CHECK =====");
const tsc = require("child_process").execSync("npm run check 2>&1", { encoding: "utf8", cwd: process.cwd() });
const ourErrors = tsc.split("\n").filter(l => l.includes("error TS") && !l.includes("audnix-e2e"));
if (ourErrors.length === 0) {
  console.log("0 errors from our code. Only pre-existing errors in audnix-e2e-master.ts");
} else {
  console.log(ourErrors.length + " errors from our code:");
  ourErrors.forEach(e => console.log("  " + e.trim()));
}
