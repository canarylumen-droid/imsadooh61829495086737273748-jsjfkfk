/**
 * AI Content Sanitizer
 * 
 * Extracts the actual sales copy from LLM outputs, stripping conversational
 * fillers, assistant prefixes, and accidental markdown formatting.
 */

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
