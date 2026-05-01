import { generateReply } from '@services/brain-worker/src/ai-lib/core/ai-service.js';
import { MODELS } from '@services/brain-worker/src/ai-lib/utils/model-config.js';

export async function generateEmailSubject(userId: string, content: string): Promise<string> {
  try {
    const response = await generateReply(
      "You are a professional email subject line generator.",
      `Generate a professional, compelling email subject line for this email body. Keep it under 60 characters and make it engaging:\n\n${content.substring(0, 500)}`,
      {
        model: MODELS.intent_classification,
        maxTokens: 100
      }
    );

    const subject = response.text?.trim() || 'Hello';
    return subject.replace(/^["']|["']$/g, ''); // Remove quotes if any
  } catch (error) {
    console.warn('Failed to generate email subject with AI, using default:', error);
    return 'Message from Your Business';
  }
}
