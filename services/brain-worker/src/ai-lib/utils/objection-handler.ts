import { objectionService } from '../analyzers/objection-service.js';
import { generateAutonomousObjectionResponse } from '../analyzers/autonomous-objection-responder.js';
import { type Message } from '@audnix/shared';

export interface ObjectionContext {
  userId: string;
  leadName: string;
  leadIndustry: string;
  previousMessages: Message[];
  brandName: string;
  userIndustry: string;
}

/**
 * Handles autonomous objection responses.
 */
export async function handleObjection(text: string, context: ObjectionContext) {
  console.log(`🛡️ Objection detected for lead. Triggering closer logic.`);
  
  const response = await generateAutonomousObjectionResponse(text, {
    userId: context.userId,
    leadName: context.leadName,
    leadIndustry: context.leadIndustry,
    previousMessages: context.previousMessages.slice(-5).map(m => ({
      role: m.direction === 'inbound' ? 'user' : 'assistant',
      content: m.body
    })),
    brandName: context.brandName,
    userIndustry: context.userIndustry
  });

  return response;
}
