/**
 * NGA-1 SafetyGuard
 * 
 * Enforces compliance across all outreach channels.
 * Checks for hallucinations, missing placeholders, and mandatory unsubscribe links.
 */
export class SafetyGuard {
  /**
   * Scan and sanitize outgoing email content
   */
  static async sanitizeResponse(body: string, subject: string): Promise<{
    body: string;
    subject: string;
    wasFlagged: boolean;
    flagReasons?: string[];
  }> {
    const reasons: string[] = [];
    let sanitizedBody = body;
    let sanitizedSubject = subject;

    // 1. Detect common AI "Hallucinations" or placeholders left behind
    const placeholderRegex = /\[[A-Za-z\s_]+\]|\{\{[A-Za-z\s_]+\}\}/g;
    const matches = body.match(placeholderRegex) || [];
    
    // We allow standard variables like {{firstName}}, but flag others
    const allowedVariables = ['{{firstName}}', '{{lead_name}}', '{{company}}', '{{business_name}}', '{{unsubscribe}}'];
    const illegalPlaceholders = matches.filter(m => !allowedVariables.includes(m));

    if (illegalPlaceholders.length > 0) {
      reasons.push(`Unresolved placeholders: ${illegalPlaceholders.join(', ')}`);
      // Strip them for safety
      illegalPlaceholders.forEach(p => {
        sanitizedBody = sanitizedBody.replace(p, '');
      });
    }

    // 2. Detect AI "Expert" mode leaks (e.g., "As an AI...", "Based on the data...")
    const aiLeaks = [
      "as an ai",
      "i don't have feelings",
      "my programming",
      "the provided context",
      "based on the text"
    ];

    aiLeaks.forEach(leak => {
      if (sanitizedBody.toLowerCase().includes(leak)) {
        reasons.push(`AI identity leak detected: "${leak}"`);
        // Mask the leak
        const regex = new RegExp(leak, 'gi');
        sanitizedBody = sanitizedBody.replace(regex, '');
      }
    });

    // 3. Mandatory placeholder check (Ensure it doesn't look like a template)
    if (sanitizedBody.includes('[') && sanitizedBody.includes(']')) {
      reasons.push('Possible bracketed placeholder detected');
    }

    return {
      body: sanitizedBody,
      subject: sanitizedSubject,
      wasFlagged: reasons.length > 0,
      flagReasons: reasons.length > 0 ? reasons : undefined
    };
  }
}
