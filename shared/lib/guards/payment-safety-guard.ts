/**
 * PAYMENT SAFETY GUARD v1
 * ================================
 * Prevents the AI from sending broken or missing payment links.
 * Checks the user's organization/settings for a valid Stripe/Payment URL.
 */

import { storage } from '@shared/lib/storage/storage.js';

export class PaymentSafetyGuard {
  /**
   * Checks if a message contains payment intent and verifies/injects the link.
   */
  static async verify(userId: string, body: string): Promise<{ isSafe: boolean; reason?: string; injectedContent?: string }> {
    const paymentKeywords = ['invoice', 'payment', 'pay', 'checkout', 'stripe', 'link'];
    const hasPaymentIntent = paymentKeywords.some(k => body.toLowerCase().includes(k));

    if (!hasPaymentIntent) return { isSafe: true };

    const user = await storage.getUser(userId);
    const org = (user as any)?.organizationId ? await storage.getOrganization((user as any).organizationId) : null;
    
    // Check for common link patterns in the body
    const hasLink = body.includes('http://') || body.includes('https://');
    const defaultLink = (org?.metadata as any)?.defaultPaymentLink || (user?.metadata as any)?.defaultPaymentLink;

    if (hasPaymentIntent && !hasLink) {
      if (!defaultLink) {
        return { 
          isSafe: false, 
          reason: "Message mentions payment but no payment link is configured in settings." 
        };
      }

      // AUTONOMOUS INJECTION: Add the link to the end of the message
      const injectedContent = body.trim() + `\n\nYou can complete the checkout here: ${defaultLink}`;
      return { 
        isSafe: true, 
        injectedContent 
      };
    }

    return { isSafe: true };
  }
}
