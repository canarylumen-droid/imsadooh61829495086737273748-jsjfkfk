import { Router, Request, Response } from "express";
import { storage } from "@shared/lib/storage/storage.js";
import { requireAuthOrApiKey, getCurrentUserId } from "../middleware/auth.js";
import { db } from "@shared/lib/db/db.js";
import { pendingPayments, leads, auditTrail } from "@audnix/shared";
import { eq, and } from "drizzle-orm";
import { wsSync } from "@shared/lib/realtime/websocket-sync.js";

const router = Router();

/**
 * GET /api/pending-payments
 * Fetch all pending payments for the current user.
 */
router.get("/", requireAuthOrApiKey, async (req: Request, res: Response) => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const payments = await storage.getPendingPayments(userId);
    // Lead data is already joined inside storage.getPendingPayments — no second loop needed
    res.json(payments);
  } catch (error: any) {
    console.error("Error fetching pending payments:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/pending-payments/:id/link
 * Update the custom payment link for a specific payment.
 */
router.patch("/:id/link", requireAuthOrApiKey, async (req: Request, res: Response) => {
  try {
    const userId = getCurrentUserId(req);
    const { id } = req.params;
    const { link } = req.body;

    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!link) return res.status(400).json({ error: "Link is required" });

    const payment = await storage.getPendingPayment(id);
    if (!payment || payment.userId !== userId) {
      return res.status(404).json({ error: "Payment not found" });
    }

    const updated = await storage.updatePendingPayment(id, { 
      customPaymentLink: link
      // Status intentionally NOT reset — updating the link does not invalidate a previously dispatched email
    });

    res.json(updated);
  } catch (error: any) {
    console.error("Error updating payment link:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/pending-payments/:id/confirm
 * Manually confirm a payment was received.
 * This triggers the conversion logic and unpauses campaigns.
 */
router.post("/:id/confirm", requireAuthOrApiKey, async (req: Request, res: Response) => {
  try {
    const userId = getCurrentUserId(req);
    const { id } = req.params;

    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const payment = await storage.getPendingPayment(id);
    if (!payment || payment.userId !== userId) {
      return res.status(404).json({ error: "Payment not found" });
    }

    if (payment.status === 'paid') {
      return res.status(400).json({ error: "Payment already confirmed." });
    }

    // 1. Update Payment Status
    const updatedPayment = await storage.updatePendingPayment(id, {
      status: 'paid',
      updatedAt: new Date()
    });

    // 2. Update Lead Status & Unpause AI
    const lead = await storage.getLeadById(payment.leadId);
    if (lead) {
      await storage.updateLead(lead.id, {
        status: 'converted',
        aiPaused: false, // UNPAUSE AI as requested
        updatedAt: new Date()
      });

      // 3. Abort active campaigns for this lead (Safety Layer)
      const { campaignLeads } = await import("@audnix/shared");
      await db.update(campaignLeads)
        .set({ status: 'aborted', updatedAt: new Date() })
        .where(eq(campaignLeads.leadId, lead.id));

      // 4. Create Audit Trail
      await storage.createAuditLog({
        userId,
        leadId: lead.id,
        action: 'payment_confirmed_manual',
        details: { 
          paymentId: id, 
          amount: payment.amountDetected,
          fathomMeetingId: payment.fathomMeetingId
        }
      });

      // 5. Notify Frontend
      wsSync.notifyLeadsUpdated(userId, { event: 'UPDATE', leadId: lead.id });
    }

    res.json({ success: true, payment: updatedPayment });
  } catch (error: any) {
    console.error("Error confirming payment:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/pending-payments/:id/resend
 * Manually trigger the checkout email again.
 */
router.post("/:id/resend", requireAuthOrApiKey, async (req: Request, res: Response) => {
  try {
    const userId = getCurrentUserId(req);
    const { id } = req.params;

    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { checkoutWorker } = await import("@services/billing-service/src/billing/workers/checkout-worker.js");
    const success = await checkoutWorker.processPendingPayment(id);

    if (success) {
      res.json({ success: true, message: "Checkout email resent successfully." });
    } else {
      res.status(500).json({ error: "Failed to resend checkout email. Check your default payment link settings." });
    }
  } catch (error: any) {
    console.error("Error resending checkout email:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;

