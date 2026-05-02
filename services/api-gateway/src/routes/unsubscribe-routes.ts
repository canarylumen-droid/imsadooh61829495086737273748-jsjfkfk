import { Router } from 'express';
import { db } from '@shared/lib/db/db.js';
import { leads } from '@audnix/shared';
import { eq } from 'drizzle-orm';
import { storage } from '@shared/lib/storage/storage.js';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';

const router = Router();

/**
 * GET /api/unsubscribe/:leadId
 * Public unsubscribe link for outreach emails.
 */
router.get('/:leadId', async (req, res) => {
  try {
    const { leadId } = req.params;
    
    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
    
    if (!lead) {
      return res.status(404).send('<h1>Lead not found</h1><p>We could not find your subscription record.</p>');
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
      <div style="font-family: sans-serif; max-width: 500px; margin: 100px auto; text-align: center; border: 1px solid #eee; padding: 40px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.05);">
        <h1 style="color: #333;">Unsubscribed successfully</h1>
        <p style="color: #666; line-height: 1.6;">You have been removed from our outreach list for <strong>${lead.name}</strong>. You will no longer receive automated messages from us.</p>
        <hr style="margin: 30px 0; border: 0; border-top: 1px solid #eee;">
        <p style="font-size: 12px; color: #999;">Audnix Autonomous Intelligence Outreach</p>
      </div>
    `);
  } catch (error) {
    console.error('[Unsubscribe] Error:', error);
    res.status(500).send('<h1>Something went wrong</h1><p>Please try again later.</p>');
  }
});

export default router;
