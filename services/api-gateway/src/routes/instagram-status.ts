import { Router, Request, Response } from 'express';
import { requireAuthOrApiKey, getCurrentUserId } from '../middleware/auth.js';
import { storage } from '@shared/lib/storage/storage.js';
import { db } from '@shared/lib/db/db.js';
import { sql } from 'drizzle-orm';

const router = Router();

let lastWebhookEvent: Date | null = null;
let webhookEventCount = 0;

export function recordWebhookEvent(): void {
  lastWebhookEvent = new Date();
  webhookEventCount++;
}

export function getWebhookStats(): { lastEvent: Date | null; eventCount: number } {
  return { lastEvent: lastWebhookEvent, eventCount: webhookEventCount };
}

router.get('/status', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    
    const integration = await storage.getIntegration(userId, 'instagram');
    
    if (!integration || !integration.connected) {
      res.json({
        connected: false,
        webhook: 'inactive',
        message: 'Instagram not connected',
      });
      return;
    }
    
    const webhookStats = getWebhookStats();
    
    let tokenStatus = 'unknown';
    let tokenExpiry: Date | null = null;
    
    try {
      const meta = JSON.parse(integration.encryptedMeta || '{}');
      if (meta.expiresAt) {
        tokenExpiry = new Date(meta.expiresAt);
        const now = new Date();
        if (tokenExpiry < now) {
          tokenStatus = 'expired';
        } else if (tokenExpiry.getTime() - now.getTime() < 7 * 24 * 60 * 60 * 1000) {
          tokenStatus = 'expiring_soon';
        } else {
          tokenStatus = 'valid';
        }
      }
    } catch (e) {
      console.error('Failed to parse integration meta:', e);
    }
    
    let recentEvents: any[] = [];
    try {
      const result = await db.execute(sql`
        SELECT event_type, payload, created_at
        FROM instagram_webhook_logs
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
        LIMIT 10
      `);
      recentEvents = result.rows as any[];
    } catch (e) {
    }
    
    res.json({
      connected: true,
      webhook: webhookStats.lastEvent ? 'active' : 'pending',
      subscriptions: ['messages', 'messaging_postbacks', 'messaging_referral', 'messaging_seen', 'comments'],
      fields: ['message', 'message_reactions', 'message_reads', 'comments', 'live_comments'],
      lastEvent: webhookStats.lastEvent?.toISOString() || null,
      eventCount: webhookStats.eventCount,
      tokenStatus,
      tokenExpiry: tokenExpiry?.toISOString() || null,
      recentEvents,
      callbackUrl: `${process.env.BASE_URL || 'https://audnixai.com'}/api/instagram/callback`,
    });
  } catch (error: any) {
    console.error('Error getting Instagram status:', error);
    res.status(500).json({ 
      error: 'Failed to get Instagram status',
      message: error.message,
    });
  }
});

router.post('/test-webhook', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    recordWebhookEvent();
    
    res.json({
      success: true,
      message: 'Test webhook event recorded',
      lastEvent: lastWebhookEvent?.toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
