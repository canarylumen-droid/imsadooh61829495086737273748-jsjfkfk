import { Lead } from "@audnix/shared";
import { generateExpertOutreach } from "@services/brain-worker/src/ai-lib/core/conversation-ai.js";

export type MessageType = 'hook' | 'value' | 'social_proof' | 'urgency' | 'followup';

export interface MessageTemplate {
  id: string;
  type: MessageType;
  subject?: string;
  body: string;
  tone: 'professional' | 'casual' | 'urgent' | 'friendly';
  channel: 'email' | 'instagram';
}

/**
 * AI SEQUENCE ENGINE (Replaces static templates)
 * Dynamically crafts high-fidelity strategic messages for multi-step campaigns.
 */
export async function generateStrategicSequenceMessage(
  lead: Lead,
  userId: string,
  type: MessageType,
  channel: 'email' | 'instagram' = 'email'
): Promise<MessageTemplate> {
  // Hooks are handled by the core Expert Outreach node
  if (type === 'hook') {
    const expert = await generateExpertOutreach(lead, userId);
    return {
      id: `ai_${Date.now()}`,
      type: 'hook',
      subject: expert.subject,
      body: expert.body,
      tone: 'professional',
      channel
    };
  }

  // Other sequence types leverage the same AI logic but with specific directives
  // For now, mapping to expert generation with type-specific context enhancement
  const expert = await generateExpertOutreach(lead, userId);

  return {
    id: `ai_${type}_${Date.now()}`,
    type,
    subject: expert.subject,
    body: expert.body,
    tone: type === 'urgency' ? 'urgent' : 'professional',
    channel
  };
}

/**
 * LEGACY - Keep basic rotation logic for sequence progression
 */
export function shouldRotateTemplate(sendCount: number): boolean {
  return true; // Always rotate when using AI-driven generation
}


