import Stripe from 'stripe';
import { getStripeClient } from '@services/billing-service/src/billing-lib/stripe-client.js';
import { storage } from '@shared/lib/storage/storage.js';
import { PRICING_TIERS } from '@shared/pricing-config.js';

export const isDemoMode = process.env.DISABLE_EXTERNAL_API === "true";

let stripe: Stripe | null = null;

(async () => {
  stripe = await getStripeClient();
})();

export { stripe };

/**
 * Plan configurations — single source of truth: shared/pricing-config.ts
 * Use env vars to override limits for legacy deployments; defaults match pricing-config.
 */
const _starterTier = PRICING_TIERS.find(t => t.id === 'starter');
const _proTier = PRICING_TIERS.find(t => t.id === 'pro');
const _enterpriseTier = PRICING_TIERS.find(t => t.id === 'enterprise');

export const PLANS = {
  starter: {
    priceId: process.env.STRIPE_PRICE_ID_MONTHLY_49 || "price_starter",
    name: "Starter",
    price: 49.99,
    // Default to pricing-config.ts value (25,000); env var for emergency override only
    leads_limit: parseInt(process.env.LEADS_LIMIT_PLAN_49 || String(_starterTier?.leadsLimit ?? 25000)),
    voice_minutes: parseInt(process.env.VOICE_MINUTES_PLAN_49 || String(_starterTier?.voiceMinutes ?? 250)),
  },
  pro: {
    priceId: process.env.STRIPE_PRICE_ID_MONTHLY_99 || "price_pro",
    name: "Pro",
    price: 99.99,
    // Default to pricing-config.ts value (100,000)
    leads_limit: parseInt(process.env.LEADS_LIMIT_PLAN_99 || String(_proTier?.leadsLimit ?? 100000)),
    voice_minutes: parseInt(process.env.VOICE_MINUTES_PLAN_99 || String(_proTier?.voiceMinutes ?? 1000)),
  },
  enterprise: {
    priceId: process.env.STRIPE_PRICE_ID_MONTHLY_199 || "price_enterprise",
    name: "Enterprise",
    price: 199.99,
    // -1 means unlimited (matches pricing-config.ts enterprise tier)
    leads_limit: parseInt(process.env.LEADS_LIMIT_PLAN_199 || String(_enterpriseTier?.leadsLimit ?? -1)),
    voice_minutes: parseInt(process.env.VOICE_MINUTES_PLAN_199 || String(_enterpriseTier?.voiceMinutes ?? -1)),
  },
};

/**
 * Top-up catalog - Voice minutes with 90%+ profit margin
 * 
 * COST BREAKDOWN PER MINUTE:
 * - ElevenLabs voice generation: $0.006
 * - Storage + delivery (S3/Supabase): $0.002  
 * - Processing overhead (API calls): $0.002
 * Total cost: ~$0.01/minute
 * 
 * PROFIT MARGINS (90%+):
 * - 100 min: Cost $1 → Price $10 (90% margin)
 * - 300 min: Cost $3 → Price $30 (90% margin)
 * - 600 min: Cost $6 → Price $60 (90% margin)
 * - 1,200 min: Cost $12 → Price $120 (90% margin)
 */
export const TOPUPS = {
  leads_1000: {
    priceId: process.env.STRIPE_PRICE_TOPUP_LEADS_1000 || "price_leads_1000",
    type: "leads" as const,
    amount: 1000,
    price: 30,
  },
  leads_2500: {
    priceId: process.env.STRIPE_PRICE_TOPUP_LEADS_2500 || "price_leads_2500",
    type: "leads" as const,
    amount: 2500,
    price: 65,
  },
  voice_100: {
    priceId: process.env.STRIPE_PRICE_TOPUP_VOICE_100 || "price_voice_100",
    type: "voice" as const,
    amount: 100,
    price: 10,
    description: "100 minutes - $10",
  },
  voice_300: {
    priceId: process.env.STRIPE_PRICE_TOPUP_VOICE_300 || "price_voice_300",
    type: "voice" as const,
    amount: 300,
    price: 30,
    description: "300 minutes - $30",
  },
  voice_600: {
    priceId: process.env.STRIPE_PRICE_TOPUP_VOICE_600 || "price_voice_600",
    type: "voice" as const,
    amount: 600,
    price: 60,
    description: "600 minutes - $60",
  },
  voice_1200: {
    priceId: process.env.STRIPE_PRICE_TOPUP_VOICE_1200 || "price_voice_1200",
    type: "voice" as const,
    amount: 1200,
    price: 120,
    description: "1,200 minutes - $120",
  },
};

/**
 * Create Stripe customer for user
 */
export async function createStripeCustomer(
  email: string,
  name?: string,
  userId?: string
): Promise<string> {
  if (isDemoMode || !stripe) {
    return `cus_mock_${Date.now()}`;
  }

  try {
    const customer = await stripe.customers.create({
      email,
      name,
      metadata: { userId: userId || '' },
    });
    return customer.id;
  } catch (error) {
    console.error('Error creating Stripe customer:', error);
    // Return a mock ID as fallback to prevent blocking user flow if Stripe is down or keys are misconfigured,
    // but log it prominently.
    return `cus_error_fallback_${Date.now()}`;
  }
}

/**
 * Create subscription for customer
 */
export async function createSubscription(
  customerId: string,
  planKey: keyof typeof PLANS
): Promise<{ subscriptionId: string; clientSecret: string | null }> {
  if (isDemoMode) {
    return {
      subscriptionId: `sub_mock_${Date.now()}`,
      clientSecret: null,
    };
  }

  // This function is not directly used with payment links,
  // as subscription creation is handled by Stripe's checkout flow.
  // It's kept here for potential future use or if a direct subscription API is needed.
  // If it were to be used, the Stripe SDK would need to be initialized.
  return {
    subscriptionId: `sub_mock_${Date.now()}`,
    clientSecret: null,
  };
}

/**
 * Update user subscription plan
 */
export async function updateSubscriptionPlan(
  subscriptionId: string,
  newPlanKey: keyof typeof PLANS
): Promise<void> {
  if (isDemoMode) {
    return;
  }

  // This function is not directly used with payment links.
  // It's kept here for potential future use.
}

/**
 * Cancel subscription
 */
export async function cancelSubscription(subscriptionId: string): Promise<void> {
  if (isDemoMode) {
    return;
  }

  // This function is not directly used with payment links.
  // It's kept here for potential future use.
}

/**
 * Get payment link for subscription plan
 * Supports BOTH payment links (recommended) and price IDs
 */
export async function getSubscriptionPaymentLink(
  planKey: keyof typeof PLANS,
  userId: string
): Promise<string> {
  // Method 1: Payment Links (easiest - just copy from Stripe Dashboard)
  const paymentLinks = {
    starter: process.env.STRIPE_PAYMENT_LINK_STARTER,
    pro: process.env.STRIPE_PAYMENT_LINK_PRO,
    enterprise: process.env.STRIPE_PAYMENT_LINK_ENTERPRISE,
  };

  const link = paymentLinks[planKey];

  // If payment link exists, use it (preferred method)
  if (link) {
    try {
      const url = new URL(link);
      // Only allow Stripe payment links
      if (url.hostname === 'buy.stripe.com' && url.protocol === 'https:') {
        url.searchParams.set('client_reference_id', userId);
        return url.toString();
      }
    } catch (e) {
      console.error('Invalid payment link URL:', e);
    }
  }

  // Method 2: Price IDs (if your friend gave you these instead)
  // You'll need to create payment links from these price IDs in Stripe Dashboard
  const plan = PLANS[planKey];
  const priceId = plan.priceId;

  // Try to create checkout session if Stripe SDK is available and we have a valid price ID
  if (stripe && process.env.STRIPE_SECRET_KEY && priceId && priceId.startsWith('price_')) {
    try {
      console.log(`Creating Stripe checkout session for ${planKey} with price ID: ${priceId}`);
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${process.env.VITE_API_URL || 'https://audnixai.com'}/dashboard/pricing?success=true`,
        cancel_url: `${process.env.VITE_API_URL || 'https://audnixai.com'}/dashboard/pricing?cancelled=true`,
        client_reference_id: userId,
      });
      if (session.url) return session.url;
    } catch (e) {
      console.error('Stripe checkout session creation failed:', e);
    }
  }

  // Return helpful error with instructions
  throw new Error(
    `Payment link not configured for ${planKey} plan. Please add STRIPE_PAYMENT_LINK_${planKey.toUpperCase()} to your environment variables, or configure STRIPE_SECRET_KEY with valid price IDs.`
  );
}

/**
 * Get payment link for voice minutes top-up
 * Supports BOTH payment links (recommended) and price IDs
 */
export async function getTopupPaymentLink(
  topupKey: keyof typeof TOPUPS,
  userId: string
): Promise<string> {
  // Method 1: Payment Links (easiest)
  const paymentLinks = {
    voice_100: process.env.STRIPE_PAYMENT_LINK_VOICE_100,
    voice_300: process.env.STRIPE_PAYMENT_LINK_VOICE_300,
    voice_600: process.env.STRIPE_PAYMENT_LINK_VOICE_600,
    voice_1200: process.env.STRIPE_PAYMENT_LINK_VOICE_1200,
    leads_1000: process.env.STRIPE_PAYMENT_LINK_LEADS_1000,
    leads_2500: process.env.STRIPE_PAYMENT_LINK_LEADS_2500,
  };

  const link = paymentLinks[topupKey];

  // If payment link exists, use it (preferred method)
  if (link) {
    try {
      const url = new URL(link);
      // Only allow Stripe payment links
      if (url.hostname === 'buy.stripe.com' && url.protocol === 'https:') {
        url.searchParams.set('client_reference_id', userId);
        return url.toString();
      }
    } catch (e) {
      console.error('Invalid payment link URL:', e);
    }
  }

  // Method 2: Use Price IDs to create checkout session via Stripe SDK
  const topup = TOPUPS[topupKey];
  const priceId = topup.priceId;

  if (!stripe || !process.env.STRIPE_SECRET_KEY) {
    console.error('⚠️ Stripe SDK not initialized or STRIPE_SECRET_KEY missing');
    throw new Error(
      `❌ Payment processing not configured.\n\n` +
      `To enable payments:\n` +
      `1. Ensure STRIPE_SECRET_KEY is set in Replit Secrets\n` +
      `2. Create payment links: https://dashboard.stripe.com/payment-links\n` +
      `3. Add them as STRIPE_PAYMENT_LINK_${topupKey.toUpperCase()} in Replit Secrets`
    );
  }

  // Try to create a checkout session with the price ID
  try {
    console.log(`Creating checkout session with price ID: ${priceId}`);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.VITE_API_URL || 'https://audnixai.com'}/dashboard/pricing?session_id={CHECKOUT_SESSION_ID}&success=true`,
      cancel_url: `${process.env.VITE_API_URL || 'https://audnixai.com'}/dashboard/pricing?cancelled=true`,
      client_reference_id: userId,
    });

    if (!session.url) {
      throw new Error('No checkout URL returned from Stripe');
    }

    console.log(`✅ Checkout session created: ${session.id}`);
    return session.url;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Error creating checkout session: ${errorMessage}`);
    throw new Error(
      `❌ Failed to create checkout for ${topupKey}.\n\n` +
      `Error: ${errorMessage}\n\n` +
      `Ensure STRIPE_SECRET_KEY is properly configured in Replit Secrets.`
    );
  }
}

/**
 * Get plan limits for a plan key
 */
export function getPlanLimits(planKey: string): { leads_limit: number; voice_minutes: number } {
  const plan = PLANS[planKey as keyof typeof PLANS];

  if (!plan) {
    return {
      leads_limit: 500,
      voice_minutes: 0,
    };
  }

  return {
    leads_limit: plan.leads_limit,
    voice_minutes: plan.voice_minutes,
  };
}

/**
 * Process successful top-up payment
 * Adds purchased minutes/leads to user's balance in real-time
 * Records audit trail for compliance and analytics
 */
export async function processTopupSuccess(
  userId: string,
  topupType: string,
  topupAmount: number
): Promise<void> {
  console.log(`Processing top-up for user ${userId}: ${topupAmount} minutes`);

  const { storage } = await import('@shared/lib/storage/storage.js');

  // Get current user
  const user = await storage.getUserById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  // Add minutes to topup balance
  const currentTopup = user.voiceMinutesTopup || 0;
  await storage.updateUser(userId, {
    voiceMinutesTopup: currentTopup + topupAmount
  });

  // Create audit log
  await storage.createUsageTopup({
    userId,
    type: 'voice',
    amount: topupAmount,
    metadata: {
      source: 'stripe_topup',
      topupType,
      priceId: TOPUPS[topupType as keyof typeof TOPUPS]?.priceId
    }
  });

  // Send notification
  await storage.createNotification({
    userId,
    type: 'system',
    title: '✅ Top-up successful!',
    message: `+${topupAmount} voice minutes added to your account`,
    metadata: { topupAmount, topupType }
  });

  console.log(`✅ Added ${topupAmount} minutes to user ${userId}`);
}

/**
 * Create subscription checkout session
 */
export async function createSubscriptionCheckout(
  customerId: string,
  planKey: keyof typeof PLANS,
  userId: string
): Promise<{ sessionId: string; url: string }> {
  if (isDemoMode) {
    return {
      sessionId: `cs_mock_${Date.now()}`,
      url: `/dashboard?demo=true`,
    };
  }

  const paymentLink = await getSubscriptionPaymentLink(planKey, userId);
  return {
    sessionId: `cs_link_${Date.now()}`,
    url: paymentLink,
  };
}

/**
 * Create top-up checkout session
 */
export async function createTopupCheckout(
  customerId: string,
  topupKey: keyof typeof TOPUPS,
  userId: string
): Promise<{ sessionId: string; url: string }> {
  if (isDemoMode) {
    return {
      sessionId: `cs_mock_${Date.now()}`,
      url: `/dashboard?demo=true`,
    };
  }

  const paymentLink = await getTopupPaymentLink(topupKey, userId);
  return {
    sessionId: `cs_link_${Date.now()}`,
    url: paymentLink,
  };
}

/**
 * Verify webhook signature
 */
export function verifyWebhookSignature(
  payload: string | Buffer,
  signature: string
): Stripe.Event {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET not configured - rejecting webhook for security");
  }

  if (!stripe) {
    throw new Error("Stripe SDK not initialized - cannot verify webhooks");
  }

  try {
    const event = stripe.webhooks.constructEvent(
      payload,
      signature,
      webhookSecret
    );
    console.log(`✅ Webhook signature verified: ${event.type}`);
    return event;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error(`❌ Webhook signature verification failed: ${errorMessage}`);
    throw new Error(`Webhook signature verification failed: ${errorMessage}`);
  }
}





