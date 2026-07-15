/**
 * Internal API server for the warmup service.
 * Exposes read-only endpoints for other Audnix microservices.
 * NOT exposed to the public API gateway — only accessible on the internal network.
 */

import express from 'express';
import { db } from './db/warmup-db.js';
import { warmupSeedAccounts } from '@audnix/shared';
import { eq } from 'drizzle-orm';
import { decryptWarmupSecret } from './lib/warmup-crypto.js';

const app = express();
const PORT = parseInt(process.env.WARMUP_INTERNAL_PORT || '3101', 10);

function requireInternalAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const expected = process.env.WARMUP_API_KEY || process.env.INTERNAL_API_KEY;
  if (process.env.NODE_ENV === 'production' && !expected) {
    return res.status(503).json({ error: 'Internal API key is not configured' });
  }

  if (expected) {
    const auth = req.headers.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : req.headers['x-api-key'];
    if (token !== expected) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  next();
}

app.get('/api/internal/seed-accounts', requireInternalAuth, async (_req, res) => {
  try {
    const seeds = await db
      .select()
      .from(warmupSeedAccounts)
      .where(eq(warmupSeedAccounts.status, 'active'));

    const result = seeds.map((seed: any) => {
      const meta = (seed.metadata as any) || {};
      let imapPass = '';
      try {
        imapPass = meta.imapPass ? decryptWarmupSecret(meta.imapPass) : '';
      } catch {}

      return {
        id: seed.id,
        email: seed.email,
        provider: seed.provider,
        imapHost: meta.imapHost || '',
        imapPort: meta.imapPort || 993,
        imapUser: meta.imapUser || seed.email,
        imapPass,
      };
    }).filter((s: any) => s.imapHost && s.imapPass);

    res.json({ seeds: result, count: result.length });
  } catch (err: any) {
    console.error('[Warmup Internal] Failed to list seed accounts:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'warmup-internal' });
});

export function startWarmupInternalServer() {
  app.listen(PORT, () => {
    console.log(`[Warmup Internal] Listening on port ${PORT}`);
  });
}
