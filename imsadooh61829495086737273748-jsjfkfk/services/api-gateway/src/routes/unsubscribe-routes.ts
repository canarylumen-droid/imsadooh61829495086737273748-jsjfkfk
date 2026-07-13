import { Router } from 'express';
import { db } from '@shared/lib/db/db.js';
import { leads } from '@audnix/shared';
import { eq } from 'drizzle-orm';
import { storage } from '@shared/lib/storage/storage.js';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';

const router = Router();

router.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Unsubscribe API is operational. Use GET /api/unsubscribe/:leadId to unsubscribe a lead.' });
});

/**
 * GET /api/unsubscribe/:leadId
 * Public unsubscribe link for outreach emails.
 */
router.get('/:leadId', async (req, res) => {
  try {
    const { leadId } = req.params;
    
    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
    
    if (!lead) {
      return res.status(200).send(`
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 100px auto; text-align: center; padding: 40px; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.06);">
          <div style="font-size: 48px; margin-bottom: 16px;">🔍</div>
          <h1 style="color: #1a1a2e; font-size: 24px; margin: 0 0 8px;">Already Unsubscribed</h1>
          <p style="color: #666; line-height: 1.6; margin: 0;">You're already removed from our list. No further action needed.</p>
        </div>
      `);
    }

    if (lead.status === 'unsubscribed') {
      return res.send(`
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 100px auto; text-align: center; padding: 40px; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.06);">
          <div style="font-size: 48px; margin-bottom: 16px;">✅</div>
          <h1 style="color: #1a1a2e; font-size: 24px; margin: 0 0 8px;">Already Unsubscribed</h1>
          <p style="color: #666; line-height: 1.6; margin: 0;">You're already removed from <strong>${lead.name}</strong>'s list.</p>
        </div>
      `);
    }

    // Update lead status to unsubscribed
    await storage.updateLead(leadId, { 
      status: 'unsubscribed', 
      metadata: { 
        ...lead.metadata, 
        unsubscribedAt: new Date().toISOString(),
        unsubscribeSource: 'public_link'
      } 
    });

    // Notify user
    wsSync.notifyLeadsUpdated(lead.userId, { leadId, status: 'unsubscribed' });

    res.send(`
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 100px auto; text-align: center; padding: 40px; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.06);">
        <div style="font-size: 48px; margin-bottom: 16px;">✅</div>
        <h1 style="color: #1a1a2e; font-size: 24px; margin: 0 0 8px;">Unsubscribed</h1>
        <p style="color: #666; line-height: 1.6; margin: 0 0 24px;">You've been removed from <strong>${lead.name}</strong>'s outreach list. No more automated messages.</p>
        <hr style="margin: 24px 0; border: 0; border-top: 1px solid #eee;">
        <p style="font-size: 12px; color: #999;">✨ Audnix AI — Autonomous Intelligence Outreach</p>
      </div>
    `);
  } catch (error) {
    console.error('[Unsubscribe] Error:', error);
    res.status(500).send('<h1>Something went wrong</h1><p>Please try again later.</p>');
  }
});

export default router;
