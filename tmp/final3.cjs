const fs = require("fs");

const allFixes = [
  // 1. Per-provider campaign system
  ["provider-reputation.ts", "canSendToProvider"],
  ["provider-reputation.ts", "detectProviderGroup"],
  ["provider-reputation.ts", "recordProviderOutcome"],
  ["provider-reputation.ts", "recalculateProviderReputation"],
  ["provider-reputation.ts", "resetProviderDailyCounters"],
  ["provider-reputation.ts", "FLOOR_LIMIT = 1"],
  ["provider-reputation.ts", "CEILING_LIMIT = 50"],
  ["provider-reputation.ts", "RECOVERY_RATE = 2"],
  ["provider-reputation.ts", "jsonb_set"],
  ["provider-reputation.ts", "PROVIDER_GROUPS"],
  // 2. Campaign queue integration
  ["campaign-queue.ts", "canSendToProvider(integrationId, lead.email, false,"],
  ["campaign-queue.ts", "recordProviderOutcome(integrationId, lead.email"],
  ["campaign-queue.ts", "shouldYieldInitialSends"],
  ["campaign-queue.ts", "providerCheck.allowed"],
  ["campaign-queue.ts", "processFollowUp"],
  ["campaign-queue.ts", "hardCeiling"], 
  ["campaign-queue.ts", "scheduleFollowUp"],
  // 3. Bounce tracking
  ["bounce-handler.ts", "recordProviderOutcome(integrationId, event.email"],
  ["bounce-handler.ts", "event.bounceType === 'spam'"],
  // 4. Warmup seed system
  ["seed-fleet-manager.ts", "handleSeedFailure"],
  ["seed-fleet-manager.ts", "incrementSeedSentCount"],
  ["seed-fleet-manager.ts", "resetSeedDailyCounters"],
  ["seed-fleet-manager.ts", "assignSeedToDomainWithFallback"],
  ["seed-fleet-manager.ts", "verifySeedConnection"],
  ["seed-fleet-manager.ts", "testSmtp"],
  // 5. Outbound worker
  ["outbound-worker.ts", "seedFailCount"],
  ["outbound-worker.ts", "newFailCount >= 3"],
  ["outbound-worker.ts", "isRateLimit"],
  ["outbound-worker.ts", "anchorRole === 'seed'"],
  // 6. Scheduler
  ["scheduler-worker.ts", "BATCH_SIZE"],
  ["scheduler-worker.ts", "seedFleetManager.resetSeedDailyCounters"],
  ["scheduler-worker.ts", "isSeed"],
  // 7. Pairing engine
  ["pairing-engine.ts", "batchCountActiveThreads"],
  ["pairing-engine.ts", "leftJoin(integrations"],
  ["pairing-engine.ts", "getGroupPairingScore"],
  // 8. Domain clustering
  ["domain-cluster.ts", "extractRegisteredDomain"],
  ["enrollment-engine.ts", "autoAssignAnchorRoles"],
  // 9. Email service
  ["email-service/index.ts", "recalculateProviderReputation"],
  ["email-service/index.ts", "resetProviderDailyCounters"],
  ["email-service/index.ts", "PROVIDER_REPUTATION_INTERVAL"],
  // 10. Auto-reply + reply manager
  ["reply-manager.ts", "handleIncomingEmail"],
  ["reply-manager.ts", "generateAiReply"],
  ["reply-manager.ts", "MAX_AUTO_REPLIES_PER_LEAD = 3"],
  ["reply-manager.ts", "recentReplies"],
  ["mailbox-coordinator.ts", "shouldYieldInitialSends"],
  ["mailbox-coordinator.ts", "recordIncomingReply"],
  ["ai-reply-generator.ts", "generateAiReply"],
];

const paths = {
  "provider-reputation.ts": "services/email-service/src/email/provider-reputation.ts",
  "campaign-queue.ts": "shared/lib/queues/campaign-queue.ts",
  "bounce-handler.ts": "services/email-service/src/email/bounce-handler.ts",
  "seed-fleet-manager.ts": "services/warmup-service/src/engine/seed-fleet-manager.ts",
  "outbound-worker.ts": "services/warmup-service/src/workers/outbound-worker.ts",
  "scheduler-worker.ts": "services/warmup-service/src/workers/scheduler-worker.ts",
  "pairing-engine.ts": "services/warmup-service/src/lib/pairing-engine.ts",
  "domain-cluster.ts": "services/warmup-service/src/engine/domain-cluster.ts",
  "enrollment-engine.ts": "services/warmup-service/src/engine/enrollment-engine.ts",
  "email-service/index.ts": "services/email-service/index.ts",
  "reply-manager.ts": "services/email-service/src/email/reply-manager.ts",
  "mailbox-coordinator.ts": "services/email-service/src/email/mailbox-coordinator.ts",
  "ai-reply-generator.ts": "services/email-service/src/email/ai-reply-generator.ts",
};

let found = 0;
let missing = 0;
for (const [file, pattern] of allFixes) {
  const fullPath = paths[file];
  if (!fullPath || !fs.existsSync(fullPath)) { missing++; continue; }
  if (fs.readFileSync(fullPath, "utf8").includes(pattern)) { found++; }
  else { console.log("MISSING: " + pattern + " in " + file); missing++; }
}
console.log("Total checks: " + allFixes.length);
console.log("Found: " + found + ", Missing: " + missing);
console.log(missing === 0 ? "✅ ALL 44 CHECKS PASS" : "⚠️ " + missing + " MISSING");
