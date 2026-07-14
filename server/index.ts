/**
 * ─── AUDNIX AI: MICROSERVICES LAUNCHER ───────────────────────────────────────
 * 
 * This is the development entry point. In production, each service runs in its 
 * own container/process via Railway.
 * 
 * To start individual services:
 *   - npm run start:api
 *   - npm run start:worker:email
 *   - npm run start:worker:orchestrator
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = process.env.NODE_ENV !== 'production';

async function launch() {
  console.log('🚀 Audnix AI Evolution: Starting Microservices...');

  if (isDev) {
    // In local dev, we might want to run everything or just the API
    // For now, let's just start the API service by default
    console.log('💡 Running in DEV mode. Starting API Service...');
    await import('@services/api-gateway/index.js');
  } else {
    // In production, server/index.ts should only be called if explicitly starting the API
    await import('@services/api-gateway/index.js');
  }
}

launch().catch(err => {
  console.error('❌ Failed to launch:', err);
  process.exit(1);
});
