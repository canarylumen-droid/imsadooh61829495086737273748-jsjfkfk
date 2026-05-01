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
}): Promise<{ body: string; subject?: string; adjusted: boolean }> {
  const { userId, leadId, originalBody, originalSubject, isSubsequentReply } = params;

  try {
    // 1. Fetch the lead's last inbound message
    const [lastInbound] = await db.select()
      .from(messages)
      .where(and(eq(messages.leadId, leadId), eq(messages.direction, 'inbound')))
      .orderBy(desc(messages.createdAt))
      .limit(1);

    if (!lastInbound) {
      return { body: originalBody, subject: originalSubject, adjusted: false };
    }

    // 2. Import Brain worker AI lib
    const { generateReply } = await import("@services/brain-worker/src/ai-lib/core/ai-service.js");

    const modePrompt = isSubsequentReply 
      ? `BRAINSTORM MODE: This is NOT the first reply. The lead has replied again. 
         Instead of the standard template: "${originalBody}", brainstorm a fresh, personalized response that continues the conversation naturally based on their new reply: "${lastInbound.body}".`
      : `ADAPT MODE: Only rewrite the planned message: "${originalBody}" if the lead's reply requires direct acknowledgment. 
         Lead's reply: "${lastInbound.body}".`;

    const prompt = `
STRICT GUARDRAIL: ${modePrompt}
If the lead's reply is just a simple acknowledgment or doesn't necessitate changing the core message, and it's NOT a brainstorming case, return the original message exactly as is. 
DO NOT hallucinate a completely new follow-up or skip to a different topic. 
Keep it concise, professional, and matching the original tone. 
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
