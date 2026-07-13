import { Queue } from 'bullmq';
import { redisConnection, hasRedis } from './redis-config.js';

interface BillingJobData {
  type: 'pending-payment' | 'checkout-session' | 'stripe-webhook';
  paymentId?: string;
  data?: any;
}

/**
 * Dedicated queue for billing and checkout operations.
 * Separation from campaign-engine prevents billing delays during high-volume outreach.
 */
export const billingQueue = hasRedis ? new Queue<BillingJobData>('audnix-billing', {
  connection: redisConnection as any,
  defaultJobOptions: {
    attempts: 5, // High retry count for financial operations
    backoff: {
      type: 'exponential',
      delay: 60000, // 1 minute base delay
    },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  }
}) : null;

/**
 * Helper to queue a checkout email dispatch.
 */
export async function queueCheckoutDispatch(paymentId: string) {
  if (!billingQueue) {
    console.warn('[BillingQueue] Redis unavailable. Falling back to immediate execution.');
    // Dynamic import to avoid circular dependencies
    const { checkoutWorker } = await import('@services/billing-service/src/billing/workers/checkout-worker.js');
    return checkoutWorker.processPendingPayment(paymentId);
  }

  return billingQueue.add(`checkout_${paymentId}`, {
    type: 'pending-payment',
    paymentId
  });
}
