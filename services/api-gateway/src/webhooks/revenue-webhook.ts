import { Router } from 'express';
import { db } from '@shared/lib/db/db.js';
import { leads, deals, messages } from '@audnix/shared';
import { eq, and, or, sql } from 'drizzle-orm';
import { storage } from '@shared/lib/storage/storage.js';
import { wsSync } from "@shared/lib/realtime/websocket-sync.js";

const router = Router();

/**
 * Revenue Webhook
 * Handles incoming payment events from Stripe or other providers.
 * Automatically marks leads as converted and updates revenue analytics.
 */
router.post('/revenue', async (req, res) => {
  const payload = req.body;
  
  // Basic normalization for common payment providers (Stripe style)
  const email = payload.customer_email || payload.data?.object?.customer_email || payload.email;
  const amount = payload.amount || payload.data?.object?.amount || 0;
  const status = payload.status || payload.data?.object?.status || 'unknown';
  const currency = payload.currency || payload.data?.object?.currency || 'usd';

  console.log(`[RevenueWebhook] Received payment event for ${email}: ${amount} ${currency} (${status})`);

  if (!email || status !== 'succeeded') {
    return res.status(200).json({ received: true, action: 'ignored' });
  }

  try {
    // 1. Find the lead associated with this email
    const [lead] = await db.select().from(leads).where(eq(leads.email, email)).limit(1);

    if (!lead) {
      console.warn(`[RevenueWebhook] No lead found for email ${email}. Storing as unassigned revenue.`);
      // Optional: Store in a 'pending_revenue' table if needed
      return res.status(200).json({ received: true, action: 'unassigned' });
    }

    const userId = lead.userId;
    const actualAmount = amount / 100; // Assuming cents

    // 2. Update Lead Status
    await storage.updateLead(lead.id, {
      status: 'converted',
      updatedAt: new Date(),
      metadata: {
        ...(lead.metadata as any || {}),
        converted_via: 'revenue_webhook',
        converted_at: new Date().toISOString(),
        payment_amount: actualAmount,
        payment_currency: currency
      }
    });

    // 3. Find and Update/Create Deal
    const [existingDeal] = await db.select().from(deals).where(eq(deals.leadId, lead.id)).limit(1);

    if (existingDeal) {
      await db.update(deals)
        .set({
          status: 'closed_won',
          value: actualAmount,
          closedAt: new Date(),
          convertedAt: new Date()
        })
        .where(eq(deals.id, existingDeal.id));
    } else {
      await db.insert(deals).values({
        userId,
        leadId: lead.id,
        status: 'closed_won',
        value: actualAmount,
        brand: lead.company || 'Audnix Lead',
        channel: (lead.channel as any) || 'email',
        source: 'revenue_webhook',
        convertedAt: new Date(),
        closedAt: new Date()
      });
    }

    // 4. Record as a system message/log
    await storage.createMessage({
      userId,
      leadId: lead.id,
      direction: 'inbound',
      provider: 'system',
      body: `💰 Payment of ${actualAmount} ${currency.toUpperCase()} received. Deal closed as WON.`,
      metadata: {
        type: 'revenue_event',
        amount: actualAmount,
        currency
      }
    });

    // 5. Notify UI
    wsSync.notifyLeadsUpdated(userId, { leadId: lead.id, action: 'converted' });
    wsSync.notifyActivityUpdated(userId, { 
      type: 'deal_won', 
      leadName: lead.name, 
      value: actualAmount 
    });
    wsSync.broadcastToUser(userId, { type: 'stats_updated', payload: { source: 'revenue_webhook' } });

    return res.status(200).json({ received: true, action: 'converted' });
  } catch (error: any) {
    console.error(`[RevenueWebhook] Error processing revenue for ${email}:`, error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
