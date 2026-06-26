const fs = require('fs');
const files = [
  'shared/schema.ts',
  'shared/lib/db/migrator.ts',
  'services/warmup-service/src/lib/pairing-engine.ts',
  'services/warmup-service/src/engine/seed-fleet-manager.ts',
  'services/warmup-service/src/engine/anchor-engine.ts',
  'services/warmup-service/src/engine/domain-cluster.ts',
  'services/warmup-service/src/engine/enrollment-engine.ts',
  'services/warmup-service/src/engine/pool-health-monitor.ts',
  'services/warmup-service/src/lib/provider-utils.ts',
  'services/warmup-service/src/lib/imap-stealth.ts',
  'services/warmup-service/src/workers/scheduler-worker.ts',
  'services/warmup-service/src/workers/outbound-worker.ts',
  'services/email-service/src/email/provider-reputation.ts',
  'services/email-service/src/email/reputation-monitor.ts',
  'services/warmup-service/index.ts',
];
let ok = true;
let total = 0;
for (const f of files) {
  if (!fs.existsSync(f)) { console.log('❌ MISSING: ' + f); ok = false; continue; }
  const c = fs.readFileSync(f, 'utf8');
  const lines = c.split('\n').length;
  total += lines;
  if (c.trim().length === 0) { console.log('❌ EMPTY: ' + f); ok = false; }
  else { console.log('✅ ' + f + ' (' + lines + ' lines)'); }
}
console.log('Total: ' + total + ' lines across ' + files.length + ' files');
if (!ok) process.exit(1);
