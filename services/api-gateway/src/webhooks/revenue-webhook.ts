import { Router } from 'express';
import { db } from '@shared/lib/db/db.js';
import { leads, deals, messages, pendingPayments, notifications, auditTrail, campaignLeads } from '@audnix/shared';
import { eq, and, or, sql, inArray } from 'drizzle-orm';
import { storage } from '@shared/lib/storage/storage.js';
import { wsSync } from "@shared/lib/realtime/websocket-sync.js";

const router = Router();

/**
 * Enterprise Revenue Webhook
 * Handles incoming payment events (Stripe, etc.) and CLOSES the loop.
 */
router.post('/revenue', async (req, res) => {
  const payload = req.body;
  
  // Normalized extraction (Supports Stripe checkout.session.completed)
  const email = payload.customer_email || payload.data?.object?.customer_email || payload.email || payload.data?.object?.receipt_email;
  const amount = payload.amount || payload.data?.object?.amount_total || payload.data?.object?.amount || 0;
  const status = payload.status || payload.data?.object?.status || payload.data?.object?.payment_status || 'unknown';
  const currency = payload.currency || payload.data?.object?.currency || 'usd';
  const metadata = payload.metadata || payload.data?.object?.metadata || {};

  console.log(`[RevenueWebhook] 💰 Payment incoming for ${email}: ${amount} ${currency} (${status})`);

  // Only process successful payments
  if (!email || (status !== 'succeeded' && status !== 'paid' && status !== 'complete')) {
    return res.status(200).json({ received: true, action: 'ignored' });
  }

  try {
    const [lead] = await db.select().from(leads).where(eq(leads.email, email)).limit(1);

    if (!lead) {
      console.warn(`[RevenueWebhook] ⚠️ No lead found for email ${email}. Revenue is unassigned.`);
      return res.status(200).json({ received: true, action: 'unassigned' });
    }

    const userId = lead.userId;
    const actualAmount = amount / 100; // Normalizing cents to dollars

    // START ENTERPRISE CLOSING TRANSACTION
    await db.transaction(async (tx) => {
      // 1. Update Lead Status (The "Shield")
      await tx.update(leads).set({
        status: 'converted',
        aiPaused: true, // INSTANT KILL-SWITCH for all AI activity
        updatedAt: new Date(),
        metadata: {
          ...(lead.metadata as any || {}),
          converted_via: 'revenue_webhook',
          payment_amount: actualAmount,
          payment_currency: currency,
          stripe_session_id: payload.id || payload.data?.object?.id
        }
      }).where(eq(leads.id, lead.id));

      // 2. Clear all Pending Payments (The "Double-Payment Prevention")
      await tx.update(pendingPayments).set({
        status: 'paid',
        updatedAt: new Date()
      }).where(and(eq(pendingPayments.leadId, lead.id), eq(pendingPayments.status, 'pending')));

      // 3. Abort Active Campaigns (The "Inbox Safety")
      await tx.update(campaignLeads).set({
        status: 'aborted',
        updatedAt: new Date()
      }).where(and(eq(campaignLeads.leadId, lead.id), inArray(campaignLeads.status, ['pending', 'sent', 'queued'])));

      // 4. Update Deal Pipeline
      const [existingDeal] = await tx.select().from(deals).where(eq(deals.leadId, lead.id)).limit(1);
      if (existingDeal) {
        await tx.update(deals).set({
          status: 'closed_won',
          value: actualAmount,
          closedAt: new Date(),
          convertedAt: new Date()
        }).where(eq(deals.id, existingDeal.id));
      } else {
        await tx.insert(deals).values({
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

      // 5. Log to Audit Trail & Notifications
      await tx.insert(auditTrail).values({
        userId,
        leadId: lead.id,
        action: 'payment_received',
        details: { amount: actualAmount, currency, provider: 'stripe' }
      });

      await tx.insert(notifications).values({
        userId,
        type: 'conversion',
        title: '💰 Revenue Received!',
        message: `${lead.name} just paid $${actualAmount}. All outreach paused.`,
        metadata: { leadId: lead.id, amount: actualAmount }
      });
    });

    // Notify UI via WebSockets
    wsSync.notifyLeadsUpdated(userId, { leadId: lead.id, action: 'converted' });
    wsSync.notifyDealsUpdated(userId);
    wsSync.notifyActivityUpdated(userId, { type: 'deal_won', leadName: lead.name, value: actualAmount });

    console.log(`[RevenueWebhook] ✅ Lead ${lead.email} successfully converted and campaigns aborted.`);
    return res.status(200).json({ received: true, action: 'converted' });

  } catch (error: any) {
    console.error(`[RevenueWebhook] 🚨 Critical failure processing revenue for ${email}:`, error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
