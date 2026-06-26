const fs = require("fs");

const files = {
  "outbound-worker": "services/warmup-service/src/workers/outbound-worker.ts",
  "provider-reputation": "services/email-service/src/email/provider-reputation.ts",
  "scheduler-worker": "services/warmup-service/src/workers/scheduler-worker.ts",
  "campaign-queue": "shared/lib/queues/campaign-queue.ts",
  "reply-manager": "services/email-service/src/email/reply-manager.ts",
  "pairing-engine": "services/warmup-service/src/lib/pairing-engine.ts",
  "seed-fleet-manager": "services/warmup-service/src/engine/seed-fleet-manager.ts",
};

// Check each file exists and has content
let errors = [];
for (const [name, path] of Object.entries(files)) {
  if (!fs.existsSync(path)) { errors.push("FILE MISSING: " + path); continue; }
  const content = fs.readFileSync(path, "utf8");
  const lines = content.split("\n").length;
  
  // Check for dangling references (things used but not imported)
  const imports = content.match(/import .+ from .+/g) || [];
  
  // For outbound-worker, check resetSeedFailureCount uses sql
  if (name === "outbound-worker") {
    if (!content.includes("import { sql }") && content.includes("sql`jsonb_set")) {
      errors.push("outbound-worker: resetSeedFailureCount uses sql` but sql not imported");
    }
  }
  
  // For scheduler-worker, check function references
  if (name === "scheduler-worker") {
    if (content.includes("seedFleetManager.resetSeedDailyCounters") && !content.includes("seedFleetManager")) {
      errors.push("scheduler-worker: seedFleetManager used but not imported");
    }
  }
  
  console.log((errors.length > 0 ? "⚠️ " : "OK ") + name + ": " + lines + " lines, " + imports.length + " imports");
}

if (errors.length > 0) {
  console.log("\nERRORS FOUND:");
  errors.forEach(e => console.log("  ❌ " + e));
} else {
  console.log("\n✅ No import errors detected");
}
