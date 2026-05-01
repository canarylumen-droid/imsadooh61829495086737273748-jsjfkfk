/**
 * Brand Personalization System
 * 
 * Injects user/brand context into messages to make them feel human and authentic:
 * - User's name in signatures
 * - User's company name in context
 * - User's voice/tone from settings
 * - Brand colors for email styling
 * - Custom closing lines
 */

import { storage } from '@shared/lib/storage/storage.js';
import type { ChannelType } from '@shared/types.js';

interface BrandPersonalizationContext {
  senderName: string;
  senderEmail?: string;
  companyName: string;
  voiceTone: string;
  brandColors?: { primary: string; secondary: string };
  closingLine?: string;
  timezone?: string;
}

/**
 * Get complete brand context for a user
 */
export async function getBrandPersonalization(userId: string): Promise<BrandPersonalizationContext> {
  try {
    const user = await storage.getUserById(userId);

    if (!user) {
      return getDefaultContext();
    }

    const metadata = user.metadata as Record<string, unknown> | undefined;
    const closingLine = typeof metadata?.closingLine === 'string'
      ? metadata.closingLine
      : `All the best,\n{{senderName}}`;

    return {
      senderName: user.name ?? user.email.split('@')[0] ?? 'Team',
      senderEmail: user.email,
      companyName: user.company ?? 'Our Team',
      voiceTone: user.replyTone ?? 'professional and friendly',
      closingLine,
      timezone: user.timezone
    };
  } catch (error) {
    console.error('Error getting brand personalization:', error);
    return getDefaultContext();
  }
}

/**
 * Default context for fallback
 */
function getDefaultContext(): BrandPersonalizationContext {
  return {
    senderName: 'Team',
    companyName: 'Our Company',
    voiceTone: 'professional and friendly',
    closingLine: 'All the best,\nThe Team'
  };
}

/**
 * Personalize a message with brand context
 */
export function personalizeBrandContext(
  message: string,
  context: BrandPersonalizationContext
): string {
  let personalized = message;

  personalized = personalized.replace(/{{sender\.name}}/g, context.senderName);
  personalized = personalized.replace(/{{senderName}}/g, context.senderName);

  personalized = personalized.replace(/{{company\.name}}/g, context.companyName);
  personalized = personalized.replace(/{{companyName}}/g, context.companyName);

  return personalized.trim();
}

/**
 * Build email signature with brand personalization
 */
export function buildEmailSignature(context: BrandPersonalizationContext): string {
  const signatureLine = context.closingLine ?? `Best regards,\n${context.senderName}`;

  const emailLine = context.senderEmail ? `${context.senderEmail}` : '';
  const companyLine = context.companyName ? `${context.companyName}` : '';

  return `
---
${signatureLine}

${emailLine}
${companyLine}
`.trim();
}

/**
 * Apply voice tone guidelines to message generation
 */
export function getVoiceToneGuidelines(tone: string): string {
  const guidelines: Record<string, string> = {
    'professional': 'Use formal language, avoid slang, maintain distance while being helpful',
    'friendly': 'Use casual language, add personality, be warm and approachable',
    'direct': 'Be to the point, minimize fluff, focus on the key message',
    'creative': 'Use storytelling, add metaphors, make it memorable',
    'analytical': 'Focus on data and logic, be precise, avoid emotion',
    'professional and friendly': 'Balance professionalism with warmth, be helpful without being distant',
    'casual': 'Use conversational language, relatable examples, natural flow'
  };

  return guidelines[tone] ?? guidelines['professional and friendly'] ?? '';
}

/**
 * Format message for specific channel with brand context
 */
export async function formatChannelMessage(
  message: string,
  channel: ChannelType,
  userId: string,
  includeSignature: boolean = true
): Promise<string> {
  const context = await getBrandPersonalization(userId);
  let formatted = personalizeBrandContext(message, context);

  switch (channel) {
    case 'email':
      if (includeSignature) {
        formatted += '\n' + buildEmailSignature(context);
      }
      break;



    case 'instagram':
      formatted = formatted.trim();
      break;
  }

  return formatted;
}

/**
 * Get context-aware system prompt for message generation
 */
export function getContextAwareSystemPrompt(context: BrandPersonalizationContext, channel: string): string {
  const voiceGuidelines = getVoiceToneGuidelines(context.voiceTone);

  return `You are writing on behalf of ${context.senderName} from ${context.companyName}.

VOICE & TONE:
${voiceGuidelines}

SENDER INFO:
- Name: ${context.senderName}
- Company: ${context.companyName}

CHANNEL: ${channel}

RULES:
1. Always sign off as ${context.senderName}
2. Reference ${context.companyName} naturally if relevant
3. Match the tone: ${context.voiceTone}
4. Keep language natural and authentic
5. No corporate jargon unless necessary
6. Make it personal to the recipient`;
}



