import { generateReply } from "@services/brain-worker/src/ai-lib/core/ai-service.js";
import { extractJson } from "@shared/lib/utils/json-util.js";
import { db } from '@shared/lib/db/db.js';
import { leads, auditTrail, followUpQueue, users, aiActionLogs } from '@audnix/shared';
import { eq, desc, and } from 'drizzle-orm';
import { calendlyOAuth } from "@services/api-gateway/src/oauth/calendly.js";
import { availabilityService } from "@shared/lib/calendar/availability-service.js";
import ObjectionHandler from "@services/outreach-worker/src/sales-engine/objection-handler.js";
import { searchSimilarChunks, userHasChunks } from "../../ai-lib/context/vector-rpc.js";

export interface AgentActionDecision {
  action: 'send_payment_link' | 'send_invoice' | 'schedule_followup' | 'book_meeting' | 'request_info' | 'pause_nurture' | 'unknown';
  reasoning: string;
  delayDays: number;
  confidence: number;
  intentScore: number;
  emailSubject?: string;
  emailBody?: string;
  spacingReasoning?: string;
  attachedAssetUrl?: string; // Phase 16: Attached RAG asset
}

// NOTE: CASE_STUDY_DB has been removed. The agent now uses real semantic
// search against the user's uploaded Brand PDF via pgvector.
// If no PDF is uploaded, the agent gracefully skips asset attachment.

/**
 * Autonomous agent core mapping text summaries from Fathom 
 * directly into business logic actions (Next Best Action framework)
 */
export async function evaluateNextBestAction(leadId: string, summary: string): Promise<AgentActionDecision> {
  const leadMatch = await db.select().from(leads).where(eq(leads.id, leadId));
  if (leadMatch.length === 0) {
    return { action: 'unknown', reasoning: 'Lead not found', delayDays: 0, confidence: 0, intentScore: 0 };
  }
  const lead = leadMatch[0];

  const userMatch = await db.select().from(users).where(eq(users.id, lead.userId));
  const user = userMatch[0];
  const config = (user?.config as any) || {};

  const bookingLink = await (calendlyOAuth as any).getBookingLink?.(lead.userId) ?? null;
  const suggestedSlots = await availabilityService.getSuggestedTimes(lead.userId);
  const formattedSlots = availabilityService.formatSlotsForAI(suggestedSlots);

  // Strategic Intelligence (Deep Research)
  const intelligence = (user as any)?.intelligenceMetadata || {};
  const strategicContext = `
### Strategic Intelligence (Deep Research)
- Competitors: ${JSON.stringify(intelligence.competitors || [])}
- Market Gaps: ${JSON.stringify(intelligence.marketGaps || [])}
- Our Differentiators: ${JSON.stringify(intelligence.differentiators || [])}
- UVP: ${intelligence.uvp || 'Standard premium offering'}
- Why We Win: ${intelligence.whyYouWin || ""}
`;

  // Detect and format objections
  const analysis = ObjectionHandler.analyzeObjection(summary);
  const objectionContext = analysis.reframes.length > 0 ? `Objection playbook:\n- ${analysis.reframes.join('\n- ')}\nNext step: ${analysis.nextStep}` : 'No specific objection detected.';

  // Phase 14 (Real RAG): Retrieve semantically relevant brand content from user's PDF
  const hasPdfContext = await userHasChunks(lead.userId);
  let ragContext = '';
  let ragSuggestion = '';
  if (hasPdfContext) {
    const relevantChunks = await searchSimilarChunks(summary, lead.userId, 3)
      .catch(() => []);
    if (relevantChunks.length > 0) {
      ragContext = `\n\n### Relevant Brand Knowledge (from your uploaded PDF):\n` +
        relevantChunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n---\n');
    }
  } else {
    ragSuggestion = `\n\n💡 TIP: You have not uploaded a Brand PDF yet. Upload one in Settings → Brand PDF to dramatically improve AI email quality and attach real case studies.`;
  }

  const systemPrompt = `
You are an "Expert SDR Manager" AI at Audnix. You are NOT a dull assistant; you are a high-performing closer.
Your goal: Determine the single Next Best Action (NBA) from a call summary and draft a "Level 5" autonomous email that moves the needle.

### Context
- Expert/Sender: ${user?.name || 'the team'}
- Booking Link: ${bookingLink || 'Ask for availability'}
- Real-Time Availability (SUGGEST THESE): ${formattedSlots}
${ragContext}
${strategicContext}

### Objection Handling & Battle Cards (STRICT ANTI-HALLUCINATION)
${objectionContext}
RULE 1: If drafting an objection response, ONLY use facts from the Brand Knowledge section above.
RULE 2: Do NOT invent features, pricing, or timelines. If unsure, request another meeting.
RULE 3: Do NOT chase aggressively if the lead is cold. Be respectful to preserve the deal.
RULE 4: If no Brand Knowledge is available, keep the email generic but professional — never fabricate specifics.

### Decision rules for CLOSING (Expert Mode)
1. **Target 3-Email Conversion**: Do not waste time on fluff. Be direct, value-driven.
2. **Specific Availability**: If the action is "book_meeting", YOU MUST propose 2-3 specific times from the Availability list provided above. Example: "I'm free Wednesday at 2pm or Thursday at 10am. Does either work?"
3. **24/7 Autonomy**: You operate around the clock. Respond ASAP to hot leads.
4. **NO CHASING**: Set \`delayDays\` if the lead says "next month" or "traveling". Cite their specific reasoning.
5. **No Placeholders**: Never use [Name] or [Link]. Use the real data provided.

### Asset Attachment (Phase 15: Content Matching)
If the lead has a specific objection/need, map it to one of these categories to attach a case study:
"pricing", "competitor", "trust", "timing", "features".
Return this category in \`attachedAssetCategory\` if applicable.

### Available Actions
- send_payment_link: Ready for checkout.
- send_invoice: Asked for formal billing.
- book_meeting: Agreed to follow-up/demo. Propose specific times + Link.
- schedule_followup: "Cool down" required. 
- request_info: Asked for pitch deck/case studies.
- pause_nurture: Said "No" or requested DNC.
- unknown: No clear signal.

### Output JSON Format
{
  "action": "...",
  "reasoning": "Internal strategic reasoning",
  "delayDays": number,
  "confidence": 0-1.0,
  "intentScore": 0-100,
  "emailSubject": "1-6 word punchy subject",
  "emailBody": "2-4 sentence expert email body. Lead with value. Include specific slots if booking.",
  "spacingReasoning": "Why this specific delay? Citing lead verbatim if possible.",
  "attachedAssetCategory": "pricing | competitor | trust | timing | features | null"
}
`;

  const userPrompt = `Lead: ${lead.name} (${lead.company || 'Unknown'})\nPost Call Summary:\n${summary}`;

  let decision: AgentActionDecision = {
    action: 'unknown',
    reasoning: 'Failed to process AI logic',
    delayDays: 0,
    confidence: 0,
    intentScore: 0
  };

  try {
    const result = await generateReply(systemPrompt, userPrompt, { jsonMode: true, temperature: 0.1 });
    const parsed = extractJson<any>(result.text);

    // Real RAG: If AI identifies an objection category, find the best matching
    // chunk from the user's PDF via semantic search instead of a fake URL dict.
    let finalEmailBody = parsed.emailBody || '';
    let attachedUrl: string | undefined = undefined;

    if (parsed.attachedAssetCategory && hasPdfContext) {
      const assetChunks = await searchSimilarChunks(
        `${parsed.attachedAssetCategory} case study results`,
        lead.userId,
        1
      ).catch(() => []);

      if (assetChunks.length > 0 && assetChunks[0].similarity > 0.65) {
        // Append the most relevant excerpt instead of a fake link
        const assetSource = assetChunks[0].fileName;
        const assetSnippet = assetChunks[0].content.substring(0, 400);
        
        // Strategic framing for the attachment based on versioning
        finalEmailBody += `\n\nP.S. I thought this excerpt from our "${assetSource}" would be relevant to our discussion:\n\n"${assetSnippet}..."`;
        
        console.log(`📎 [AutonomousAgent] Attached asset from ${assetSource} (Similarity: ${assetChunks[0].similarity})`);
      }
    }

    // Append the PDF suggestion to reasoning if no chunks found
    if (!hasPdfContext) {
      console.log(`[AutonomousAgent] ℹ️ No Brand PDF found for user ${lead.userId}. Skipping asset attachment. ${ragSuggestion}`);
    }

    decision = {
      action: parsed.action || 'unknown',
      reasoning: parsed.reasoning || '',
      delayDays: parsed.delayDays || 0,
      confidence: parsed.confidence || 0.5,
      intentScore: parsed.intentScore || 50,
      emailSubject: parsed.emailSubject,
      emailBody: finalEmailBody,
      spacingReasoning: parsed.spacingReasoning,
      attachedAssetUrl: attachedUrl
    };
  } catch (error) {
    console.error("[Autonomous Agent] Failed to process action logic:", error);
    throw new Error(`Failed to process Autonomous Agent logic: ${(error as Error).message}`);
  }

  // 1. Check Global Engine Toggle
  if (!config.autonomousMode) {
    console.log(`ℹ️ [Autonomous Agent] Skipping action execution for Lead ${lead.email} because AI Engine is OFF.`);
    
    // Still log the decision to the feed (Simulated Mode)
    await db.insert(aiActionLogs).values({
      userId: lead.userId,
      leadId: lead.id,
      actionType: decision.action === 'book_meeting' ? 'calendar_booking' : 'follow_up',
      decision: 'skip',
      intentScore: decision.intentScore,
      confidence: decision.confidence,
      reasoning: `[SIMULATED] ${decision.reasoning} | Spacing: ${decision.spacingReasoning} (Skipped: AI Engine OFF)`,
      createdAt: new Date()
    });
    
    return decision;
  }

  // 2. Safety Check: Don't chase too hard (Wait at least 1 day between autonomous Fathom actions)
  const recentLogs = await db.select()
    .from(aiActionLogs)
    .where(and(eq(aiActionLogs.leadId, lead.id), eq(aiActionLogs.decision, 'act')))
    .orderBy(desc(aiActionLogs.createdAt))
    .limit(1);

  if (recentLogs.length > 0) {
    const hoursSinceLastAction = (Date.now() - new Date(recentLogs[0].createdAt).getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastAction < 24 && decision.delayDays === 0) {
      console.log(`[Autonomous Agent] 🛡️ Anti-chase safety: Forcing 1-day delay for ${lead.email}`);
      decision.delayDays = 1;
    }
  }

  // 3. Log to Dashboard Feed
  await db.insert(aiActionLogs).values({
    userId: lead.userId,
    leadId: lead.id,
    actionType: decision.action === 'book_meeting' ? 'calendar_booking' : 'follow_up',
    decision: decision.action === 'unknown' ? 'skip' : 'act',
    intentScore: decision.intentScore,
    confidence: decision.confidence,
    reasoning: `${decision.reasoning} | Spacing: ${decision.spacingReasoning}`,
    createdAt: new Date()
  });

  // 4. Action Routing
  const scheduledDate = new Date();
  scheduledDate.setDate(scheduledDate.getDate() + (decision.delayDays || 0));

  if (['send_payment_link', 'send_invoice', 'book_meeting', 'schedule_followup', 'request_info'].includes(decision.action)) {
    const isReady = decision.action !== 'schedule_followup'; // schedule_followup is pure delay
    
    await db.insert(followUpQueue).values({
      userId: lead.userId,
      leadId: lead.id,
      channel: lead.channel || 'email',
      scheduledAt: scheduledDate,
      status: 'pending',
      context: {
        intent: decision.action,
        reasoning: decision.reasoning,
        suggestedSubject: decision.emailSubject,
        suggestedBody: decision.emailBody,
        source: 'fathom_autonomous_engine'
      }
    });

    // Auto-unpause if we decided to act
    if (lead.aiPaused) {
      await db.update(leads).set({ aiPaused: false }).where(eq(leads.id, lead.id));
    }
  } else if (decision.action === 'pause_nurture') {
    await db.update(leads)
      .set({ aiPaused: true, status: 'hardened' })
      .where(eq(leads.id, lead.id));
  }

  return decision;
}





