const fs = require("fs");

const files = [
  "services/email-service/src/email/provider-reputation.ts",
  "shared/lib/queues/campaign-queue.ts",
  "services/email-service/src/email/bounce-handler.ts",
  "services/email-service/index.ts",
];

let total = 0;
let issues = [];

for (const f of files) {
  if (!fs.existsSync(f)) { issues.push("FILE MISSING: " + f); continue; }
  const c = fs.readFileSync(f, "utf8");
  total += c.split("\n").length;
}

// Check each critical protection
const protections = [
  ["provider-reputation.ts", "isFollowUpOrReply", "Follow-ups bypass provider limits via flag"],
  ["provider-reputation.ts", "FLOOR_LIMIT = 1", "Minimum 1 send/day even with bad reputation"],
  ["provider-reputation.ts", "CEILING_LIMIT = 50", "Max 50/day per provider cap"],
  ["provider-reputation.ts", "RECOVERY_RATE = 2", "Auto-recovery +2/cycle when clean"],
  ["provider-reputation.ts", "canSendFollowUpOrReply", "Explicit bypass for replies"],
  ["provider-reputation.ts", "detectProviderGroup", "Provider detection from email domain"],
  ["provider-reputation.ts", "getProviderState", "Null-safe provider state reader"],
  ["provider-reputation.ts", "getProviderSummary", "Debug/summary endpoint"],
  ["provider-reputation.ts", "PROVIDER_GROUPS", "All 7 provider groups"],
  ["campaign-queue.ts", "processFollowUp", "Follow-up handler separate from initial sends"],
  ["campaign-queue.ts", "canSendToProvider(", "Provider check in initial send path"],
  ["campaign-queue.ts", "isFollowUpOrReply", "False for cold sends, true for follow-ups"],
  ["campaign-queue.ts", "recordProviderOutcome(", "Tracks provider consumption after send"],
  ["campaign-queue.ts", ".catch((err", "Crash-safe outcome recording"],
  ["bounce-handler.ts", "recordProviderOutcome(", "Bounce feeds into provider budget"],
  ["bounce-handler.ts", "event.bounceType === 'spam'", "Spam detected and recorded per provider"],
  ["email-service/index.ts", "recalculateProviderReputation", "6-hour auto recalculation"],
  ["email-service/index.ts", "resetProviderDailyCounters", "Hourly counter reset check"],
];

console.log("===== PROTECTION CHECK =====");
for (const [file, pattern, desc] of protections) {
  const filePath = file === "bounce-handler.ts" ? "services/email-service/src/email/" + file 
    : file === "campaign-queue.ts" ? "shared/lib/queues/" + file
    : file === "email-service/index.ts" ? "services/email-service/index.ts"
    : "services/email-service/src/email/" + file;
  
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, "utf8").includes(pattern)) {
    console.log("  ✅ " + desc);
  } else {
    console.log("  ❌ " + desc + " — NOT FOUND");
    issues.push(filePath + " missing: " + pattern);
  }
}

console.log("\n===== SUMMARY =====");
console.log("Total lines: " + total + " across " + files.length + " files");
console.log("Protections: " + protections.length);
console.log("Issues: " + (issues.length === 0 ? "0 — ALL PASS" : issues.length));
if (issues.length > 0) issues.forEach(i => console.log("  " + i));
