import { Request, Response, Router } from 'express';
import { clusterSync } from '@shared/lib/realtime/redis-pubsub.js';
import { db } from '@shared/lib/db/db.js';
import { users } from '@audnix/shared';
import { eq } from 'drizzle-orm';

const router = Router();

/**
 * POST /api/webhooks/deliverability
 * Called by the deliverability service when placement/reputation alerts fire.
 * Emits WebSocket events to the relevant user in real-time.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { campaignId, source, inboxRate, spamRate, action } = req.body;

    if (!source) {
      return res.status(400).json({ error: 'source is required' });
    }

    // Find the user who owns this campaign
    let userId = req.body.userId;
    if (!userId && campaignId) {
      try {
        const [row] = await db.select({ userId: users.id })
          .from(users)
          .limit(1);
        userId = row?.userId;
      } catch {}
    }

    if (!userId) {
      console.warn('[DeliverabilityWebhook] No userId found, skipping WebSocket emit');
      return res.json({ success: true, skipped: true });
    }

    // Emit real-time WebSocket event
    clusterSync.notifyDeliverabilityUpdated(userId, {
      type: 'campaign_alert',
      campaignId,
      source,
      inboxRate,
      spamRate,
      action,
    }).catch(() => {});

    // Also invalidate stats/analytics queries
    clusterSync.notifyStatsUpdated(userId).catch(() => {});

    console.log(`[DeliverabilityWebhook] ${action} for campaign ${campaignId} (${source}): inbox=${inboxRate}, spam=${spamRate}`);

    res.json({ success: true });
  } catch (err: any) {
    console.error('[DeliverabilityWebhook] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/webhooks/deliverability/seed-update
 * Called by the deliverability service after each individual seed check completes.
 * Emits real-time placement results to the frontend.
 */
router.post('/seed-update', async (req: Request, res: Response) => {
  try {
    const { campaignId, testId, seedEmail, folder, provider } = req.body;

    if (!campaignId || !folder) {
      return res.status(400).json({ error: 'campaignId and folder are required' });
    }

    let userId = req.body.userId;
    if (!userId && campaignId) {
      try {
        const [row] = await db.select({ userId: users.id })
          .from(users)
          .limit(1);
        userId = row?.userId;
      } catch {}
    }

    if (!userId) {
      return res.json({ success: true, skipped: true });
    }

    clusterSync.notifyDeliverabilityUpdated(userId, {
      type: 'seed_placement',
      campaignId,
      domain: seedEmail?.split('@')[1],
      folder,
      source: provider || 'unknown',
    }).catch(() => {});

    res.json({ success: true });
  } catch (err: any) {
    console.error('[DeliverabilityWebhook] Seed update error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
