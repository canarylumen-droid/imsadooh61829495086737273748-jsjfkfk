
import { Router } from 'express';
import { outreachEngine } from "@services/outreach-worker/workers/outreach-engine.js";
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { workerHealthMonitor } from '@shared/lib/monitoring/worker-health.js';

const router = Router();

/**
 * GET /api/admin/worker/tick
 * Manual trigger for the outreach engine (for serverless cron)
 * Protected by secret token in headers
 */
router.get('/tick', async (req, res) => {
  const secretToken = req.headers['x-worker-secret'];
  const expectedToken = process.env.WORKER_SECRET;

  if (!expectedToken) {
    console.error('[WorkerRoutes] WORKER_SECRET env var is not set — tick endpoint disabled.');
    return res.status(503).json({ error: 'Worker secret not configured' });
  }

  if (secretToken !== expectedToken) {
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
router.get('/status', requireAdmin, async (req, res) => {
  const health = workerHealthMonitor.getDetailedStatus();
  res.json({
    ...health,
    timestamp: new Date().toISOString(),
  });
});

export default router;
