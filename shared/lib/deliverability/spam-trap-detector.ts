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

  private static readonly DISPOSABLE_DOMAINS = new Set([
    'mailinator.com', 'guerrillamail.com', 'temp-mail.org',
    '10minutemail.com', 'spamhero.com', 'hushmail.com',
    'getnada.com', 'dispostable.com', 'tempmail.com', 'yopmail.com',
    'maildrop.cc', 'trashmail.com', 'throwaway.email', 'burnermail.io',
    'tempemail.co', 'spambox.us', 'mailexpire.com', 'mailsac.com',
    'yopmail.fr', 'yopmail.net', 'jetable.org', 'casualdx.com',
    'filzmail.com', 'maileater.com', 'mailexpire.com', 'mailmoat.com',
    'mintemail.com', 'mytrashmail.com', 'nepwk.com', 'nullbox.info',
    'oneoffemail.com', 'oneoffmail.com', 'paypermail.com', 'quickmail.in',
    'rcpt.at', 'rejectmail.com', 'schafmail.de', 'sendspamhere.com',
    'sharpmail.co.uk', 'sneakemail.com', 'spam4.me', 'spambob.com',
    'spambog.com', 'spambox.info', 'spamcannon.com', 'spamdecoy.net',
    'spameater.org', 'spamfree24.org', 'spamgoes.in', 'spamherelots.com',
    'spamhereplease.com', 'spamhole.com', 'spamify.com', 'spaminator.de',
    'spamkill.info', 'spaml.com', 'spamlot.net', 'spammotel.com',
    'spamobox.com', 'spamsalad.com', 'spamserver.info', 'spamslicer.com',
    'spamsphere.com', 'spamspot.com', 'spamstack.net', 'spamthis.co.uk',
    'spamtrail.com', 'spamwc.de', 'spamx.net', 'speed.1s.fr',
    'supergreatmail.com', 'temporaryemail.net', 'thanksnospam.info',
    'thankyou2010.com', 'thc.st', 'thetrash.email', 'trash2009.com',
    'trashdevil.de', 'trashymail.com', 'tyldd.com', 'uggsrock.com',
    'wegwerfmail.de', 'wh4f.org', 'whyspam.me', 'willselfdestruct.com',
    'winemaven.info', 'wronghead.com', 'xagloo.com', 'xemaps.com',
    'xents.com', 'xmaily.com', 'xoxy.net', 'yep.it', 'yogamaven.com',
    'yopmail.fr', 'ypmail.webarnak.fr.eu.org', 'yuurok.com',
    'zehnminutenmail.de', 'zippymail.info', 'zoaxe.com', 'zoemail.org',
    'spamgourmet.com', 'inboxbear.com', 'emailondeck.com', 'mohmal.com',
    'sharklasers.com', 'guerrillamail.org', 'guerrillamail.biz',
  ]);

  // Known spam trap domains operated by tracking organizations
  private static readonly TRAP_DOMAINS = new Set([
    'spamtrap.com', 'spamtraps.org', 'projecthoneypot.org',
    'spamcop.net', 'sorbs.net', 'psbl.org',
  ]);

  /**
   * Deterministic scan for known trap patterns and disposable domains.
   */
  static scan(email: string): SpamTrapResult {
    const [prefix, domain] = email.toLowerCase().split('@');
    if (!prefix || !domain) return { isTrap: true, score: 100, reason: 'Invalid email format' };

    let score = 0;
    const reasons: string[] = [];
    let isDisposable = false;

    if (this.SUSPICIOUS_PREFIXES.includes(prefix)) {
      score += 30;
      reasons.push(`Suspicious prefix: ${prefix}`);
    }

    if (this.TRAP_DOMAINS.has(domain)) {
      score += 100;
      reasons.push(`Known spam trap domain: ${domain}`);
      return { isTrap: true, score: 100, reason: reasons.join(', '), isDisposable: false };
    }

    if (this.DISPOSABLE_DOMAINS.has(domain)) {
      score += 90;
      isDisposable = true;
      reasons.push(`Known disposable domain: ${domain}`);
    }

    const entropy = this.calculateEntropy(prefix);
    if (entropy > 4.5 && prefix.length > 10 && !prefix.includes('.') && !prefix.includes('-')) {
      score += 40;
      reasons.push(`High entropy prefix (${entropy.toFixed(2)})`);
    }

    if (/^[a-z]{4,}\d{4,}$/.test(prefix)) {
      score += 20;
      reasons.push('Alphanumeric suffix pattern');
    }

    if (domain.includes('temporary') || domain.includes('tempm') || domain.includes('disposable')) {
      score += 50;
      reasons.push(`Suspicious domain name: ${domain}`);
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
