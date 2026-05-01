import { Router, Request, Response } from 'express';
import Stripe from 'stripe';

const router = Router();

const stripeApiKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeApiKey ? new Stripe(stripeApiKey, {
  apiVersion: '2024-06-20' as Stripe.LatestApiVersion,
}) : null;

router.post('/confirm-payment', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!stripe) {
      res.status(503).json({ error: 'Stripe not configured' });
      return;
    }

    const { sessionId } = req.body as { sessionId?: string; subscriptionId?: string };

    if (!sessionId) {
      res.status(400).json({ error: 'Session ID required' });
      return;
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (session.payment_status !== 'paid') {
      res.status(400).json({
        success: false,
        message: 'Payment not completed',
        status: session.payment_status,
      });
      return;
    }

    let subscription: Stripe.Subscription | null = null;
    if (session.subscription) {
      subscription = await stripe.subscriptions.retrieve(session.subscription as string);
    }

    res.json({
      success: true,
      paymentStatus: session.payment_status,
      subscription: subscription ? {
        id: subscription.id,
        status: subscription.status,
        currentPeriodEnd: (subscription as any).current_period_end ?? null,
        items: subscription.items.data.map((item: Stripe.SubscriptionItem) => ({
          priceId: item.price.id,
          product: item.price.product,
          amount: item.price.unit_amount,
          currency: item.price.currency,
        })),
      } : null,
      customerEmail: session.customer_details?.email,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Confirmation failed';
    console.error('Payment confirmation error:', error);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

router.post('/verify-subscription', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!stripe) {
      res.status(503).json({ error: 'Stripe not configured' });
      return;
    }

    const { subscriptionId } = req.body as { subscriptionId?: string };

    if (!subscriptionId) {
      res.status(400).json({ error: 'Subscription ID required' });
      return;
    }

    const subscription = await stripe.subscriptions.retrieve(subscriptionId);

    res.json({
      success: true,
      id: subscription.id,
      status: subscription.status,
      currentPeriodEnd: new Date(((subscription as any).current_period_end ?? 0) * 1000),
      plan: subscription.items.data[0]?.price?.nickname,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Verification failed';
    console.error('Subscription verification error:', error);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

router.post('/admin/bypass-check', async (req: Request, res: Response): Promise<void> => {
  try {
    if (!stripe) {
      res.status(503).json({ error: 'Stripe not configured' });
      return;
    }

    const { sessionId, expectedAmount } = req.body as { sessionId?: string; expectedAmount?: number };

    if (!sessionId) {
      res.status(400).json({ error: 'Session ID required' });
      return;
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const amountMismatch = expectedAmount && session.amount_total !== expectedAmount * 100;

    const fraudIndicators = {
      paymentStatusNotPaid: session.payment_status !== 'paid',
      amountMismatch,
      noCustomer: !session.customer_details?.email,
      sessionExpired: new Date(session.created * 1000).getTime() < Date.now() - 24 * 60 * 60 * 1000,
    };

    const isFraudulent = Object.values(fraudIndicators).some((v): boolean => Boolean(v));

    res.json({
      success: true,
      legitimate: !isFraudulent,
      fraudIndicators,
      sessionDetails: {
        id: session.id,
        paymentStatus: session.payment_status,
        amount: (session.amount_total ?? 0) / 100,
        currency: session.currency,
        customer: session.customer_details?.email,
        createdAt: new Date(session.created * 1000),
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Bypass check failed';
    console.error('Bypass check error:', error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

export default router;
