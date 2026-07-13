import { Router, Request, Response } from 'express';
import { followUpWorker } from '@services/brain-worker/src/ai-lib/core/follow-up-worker.js';
import { requireAuth, requireAdmin, getCurrentUserId } from '../middleware/auth.js';
import { db } from '@shared/lib/db/db.js';
import { followUpQueue, leads } from '@audnix/shared';
import { eq, and, gte, sql } from 'drizzle-orm';

const router = Router();

/**
 * Start the follow-up worker
 */
router.post('/worker/start', requireAdmin, async (req: Request, res: Response) => {
  try {
    followUpWorker.start();
    res.json({
      success: true,
      message: 'Follow-up worker started successfully'
    });
  } catch (error) {
    console.error('Error starting worker:', error);
    res.status(500).json({ error: 'Failed to start worker' });
  }
});

/**
 * Stop the follow-up worker
 */
router.post('/worker/stop', requireAdmin, async (req: Request, res: Response) => {
  try {
    followUpWorker.stop();
    res.json({
      success: true,
      message: 'Follow-up worker stopped successfully'
    });
  } catch (error) {
    console.error('Error stopping worker:', error);
    res.status(500).json({ error: 'Failed to stop worker' });
  }
});

/**
 * Get worker status
 */
router.get('/worker/status', async (req: Request, res: Response) => {
  try {
    const isRunning = (followUpWorker as any).isRunning || false;

    // Get queue statistics from Neon database
    let queueStats = null;
    if (db) {
      try {
        const pendingRows = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(followUpQueue)
          .where(eq(followUpQueue.status, 'pending'));
        const { count: pendingCount } = pendingRows?.[0] || { count: 0 };

        const processingRows = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(followUpQueue)
          .where(eq(followUpQueue.status, 'processing'));
        const { count: processingCount } = processingRows?.[0] || { count: 0 };

        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const completedRows = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(followUpQueue)
          .where(
            and(
              eq(followUpQueue.status, 'completed'),
              gte(followUpQueue.processedAt, oneDayAgo)
            )
          );
        const { count: completedCount } = completedRows?.[0] || { count: 0 };

        queueStats = {
          pending: pendingCount || 0,
          processing: processingCount || 0,
          completedLast24h: completedCount || 0,
        };
      } catch (error) {
        console.error('Error fetching queue stats:', error);
        queueStats = {
          pending: 0,
          processing: 0,
          completedLast24h: 0,
        };
      }
    }

    res.json({
      isRunning,
      queueStats,
      message: isRunning ? 'Worker is running' : 'Worker is stopped'
    });
  } catch (error) {
    console.error('Error getting worker status:', error);
    res.status(500).json({ error: 'Failed to get worker status' });
  }
});

/**
 * Manually trigger follow-up for a specific lead
 */
router.post('/worker/trigger/:leadId', requireAuth, async (req: Request, res: Response) => {
  try {
    const { leadId } = req.params;
    const userId = getCurrentUserId(req);

    if (!userId || !leadId || !db) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    // Get lead details from Neon
    const [lead] = await db
      .select()
      .from(leads)
      .where(
        and(
          eq(leads.id, leadId),
          eq(leads.userId, userId)
        )
      )
      .limit(1);

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    // Create follow-up job in Neon
    await db.insert(followUpQueue).values({
      userId,
      leadId,
      channel: lead.channel as "email" | "instagram",
      scheduledAt: new Date(),
      context: {
        manual_trigger: true,
        triggered_by: userId,
      }
    });

    res.json({
      success: true,
      message: 'Follow-up scheduled successfully'
    });
  } catch (error) {
    console.error('Error triggering follow-up:', error);
    res.status(500).json({ error: 'Failed to trigger follow-up' });
  }
});

/**
 * Manually process the queue (useful for Vercel Crons)
 */
router.post('/worker/process', async (req: Request, res: Response) => {
  try {
    // Basic auth check or secret check
    const secret = req.headers['x-cron-secret'];
    if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('🤖 [Cron] Manually triggering follow-up queue processing...');
    await followUpWorker.processQueue();

    res.json({
      success: true,
      message: 'Queue processing triggered'
    });
  } catch (error) {
    console.error('Error processing queue:', error);
    res.status(500).json({ error: 'Failed to process queue' });
  }
});


/**
 * GET /api/worker/outreach/tick
 * Manual trigger for the outreach engine (for serverless cron)
 */
router.get('/outreach/tick', async (req: Request, res: Response) => {
  const secretToken = req.headers['x-worker-secret'];
  const expectedToken = process.env.WORKER_SECRET;

  if (!expectedToken) {
    console.error('[WorkerRoutes] WORKER_SECRET env var is not set — outreach tick disabled.');
    return res.status(503).json({ error: 'Worker secret not configured' });
  }

  if (secretToken !== expectedToken) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const { outreachEngine } = await import("@services/outreach-worker/workers/outreach-engine.js");
    const result = await outreachEngine.tick();
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

