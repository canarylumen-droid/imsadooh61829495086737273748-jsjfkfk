const fs = require("fs");
const checks = [
  ["pairing-engine", "batchCountActiveThreads"],
  ["pairing-engine", "leftJoin(integrations"],
  ["pairing-engine", "COALESCE(warmupMailboxes.dailyLimit"],
  ["seed-fleet-manager", "verifySeedConnection"],
  ["seed-fleet-manager", "testSmtp"],
  ["seed-fleet-manager", "testImap"],
  ["seed-fleet-manager", "handleSeedFailure"],
  ["seed-fleet-manager", "incrementSeedSentCount"],
  ["seed-fleet-manager", "assignSeedToDomainWithFallback"],
  ["seed-fleet-manager", "resetSeedDailyCounters"],
  ["anchor-engine", "assignSeedToDomainWithFallback"],
  ["anchor-engine", "detectProvider"],
  ["anchor-engine", "promoteToAnchor"],
  ["domain-cluster", "extractRegisteredDomain"],
  ["domain-cluster", "assignSeedToCluster"],
  ["enrollment-engine", "autoAssignAnchorRoles"],
  ["scheduler-worker", "seedFleetManager.resetSeedDailyCounters"],
  ["scheduler-worker", "BATCH_SIZE"],
  ["outbound-worker", "seedFleetManager.incrementSeedSentCount"],
  ["provider-reputation", "detectProviderGroup"],
  ["provider-reputation", "getProviderLimit"],
  ["provider-reputation", "recordProviderOutcome"],
  ["provider-reputation", "recalculateProviderReputation"],
  ["provider-utils", "getGroupPairingScore"],
  ["provider-utils", "isCrossProviderPair"],
];
const dir = "services/warmup-service/src";
const dir2 = "services/email-service/src/email";
let issues = 0;
for (const [file, term] of checks) {
  let path = file.includes("/") ? file : dir + "/lib/" + file + ".ts";
  const enginePath = dir + "/engine/" + file + ".ts";
  const workersPath = dir + "/workers/" + file + ".ts";
  const emailPath = dir2 + "/" + file + ".ts";
  const indexPaths = [path, enginePath, workersPath, emailPath];
  let found = false;
  for (const p of indexPaths) {
    if (fs.existsSync(p) && fs.readFileSync(p, "utf8").includes(term)) {
      found = true; break;
    }
  }
  if (!found) {
    console.log("MISSING: " + term + " in " + file + ".ts");
    issues++;
  }
}
if (issues === 0) console.log("All " + checks.length + " logic checks passed.");
else console.log(issues + " issues found.");
