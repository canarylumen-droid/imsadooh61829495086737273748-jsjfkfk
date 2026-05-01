import { Router, Request, Response } from "express";
import { storage } from "@shared/lib/storage/storage.js";
import { db } from "@shared/lib/db/db.js";
import { requireAuth, getCurrentUserId } from "../middleware/auth.js";
import { sql } from "drizzle-orm";

const router = Router();

interface PaymentSessionRow {
  id: number;
  user_id: string;
  stripe_session_id: string;
  plan: string;
  amount: number;
  expires_at: string;
  subscription_id: string;
  status: string;
  verified_at?: string | null;
  created_at?: string;
}

const PLAN_AMOUNTS: Record<string, number> = {
  starter: 4900, // $49
  pro: 9900,     // $99
  enterprise: 29900, // $299
};

/**
 * POST /api/payment/checkout-session
 * Create Stripe checkout session for user
 * SECURITY: Uses parameterized queries to prevent SQL injection
 */
router.post("/checkout-session", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { plan } = req.body as { plan: unknown };

    // Validate plan
    if (!plan || typeof plan !== 'string' || !PLAN_AMOUNTS[plan]) {
      res.status(400).json({ error: "Invalid plan" });
      return;
    }

    const user = await storage.getUserById(userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // For development: return a simulated session ID
    // In production with real Stripe SDK, this would call stripe.checkout.sessions.create()
    const sessionId = `cs_test_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const subscriptionId = `sub_test_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // Create payment session in database using parameterized query
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    
    await db.execute(sql`
      INSERT INTO payment_sessions 
      (user_id, stripe_session_id, plan, amount, expires_at, subscription_id, status)
      VALUES (${userId}, ${sessionId}, ${plan}, ${PLAN_AMOUNTS[plan] / 100}, ${expiresAt.toISOString()}, ${subscriptionId}, 'pending')
    `);

    console.log(`💳 Payment session created: ${sessionId} for ${user.email} (${plan})`);

    res.json({
      success: true,
      sessionId,
      subscriptionId,
      plan,
      amount: PLAN_AMOUNTS[plan] / 100,
      checkoutUrl: `https://checkout.stripe.com/pay/${sessionId}`,
    });
  } catch (error: unknown) {
    console.error("Error creating checkout session:", error);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

/**
 * POST /api/payment/verify-session
 * Verify payment session and mark user as pending approval
 * SECURITY: Uses parameterized queries to prevent SQL injection
 */
router.post("/verify-session", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { sessionId } = req.body as { sessionId: unknown };

    // Validate input
    if (!sessionId || typeof sessionId !== 'string' || sessionId.length === 0) {
      res.status(400).json({ error: "Session ID required" });
      return;
    }

    // Fetch session from database using parameterized query
    const result = await db.execute(sql`
      SELECT * FROM payment_sessions 
      WHERE stripe_session_id = ${sessionId} AND user_id = ${userId} AND status = 'pending'
      LIMIT 1
    `);

    if (!result || result.rows.length === 0) {
      res.status(404).json({ error: "Session not found or already verified" });
      return;
    }

    const session = result.rows[0] as unknown as PaymentSessionRow;

    // Check if expired
    if (new Date(session.expires_at) < new Date()) {
      await db.execute(sql`
        UPDATE payment_sessions SET status = 'expired' 
        WHERE stripe_session_id = ${sessionId}
      `);
      res.status(400).json({ error: "Payment session expired" });
      return;
    }

    // Mark session as completed using parameterized query
    await db.execute(sql`
      UPDATE payment_sessions 
      SET status = 'completed', verified_at = NOW() 
      WHERE stripe_session_id = ${sessionId}
    `);

    const user = await storage.getUserById(userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Mark user as pending approval
    await storage.updateUser(userId, {
      paymentStatus: "pending",
      pendingPaymentAmount: session.amount,
      pendingPaymentPlan: session.plan,
      pendingPaymentDate: new Date(),
    } as any);

    console.log(`✅ Payment verified: ${user.email} (${session.plan} - $${session.amount}) - Subscription ID: ${session.subscription_id}`);

    res.json({
      success: true,
      message: "Payment verified. Pending admin approval.",
      subscriptionId: session.subscription_id,
      plan: session.plan,
      amount: session.amount,
    });
  } catch (error: unknown) {
    console.error("Error verifying payment:", error);
    res.status(500).json({ error: "Failed to verify payment" });
  }
});

export { router as paymentCheckoutRouter };
