/**
 * SPAM TRAP & REPUTATION GUARD v2
 * ================================
 * Deliverability protection layer. Identifies "Honeypot" emails, 
 * disposable domains, and MX-less addresses to protect the 500+ mailbox grid.
 */

import dns from 'dns/promises';

export interface SpamTrapResult {
  isTrap: boolean;
  score: number; // 0-100, higher = more likely trap
  reason?: string;
  isDisposable?: boolean;
  hasMx?: boolean;
}

export class SpamTrapDetector {
  // Common honeypot and catch-all prefixes
  private static readonly SUSPICIOUS_PREFIXES = [
    'trap', 'honeypot', 'spam', 'admin', 'postmaster', 'webmaster',
    'abuse', 'noc', 'security', 'hostmaster', 'test', 'dev', 'info',
    'contact', 'sales', 'support', 'office'
  ];

  // Domains known for hosting spam traps or disposable emails
  private static readonly DISPOSABLE_DOMAINS = [
    'mailinator.com', 'guerrillamail.com', 'temp-mail.org', 
    '10minutemail.com', 'spamhero.com', 'hushmail.com',
    'getnada.com', 'dispostable.com', 'tempmail.com', 'yopmail.com'
  ];

  /**
   * Deterministic scan for known trap patterns and disposable domains.
   */
  static scan(email: string): SpamTrapResult {
    const [prefix, domain] = email.toLowerCase().split('@');
    if (!prefix || !domain) return { isTrap: true, score: 100, reason: 'Invalid email format' };

    let score = 0;
    const reasons: string[] = [];
    let isDisposable = false;

    // Check prefixes
    if (this.SUSPICIOUS_PREFIXES.includes(prefix)) {
      score += 40;
      reasons.push(`Suspicious prefix: ${prefix}`);
    }

    // Check domains
    if (this.DISPOSABLE_DOMAINS.includes(domain)) {
      score += 90;
      isDisposable = true;
      reasons.push(`Known disposable domain: ${domain}`);
    }

    // Check for "random string" prefixes (e.g. asdfghjkl@...)
    const entropy = this.calculateEntropy(prefix);
    if (entropy > 3.8 && prefix.length > 8 && !prefix.includes('.') && !prefix.includes('_')) {
      score += 60;
      reasons.push(`High entropy prefix (${entropy.toFixed(2)}) - likely machine generated trap`);
    }

    // [PHASE 120] GIBBERISH PATTERN: Detect bot-style alphanumeric suffixes (e.g. mike8273@...)
    if (/^[a-z]{3,}\d{4,}$/.test(prefix)) {
      score += 30;
      reasons.push('Matches bot-style numeric suffix pattern');
    }

    return { 
      isTrap: score >= 70, 
      score, 
      reason: reasons.join(', '),
      isDisposable 
    };
  }

  /**
   * Calculates Shannon Entropy of a string to detect randomness.
   */
  private static calculateEntropy(str: string): number {
    const len = str.length;
    if (len === 0) return 0;
    const freq: Record<string, number> = {};
    for (const char of str) freq[char] = (freq[char] || 0) + 1;
    return Object.values(freq).reduce((sum, f) => sum - (f/len) * Math.log2(f/len), 0);
  }

  /**
   * Performs real-time MX record validation.
   */
  static async checkMx(domain: string): Promise<boolean> {
    try {
      const records = await dns.resolveMx(domain);
      return records && records.length > 0;
    } catch (err) {
      return false;
    }
  }

  /**
   * Full reputation check (Deterministic + MX + AI).
   */
  static async verifyFull(email: string, leadData: any, generateFn?: (prompt: string) => Promise<string>): Promise<SpamTrapResult> {
    const base = this.scan(email);
    const domain = email.split('@')[1];

    // MX Check
    if (domain) {
      const hasMx = await this.checkMx(domain);
      if (!hasMx) {
        base.isTrap = true;
        base.score = 100;
        base.reason = (base.reason ? base.reason + ', ' : '') + 'No MX records found for domain';
        base.hasMx = false;
      } else {
        base.hasMx = true;
      }
    }

    // AI Check for "Contextual Fakes"
    if (!base.isTrap && generateFn) {
      const aiResult = await this.verifyWithAI(leadData, generateFn);
      if (aiResult.isTrap) {
        base.isTrap = true;
        base.score = aiResult.score;
        base.reason = (base.reason ? base.reason + ', ' : '') + aiResult.reason;
      }
    }

    return base;
  }

  /**
   * AI-driven verification for high-risk profiles.
   */
  private static async verifyWithAI(
    leadData: any,
    generateFn: (prompt: string) => Promise<string>
  ): Promise<SpamTrapResult> {
    const prompt = `Analyze if this lead profile looks like a "Spam Trap" or a "Fake Lead" designed to hurt email deliverability.

LEAD DATA:
${JSON.stringify(leadData, null, 2)}

[INDICATORS OF TRAPS]
1. Generic names (e.g. "John Doe", "Test User").
2. Gibberish company names.
3. Inconsistent data (e.g. Role = CEO, Company = "asdf").

Return "TRAP" or "CLEAN".`;

    try {
      const response = await generateFn(prompt);
      const result = response.trim();

      if (result === 'TRAP') {
        return { isTrap: true, score: 85, reason: 'AI detected fake/trap profile patterns' };
      }

      return { isTrap: false, score: 10 };
    } catch (err) {
      return { isTrap: false, score: 0 };
    }
  }

  /**
   * Enforces CAN-SPAM compliance by injecting the footer.
   */
  static injectComplianceFooter(html: string, unsubscribeLink: string, physicalAddress: string): string {
    const footer = `
      <div style="margin-top: 20px; font-size: 12px; color: #666; border-top: 1px solid #eee; padding-top: 10px;">
        <p>${physicalAddress}</p>
        <p>If you'd like to stop receiving these emails, you can <a href="${unsubscribeLink}">unsubscribe here</a>.</p>
      </div>
    `;
    
    if (html.includes('</body>')) {
      return html.replace('</body>', `${footer}</body>`);
    }
    return html + footer;
  }
}
