import { NGA1_CHECKLIST } from "./nga1-checklist.js";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  reasoning?: string;
}

/**
 * NGA-1 SAFETY GUARD
 * Programmatically enforces non-negotiable rules from the NGA-1 checklist.
 */
export class SafetyGuard {
  /**
   * Validates AI output against NGA-1 non-negotiables.
   */
  static validate(text: string, context: { channel: string; isEmail: boolean }): ValidationResult {
    const errors: string[] = [];

    // 1. Zero Hallucination: Check for placeholder leaks
    const placeholderRegex = /<[^>]+>|\[[^\]]+\]|\{\{[^\}]+\}\}/g;
    const matches = text.match(placeholderRegex);
    if (matches) {
      errors.push(`Hallucination detected: Leaked placeholders found: ${matches.join(', ')}`);
    }

    // 2. Unsubscribe Check (for Emails)
    if (context.isEmail) {
      const hasUnsubscribePlaceholder = text.includes('{{unsubscribe_link}}') || text.includes('{{{unsubscribe_link}}}') || text.includes('unsubscribe_link');
      const hasUnsubscribeHtml = /<a[^>]*href=["'][^"']*unsubscribe[^"']*["'][^>]*>/i.test(text) || /unsubscribe|opt out|stop receiving/i.test(text);
      
      if (!hasUnsubscribePlaceholder && !hasUnsubscribeHtml) {
        errors.push("Compliance error: Missing mandatory unsubscribe link/placeholder in email body.");
      }
    }

    // 3. Never Fake: Check for common "fake" patterns mentioned in NGA-1
    const fakePatterns = [
      /in your city/i,
      /visiting your office/i,
      /just passed by/i,
      /fake-invoice/i,
      /mock-calendar/i
    ];
    for (const pattern of fakePatterns) {
      if (pattern.test(text)) {
        errors.push(`Safety error: Detected potentially fake/hallucinated claim matching pattern ${pattern}`);
      }
    }

    // 4. Payment Link Rule: Never LLM-generate payment links.
    // If we see anything looking like a payment URL that wasn't injected via variables.
    const paymentUrlPattern = /stripe\.com|paypal\.me|buy\.stripe\.com|checkout\.stripe\.com/i;
    if (paymentUrlPattern.test(text)) {
        // This is a simplified check. In a production system, we'd compare against known valid links.
        // For now, we flag it if it's not a placeholder that should have been replaced.
        if (!text.includes('payment_link')) {
            // If it's a raw link that doesn't look like our official ones, block it.
            errors.push("Safety error: Detected a raw payment link that was not properly injected via settings. Blocked to prevent hallucinated billing.");
        }
    }

    // 5. Niche Awareness: Check if the text sounds like generic marketing.
    const genericMarketingPhrases = [
      /cutting edge/i,
      /game changer/i,
      /synergy/i,
      /leverage/i,
      /paradigm shift/i
    ];
    let genericCount = 0;
    for (const phrase of genericMarketingPhrases) {
      if (phrase.test(text)) genericCount++;
    }
    if (genericCount >= 2) {
      errors.push("Niche awareness error: Response is too generic/marketing-heavy. Use specific industry language instead.");
    }

    // 6. Math Check: Verify percentages and discounts
    const discountMatch = text.match(/(\d+)%\s+off/i);
    if (discountMatch) {
        // If a discount is mentioned, we should ideally verify it.
        // For now, we'll log it for auditing if it's > 50% as a safety precaution.
        const percentage = parseInt(discountMatch[1], 10);
        if (percentage > 50) {
            errors.push(`Math safety error: Unusually high discount (${percentage}%) detected. Verify pricing accuracy.`);
        }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Wraps an AI call with automatic validation and retry/block logic.
   */
  static async sanitizeResponse(text: string, context: { channel: string; isEmail: boolean }): Promise<string> {
    const result = this.validate(text, context);
    if (!result.valid) {
      console.error(`🚨 [NGA-1 Safety Guard] Validation failed:\n${result.errors.join('\n')}`);
      throw new Error(`NGA-1 Compliance Violation: ${result.errors[0]}`);
    }
    return text;
  }
}
