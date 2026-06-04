/**
 * Lightweight Closed-Label Sentiment Classification Prompt — Task 4
 *
 * Optimized for sub-100 token inference on small LLMs (Llama 3.2 3B, Qwen 2.5 3B).
 * Returns EXACTLY ONE of 4 labels with no explanation.
 *
 * Labels:
 * - POSITIVE: Interest, enthusiasm, agreement, meeting request
 * - NEGATIVE: Hard no, unsubscribe, stop emailing, clear rejection
 * - NEUTRAL: Question without intent, auto-reply, out-of-office, generic response
 * - OBJECTION: Concern raised (price, timing, competitor) but door still open
 */

export const SENTIMENT_SYSTEM_PROMPT = `You are an email sentiment classifier. Analyze the email below and classify it into EXACTLY ONE of these labels:

POSITIVE: The recipient shows interest, asks for more info, agrees to a call/meeting, or expresses enthusiasm.
NEGATIVE: The recipient declines, unsubscribes, is annoyed, or explicitly says no.
NEUTRAL: The recipient asks a question without clear intent, or sends a generic/auto-response.
OBJECTION: The recipient raises a concern (price, timing, competition) but has NOT closed the door.

Rules:
1. Respond with ONLY the label. No explanation, no formatting, no punctuation.
2. If the email contains "unsubscribe", "remove me", "stop emailing", always output NEGATIVE.
3. If the email contains "interested", "book a call", "schedule", "yes", "sounds good", always output POSITIVE.
4. If the email is an out-of-office or auto-reply, output NEUTRAL.`;

export type SentimentLabel = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'OBJECTION';

export const VALID_SENTIMENT_LABELS: SentimentLabel[] = ['POSITIVE', 'NEGATIVE', 'NEUTRAL', 'OBJECTION'];

/**
 * Normalize raw LLM output to a valid sentiment label.
 * Handles common variations like lowercase, extra whitespace, or trailing punctuation.
 */
export function normalizeSentiment(raw: string): SentimentLabel {
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (cleaned.includes('POSITIVE')) return 'POSITIVE';
  if (cleaned.includes('NEGATIVE')) return 'NEGATIVE';
  if (cleaned.includes('NEUTRAL')) return 'NEUTRAL';
  if (cleaned.includes('OBJECTION')) return 'OBJECTION';
  // Fallback: scan for any valid label substring
  for (const label of VALID_SENTIMENT_LABELS) {
    if (cleaned.includes(label)) return label;
  }
  return 'NEUTRAL'; // safest default
}

/**
 * Wrap an email body with the classification instruction.
 */
export function buildSentimentUserPrompt(emailBody: string): string {
  const truncated = emailBody.length > 800 ? emailBody.slice(0, 800) + '...' : emailBody;
  return `Email:\n---\n${truncated}\n---\n\nLabel:`;
}
