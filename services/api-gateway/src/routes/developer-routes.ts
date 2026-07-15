import { Router, Request, Response } from 'express';
import { requireAuth, getCurrentUserId } from '../middleware/auth.js';
import { developerLimiter } from '../middleware/rate-limit.js';
import { db } from '@shared/lib/db/db.js';
import { sql } from 'drizzle-orm';
import crypto from 'crypto';
import {
  scheduleUserDeletion,
  cancelUserDeletion,
  getPendingDeletion,
} from '@shared/lib/queues/deletion-queue.js';

const router = Router();

// Ensure scope column exists (safe for existing DBs)
async function ensureScopeColumn() {
  try {
    await db.execute(sql`
      ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'read_write'
    `);
  } catch {}
}
ensureScopeColumn();

// Apply rate limiter to all developer routes
router.use(developerLimiter);

// ─── List API Keys ──────────────────────────────────────────────────────
router.get('/api-keys', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return; }

    const result = await db.execute(sql`
      SELECT id, name, scope, key, last_used_at, expires_at, created_at
      FROM api_keys
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
    `);

    const keys = result.rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      scope: row.scope || 'read_write',
      // Show only first 8 + last 4 chars
      key: `audnix_${row.key.substring(0, 6)}...${row.key.substring(row.key.length - 4)}`,
      lastUsedAt: row.last_used_at?.toISOString() || null,
      expiresAt: row.expires_at?.toISOString() || null,
      createdAt: row.created_at?.toISOString() || null,
    }));

    res.json(keys);
  } catch (error) {
    console.error('Error fetching API keys:', error);
    res.status(500).json({ error: 'Failed to fetch API keys' });
  }
});

// ─── Create API Key ─────────────────────────────────────────────────────
router.post('/api-keys', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return; }

    const { name, scope } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'API key name is required' });
      return;
    }

    const keyScope = scope === 'read_only' ? 'read_only' : 'read_write';

    const rawKey = `audnix_${crypto.randomBytes(32).toString('hex')}`;
    const hashedKey = crypto.createHash('sha256').update(rawKey).digest('hex');

    await db.execute(sql`
      INSERT INTO api_keys (user_id, name, key, scope)
      VALUES (${userId}, ${name.trim()}, ${hashedKey}, ${keyScope})
    `);

    const result = await db.execute(sql`
      SELECT id, name, scope, key, created_at
      FROM api_keys
      WHERE key = ${hashedKey}
    `);

    const created = result.rows[0] as any;

    res.status(201).json({
      id: created.id,
      name: created.name,
      scope: created.scope || 'read_write',
      key: rawKey,
      createdAt: created.created_at?.toISOString() || null,
      message: 'Make sure to copy your API key now. You won\'t be able to see it again.',
    });
  } catch (error) {
    console.error('Error creating API key:', error);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

// ─── Edit API Key Name ──────────────────────────────────────────────────
router.patch('/api-keys/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return; }

    const { id } = req.params;
    const { name } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'Key name is required' });
      return;
    }

    await db.execute(sql`
      UPDATE api_keys SET name = ${name.trim()} WHERE id = ${id} AND user_id = ${userId}
    `);

    res.json({ success: true, message: 'API key name updated.' });
  } catch (error) {
    console.error('Error updating API key:', error);
    res.status(500).json({ error: 'Failed to update API key' });
  }
});

// ─── Delete API Key ─────────────────────────────────────────────────────
router.delete('/api-keys/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return; }

    const { id } = req.params;
    await db.execute(sql`
      DELETE FROM api_keys WHERE id = ${id} AND user_id = ${userId}
    `);

    res.json({ success: true, message: 'API key permanently deleted. Any services using this key will lose access immediately.' });
  } catch (error) {
    console.error('Error deleting API key:', error);
    res.status(500).json({ error: 'Failed to delete API key' });
  }
});

// ─── Check Key Leak / Exposure Status ──────────────────────────────────
// Informs user if their key has been found in known leak databases.
// For now, returns last known scan info. A real implementation would
// integrate with services like GitGuardian or HaveIBeenPwned.
router.get('/api-keys/:id/security', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return; }

    const { id } = req.params;
    const result = await db.execute(sql`
      SELECT id, name, last_used_at, created_at FROM api_keys WHERE id = ${id} AND user_id = ${userId}
    `);

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'API key not found' });
      return;
    }

    const key = result.rows[0] as any;

    res.json({
      id: key.id,
      name: key.name,
      lastUsedAt: key.last_used_at?.toISOString() || null,
      createdAt: key.created_at?.toISOString() || null,
      exposed: false, // Would be populated by leak scanning service
      lastScannedAt: null,
      recommendation: 'Rotate keys regularly. If you suspect exposure, delete and recreate immediately.',
    });
  } catch (error) {
    console.error('Error checking key security:', error);
    res.status(500).json({ error: 'Failed to check key security status.' });
  }
});

// ─── Account Deletion ──────────────────────────────────────────────────
router.post('/request-deletion', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return; }

    const existing = await getPendingDeletion(userId);
    if (existing) {
      res.status(409).json({
        error: 'Deletion already requested',
        scheduledFor: existing.scheduledFor,
        remainingMs: existing.remainingMs,
      });
      return;
    }

    const jobId = await scheduleUserDeletion(userId);
    if (!jobId) {
      res.status(503).json({ error: 'Deletion queue unavailable. Try again later.' });
      return;
    }

    const pending = await getPendingDeletion(userId);

    res.json({
      success: true,
      message: 'Account deletion scheduled. You have 24-48 hours to cancel before permanent deletion.',
      jobId,
      scheduledFor: pending?.scheduledFor || null,
      remainingMs: pending?.remainingMs || null,
    });
  } catch (error) {
    console.error('Error requesting deletion:', error);
    res.status(500).json({ error: 'Failed to schedule deletion' });
  }
});

router.post('/cancel-deletion', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return; }

    const cancelled = await cancelUserDeletion(userId);
    if (!cancelled) {
      res.status(404).json({ error: 'No pending deletion found.' });
      return;
    }

    res.json({ success: true, message: 'Deletion request cancelled. Your account is safe.' });
  } catch (error) {
    console.error('Error cancelling deletion:', error);
    res.status(500).json({ error: 'Failed to cancel deletion' });
  }
});

router.get('/deletion-status', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return; }

    const pending = await getPendingDeletion(userId);
    if (!pending) {
      res.json({ pending: false });
      return;
    }

    res.json({
      pending: true,
      scheduledFor: pending.scheduledFor,
      remainingMs: pending.remainingMs,
    });
  } catch (error) {
    console.error('Error checking deletion status:', error);
    res.status(500).json({ error: 'Failed to check deletion status' });
  }
});

export default router;
