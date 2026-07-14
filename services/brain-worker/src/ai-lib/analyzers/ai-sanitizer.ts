/**
 * AI Content Sanitizer
 * 
 * Extracts the actual sales copy from LLM outputs, stripping conversational
 * fillers, assistant prefixes, JSON reasoning leaks, and accidental markdown.
 * 
 * CRITICAL: This is the last line of defense before a real email is sent to a lead.
 * Any internal AI reasoning, JSON artifacts, or template variables that slip through
 * will damage brand reputation.
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

  let trimmed = text.trim();

  // ── STRIP JSON REASONING LEAKS ─────────────────────────────────────────
  // Detect if the text contains or starts with a JSON object containing reasoning fields
  // This catches models that output: {"action":"send","reasoning":"...","body":"..."}
  // as well as models that prepend/append JSON blocks to otherwise clean text.
  
  // Try to extract body from JSON if the text contains JSON with a body field
  const jsonBlockMatch = trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || 
                         trimmed.match(/^(\{[\s\S]*?\})$/);
  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1]);
      const body = parsed.body || parsed.email_body || parsed.message || '';
      if (body && typeof body === 'string' && body.trim().length > 10) {
        // Successfully extracted body from JSON wrapper - use it
        trimmed = body.trim();
      } else if (parsed.reasoning || parsed.action || parsed.delayDays || parsed.thought || parsed.thinking) {
        // JSON contains reasoning/action fields but no usable body - BLOCK
        console.warn('[EmailSanitizer] AI returned JSON with reasoning fields and no usable body. Blocking send.');
        return '';
      }
    } catch {
      // Not valid JSON — fall through to pattern stripping
    }
  }

  // Block any text that STARTS with JSON reasoning fields (even partial JSON)
  if (/^\s*\{?\s*"(action|reasoning|delayDays|thought|thinking|thoughtProcess|strategy)"/i.test(trimmed)) {
    // Try one more time to extract body from the JSON
    try {
      const jsonStart = trimmed.indexOf('{');
      if (jsonStart >= 0) {
        const jsonStr = trimmed.substring(jsonStart);
        const jsonEnd = jsonStr.lastIndexOf('}');
        if (jsonEnd > 0) {
          const parsed = JSON.parse(jsonStr.substring(0, jsonEnd + 1));
          const body = parsed.body || parsed.email_body || parsed.message || '';
          if (body && typeof body === 'string' && body.trim().length > 10) {
            trimmed = body.trim();
          } else {
            console.warn('[EmailSanitizer] Detected raw JSON reasoning prefix in email body. Blocking send.');
            return '';
          }
        }
      }
    } catch {
      console.warn('[EmailSanitizer] Detected raw JSON reasoning prefix in email body. Blocking send.');
      return '';
    }
  }

  // ── STRIP INLINE REASONING FRAGMENTS ───────────────────────────────────
  // Some models embed reasoning between the email parts:
  // "Hi there,\n\n...email body...\n\n{\"reasoning\": \"...\", \"action\": \"send\"}"
  // or "Reasoning: The lead has replied...\n\nHi there,..."
  const reasoningPatterns = [
    /\n*-{3,}\s*\n*"?reasoning"?\s*:\s*[\s\S]*$/i,
    /\n*"?reasoning"?\s*:\s*"[^"]*[\s\S]*$/i,
    /\n*"?action"?\s*:\s*"(send|reply|wait|follow)"[\s\S]*$/i,
    /\n*"?delayDays"?\s*:\s*\d+[\s\S]*$/i,
    /\n*"?thought(?:s|Process)?"?\s*:\s*[\s\S]*$/i,
    /\n*"?strategy"?\s*:\s*[\s\S]*$/i,
    /\n*"?thoughts"?\s*:\s*"[\s\S]*$/i,
    /\n*What AI will be thinking[\s\S]*$/i,
    /\n*AI (?:Analysis|Reasoning|Thought)[\s\S]*$/i,
  ];
  for (const pattern of reasoningPatterns) {
    if (pattern.test(trimmed)) {
      trimmed = trimmed.replace(pattern, '').trim();
    }
  }

  // ── STRIP LEADING JSON BLOCKS ──────────────────────────────────────────
  // If the body starts with a JSON object (e.g., DeepSeek outputting full JSON),
  // try to extract just the body field
  if (/^\s*\{[\s\S]*"body"[\s\S]*\}/.test(trimmed) && !trimmed.includes('<')) {
    try {
      // Find the first { and last }
      const firstBrace = trimmed.indexOf('{');
      const lastBrace = trimmed.lastIndexOf('}');
      if (lastBrace > firstBrace) {
        const parsed = JSON.parse(trimmed.substring(firstBrace, lastBrace + 1));
        const body = parsed.body || parsed.email_body || parsed.message || '';
        if (body && typeof body === 'string' && body.trim().length > 10) {
          trimmed = body.trim();
        }
      }
    } catch {
      // Not valid JSON, skip
    }
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
