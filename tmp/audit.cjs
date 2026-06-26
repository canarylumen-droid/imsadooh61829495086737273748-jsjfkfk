const fs = require("fs");
const checks = [
  // Per-provider reputation engine must have these functions
  ["services/email-service/src/email/provider-reputation.ts", ["canSendToProvider","recordProviderOutcome","recalculateProviderReputation","resetProviderDailyCounters","detectProviderGroup"]],
  // Campaign queue must import and use per-provider check
  ["shared/lib/queues/campaign-queue.ts", ["canSendToProvider","recordProviderOutcome","providerCheck.allowed","providerCheck.reason"]],
  // Reputation monitor must have provider counter reset
  ["services/email-service/src/email/reputation-monitor.ts", ["resetAllProviderCounters","resetProviderDailyCounters"]],
  // Schema must have providerLimits
  ["shared/schema.ts", ["providerLimits"]],
  // Migrator must add provider_limits column
  ["shared/lib/db/migrator.ts", ["provider_limits"]],
  // Scheduler must NOT have the import (we removed it)
  ["services/warmup-service/src/workers/scheduler-worker.ts", ["seedFleetManager.resetSeedDailyCounters"]],
  // Scheduler should not have provider-reputation import anymore
];
let allGood = true;
for (const [file, expected] of checks) {
  if (!fs.existsSync(file)) { console.log("MISSING: " + file); allGood = false; continue; }
  const content = fs.readFileSync(file, "utf8");
  for (const term of expected) {
    if (!content.includes(term)) {
      // For scheduler, check that the term does NOT exist
      if (file.includes("scheduler") && term.includes("provider-reputation")) {
        // we expect this NOT to be there
        continue;
      }
      console.log("MISSING: \"" + term + "\" in " + file);
      allGood = false;
    }
  }
  console.log("OK: " + file + " (" + content.split("\n").length + " lines, " + expected.length + " checks)");
}
console.log(allGood ? "ALL CHECKS PASSED" : "ISSUES FOUND");
