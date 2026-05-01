interface ContentFilterResult {
  isSafe: boolean;
  flags: string[];
  severity: 'low' | 'medium' | 'high';
}

/**
 * Check if content contains inappropriate material
 */
export function checkContentSafety(text: string): ContentFilterResult {
  const result: ContentFilterResult = {
    isSafe: true,
    flags: [],
    severity: 'low'
  };
  
  const lowerText = text.toLowerCase();
  
  // Profanity detection
  const profanityWords = ['fuck', 'shit', 'damn', 'bitch', 'asshole'];
  profanityWords.forEach(word => {
    if (lowerText.includes(word)) {
      result.flags.push('profanity');
      result.isSafe = false;
      result.severity = 'medium';
    }
  });
  
  // Spam detection
  const spamPatterns = [
    /click here now/i,
    /limited time offer/i,
    /buy now/i,
    /act fast/i,
    /free money/i
  ];
  
  spamPatterns.forEach(pattern => {
    if (pattern.test(text)) {
      result.flags.push('spam');
      result.isSafe = false;
      result.severity = 'low';
    }
  });
  
  // Harassment detection
  const harassmentWords = ['kill', 'die', 'hate', 'stupid', 'idiot'];
  harassmentWords.forEach(word => {
    if (lowerText.includes(word)) {
      result.flags.push('harassment');
      result.isSafe = false;
      result.severity = 'high';
    }
  });
  
  // Sensitive info detection
  const sensitivePatterns = [
    /\d{3}-\d{2}-\d{4}/, // SSN
    /\d{16}/, // Credit card
    /password/i
  ];
  
  sensitivePatterns.forEach(pattern => {
    if (pattern.test(text)) {
      result.flags.push('sensitive_info');
      result.isSafe = false;
      result.severity = 'high';
    }
  });
  
  return result;
}

/**
 * Filter and sanitize content
 */
export function sanitizeContent(text: string): string {
  const check = checkContentSafety(text);
  
  if (!check.isSafe && check.severity === 'high') {
    return '[Content filtered for safety]';
  }
  
  return text;
}
