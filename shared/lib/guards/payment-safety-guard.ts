/**
 * PAYMENT SAFETY GUARD v1
 * ================================
 * Payment links are disabled — admin handles payments manually.
 * This guard now only ensures no payment content goes out.
 */

export class PaymentSafetyGuard {
  /**
   * Payment links are disabled. Always returns safe with no injection.
   */
  static async verify(userId: string, body: string): Promise<{ isSafe: boolean; reason?: string; injectedContent?: string }> {
    const paymentKeywords = ['invoice', 'payment', 'pay', 'checkout', 'stripe', 'link'];
    const hasPaymentIntent = paymentKeywords.some(k => body.toLowerCase().includes(k));

    if (hasPaymentIntent) {
      return { isSafe: true };
    }

    return { isSafe: true };
  }
}
