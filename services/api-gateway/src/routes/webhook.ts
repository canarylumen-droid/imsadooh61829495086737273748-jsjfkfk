import { Request, Response, Router } from 'express';
import Stripe from 'stripe';
import crypto from 'crypto';
import { stripe, verifyWebhookSignature, processTopupSuccess, PLANS } from '@services/billing-service/src/billing-lib/stripe.js';
import { storage } from '@shared/lib/storage/storage.js';
import { handleCalendlyWebhook, handleCalendlyVerification, verifyCalendlySignature } from '@services/api-gateway/src/webhooks/calendly-webhook.js';
import { handleInstagramWebhook, handleInstagramVerification } from '@services/api-gateway/src/webhooks/instagram-webhook.js';

import type { PlanType } from '@shared/types.js';


const router = Router();

interface LemonSqueezyWebhookMeta {
  event_name: string;
  custom_data?: Record<string, unknown>;
}

interface LemonSqueezyOrderAttributes {
  user_email: string;
  user_name?: string;
  product_id: string;
  variant_id: string;
  total: number;
  currency: string;
  status?: string;
}

interface LemonSqueezySubscriptionAttributes {
  user_email: string;
  status: string;
  product_id: string;
  variant_id: string;
}

interface LemonSqueezyWebhookData {
  id: string;
  attributes: LemonSqueezyOrderAttributes | LemonSqueezySubscriptionAttributes;
}

interface LemonSqueezyWebhookPayload {
  meta: LemonSqueezyWebhookMeta;
  data: LemonSqueezyWebhookData;
}

interface CheckoutSessionMetadata {
  userId?: string;
  planKey?: string;
  topupType?: string;
  topupAmount?: string;
}

/**
 * Calendly webhook handler
 */
router.post('/calendly', async (req: Request, res: Response): Promise<void> => {
  if (req.body?.webhook_used_for_testing) {
    handleCalendlyVerification(req, res);
    return;
  }

  await handleCalendlyWebhook(req, res);
});

/**
 * Fathom AI webhook handler
 */
router.post('/fathom', async (req: Request, res: Response): Promise<void> => {
  try {
    const webhookId = req.headers['webhook-id'] as string;
    const webhookTimestamp = req.headers['webhook-timestamp'] as string;
    const webhookSignature = req.headers['webhook-signature'] as string;
    const secret = process.env.FATHOM_WEBHOOK_SECRET;
    
    if (!secret || !secret.startsWith('whsec_')) {
      res.status(500).json({ error: 'Fathom webhook secret is not configured' });
      return;
    }

    if (secret.startsWith('whsec_')) {
      if (!webhookSignature || !webhookId || !webhookTimestamp) {
        res.status(401).json({ error: 'Missing fathom security headers' });
        return;
      }

      // Verify timestamp is within 5 minutes to prevent replay attacks
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - parseInt(webhookTimestamp)) > 300) {
        console.error('[Fathom Webhook] Stale timestamp detected.');
        res.status(401).json({ error: 'Stale request' });
        return;
      }
      
      const rawBody = (req as any).rawBody ? (req as any).rawBody.toString() : JSON.stringify(req.body);
      const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;
      
      // Fathom secrets are Base64 encoded after the 'whsec_' prefix
      const secretBytes = Buffer.from(secret.split('_')[1], 'base64');
      
      const expected = crypto.createHmac('sha256', secretBytes)
        .update(signedContent)
        .digest('base64');
      
      // Extract signature: Fathom/Svix format is "v1,hash"
      const parts = webhookSignature.split(',');
      const providedSig = parts[0] === 'v1' ? parts[1] : parts.find(p => p.startsWith('v1,'))?.substring(3);
        
      const expectedBuffer = Buffer.from(expected);
      const providedBuffer = Buffer.from(providedSig || '');
      if (!providedSig || expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
        console.error('[Fathom Webhook] Invalid HMAC signature detected.');
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    }

    // Fathom is disabled — call processing is handled by Calendly + manual flow
    console.log(`[Fathom Webhook] Received but disabled. Meeting: ${req.body?.data?.recording_id || req.body?.data?.id}`);
    res.json({ received: true, queued: false, disabled: true });
  } catch (error: unknown) {
    console.error('Fathom webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * Instagram webhook verification (GET request from Meta)
 * URL: /api/webhook/instagram
 */
router.get('/instagram', (req: Request, res: Response): void => {
  handleInstagramVerification(req, res);
});

/**
 * Instagram webhook handler (POST events from Meta)
 * URL: /api/webhook/instagram
 */
router.post('/instagram', async (req: Request, res: Response): Promise<void> => {
  await handleInstagramWebhook(req, res);
});

/**
 * Instagram callback verification (GET request from Meta)
 * URL: /api/instagram/callback
 * This is the Meta-required endpoint format
 */
router.get('/callback', (req: Request, res: Response): void => {
  console.log('[Instagram Callback] GET request received');
  console.log('[Instagram Callback] Query params:', req.query);
  handleInstagramVerification(req, res);
});

/**
 * Instagram callback handler (POST events from Meta)
 * URL: /api/instagram/callback
 * This is the Meta-required endpoint format
 */
router.post('/callback', async (req: Request, res: Response): Promise<void> => {
  console.log('[Instagram Callback] POST request received');
  console.log('[Instagram Callback] Body:', JSON.stringify(req.body, null, 2));
  await handleInstagramWebhook(req, res);
});

/**
 * Stripe webhook handler
 */
router.post('/stripe', async (req: Request, res: Response): Promise<void> => {
  try {
    const sig = req.headers['stripe-signature'] as string;

    if (!sig) {
      res.status(400).json({ error: 'Missing signature' });
      return;
    }

    const event = verifyWebhookSignature(
      (req as any).rawBody,
      sig
    );

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const metadata = (session.metadata || {}) as CheckoutSessionMetadata;
        const { userId, planKey, topupType } = metadata;

        if (!userId) {
          console.error('No userId in session metadata');
          res.status(400).json({ error: 'Missing userId' });
          return;
        }

        if (topupType) {
          const topupAmount = metadata.topupAmount;
          await processTopupSuccess(userId, topupType, parseInt(topupAmount || '0'));
        } else if (planKey) {
          const plan = PLANS[planKey as keyof typeof PLANS];
          if (!plan) {
            console.error('Invalid planKey:', planKey);
            res.status(400).json({ error: 'Invalid plan' });
            return;
          }

          const stripeCustomerId = typeof session.customer === 'string'
            ? session.customer
            : (session.customer as Stripe.Customer | Stripe.DeletedCustomer | null)?.id ?? undefined;
          const stripeSubscriptionId = typeof session.subscription === 'string'
            ? session.subscription
            : (session.subscription as Stripe.Subscription | null)?.id ?? undefined;

          await storage.updateUser(userId, {
            plan: planKey as PlanType,
            stripeCustomerId,
            stripeSubscriptionId,
            trialExpiresAt: null,
          });

          console.log(`✓ User ${userId} upgraded to ${planKey} plan - features unlocked`);

          const planNames: Record<string, string> = {
            starter: 'Starter ($49)',
            pro: 'Pro ($99)',
            enterprise: 'Enterprise ($199)',
          };

          await storage.createPayment({
            userId,
            stripePaymentId: (session.payment_intent as string) ?? undefined,
            amount: session.amount_total || 0,
            currency: session.currency || 'usd',
            status: 'completed',
            plan: planKey,
            paymentLink: session.url ?? undefined,
            webhookPayload: event as any,
          });

          await storage.createNotification({
            userId,
            type: 'system',
            title: `Upgraded to ${planNames[planKey] || planKey} Plan`,
            message: `Congratulations! Your payment was successful and you've been upgraded to the ${planNames[planKey] || planKey} plan. All premium features are now unlocked.`,
            actionUrl: '/dashboard',
            metadata: { plan: planKey, upgrade: true },
          });
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = typeof subscription.customer === 'string'
          ? subscription.customer
          : (subscription.customer as Stripe.Customer).id;
        const userId = await getUserIdFromStripeCustomer(customerId);

        if (userId) {
          const status = subscription.status;
          const planId = getPlanFromSubscription(subscription);

          await storage.updateUser(userId, {
            plan: status === 'active' ? planId as PlanType : 'trial',
          });
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = typeof subscription.customer === 'string'
          ? subscription.customer
          : (subscription.customer as Stripe.Customer).id;
        const userId = await getUserIdFromStripeCustomer(customerId);

        if (userId) {
          await storage.updateUser(userId, {
            plan: 'trial',
            stripeSubscriptionId: null,
            trialExpiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          });
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = typeof invoice.customer === 'string'
          ? invoice.customer
          : (invoice.customer as Stripe.Customer)?.id;

        if (customerId) {
          const userId = await getUserIdFromStripeCustomer(customerId);

          if (userId) {
            await storage.createNotification({
              userId,
              type: 'billing_issue',
              title: 'Payment Failed',
              message: 'Your payment failed. Please update your payment method to continue using premium features.',
              actionUrl: '/dashboard/pricing',
            });
          }
        }
        break;
      }
    }

    res.json({ received: true });
  } catch (error: unknown) {
    console.error('Webhook error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (errorMessage.includes('signature') || errorMessage.includes('STRIPE_WEBHOOK_SECRET')) {
      res.status(400).json({ error: 'Webhook signature verification failed' });
      return;
    }
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * Lemon Squeezy webhook handler
 */
router.post('/lemonsqueezy', async (req: Request, res: Response): Promise<void> => {
  try {
    const signature = req.headers['x-signature'] as string;
    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;

    if (!signature || !secret) {
      res.status(400).json({ error: 'Missing signature or secret' });
      return;
    }

    const hash = crypto
      .createHmac('sha256', secret)
      .update((req as any).rawBody)
      .digest('hex');

    if (hash !== signature) {
      res.status(400).json({ error: 'Invalid signature' });
      return;
    }

    const payload = req.body as LemonSqueezyWebhookPayload;
    const { meta, data } = payload;
    const eventName = meta.event_name;

    switch (eventName) {
      case 'order_created': {
        const attributes = data.attributes as LemonSqueezyOrderAttributes;
        const { user_email, product_id, variant_id } = attributes;

        const user = await storage.getUserByEmail(user_email);
        if (!user) {
          console.error('User not found:', user_email);
          res.status(404).json({ error: 'User not found' });
          return;
        }

        const plan = mapLemonSqueezyToPlan(product_id, variant_id);

        await storage.updateUser(user.id, {
          plan: plan as PlanType,
          trialExpiresAt: null,
        });

        await storage.createPayment({
          userId: user.id,
          stripePaymentId: data.id,
          amount: attributes.total,
          currency: attributes.currency,
          status: 'completed',
          plan: plan,
          webhookPayload: req.body,
        });
        break;
      }

      case 'subscription_created':
      case 'subscription_updated': {
        const attributes = data.attributes as LemonSqueezySubscriptionAttributes;
        const { user_email, status, product_id, variant_id } = attributes;

        const user = await storage.getUserByEmail(user_email);
        if (!user) break;

        const plan = mapLemonSqueezyToPlan(product_id, variant_id);

        await storage.updateUser(user.id, {
          plan: status === 'active' ? plan as PlanType : 'trial',
        });
        break;
      }

      case 'subscription_cancelled': {
        const attributes = data.attributes as LemonSqueezySubscriptionAttributes;
        const { user_email } = attributes;

        const user = await storage.getUserByEmail(user_email);
        if (!user) break;

        await storage.updateUser(user.id, {
          plan: 'trial',
          trialExpiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        });
        break;
      }
    }

    res.json({ received: true });
  } catch (error: unknown) {
    console.error('Lemon Squeezy webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * Generic payment webhook (for custom integrations)
 */
router.post('/payment', async (req: Request, res: Response): Promise<void> => {
  try {
    const { provider } = req.query;

    if (provider === 'stripe') {
      req.url = '/stripe';
      return;
    } else if (provider === 'lemonsqueezy') {
      req.url = '/lemonsqueezy';
      return;
    } else {
      res.status(400).json({ error: 'Unknown payment provider' });
      return;
    }
  } catch (error: unknown) {
    console.error('Payment webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

async function getUserIdFromStripeCustomer(customerId: string): Promise<string | null> {
  try {
    const user = await storage.getUserByStripeCustomerId(customerId);
    return user?.id || null;
  } catch (error: unknown) {
    console.error('Error finding user by Stripe customer ID:', error);
    return null;
  }
}

function getPlanFromSubscription(subscription: Stripe.Subscription): string {
  const priceId = subscription.items.data[0]?.price.id;
  const priceToPlan: Record<string, string> = {
    [process.env.STRIPE_STARTER_PRICE_ID || '']: 'starter',
    [process.env.STRIPE_PRO_PRICE_ID || '']: 'pro',
    [process.env.STRIPE_ENTERPRISE_PRICE_ID || '']: 'enterprise',
  };

  return priceToPlan[priceId] || 'trial';
}

function mapLemonSqueezyToPlan(productId: string, variantId: string): string {
  const mapping: Record<string, string> = {
    [process.env.LEMONSQUEEZY_STARTER_VARIANT_ID || '']: 'starter',
    [process.env.LEMONSQUEEZY_PRO_VARIANT_ID || '']: 'pro',
    [process.env.LEMONSQUEEZY_ENTERPRISE_VARIANT_ID || '']: 'enterprise',
  };

  return mapping[`${productId}_${variantId}`] || 'trial';
}

/**
 * Gmail Pub/Sub push notification handler
 */
router.post('/google/push', async (req: Request, res: Response) => {
  try {
    const message = req.body.message;
    if (!message || !message.data) {
      return res.status(400).send('Invalid Pub/Sub message');
    }

    const decoded = JSON.parse(Buffer.from(message.data, 'base64').toString());
    const { PushNotificationService } = await import('@services/email-service/src/email/push-notification-service.js');
    
    await PushNotificationService.handleGmailPush(decoded);
    res.status(200).send('OK');
  } catch (error) {
    console.error('[Webhooks] Gmail push failed:', error);
    res.status(500).send('Error');
  }
});

/**
 * Outlook Graph API push notification handler
 */
router.post('/outlook/push', async (req: Request, res: Response) => {
  try {
    // Handle validation request
    if (req.query.validationToken) {
      return res.status(200).send(req.query.validationToken);
    }

    const notifications = req.body.value || [];
    const { PushNotificationService } = await import('@services/email-service/src/email/push-notification-service.js');

    for (const notification of notifications) {
      const clientState = notification.clientState;
      // In a production app, verify clientState here to prevent spoofing
      
      const resourceData = notification.resourceData;
      if (resourceData && resourceData.id) {
          // Outlook notifications don't always include userId directly, 
          // we might need to look it up or rely on the clientState to store userId
          // For simplicity, we assume we find the user by looking at active subscriptions 
          const subId = notification.subscriptionId;
          const user = await storage.getUserByOutlookSubscriptionId(subId);
          
          if (user) {
              await PushNotificationService.handleOutlookPush(user.id, resourceData.id);
          }
      }
    }

    res.status(202).send('Accepted');
  } catch (error) {
    console.error('[Webhooks] Outlook push failed:', error);
    res.status(500).send('Error');
  }
});

export default router;

