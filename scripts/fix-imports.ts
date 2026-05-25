import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const replacements = [
  { p: /['"](?:\.\.\/)+lib\/storage\/storage\.js['"]/g, r: "'@shared/lib/storage/storage.js'" },
  { p: /['"](?:\.\.\/)+storage\/storage\.js['"]/g, r: "'@shared/lib/storage/storage.js'" },
  { p: /['"](?:\.\.\/)+lib\/storage\/blob-storage\.js['"]/g, r: "'@shared/lib/storage/blob-storage.js'" },
  { p: /['"](?:\.\.\/)+lib\/db\/db\.js['"]/g, r: "'@shared/lib/db/db.js'" },
  { p: /['"](?:\.\.\/)+db\/db\.js['"]/g, r: "'@shared/lib/db/db.js'" },
  { p: /['"](?:\.\.\/)+lib\/redis\/redis\.js['"]/g, r: "'@shared/lib/redis/redis.js'" },
  { p: /['"](?:\.\.\/)+redis\/redis\.js['"]/g, r: "'@shared/lib/redis/redis.js'" },
  { p: /['"](?:\.\.\/)+lib\/redis\/brand-pdf-storage\.js['"]/g, r: "'@shared/lib/redis/brand-pdf-storage.js'" },
  { p: /['"](?:\.\.\/)+lib\/queues\/redis-config\.js['"]/g, r: "'@shared/lib/queues/redis-config.js'" },
  { p: /['"](?:\.\.\/)+lib\/queues\/outreach-queue\.js['"]/g, r: "'@shared/lib/queues/outreach-queue.js'" },
  { p: /['"](?:\.\.\/)+lib\/realtime\/websocket-sync\.js['"]/g, r: "'@shared/lib/realtime/websocket-sync.js'" },
  { p: /['"](?:\.\.\/)+lib\/realtime\/socket-service\.js['"]/g, r: "'@shared/lib/realtime/socket-service.js'" },
  { p: /['"](?:\.\.\/)+realtime\/websocket-sync\.js['"]/g, r: "'@shared/lib/realtime/websocket-sync.js'" },
  { p: /['"](?:\.\.\/)+realtime\/socket-service\.js['"]/g, r: "'@shared/lib/realtime/socket-service.js'" },
  { p: /['"](?:\.\.\/)+lib\/crypto\/encryption\.js['"]/g, r: "'@shared/lib/crypto/encryption.js'" },
  { p: /['"](?:\.\.\/)+crypto\/encryption\.js['"]/g, r: "'@shared/lib/crypto/encryption.js'" },
  { p: /['"](?:\.\.\/)+lib\/ai\/core\/ai-service\.js['"]/g, r: "'@shared/lib/ai/core/ai-service.js'" },
  { p: /['"](?:\.\.\/)+lib\/ai\/core\/conversation-ai\.js['"]/g, r: "'@services/brain-worker/src/ai-lib/core/conversation-ai.js'" },
  { p: /['"](?:\.\.\/)+lib\/ai\/core\/follow-up-worker\.js['"]/g, r: "'@services/brain-worker/src/ai-lib/core/follow-up-worker.js'" },
  { p: /['"](?:\.\.\/)+lib\/ai\/formatters\/smart-replies\.js['"]/g, r: "'@services/brain-worker/src/ai-lib/formatters/smart-replies.js'" },
  { p: /['"](?:\.\.\/)+lib\/ai\/engines\/lead-scoring\.js['"]/g, r: "'@services/brain-worker/lead-scoring.js'" },
  { p: /['"](?:\.\.\/)+lib\/ai\/engines\/analytics-engine\.js['"]/g, r: "'@services/brain-worker/src/ai-lib/engines/analytics-engine.js'" },
  { p: /['"](?:\.\.\/)+lib\/ai\/engines\/deal-evaluator\.js['"]/g, r: "'@services/brain-worker/src/ai-lib/engines/deal-evaluator.js'" },
  { p: /['"](?:\.\.\/)+lib\/ai\/analyzers\/competitor-detection\.js['"]/g, r: "'@services/brain-worker/src/ai-lib/analyzers/competitor-detection.js'" },
  { p: /['"](?:\.\.\/)+lib\/ai\/specialized\/price-negotiation\.js['"]/g, r: "'@services/brain-worker/src/ai-lib/specialized/price-negotiation.js'" },
  { p: /['"](?:\.\.\/)+lib\/ai\/analyzers\/comment-detection\.js['"]/g, r: "'@services/brain-worker/src/ai-lib/analyzers/comment-detection.js'" },
  { p: /['"](?:\.\.\/)+lib\/ai\/utils\/csv-mapper\.js['"]/g, r: "'@shared/lib/imports/csv-mapper.js'" },
  { p: /['"](?:\.\.\/)+lib\/ai\/utils\/body-parser\.js['"]/g, r: "'@shared/lib/ai/utils/body-parser.js'" },
  { p: /['"](?:\.\.\/)+lib\/ai\/utils\/model-config\.js['"]/g, r: "'@shared/lib/ai/utils/model-config.js'" },
  { p: /['"](?:\.\.\/)+lib\/ai\/context\/personality-learner\.js['"]/g, r: "'@services/brain-worker/src/ai-lib/context/personality-learner.js'" },
  { p: /['"](?:\.\.\/)+lib\/ai\/context\/vector-search\.js['"]/g, r: "'@services/brain-worker/src/ai-lib/context/vector-search.js'" },
  { p: /['"](?:\.\.\/)+lib\/email\/imap-idle-manager\.js['"]/g, r: "'@services/email-service/src/email/imap-idle-manager.js'" },
  { p: /['"](?:\.\.\/)+lib\/email\/email-sync-worker\.js['"]/g, r: "'@services/email-service/src/email/email-sync-worker.js'" },
  { p: /['"](?:\.\.\/)+lib\/email\/dns-verification\.js['"]/g, r: "'@services/email-service/src/email/dns-verification.js'" },
  { p: /['"](?:\.\.\/)+lib\/email\/bounce-handler\.js['"]/g, r: "'@services/email-service/src/email/bounce-handler.js'" },
  { p: /['"](?:\.\.\/)+lib\/email\/smtp-abuse-protection\.js['"]/g, r: "'@services/email-service/src/email/smtp-abuse-protection.js'" },
  { p: /['"](?:\.\.\/)+lib\/email\/email-warmup-worker\.js['"]/g, r: "'@services/email-service/src/email/email-warmup-worker.js'" },
  { p: /['"](?:\.\.\/)+lib\/email\/email-tracking\.js['"]/g, r: "'@services/email-service/src/email/email-tracking.js'" },
  { p: /['"](?:\.\.\/)+lib\/email\/reputation-monitor\.js['"]/g, r: "'@services/email-service/src/email/reputation-monitor.js'" },
  { p: /['"](?:\.\.\/)+lib\/email\/email-discovery\.js['"]/g, r: "'@services/email-service/src/email/email-discovery.js'" },
  { p: /['"](?:\.\.\/)+lib\/channels\/email\.js['"]/g, r: "'@shared/lib/channels/email.js'" },
  { p: /['"](?:\.\.\/)+lib\/channels\/instagram\.js['"]/g, r: "'@shared/lib/providers/instagram.js'" },
  { p: /['"](?:\.\.\/)+lib\/auth\/twilio-email-otp\.js['"]/g, r: "'@services/api-gateway/src/auth/twilio-email-otp.js'" },
  { p: /['"](?:\.\.\/)+email\/otp-templates\.js['"]/g, r: "'@shared/lib/notifications/otp-templates.js'" },
  { p: /['"](?:\.\.\/)+lib\/oauth\/gmail\.js['"]/g, r: "'@services/api-gateway/src/oauth/gmail.js'" },
  { p: /['"](?:\.\.\/)+lib\/oauth\/calendly\.js['"]/g, r: "'@services/api-gateway/src/oauth/calendly.js'" },
  { p: /['"](?:\.\.\/)+lib\/oauth\/google-calendar\.js['"]/g, r: "'@services/api-gateway/src/oauth/google-calendar.js'" },
  { p: /['"](?:\.\.\/)+lib\/oauth\/instagram\.js['"]/g, r: "'@services/api-gateway/src/oauth/instagram.js'" },
  { p: /['"](?:\.\.\/)+lib\/calendar\/calendly\.js['"]/g, r: "'@services/api-gateway/src/oauth/calendly.js'" },
  { p: /['"](?:\.\.\/)+lib\/calendar\/google-calendar\.js['"]/g, r: "'@shared/lib/calendar/google-calendar.js'" },
  { p: /['"](?:\.\.\/)+lib\/calendar\/calendar-booking\.js['"]/g, r: "'@shared/lib/calendar/calendar-booking.js'" },
  { p: /['"](?:\.\.\/)+config\/oauth-redirects\.js['"]/g, r: "'@shared/config/config/oauth-redirects.js'" },
  { p: /['"](?:\.\.\/)+lib\/monitoring\/worker-health\.js['"]/g, r: "'@shared/lib/monitoring/worker-health.js'" },
  { p: /['"](?:\.\.\/)+lib\/monitoring\/quota-service\.js['"]/g, r: "'@shared/lib/monitoring/quota-service.js'" },
  { p: /['"](?:\.\.\/)+monitoring\/worker-health\.js['"]/g, r: "'@shared/lib/monitoring/worker-health.js'" },
  { p: /['"](?:\.\.\/)+monitoring\/quota-service\.js['"]/g, r: "'@shared/lib/monitoring/quota-service.js'" },
  { p: /['"](?:\.\.\/)+lib\/analytics\/stats-service\.js['"]/g, r: "'@shared/lib/analytics/stats-service.js'" },
  { p: /['"](?:\.\.\/)+lib\/billing\/stripe\.js['"]/g, r: "'@shared/lib/billing/stripe.js'" },
  { p: /['"](?:\.\.\/)+lib\/sales-engine\/outreach-engine\.js['"]/g, r: "'@services/outreach-worker/src/sales-engine/outreach-engine.js'" },
  { p: /['"](?:\.\.\/)+services\/outreach\/workers\/outreach-engine\.js['"]/g, r: "'@services/outreach-worker/src/sales-engine/outreach-engine.js'" },
  { p: /['"](?:\.\.\/)+lib\/outreach\/outreach-runner\.js['"]/g, r: "'@services/outreach-worker/src/outreach-lib/outreach-runner.js'" },
  { p: /['"](?:\.\.\/)+services\/ai\/workers\/lead-enrichment-worker\.js['"]/g, r: "'@services/brain-worker/workers/lead-enrichment-worker.js'" },
  { p: /['"](?:\.\.\/)+services\/orchestrator\/agents\/universal-sales-agent\.js['"]/g, r: "'@services/brain-worker/src/orchestrator/agents/universal-sales-agent.js'" },
  { p: /['"](?:\.\.\/)+services\/orchestrator\/agents\/universal-sales-agent-integrated\.js['"]/g, r: "'@services/brain-worker/src/orchestrator/agents/universal-sales-agent-integrated.js'" },
  { p: /['"](?:\.\.\/)+lib\/imports\/lead-importer\.js['"]/g, r: "'@shared/lib/imports/lead-importer.js'" },
  { p: /['"](?:\.\.\/)+lib\/imports\/paged-email-importer\.js['"]/g, r: "'@shared/lib/imports/paged-email-importer.js'" },
  { p: /['"](?:\.\.\/)+lib\/scraping\/email-verifier\.js['"]/g, r: "'@shared/lib/scraping/email-verifier.js'" },
  { p: /['"](?:\.\.\/)+lib\/media\/pdf-processor\.js['"]/g, r: "'@shared/lib/media/pdf-processor.js'" },
  { p: /['"](?:\.\.\/)+lib\/utils\/validation\.js['"]/g, r: "'@shared/lib/utils/validation.js'" },
  { p: /['"](?:\.\.\/)+shared\/types\.js['"]/g, r: "'@shared/types.js'" },
  { p: /['"](?:\.\.\/)+core\/logger\.js['"]/g, r: "'@shared/lib/logger.js'" },
  { p: /['"](?:\.\.\/)+lib\/queues\/redis-config\.js['"]/g, r: "'@shared/lib/queues/redis-config.js'" },
];

function walk(dir: string, callback: (filePath: string) => void) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).forEach((f) => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    if (isDirectory) {
      if (!['node_modules', 'dist', '.git'].includes(f)) {
        walk(dirPath, callback);
      }
    } else {
      if (f.endsWith('.ts') || f.endsWith('.tsx')) {
        callback(path.join(dir, f));
      }
    }
  });
}

console.log('🚀 Starting depth-agnostic import path fix...');

let filesFixed = 0;
let totalReplacements = 0;

const scanDirs = ['services', 'server', 'scripts', 'shared'];

scanDirs.forEach(dir => {
  const fullPath = path.join(projectRoot, dir);
  walk(fullPath, (filePath) => {
    let content = fs.readFileSync(filePath, 'utf8');
    let originalContent = content;
    let fileReplacements = 0;

    replacements.forEach(({ p, r }) => {
      const matches = content.match(p);
      if (matches) {
        content = content.replace(p, r);
        fileReplacements += matches.length;
      }
    });

    if (content !== originalContent) {
      fs.writeFileSync(filePath, content, 'utf8');
      filesFixed++;
      totalReplacements += fileReplacements;
      console.log(`✅ FIXED ${fileReplacements} import(s) in: ${path.relative(projectRoot, filePath)}`);
    }
  });
});

console.log(`\n✨ Done! Fixed ${totalReplacements} imports across ${filesFixed} files.`);
