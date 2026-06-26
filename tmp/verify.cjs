const fs = require("fs");

const checks = [
  // provider-reputation.ts must have all critical functions
  ["services/email-service/src/email/provider-reputation.ts", [
    "canSendToProvider", "cachedIntegration", "recordProviderOutcome", 
    "recalculateProviderReputation", "resetProviderDailyCounters", 
    "detectProviderGroup", "bounce.email"
  ]],
  // campaign-queue.ts must pass cached integration + crash-safe
  ["shared/lib/queues/campaign-queue.ts", [
    "canSendToProvider(integrationId, lead.email,", "currentIntegration.providerLimits",
    "recordProviderOutcome(integrationId, lead.email, 'sent')",
    ".catch((err: any) => {", "providerCheck.allowed"
  ]],
  // bounce-handler.ts must record per-provider outcome
  ["services/email-service/src/email/bounce-handler.ts", [
    "recordProviderOutcome", "event.bounceType === 'spam'", "provider-reputation.js"
  ]],
  // email-service entry must have recalculation scheduler
  ["services/email-service/index.ts", [
    "recalculateProviderReputation", "resetProviderDailyCounters",
    "PROVIDER_REPUTATION_INTERVAL", "integrations.id"
  ]],
  // Schema must have providerLimits
  ["shared/schema.ts", ["providerLimits"]],
  // Migrator must have provider_limits migration
  ["shared/lib/db/migrator.ts", ["provider_limits"]],
];

let allGood = true;
for (const [file, terms] of checks) {
  if (!fs.existsSync(file)) { console.log("MISSING FILE: " + file); allGood = false; continue; }
  const content = fs.readFileSync(file, "utf8");
  const lines = content.split("\n").length;
  let missing = [];
  for (const t of terms) {
    if (!content.includes(t)) missing.push(t);
  }
  if (missing.length > 0) {
    console.log("ISSUES in " + file + ":");
    missing.forEach(m => console.log("  MISSING: " + m));
    allGood = false;
  } else {
    console.log("OK: " + file + " (" + lines + " lines, " + terms.length + "/" + terms.length + " checks)");
  }
}

// Count total lines across all modified files
const allFiles = [
  "services/email-service/src/email/provider-reputation.ts",
  "shared/lib/queues/campaign-queue.ts",
  "services/email-service/src/email/bounce-handler.ts",
  "services/email-service/index.ts",
  "shared/schema.ts",
  "shared/lib/db/migrator.ts",
  "services/email-service/src/email/reputation-monitor.ts",
  "services/warmup-service/src/engine/seed-fleet-manager.ts",
  "services/warmup-service/src/lib/pairing-engine.ts",
  "services/warmup-service/src/lib/provider-utils.ts",
  "services/warmup-service/src/workers/scheduler-worker.ts",
  ".env.example"
];
let totalLines = 0;
for (const f of allFiles) {
  if (fs.existsSync(f)) totalLines += fs.readFileSync(f, "utf8").split("\n").length;
}
console.log("\nTotal: " + totalLines + " lines across " + allFiles.length + " files");
console.log(allGood ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
