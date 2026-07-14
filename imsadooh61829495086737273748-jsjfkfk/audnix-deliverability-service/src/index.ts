import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { config } from './config.js';
import { runMigrations } from './db/client.js';
import seedRoutes from './routes/seed.routes.js';
import reputationRoutes from './routes/reputation.routes.js';
import { pollSeedInboxes } from './jobs/pollSeedInboxes.js';
import { pollPostmaster } from './jobs/pollPostmaster.js';
import { pollSNDS } from './jobs/pollSNDS.js';

const app = express();

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'],
  credentials: true,
}));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'audnix-deliverability',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.use('/seed', seedRoutes);
app.use('/reputation', reputationRoutes);

async function start() {
  console.log('[Deliverability] Running migrations...');
  runMigrations();

  cron.schedule(config.intervals.seedPoll, () => {
    pollSeedInboxes().catch(err => {
      console.error('[Cron] Seed poll failed:', err);
    });
  });
  console.log(`[Deliverability] Seed poll scheduled: ${config.intervals.seedPoll}`);

  cron.schedule(config.intervals.postmasterPoll, () => {
    pollPostmaster().catch(err => {
      console.error('[Cron] Postmaster poll failed:', err);
    });
  });
  console.log(`[Deliverability] Postmaster poll scheduled: ${config.intervals.postmasterPoll}`);

  cron.schedule(config.intervals.sndsPoll, () => {
    pollSNDS().catch(err => {
      console.error('[Cron] SNDS poll failed:', err);
    });
  });
  console.log(`[Deliverability] SNDS poll scheduled: ${config.intervals.sndsPoll}`);

  pollSeedInboxes().catch(err => {
    console.error('[Startup] Initial seed poll failed:', err);
  });

  app.listen(config.port, () => {
    console.log(`[Deliverability] Listening on port ${config.port}`);
  });
}

start().catch(err => {
  console.error('[Deliverability] Fatal:', err);
  process.exit(1);
});
