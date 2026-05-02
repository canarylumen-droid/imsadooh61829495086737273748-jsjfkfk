/**
 * HALLUCINATION VERIFIER v1
 * ================================
 * Post-generation safety layer to ensure the AI never fabricates 
 * metrics, URLs, or placeholders in outreach copy.
 */

export interface VerificationResult {
  isSafe: boolean;
  reason?: string;
  cleanedContent?: string;
}

export class HallucinationVerifier {
  // Common hallucination patterns (placeholders, fake stats, fake URLs)
  private static readonly DANGEROUS_PATTERNS = [
    /\[.*?\]/,                  // [Bracketed Placeholders]
    /\{.*?\}/,                  // {Curly Placeholders}
    /www\.example\.com/i,       // Example URLs
    /fake-url\.com/i,           // Fake URLs
    /000-000-0000/,             // Placeholder phones
    /your-link-here/i,          // Link placeholders
    /123 Main St/i,             // Placeholder addresses
  ];

  /**
   * Performs a deterministic scan for obvious hallucinations.
   */
  static scan(text: string): VerificationResult {
    for (const pattern of this.DANGEROUS_PATTERNS) {
      if (pattern.test(text)) {
        return {
          isSafe: false,
          reason: `Detected placeholder or fake pattern: ${pattern.source}`,
        };
      }
    }

    // Check for "Percentage Hallucinations" (e.g., 100% success rate claims)
    if (text.includes('100% success') || text.includes('zero risk')) {
      return {
        isSafe: false,
        reason: 'Detected over-promise / compliance risk phrasing',
      };
    }

    return { isSafe: true };
  }

  /**
   * [PHASE 95] LIVE DATA CROSS-REFERENCING
   * Verifies the message content against actual database records for the lead.
   */
  static verifyAgainstLead(text: string, lead: any): VerificationResult {
    const basic = this.scan(text);
    if (!basic.isSafe) return basic;

    // 1. IDENTITY CHECK: Did the AI get the name right?
    const firstName = lead.name?.trim().split(' ')[0];
    if (firstName && (text.includes('Hi ') || text.includes('Hello '))) {
      const lowerText = text.toLowerCase();
      const lowerName = firstName.toLowerCase();
      
      // If there's a greeting but it doesn't contain the name (and isn't a generic 'there')
      if (!lowerText.includes(lowerName) && !lowerText.includes('hi there') && !lowerText.includes('hello there')) {
        return {
          isSafe: false,
          reason: `Identity Mismatch: AI used an incorrect name or missed the lead's name (${firstName})`
        };
      }
    }

    // 2. COMPANY CHECK: Is the AI pitching the correct business?
    const company = lead.company?.trim();
    if (company && company.length > 2) {
      const lowerText = text.toLowerCase();
      const lowerCompany = company.toLowerCase();
      
      // If the AI mentions "at [Company]" or "with [Company]" but uses the wrong one
      const mentionsCompanyContext = lowerText.includes(' at ') || lowerText.includes(' with ');
      if (mentionsCompanyContext && !lowerText.includes(lowerCompany)) {
        return {
          isSafe: false,
          reason: `Company Mismatch: AI mentioned the wrong organization context (Expected: ${company})`
        };
      }
    }

    return { isSafe: true };
  }

  /**
   * Advanced AI-driven verification.
   * Compares the generated text against the provided brand context.
   */
  static async verifyWithAI(
    text: string, 
    brandContext: string,
    generateFn: (prompt: string) => Promise<string>
  ): Promise<VerificationResult> {
    const prompt = `You are a Compliance & Fact-Checker. 
Verify if the following message contains any fabricated information, fake metrics, or placeholders that haven't been filled.

[BRAND CONTEXT]
${brandContext}

[MESSAGE TO VERIFY]
${text}

[RULES]
1. If the message claims a metric (e.g. "We helped 50 companies") that is NOT in the brand context, it is a HALLUCINATION.
2. If there are brackets like [Name] or [Link], it is UNSAFE.
3. If it is 100% honest and ready to send, return "SAFE".
4. If it is unsafe, return the corrected version of the message.

Return ONLY the corrected message or the word "SAFE".`;

    try {
      const response = await generateFn(prompt);
      const cleanResponse = response.trim();

      if (cleanResponse === 'SAFE') {
        return { isSafe: true };
      }

      return {
        isSafe: false,
        reason: 'AI detected fact-fabrication or placeholders',
        cleanedContent: cleanResponse
      };
    } catch (err) {
      console.error('[HallucinationVerifier] AI check failed:', err);
      return { isSafe: false, reason: 'Verification engine error' };
    }
  }
}
