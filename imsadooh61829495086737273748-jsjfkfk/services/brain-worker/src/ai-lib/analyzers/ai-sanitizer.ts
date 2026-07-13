/**
 * AI Content Sanitizer
 * 
 * Extracts the actual sales copy from LLM outputs, stripping conversational
 * fillers, assistant prefixes, JSON reasoning leaks, and accidental markdown.
 */

/**
 * CRITICAL: Strips AI reasoning JSON leaks from email bodies.
 * 
 * Some AI models (especially DeepSeek with chain-of-thought) dump their
 * internal decision JSON into the output: { "action": "send", "reasoning": "...",
 * "subject": "...", "body": "..." }. This MUST never reach a real email.
 * 
 * This function detects that pattern and extracts ONLY the body string.
 * If no body field found, returns empty string so the email is skipped.
 */
export function sanitizeEmailBody(text: string): string {
  if (!text) return "";

  const trimmed = text.trim();

  // Detect if the entire text looks like a JSON object
  if ((trimmed.startsWith('{') && trimmed.includes('"body"')) ||
      (trimmed.startsWith('```') && trimmed.includes('"body"'))) {
    try {
      // Strip markdown code fences first
      const raw = trimmed.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '');
      const parsed = JSON.parse(raw);

      // Extract body field only — discard action, delayDays, reasoning, etc.
      const body = parsed.body || parsed.email_body || parsed.message || '';
      if (body && typeof body === 'string' && body.trim().length > 10) {
        return body.trim();
      }

      // If body is missing or empty, this is a bad AI output — return empty
      console.warn('[EmailSanitizer] AI returned JSON without usable body field. Blocking send.');
      return '';
    } catch {
      // Not valid JSON — fall through to artifact pattern stripping below
    }
  }

  // Also block any text that STARTS with JSON reasoning fields
  if (/^\s*\{\s*"(action|reasoning|delayDays|thought|thinking)"/i.test(trimmed)) {
    console.warn('[EmailSanitizer] Detected raw JSON reasoning prefix in email body. Blocking send.');
    return '';
  }

  return trimmed;
}

/**
 * Sanitizes the subject line — strips JSON artifacts, template vars, etc.
 */
export function sanitizeEmailSubject(text: string): string {
  if (!text) return '';
  const trimmed = text.trim();

  // If subject looks like JSON, it's a bug — block it
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    console.warn('[EmailSanitizer] Subject line looks like JSON. Using fallback.');
    return '';
  }

  return trimmed;
}

const ARTIFACT_PATTERNS = [
  /^assistant:\s*/i,
  /^certainly!\s*/i,
  /^here is the response:\s*/i,
  /^here's a possible response:\s*/i,
  /^here is a subject line:\s*/i,
  /^subject:\s*/i,
  /^(sure|okay|claro|por supuesto|entendu|bien sûr|gerne|natürlich),\s+/i,
  /^i understand.\s*/i,
  /^entiendo.\s*/i,
  /^je comprends.\s*/i,
  /^ich verstehe.\s*/i,
];

/**
 * Strips common LLM artifacts and cleans up the text for production outreach.
 */
export function sanitizeAIResponse(text: string): string {
  if (!text) return "";

  let cleaned = text.trim();

  // 1. Remove markdown code blocks if the AI accidentally wrapped the text
  cleaned = cleaned.replace(/^```[a-z]*\n([\s\S]*?)\n```$/i, '$1');
  
  // 2. Iteratively strip prefixes while we match any known patterns
  let prefixMatched = true;
  while (prefixMatched) {
    prefixMatched = false;
    for (const pattern of ARTIFACT_PATTERNS) {
      if (pattern.test(cleaned)) {
        cleaned = cleaned.replace(pattern, "").trim();
        prefixMatched = true;
      }
    }
  }

  // 3. Remove leading/trailing quotes if the model wrapped the whole thing
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.substring(1, cleaned.length - 1).trim();
  }
  
  // 4. Final safety check: if everything was stripped or text is garbage, return a safe minimal string
  if (cleaned.length < 2) {
    return text.trim(); // Return original trim if we over-cleaned
  }

  return cleaned;
}

/**
 * Validates that the generated text is "Sales Ready".
 * Checks for placeholder hallucinations like [Name] or {Business}.
 */
export function isSalesReady(text: string): boolean {
  const placeholders = /\[.*?\]|\{.*?\}|<.*?>/g;
  return !placeholders.test(text);
}
