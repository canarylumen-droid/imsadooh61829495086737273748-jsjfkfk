/**
 * AUTONOMOUS OPT-OUT DETECTOR v1
 * ================================
 * Detects unsubscribe intent in natural language (e.g. "stop", "remove me", 
 * "not interested") to ensure compliance without needing a link click.
 */

export class OptOutDetector {
  private static readonly OPT_OUT_KEYWORDS = [
    'stop', 'unsubscribe', 'remove', 'don\'t contact', 'dont contact',
    'take me off', 'not interested', 'take me out', 'fuck off', 'spam',
    'report', 'cease', 'desist'
  ];

  /**
   * Quick deterministic check for opt-out keywords.
   */
  static isLikelyOptOut(text: string): boolean {
    const lower = text.toLowerCase();
    
    // Check for exact word matches to avoid "I can't stop thinking about this"
    return this.OPT_OUT_KEYWORDS.some(keyword => {
      const regex = new RegExp(`\\b${keyword}\\b`, 'i');
      return regex.test(lower);
    });
  }

  /**
   * AI-driven intent analysis for subtle opt-outs.
   */
  static async analyzeIntent(
    text: string,
    generateFn: (prompt: string) => Promise<string>
  ): Promise<boolean> {
    const prompt = `Analyze if the following message from a lead indicates they want to stop receiving messages or are expressing a "Hard No".

[MESSAGE]
"${text}"

[RULES]
- Return "OPT_OUT" if they want to be removed or are very upset/uninterested.
- Return "KEEP" if they are just busy, asking a question, or neutral.
- Return ONLY the keyword.`;

    try {
      const response = await generateFn(prompt);
      return response.trim() === 'OPT_OUT';
    } catch (err) {
      console.error('[OptOutDetector] AI analysis failed:', err);
      return false; // Fail open (don't unsub by accident)
    }
  }
}
