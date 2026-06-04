/**
 * Sentiment Analysis Service — Task 4
 *
 * Thin wrapper around the AI classification pipeline for email sentiment.
 * Uses the lightweight closed-label prompt optimized for small LLMs.
 *
 * Integration points:
 * - Inbound Sweep: classify swept emails before auto-reply decisions
 * - Lead Intelligence: enrich lead profile with sentiment history
 * - CRM: color-code leads by dominant sentiment
 */

import {
  SENTIMENT_SYSTEM_PROMPT,
  buildSentimentUserPrompt,
  normalizeSentiment,
  type SentimentLabel,
} from '../ai-lib/prompts/sentiment-classification-prompt.js';

import {
  generateReply,
} from '../ai-lib/core/ai-service.js';

interface SentimentResult {
  label: SentimentLabel;
  confidence: number;
  raw: string;
}

/**
 * Classify an email body into one of 4 sentiment labels.
 * Uses generateReply with the lightweight prompt for maximum provider compatibility.
 */
export async function classifySentiment(emailBody: string): Promise<SentimentResult> {
  if (!emailBody || emailBody.trim().length === 0) {
    return { label: 'NEUTRAL', confidence: 1.0, raw: 'empty_input' };
  }

  const userPrompt = buildSentimentUserPrompt(emailBody);

  try {
    const res = await generateReply(SENTIMENT_SYSTEM_PROMPT, userPrompt, {
      temperature: 0.1, // low temp for deterministic classification
      maxTokens: 20,    // label only, extremely short
      model: undefined, // use default failover chain
    });

    const raw = res.text.trim();
    const label = normalizeSentiment(raw);

    // Simple heuristic confidence: exact match = 0.95, normalized match = 0.75
    const confidence = raw.toUpperCase().replace(/[^A-Z]/g, '') === label ? 0.95 : 0.75;

    return { label, confidence, raw };
  } catch (err: any) {
    console.warn('[SentimentService] Classification failed:', err.message);
    return { label: 'NEUTRAL', confidence: 0.5, raw: 'error_fallback' };
  }
}

/**
 * Batch classify multiple emails. Useful for sweep/import pipelines.
 */
export async function classifySentimentBatch(
  items: Array<{ id: string; body: string }>
): Promise<Array<{ id: string; result: SentimentResult }>> {
  const results: Array<{ id: string; result: SentimentResult }> = [];

  // Sequential to respect rate limits; can be parallelized if using local LLM
  for (const item of items) {
    const result = await classifySentiment(item.body);
    results.push({ id: item.id, result });
  }

  return results;
}

/**
 * Determine if an auto-reply should be suppressed based on sentiment.
 * Returns true if the email is NEGATIVE (unsubscribe, hard no).
 */
export function shouldSuppressAutoReply(result: SentimentResult): boolean {
  return result.label === 'NEGATIVE';
}

/**
 * Determine if a lead should be escalated to human sales.
 * Returns true for POSITIVE (hot lead) or OBJECTION (needs handling).
 */
export function shouldEscalateToHuman(result: SentimentResult): boolean {
  return result.label === 'POSITIVE' || result.label === 'OBJECTION';
}
