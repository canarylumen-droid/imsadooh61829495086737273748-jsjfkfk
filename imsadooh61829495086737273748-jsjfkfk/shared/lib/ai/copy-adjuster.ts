import { db } from '@shared/lib/db/db.js';
import { messages } from "@audnix/shared";
import { and, eq, desc } from "drizzle-orm";

/**
 * Adjusts the outreach body based on the lead's most recent inbound message.
 * Applies strict guardrails to ensure the AI doesn't hallucinate or deviate from the campaign goal.
 */
export async function adjustCopyIfNecessary(params: {
  userId: string;
  leadId: string;
  originalBody: string;
  originalSubject?: string;
  isSubsequentReply?: boolean;
  currentStepIndex?: number;
  totalSteps?: number;
  sequenceHistory?: { subject: string; body: string; sentAt: Date }[];
  isBreakup?: boolean;
}): Promise<{ body: string; subject?: string; adjusted: boolean }> {
  const { userId, leadId, originalBody, originalSubject, isSubsequentReply, currentStepIndex, totalSteps, sequenceHistory, isBreakup } = params;

  try {
    // 1. Fetch the lead's last inbound message
    const [lastInbound] = await db.select()
      .from(messages)
      .where(and(eq(messages.leadId, leadId), eq(messages.direction, 'inbound')))
      .orderBy(desc(messages.createdAt))
      .limit(1);

    if (!lastInbound && !isBreakup) {
      return { body: originalBody, subject: originalSubject, adjusted: false };
    }

    // 2. Import Brain worker AI lib
    const { generateReply } = await import("@services/brain-worker/src/ai-lib/core/ai-service.js");

    const historyContext = sequenceHistory && sequenceHistory.length > 0
      ? `\nPREVIOUS MESSAGES SENT TO THIS LEAD:\n${sequenceHistory.map((msg, i) => `[Step ${i}] ${msg.sentAt.toISOString()}: ${msg.subject} - ${msg.body}`).join('\n')}`
      : '';

    const stepContext = currentStepIndex !== undefined && totalSteps !== undefined
      ? `\nSEQUENCE PACING: This is Follow-Up Step ${currentStepIndex} out of ${totalSteps}. Ensure the tone naturally fits this stage of the sequence without repeating past angles.`
      : '';

    const modePrompt = isBreakup
      ? `TAKEAWAY MODE: This is a "Breakup" email. The lead hasn't responded. 
         Rewrite the planned message: "${originalBody}" to be a polite, high-status "Takeaway". 
         Assume they are too busy or it's not a fit. Frame it as "I'll stop reaching out so I don't clutter your inbox". 
         Avoid sounding desperate or passive-aggressive. Be professional and elite.`
      : isSubsequentReply 
      ? `BRAINSTORM MODE: This is NOT the first reply. The lead has replied again. 
         Instead of the standard template: "${originalBody}", brainstorm a fresh, personalized response that continues the conversation naturally based on their new reply: "${lastInbound ? lastInbound.body : 'No recent reply found'}".`
      : `ADAPT MODE: You are an elite, contextual rewriter. 
         Rewrite the planned message: "${originalBody}" to directly acknowledge the lead's reply and their specific context. 
         Lead's reply: "${lastInbound ? lastInbound.body : 'No recent reply found'}".${stepContext}${historyContext}`;

    const prompt = `
STRICT GUARDRAIL: ${modePrompt}
If the lead's reply is just a simple acknowledgment or doesn't necessitate changing the core message, and it's NOT a brainstorming case, return the original message exactly as is. 
DO NOT hallucinate a completely new follow-up or skip to a different topic. 
Keep it concise, professional, zero-fluff, and matching the original tone. 
The goal is to book a call or move the deal forward based on the campaign intent.
`;

    const result = await generateReply(
      prompt,
      "Rewrite the outreach copy to better fit the conversation context.",
      { temperature: 0.7 } // Slightly higher for brainstorming
    );

    if (result && result.text && result.text.trim() !== originalBody.trim()) {
      console.log(`[CopyAdjuster] AI ${isSubsequentReply ? 'Brainstormed' : 'Adjusted'} copy for lead ${leadId}`);
      return { body: result.text, subject: originalSubject, adjusted: true };
    }

    return { body: originalBody, subject: originalSubject, adjusted: false };
  } catch (error: any) {
    console.error(`[CopyAdjuster] Error adjusting copy for lead ${leadId}:`, error.message);
    return { body: originalBody, subject: originalSubject, adjusted: false };
  }
}
