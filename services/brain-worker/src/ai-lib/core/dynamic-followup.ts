/**
 * DYNAMIC FOLLOW-UP ENGINE v1
 * ================================
 * Crafts unique, context-aware follow-ups when the hardcoded 
 * campaign template steps are exhausted (Step 3+).
 */

import { generateReply } from './ai-service.js';
import { MODELS } from '../utils/model-config.js';
import { HallucinationVerifier } from '@shared/lib/ai/hallucination-verifier.js';

export interface FollowUpContext {
  leadName: string;
  companyName: string;
  industry?: string;
  history: string; // Previous messages
  brandContext: string;
  stepNumber: number;
}

export class DynamicFollowUpEngine {
  /**
   * Generates a unique follow-up message.
   */
  static async generate(ctx: FollowUpContext): Promise<{ subject: string; body: string }> {
    const prompt = `You are a Senior SDR Intelligence Engine. This lead (${ctx.leadName} at ${ctx.companyName}) has been silent for ${ctx.stepNumber - 1} touches.

[BRAND CONTEXT]
${ctx.brandContext}

[CONVERSATION HISTORY]
${ctx.history}

[STRATEGIC REASONING TASK]
1. Analyze the Lead's Sentiment: From the history, do they sound busy, skeptical, or has there been zero engagement?
2. Multi-Channel Check: If history shows multiple platforms (Instagram, Email), acknowledge the cross-platform persistence.
3. Reason for Silence: Hypothesize why they haven't replied (e.g., bad timing, wrong value prop).
4. Pivot Strategy: Change the "Angle" of the conversation. If we focused on ROI, focus on "Peace of Mind" or "Efficiency" this time.

[MESSAGE TASK]
Craft Follow-up #${ctx.stepNumber}.
- Use a "Pattern Interrupter": Start with something unexpected but relevant to ${ctx.industry || 'their niche'}.
- Acknowledge the silence with empathy, not guilt.
- Maintain a "High-Status" tone. You are a peer expert, not a persistent salesperson.
- Goal: Secure a "soft opt-in" (e.g., "Worth a look?") rather than a hard meeting request.

[CONSTRAINTS]
- MAX 60 words. Short = Respectful of their time.
- NO placeholders or hallucinated metrics.
- Return JSON only.

Return JSON:
{
  "strategic_vibe": "Summary of lead sentiment",
  "pivot_angle": "The new strategy used",
  "subject": "Re: ...",
  "body": "..."
}`;

    try {
      const response = await generateReply(
        "You are a Senior SDR. Return JSON with 'subject' and 'body'.",
        prompt,
        { model: MODELS.sales_reasoning, temperature: 0.8, maxTokens: 400, jsonMode: true }
      );

      const parsed = JSON.parse(response.text || '{}');
      let body = parsed.body || '';
      let subject = parsed.subject || 'Quick follow up';

      // Hallucination Guard
      const verification = HallucinationVerifier.scan(body);
      if (!verification.isSafe && verification.cleanedContent) {
        body = verification.cleanedContent;
      }

      return { subject, body };
    } catch (err) {
      console.error('[DynamicFollowUp] Generation failed:', err);
      return { 
        subject: 'Quick follow up', 
        body: `Hi ${ctx.leadName}, just wanted to make sure my last message didn't get buried. Are you open to a quick chat about ${ctx.companyName}?`
      };
    }
  }
}
