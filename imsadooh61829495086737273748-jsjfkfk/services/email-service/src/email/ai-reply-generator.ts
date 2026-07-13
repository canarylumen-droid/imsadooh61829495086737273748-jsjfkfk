import { generateExpertOutreach } from "@services/brain-worker/src/ai-lib/core/conversation-ai.js";

const PIVOT_AFTER_REPLIES = 5;

interface AiReplyParams {
  leadEmail: string;
  leadName: string;
  company: string;
  campaignContext: string;
  originalMessage: string;
  previousMessages: Array<{ subject: string; body: string; direction: 'outbound' | 'inbound' }>;
  userId: string;
  replyCount: number;
}

export async function generateAiReply(params: AiReplyParams): Promise<string> {
  const { leadName, company, originalMessage, previousMessages, userId, replyCount } = params;

  const conversationHistory = previousMessages
    .map(m => `[${m.direction === 'outbound' ? 'WE' : 'THEY'}] ${m.body}`)
    .join('\n\n');

  const prompt = `You are a sales assistant replying to a lead. Read the conversation and decide what to do.

LEAD: ${leadName}, ${company}
THEIR LATEST MESSAGE: "${originalMessage}"

HISTORY:
${conversationHistory || '(first reply)'}

DECIDE:
- If the lead is showing interest (asking about details, saying yes, wanting to learn more) → OFFER a booking link or call
- If they've been going back and forth for ${PIVOT_AFTER_REPLIES}+ messages without committing → GENTLY suggest a call
- If they're just asking a question → ANSWER it naturally

RULES:
- Max 80 words
- Plain text only, no HTML
- Sound human, not like a bot
- If offering a booking: make it natural, not pushy
- If answering: be helpful and conversational`;

  try {
    const result = await generateExpertOutreach(
      { name: leadName, email: params.leadEmail, company, additionalContext: prompt } as any,
      userId
    );

    if (result && result.body) {
      return stripNonPlainText(result.body);
    }

    return fallbackReply(leadName, replyCount, originalMessage);
  } catch (err: any) {
    console.warn(`[AiReply] Generation failed: ${err.message}`);
    return fallbackReply(leadName, replyCount, originalMessage);
  }
}

function fallbackReply(name: string, replyCount: number, message: string): string {
  const lower = message.toLowerCase();
  const soundsInterested = ['yes', 'sure', 'ok', 'tell me', 'interested', 'demo', 'pricing', 'schedule', 'book']
    .some(w => lower.includes(w));

  if (soundsInterested) {
    return `Great, ${name}! Let's get something on the calendar. Does this week work for you?`;
  }
  if (replyCount >= PIVOT_AFTER_REPLIES) {
    return `Hey ${name}, would a quick call make it easier to go over everything?`;
  }
  return `Thanks for the reply, ${name}! Happy to answer any questions.`;
}

function stripNonPlainText(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim();
}