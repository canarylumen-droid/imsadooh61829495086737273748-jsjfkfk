/**
 * PAYMENT SAFETY GUARD v1
 * ================================
 * Prevents the AI from sending broken or missing payment links.
 * Checks the user's organization/settings for a valid Stripe/Payment URL.
 */

import { storage } from '@shared/lib/storage/storage.js';

function isValidHttpUrl(raw: string | undefined | null): boolean {
  if (!raw) return false;
  try {
    const u = new URL(String(raw).trim());
    return (u.protocol === 'http:' || u.protocol === 'https:');
  } catch {
    return false;
  }
}

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
    
    // Check for common link patterns in the body (simple detection)
    const hasLink = /https?:\/\//i.test(body);
    const defaultLink = (org?.metadata as any)?.defaultPaymentLink || (user?.metadata as any)?.defaultPaymentLink;

    if (hasPaymentIntent && !hasLink) {
      // Validate configured default link before injecting
      if (!defaultLink || !isValidHttpUrl(defaultLink)) {
        return { 
          isSafe: false, 
          reason: "Message mentions payment but no valid payment link is configured in settings." 
        };
      }

      // AUTONOMOUS INJECTION: Add the sanitized link to the end of the message
      const injectedContent = body.trim() + `\n\nYou can complete the checkout here: ${String(defaultLink).trim()}`;
      return { 
        isSafe: true, 
        injectedContent 
      };
    }

    return { isSafe: true };
  }
}
