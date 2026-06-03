/**
 * LLM Copywriter
 * Generates plain-text B2B email replies for warmup threads.
 * NO HTML. NO links. NO tracking pixels.
 */

import { WARMUP_CONFIG } from '../config/warmup-config.js';
import type { ThreadContext } from '../types/warmup-types.js';

const SYSTEM_PROMPT = `You are writing plain-text B2B email replies for an email warmup system.
Rules:
1. Write ONLY plain text. No HTML tags. No markdown links.
2. NEVER include URLs, hyperlinks, or web addresses.
3. NEVER include signatures with websites or phone numbers.
4. NEVER include tracking pixels or image references.
5. Be conversational and slightly informal. Short paragraphs (2-3 sentences each).
6. Vary openings: "Hey", "Hi", "Quick question", "Just following up"
7. Topics: workflow questions, scheduling, tool recommendations, casual follow-ups.
8. If replying, reference the previous message naturally but briefly.
9. Keep replies under 80 words.`;

export class LlmCopywriter {
  private deepseekClient: any = null;
  private openaiClient: any = null;

  constructor() {
    this.initClients();
  }

  private initClients() {
    try {
      const { OpenAI } = require('openai');
      if (process.env.DEEPSEEK_API_KEY) {
        this.deepseekClient = new OpenAI({
          apiKey: process.env.DEEPSEEK_API_KEY,
          baseURL: 'https://api.deepseek.com',
        });
      }
      if (process.env.OPENAI_API_KEY) {
        this.openaiClient = new OpenAI({
          apiKey: process.env.OPENAI_API_KEY,
        });
      }
    } catch {
      // Clients unavailable — templates will serve as fallback
    }
  }

  async generateReply(context: ThreadContext): Promise<string> {
    try {
      const text = await this.tryLLM(context);
      if (text) return this.sanitize(text);
    } catch (err: any) {
      console.warn('[Warmup][LLM] AI generation failed:', err.message);
    }

    // Fallback to templates
    return this.templateFallback(context);
  }

  private async tryLLM(context: ThreadContext): Promise<string | null> {
    const messages = context.previousMessages.map((m) => ({
      role: m.direction === 'outbound' ? 'assistant' : 'user',
      content: m.body,
    }));

    const client = this.deepseekClient || this.openaiClient;
    if (!client) return null;

    const model = this.deepseekClient
      ? 'deepseek-v4-flash'
      : 'gpt-4o-mini';

    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...messages,
        {
          role: 'user',
          content: `Write the next reply in this email thread (volley ${context.volleyNumber}):`,
        },
      ],
      max_tokens: WARMUP_CONFIG.LLM_MAX_TOKENS,
      temperature: WARMUP_CONFIG.LLM_TEMPERATURE,
    });

    return completion.choices[0]?.message?.content?.trim() || null;
  }

  private sanitize(text: string): string {
    let cleaned = text
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/www\.\S+/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/!\[.*?\]\(.*?\)/g, '')
      .replace(/\[.*?\]\(.*?\)/g, '')
      .trim();

    // Enforce 80-word max to avoid spam triggers from overly long text
    const words = cleaned.split(/\s+/);
    if (words.length > 80) {
      cleaned = words.slice(0, 80).join(' ') + '...';
    }

    return cleaned;
  }

  private templateFallback(context: ThreadContext): string {
    const TEMPLATES = [
      "Hey, just wanted to follow up on this. Does that timeline work for you?",
      "Hi — quick question. Would you prefer to chat later this week or early next?",
      "Thanks for the note. I'm leaning toward option A, but curious what you think.",
      "Hey, no rush on this. Just keeping it on your radar.",
      "Sounds good. Let me know if you need anything else from my side.",
      "Quick follow-up — did you get a chance to look at this?",
      "Hi, just checking in. Happy to adjust if the scope has changed.",
      "Thanks for the reply. I'll circle back once I hear from the team.",
      "Makes sense. Let's sync once you have more clarity.",
      "Got it — I'll hold off until you're ready. No pressure.",
      "Hey, I wanted to make sure this didn't get buried. Still interested?",
      "Quick note — are we still on track for next week?",
      "I appreciate the update. Let me know if priorities shift.",
      "That works for me. I'll prep the details and send them over.",
      "Hey, just a heads up — I'll be out Friday, so earlier in the week works better.",
      "No worries on the delay. These things take time.",
      "Good point. I hadn't considered that angle — let me think it through.",
      "Agreed. Let's pause here and regroup once there's more info.",
      "I'm flexible. Just let me know what works best on your end.",
      "Quick question — should I loop anyone else into this thread?",
    ];

    const idx = context.volleyNumber % TEMPLATES.length;
    return TEMPLATES[idx];
  }
}

export const llmCopywriter = new LlmCopywriter();
