
import { Router } from 'express';
import { outreachEngine } from "@services/outreach-worker/workers/outreach-engine.js";
import { requireAuth, getCurrentUserId } from '../middleware/auth.js';

const router = Router();

/**
 * GET /api/admin/worker/tick
 * Manual trigger for the outreach engine (for serverless cron)
 * Protected by secret token in headers
 */
router.get('/tick', async (req, res) => {
  const secretToken = req.headers['x-worker-secret'];
  const expectedToken = process.env.WORKER_SECRET || 'audnix-internal-token-42';

  if (secretToken !== expectedToken && process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const result = await outreachEngine.tick();
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/admin/worker/status
 * Check worker health and status
 */
router.get('/status', requireAuth, async (req, res) => {
  // Only admins can see status
  // For now just allow authenticated users
  res.json({
    status: 'running',
    timestamp: new Date().toISOString(),
  });
});

export default router;
