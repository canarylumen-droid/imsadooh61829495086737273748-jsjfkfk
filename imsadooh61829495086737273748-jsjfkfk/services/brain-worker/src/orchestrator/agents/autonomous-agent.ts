import { generateReply } from "@services/brain-worker/src/ai-lib/core/ai-service.js";
import { extractJson } from "@shared/lib/utils/json-util.js";
import { db } from '@shared/lib/db/db.js';
import { leads, auditTrail, followUpQueue, users, notifications, aiActionLogs } from '@audnix/shared';
import { eq, desc, and } from 'drizzle-orm';
import { calendlyOAuth } from "@services/api-gateway/src/oauth/calendly.js";
import { availabilityService } from "@shared/lib/calendar/availability-service.js";
import ObjectionHandler from "@services/outreach-worker/src/sales-engine/objection-handler.js";
import { searchSimilarChunks, userHasChunks } from "../../ai-lib/context/vector-rpc.js";

export interface AgentActionDecision {
  action: 'schedule_followup' | 'book_meeting' | 'request_info' | 'pause_nurture' | 'unknown';
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

    // Fetch Deal Value for $5k Rule
    const { deals } = await import('@audnix/shared');
    const [deal] = await db.select().from(deals).where(eq(deals.leadId, lead.id)).limit(1);
    const dealValue = deal?.value ? Number(deal.value) : (user?.metadata as any)?.offerValue || 0;

    const systemPrompt = `
## IDENTITY
You are an Expert SDR Manager at Audnix. You are NOT a dull assistant — you are a high-performing closer who makes decisions autonomously.

## MISSION
From a call summary and lead context, determine the single Next Best Action (NBA) and draft a Level 5 autonomous email that moves the deal forward.

## CONTEXT
- Expert/Sender: ${user?.name || 'the team'}
- Booking Link: ${bookingLink || 'Ask for availability'}
- Real-Time Availability (SUGGEST THESE): ${formattedSlots}
- Deal Value: $${dealValue}
${ragContext}
${strategicContext}

## 🔒 NGA-1 COMPLIANCE & ANTI-HALLUCINATION (STRICT)
1. **$5k Threshold Rule**: If Deal Value is $5,000+, you MUST NOT send a payment link. Propose a human handoff / strategy call (action: "book_meeting").
2. **ZERO HALLUCINATION**: ONLY use facts from the sections provided. Do not invent features, pricing, timelines, or case studies.
3. **No Fake Facts**: Every claim in the email must be traceable to the provided context.
4. **Objection Responses**: ${objectionContext}
   - ONLY use facts from Brand Knowledge. Do not invent.
   - If unsure, request another meeting rather than guessing.
   - If lead is cold, do not chase aggressively. Respect preserves the deal.
   - If no Brand Knowledge is available, DO NOT fabricate. Prioritize booking a call with specific times from Availability.

## DECISION RULES (EXPERT MODE)
1. **Target 3-Email Conversion**: Be direct and value-driven. No fluff.
2. **Specific Availability**: If "book_meeting", propose 2-3 specific times from the Availability list. Example: "Wednesday at 2pm or Thursday at 10am — does either work?"
3. **24/7 Autonomy**: Respond ASAP to hot leads. Use delayDays for cold/warm leads.
4. **NO CHASING**: Set delayDays if lead says "next month" or "traveling". Cite their specific reasoning.
5. **No Placeholders**: Never use [Name] or [Link]. Use real data.
6. **Asset Attachment**: Map objections/needs to: "pricing", "competitor", "trust", "timing", "features".

## AVAILABLE ACTIONS
- book_meeting: Lead is interested or ready. Propose specific times + Booking Link.
- schedule_followup: Cool down required. Set appropriate delayDays.
- request_info: Asked for pitch deck/case studies. Attach relevant asset.
- pause_nurture: Said "No" or requested DNC. Respect it.
- unknown: No clear signal. Default to gentle follow-up.

## ✅ EMAIL BODY — GOOD EXAMPLE
"Hey [Name] — thanks again for the time. Based on what you shared about [their specific pain point], I think [specific angle] would be a game-changer for you.
I'm free Wednesday at 2pm or Thursday at 10am your time. Which works better?"

## ❌ EMAIL BODY — BAD EXAMPLE
"I hope this message finds you well. I wanted to follow up on our call to see if you had any questions about our platform. Our solution offers..."
(Long, generic, no specific times proposed, no reference to their actual situation.)

## OUTPUT FORMAT (JSON ONLY)
{
  "action": "book_meeting | schedule_followup | request_info | pause_nurture | unknown",
  "reasoning": "Internal strategic reasoning — why this action?",
  "delayDays": number,
  "confidence": 0.0-1.0,
  "intentScore": 0-100,
  "emailSubject": "1-6 word punchy subject",
  "emailBody": "2-4 sentence expert email. Lead with value. Include specific slots if booking.",
  "spacingReasoning": "Why this specific delay? Cite lead verbatim if possible.",
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
    const result = await generateReply(systemPrompt, userPrompt, { jsonMode: true, temperature: 0.1, nga1Enforced: true });
    const parsed = extractJson<any>(result.text);

    // Payments are admin-only — always redirect to booking
    if (parsed.action === 'send_payment_link' || parsed.action === 'send_invoice') {
        console.warn(`[NGA-1] AI proposed payment action for lead. Overriding to book_meeting — admin handles payments manually.`);
        parsed.action = 'book_meeting';
        parsed.reasoning += " (Payment redirect: admin handles payments manually, booking call instead)";
    }


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

  if (['book_meeting', 'schedule_followup', 'request_info'].includes(decision.action)) {
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
  } else {
    // Payment actions and unknown — create notification for admin to handle
    await db.insert(notifications).values({
      userId: lead.userId,
      type: 'info',
      title: '👋 Lead Needs Manual Attention',
      message: `Lead ${lead.name} (${lead.email}) is ready for next step. AI suggestion: ${decision.action}. Reason: ${decision.reasoning}`,
      metadata: { leadId: lead.id, action: decision.action, reasoning: decision.reasoning }
    });
  }

  return decision;
}





