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
      'You are a sales reply expert. Generate concise, effective quick replies.',
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





