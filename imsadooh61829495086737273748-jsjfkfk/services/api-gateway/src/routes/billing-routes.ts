import { Router, Request, Response } from 'express';
import { requireAuth, getCurrentUserId } from '../middleware/auth.js';
import { getSubscriptionPaymentLink, getTopupPaymentLink, PLANS, TOPUPS } from '@services/billing-service/src/billing-lib/stripe.js';

const router = Router();

router.post('/payment-link', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { planKey } = req.body as { planKey?: string };

    if (!planKey || !PLANS[planKey as keyof typeof PLANS]) {
      res.status(400).json({ error: 'Invalid plan key' });
      return;
    }

    const url = await getSubscriptionPaymentLink(planKey as keyof typeof PLANS, userId);

    res.json({ success: true, url });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error getting payment link:', errorMessage);
    res.status(500).json({ error: errorMessage });
  }
});

router.post('/topup-link', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { topupKey } = req.body as { topupKey?: string };

    if (!topupKey || !TOPUPS[topupKey as keyof typeof TOPUPS]) {
      res.status(400).json({ error: 'Invalid topup key' });
      return;
    }

    const url = await getTopupPaymentLink(topupKey as keyof typeof TOPUPS, userId);

    res.json({ success: true, url });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error getting topup link:', errorMessage);
    res.status(500).json({ error: errorMessage });
  }
});

router.get('/plans', async (_req: Request, res: Response): Promise<void> => {
  try {
    const plans = Object.entries(PLANS).map(([key, plan]) => ({
      id: key,
      name: plan.name,
      price: plan.price,
      leadsLimit: plan.leads_limit,
      voiceMinutes: plan.voice_minutes,
    }));

    res.json({ plans });
  } catch (error: unknown) {
    console.error('Error fetching plans:', error);
    res.status(500).json({ error: 'Failed to fetch plans' });
  }
});

export default router;
