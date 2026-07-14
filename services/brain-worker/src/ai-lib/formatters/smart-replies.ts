import { generateReply } from '../core/ai-service.js';
import { MODELS } from '../utils/model-config.js';
import { storage } from '@shared/lib/storage/storage.js';
import type { Lead, Message } from '@audnix/shared';

const isDemoMode = false;

export interface SmartReply {
  id: string;
  text: string;
  tone: 'professional' | 'friendly' | 'urgent' | 'helpful';
  useCase: string;
  confidence: number;
}

/**
 * Generate smart reply suggestions based on conversation context
 */
export async function generateSmartReplies(
  leadId: string,
  lastMessage: Message
): Promise<SmartReply[]> {

  const lead = await storage.getLeadById(leadId);
  if (!lead) {
    throw new Error('Lead not found');
  }

  const messages = await storage.getMessagesByLeadId(leadId);
  const conversationContext = messages.slice(-5).map(m => ({
    role: m.direction === 'inbound' ? 'user' : 'assistant',
    content: m.body
  }));

  try {
    const prompt = `Based on the conversation context, generate 3-5 smart reply suggestions.
Context:
${JSON.stringify(conversationContext)}

Return JSON: { "replies": [ { "text": "...", "tone": "professional|friendly|urgent|helpful", "useCase": "...", "confidence": 0.8 } ] }`;

    const response = await generateReply(
      `## IDENTITY
You are a sales reply strategist. You generate quick, human-sounding replies that sales reps can send with one click.

## MISSION
Generate 3-5 smart reply suggestions based on the conversation context. Each reply must sound like it was written by a real person in the moment.

## 🔒 ANTI-HALLUCINATION RULES
1. Only reference facts, names, and context present in the conversation history provided.
2. Do not invent details about the product, pricing, or the lead.
3. Do not add offers or claims not supported by the context.

## HARD CONSTRAINTS
1. Each reply: max 15-20 words. Short, punchy, ready to send.
2. Cover different tones: professional, friendly, urgent, helpful — vary your suggestions.
3. No emojis. No corporate jargon. No fluff.
4. Each reply should feel like a complete thought — not a sentence fragment.
5. Rule of thumb: if the reply needs more than 15 words, it's too long.

## OUTPUT FORMAT (JSON ONLY)
{ "replies": [ { "text": "...", "tone": "professional|friendly|urgent|helpful", "useCase": "brief scenario", "confidence": 0.0-1.0 } ] }`,
      prompt,
      {
        jsonMode: true,
        maxTokens: 400,
        temperature: 0.8,
        model: MODELS.sales_reasoning
      }
    );

    const result = JSON.parse(response.text || '{"replies":[]}');
    const replies = result.replies || [];

    return replies.map((reply: any, index: number) => ({
      id: `reply-${Date.now()}-${index}`,
      text: reply.text,
      tone: reply.tone,
      useCase: reply.useCase,
      confidence: reply.confidence
    }));
  } catch (error) {
    console.error('Smart reply generation error:', error);
    throw error;
  }
}





