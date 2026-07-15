import type { Express, Request, Response } from 'express';
import { statsService } from '@shared/lib/analytics/stats-service.js';
import { requireAuthOrApiKey } from '../middleware/auth.js';

/**
 * Phase 14: Analytics & KPI Dashboard Routes
 *
 * GET  /api/analytics/stats        – Fetch KPI stats for the last 30 days
 * GET  /api/analytics/stats?start=&end=  – Custom date range
 * POST /api/analytics/persist      – Manually persist an insights snapshot
 */
export function registerAnalyticsRoutes(app: Express): void {
  // GET /api/analytics/stats
  app.get('/api/analytics/stats', requireAuthOrApiKey, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id || (req as any).session?.userId;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const startDate = req.query.start ? new Date(req.query.start as string) : undefined;
      const endDate   = req.query.end   ? new Date(req.query.end   as string) : undefined;

      const stats = await statsService.getKPIStats(userId, { startDate, endDate });
      return res.json({ ok: true, data: stats });
    } catch (err: any) {
      console.error('[Analytics] getKPIStats error:', err);
      return res.status(500).json({ error: 'Failed to calculate analytics stats', details: err.message });
    }
  });

  // POST /api/analytics/persist – Persist current stats as an insights snapshot
  app.post('/api/analytics/persist', requireAuthOrApiKey, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id || (req as any).session?.userId;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      await statsService.persistInsights(userId);
      return res.json({ ok: true, message: 'Insights snapshot saved' });
    } catch (err: any) {
      console.error('[Analytics] persistInsights error:', err);
      return res.status(500).json({ error: 'Failed to persist insights', details: err.message });
    }
  });
}
