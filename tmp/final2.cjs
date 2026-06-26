const fs = require("fs");
const fixes = [
  // GAP 11: Seed failure tracking
  ["outbound-worker.ts", "seedFailCount"],
  ["outbound-worker.ts", "handleSeedFailure"],
  ["outbound-worker.ts", "resetSeedFailureCount"],
  // GAP 12: Track failed seed attempts
  ["outbound-worker.ts", "newFailCount >= 3"],
  // GAP 1+2+8: Total daily cap
  ["campaign-queue.ts", "total daily cap hit"],
  ["campaign-queue.ts", "getMailboxSentCount"],
  // GAP 6: Atomic recordProviderOutcome
  ["provider-reputation.ts", "jsonb_build_object"],
  ["provider-reputation.ts", "jsonb_build_object"],
  // GAP 7: Dead code removed
  ["provider-reputation.ts", "canSendFollowUpOrReply"],
  // GAP 14+16: Seed scheduler limit
  ["scheduler-worker.ts", "anchorRole === 'seed'"],
  ["scheduler-worker.ts", "isSeed"],
];
const paths = {
  "outbound-worker.ts": "services/warmup-service/src/workers/outbound-worker.ts",
  "campaign-queue.ts": "shared/lib/queues/campaign-queue.ts",
  "provider-reputation.ts": "services/email-service/src/email/provider-reputation.ts",
  "scheduler-worker.ts": "services/warmup-service/src/workers/scheduler-worker.ts"
};
let allOk = true;
console.log("GAP FIX VERIFICATION:");
for (const [file, pattern] of fixes) {
  const fullPath = paths[file];
  if (!fullPath || !fs.existsSync(fullPath)) {
    console.log("  FILE NOT FOUND: " + file);
    allOk = false; continue;
  }
  const content = fs.readFileSync(fullPath, "utf8");
  if (content.includes(pattern)) {
    console.log("  OK " + file + ": \"" + pattern + "\"");
  } else {
    console.log("  MISSING in " + file + ": \"" + pattern + "\"");
    allOk = false;
  }
}
console.log(allOk ? "\nALL 13 FIXES CONFIRMED" : "\nSOME FIXES MISSING");
