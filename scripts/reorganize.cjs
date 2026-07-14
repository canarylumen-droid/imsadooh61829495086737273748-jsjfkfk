const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');

// Define directory mappings (From -> To)
const moveMap = {
  // Shared
  'server/lib/analytics': 'shared/lib/analytics',
  'server/lib/integrations': 'shared/lib/integrations',
  'server/lib/notifications': 'shared/lib/notifications',
  'server/lib/providers': 'shared/lib/providers',
  'server/lib/queues': 'shared/lib/queues',
  'server/lib/workers': 'shared/lib/workers',
  'server/lib/automation': 'shared/lib/automation',
  'server/lib/calendar': 'shared/lib/calendar',
  'server/lib/channels': 'shared/lib/channels',
  'server/lib/imports': 'shared/lib/imports',
  'server/lib/media': 'shared/lib/media',
  'server/lib/scraping': 'shared/lib/scraping',
  'server/services/audit': 'shared/services/audit',

  // API Gateway
  'server/lib/auth': 'services/api-gateway/src/auth',
  'server/lib/oauth': 'services/api-gateway/src/oauth',
  'server/lib/webhooks': 'services/api-gateway/src/webhooks',
  'server/services/api': 'services/api-gateway/src/api',

  // Social Service
  'server/services/social': 'services/social-worker/src/social',

  // Billing Service
  'server/services/billing': 'services/billing-service/src/billing',
  'server/lib/billing': 'services/billing-service/src/billing-lib',

  // RAG Worker
  'server/services/knowledge': 'services/rag-worker/src/knowledge',

  // Email Service
  'server/services/email': 'services/email-service/src/email-service-core'
};

// 1. Move Directories
console.log('--- MOVING DIRECTORIES ---');
for (const [src, dest] of Object.entries(moveMap)) {
  const fullSrc = path.join(projectRoot, src);
  const fullDest = path.join(projectRoot, dest);
  
  if (fs.existsSync(fullSrc)) {
    console.log(`Moving ${src} -> ${dest}`);
    fs.mkdirSync(path.dirname(fullDest), { recursive: true });
    try {
      fs.renameSync(fullSrc, fullDest);
    } catch (e) {
      console.error(`Failed to move ${src}: ${e.message}`);
    }
  }
}

// Full mapping of old server paths to new alias paths for import replacements
const aliasMap = {
  // Shared
  'server/lib/db': '@shared/lib/db',
  'server/lib/storage': '@shared/lib/storage',
  'server/lib/redis': '@shared/lib/redis',
  'server/lib/monitoring': '@shared/lib/monitoring',
  'server/lib/utils': '@shared/lib/utils',
  'server/lib/crypto': '@shared/lib/crypto',
  'server/lib/realtime': '@shared/lib/realtime',
  'server/lib/config': '@shared/config',
  'server/lib/analytics': '@shared/lib/analytics',
  'server/lib/integrations': '@shared/lib/integrations',
  'server/lib/notifications': '@shared/lib/notifications',
  'server/lib/providers': '@shared/lib/providers',
  'server/lib/queues': '@shared/lib/queues',
  'server/lib/workers': '@shared/lib/workers',
  'server/lib/automation': '@shared/lib/automation',
  'server/lib/calendar': '@shared/lib/calendar',
  'server/lib/channels': '@shared/lib/channels',
  'server/lib/imports': '@shared/lib/imports',
  'server/lib/media': '@shared/lib/media',
  'server/lib/scraping': '@shared/lib/scraping',
  'server/services/audit': '@shared/services/audit',
  'shared/schema.js': '@audnix/shared',

  // Email Service
  'server/lib/email-bounces': '@services/email-service/src/email-bounces',
  'server/lib/email-system': '@services/email-service/src/email-system',
  'server/lib/email-templates': '@services/email-service/src/email-templates',
  'server/lib/email-warmup': '@services/email-service/src/email-warmup',
  'server/lib/email': '@services/email-service/src/email',
  'server/services/email': '@services/email-service/src/email-service-core',

  // Outreach Worker
  'server/services/outreach': '@services/outreach-worker/src/outreach',
  'server/lib/outreach': '@services/outreach-worker/src/outreach-lib',
  'server/lib/sales-engine': '@services/outreach-worker/src/sales-engine',

  // Brain Worker
  'server/services/ai': '@services/brain-worker/src/ai-service',
  'server/lib/ai': '@services/brain-worker/src/ai-lib',
  'server/services/orchestrator': '@services/brain-worker/src/orchestrator',

  // API Gateway
  'server/routes': '@services/api-gateway/src/routes',
  'server/middleware': '@services/api-gateway/src/middleware',
  'server/core': '@services/api-gateway/src/core',
  'server/lib/auth': '@services/api-gateway/src/auth',
  'server/lib/oauth': '@services/api-gateway/src/oauth',
  'server/lib/webhooks': '@services/api-gateway/src/webhooks',
  'server/services/api': '@services/api-gateway/src/api',

  // Social Service
  'server/services/social': '@services/social-worker/src/social',

  // Billing Service
  'server/services/billing': '@services/billing-service/src/billing',
  'server/lib/billing': '@services/billing-service/src/billing-lib',

  // RAG Worker
  'server/services/knowledge': '@services/rag-worker/src/knowledge',
};

function processDirectory(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      processDirectory(fullPath);
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') || entry.name.endsWith('.js')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      let originalContent = content;
      
      // Replace relative imports traversing up
      // e.g., ../../../server/lib/email -> @services/email-service/src/email
      for (const [oldPath, newAlias] of Object.entries(aliasMap)) {
        // Regex to match relative paths going up to 'server/...'
        const escapedPath = oldPath.replace(/\//g, '\\/');
        const regex = new RegExp(`(\\'|\\")(\\.\\.\\/)+${escapedPath}`, 'g');
        content = content.replace(regex, `$1${newAlias}`);
        
        // Also match absolute-like imports that started from root (less common but possible)
        const regex2 = new RegExp(`(\\'|\\")\\.\\/${escapedPath}`, 'g');
        content = content.replace(regex2, `$1${newAlias}`);
      }

      if (content !== originalContent) {
        fs.writeFileSync(fullPath, content);
      }
    }
  }
}

console.log('--- REWRITING IMPORTS ---');
processDirectory(path.join(projectRoot, 'services'));
processDirectory(path.join(projectRoot, 'shared'));
processDirectory(path.join(projectRoot, 'server'));

console.log('Done!');
