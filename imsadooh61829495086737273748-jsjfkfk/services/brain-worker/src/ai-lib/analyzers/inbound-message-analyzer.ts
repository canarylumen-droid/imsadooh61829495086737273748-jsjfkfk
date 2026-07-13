import { storage } from '@shared/lib/storage/storage.js';
import { analyzeLeadIntent, calculateLeadQualityScore, type IntentAnalysis } from "./intent-analyzer.js";
import { detectLeadIntent, assessChurnRisk, detectObjection, type ChurnRiskAssessment, type ObjectionDetectionResult, type IntentDetectionResult } from "../context/lead-intelligence.js";
import { detectCompetitorMention, type CompetitorMentionResult } from "./competitor-detection.js";
import { autoUpdateLeadStatus, detectConversationStatus } from "../core/conversation-ai.js";
import { learningEngine } from "../engines/learning-engine.js";
import { universalSalesAI } from "../../orchestrator/agents/universal-sales-agent.js";
import { createLogger } from '@services/api-gateway/src/core/logger.js';
import { killLeadSequence } from '@shared/lib/queues/sequence-killer.js';
import type { Message, Lead } from "@audnix/shared";

const log = createLogger('INBOUND-ANALYZER');

export interface InboundMessageAnalysis {
  leadId: string;
  messageId: string;
  timestamp: Date;
  intent: IntentAnalysis | null;
  deepIntent: IntentDetectionResult | null;
  objection: ObjectionDetectionResult | null;
  churnRisk: ChurnRiskAssessment | null;
  competitorMention: {
    mentionFound: boolean;
    competitors: string[];
    context: 'positive' | 'negative' | 'neutral' | 'comparison';
    actionSuggested: string;
  } | null;
  qualityScore: number;
  suggestedAction: string;
  shouldAutoReply: boolean;
  urgencyLevel: "critical" | "high" | "medium" | "low";
  analysisMetadata: Record<string, unknown>;
}

export async function analyzeInboundMessage(
  leadId: string,
  message: Message,
  lead: Lead
): Promise<InboundMessageAnalysis> {
  const timestamp = new Date();
  const messageBody = message.body || "";

  console.log(`🧠 [ANALYZER] Processing inbound message for lead ${leadId}`);

  const allMessages = await storage.getMessagesByLeadId(leadId);

  const conversationMessages = allMessages.map(m => ({
    direction: m.direction as "inbound" | "outbound",
    body: m.body,
    createdAt: m.createdAt,
    metadata: m.metadata,
  }));

  const leadProfile = {
    id: lead.id,
    name: lead.name || "Lead",
    firstName: lead.name?.split(" ")[0] || "Lead",
    company: (lead.metadata as any)?.company || "",
    email: lead.email || "",
    industry: (lead.metadata as any)?.industry || "",
    phone: lead.phone || "",
    metadata: lead.metadata || {},
    userId: lead.userId,
  };

  /* Synchronous call moved out of Promise.all for type safety and wrapped in try-catch if needed (though it's robust) */
  let competitorMention: CompetitorMentionResult | null = null;
  let priceObjection: any = null;
  try {
    competitorMention = await detectCompetitorMention(messageBody);
    const { detectPriceObjection } = await import("../specialized/price-negotiation.js");
    priceObjection = await detectPriceObjection(messageBody);
  } catch (err) {
    console.error("Specialized detection failed:", err);
  }

  const [intent, deepIntent, objection, churnRisk, qualityResult] = await Promise.all([
    analyzeLeadIntent(messageBody, {
      id: lead.id,
      name: lead.name || "Lead",
      channel: lead.channel,
      status: lead.status,
      tags: (lead.tags as string[]) || [],
    }).catch(err => {
      console.error("Intent analysis failed:", err);
      return null;
    }),

    detectLeadIntent(conversationMessages as any[], leadProfile as any).catch(err => {
      console.error("Deep intent analysis failed:", err);
      return null;
    }),

    detectObjection(messageBody).catch(err => {
      console.error("Objection detection failed:", err);
      return null;
    }),

    assessChurnRisk(leadProfile as any, conversationMessages as any[], calculateDaysAsLead(lead)).catch(err => {
      console.error("Churn risk assessment failed:", err);
      return null;
    }),

    calculateLeadQualityScore({
      id: lead.id,
      name: lead.name || "Lead",
      channel: lead.channel,
      status: lead.status,
      tags: (lead.tags as string[]) || [],
      created_at: lead.createdAt?.toISOString(),
    }).catch(err => {
      console.error("Quality score calculation failed:", err);
      return { score: 50, recommendation: "Continue nurturing" };
    }),
  ]);

  const urgencyLevel = determineUrgency(intent, deepIntent, objection, churnRisk, competitorMention, priceObjection);
  const suggestedAction = determineBestAction(intent, deepIntent, objection, churnRisk, competitorMention, qualityResult, priceObjection);

  // ─── POSITIVE INTENT DETECTION — SEQUENCE KILL + HAND-OFF ────────────────
  // This is the most critical block in the entire AI pipeline.
  // The instant a lead shows any real buying interest we:
  //   1. Kill all pending automated sequences (BullMQ + campaignLeads DB).
  //   2. Pause AI at the leads table level.
  //   3. Fire a human hand-off notification to the dashboard.
  //   4. Set status to 'qualified' (terminal hand-off state).
  // Auto-reply is explicitly disabled for positive leads — a human must close.
  const isPositiveIntent =
    intent?.readyToBuy === true ||
    intent?.wantsToSchedule === true ||
    deepIntent?.intentLevel === "high";

  let finalStatus = lead.status;

  if (isPositiveIntent && !['booked', 'converted', 'qualified'].includes(lead.status)) {
    log.info(`🔥 [ANALYZER] POSITIVE INTENT detected for lead ${leadId} — killing sequence and flagging for hand-off`);
    finalStatus = 'qualified';

    // Kill the sequence in the background — non-blocking so analysis result is
    // still returned quickly. The kill itself is logged and audited internally.
    killLeadSequence(
      leadId,
      lead.userId,
      'positive_intent_detected',
      deepIntent?.intentLevel || 'high',
      suggestedAction
    ).catch((e: any) =>
      log.error('[ANALYZER] killLeadSequence failed', { error: e.message })
    );
  } else if (deepIntent?.intentLevel === "not_interested" && lead.status !== "booked") {
    finalStatus = "not_interested";
  }

  // shouldAutoReply must be computed AFTER positive intent detection so it
  // returns false for hand-off leads (a human must close, not the AI).
  const shouldAutoReply = determineShouldAutoReply(lead, intent, urgencyLevel, isPositiveIntent);

  // Only run generic status auto-update for non-positive-intent leads.
  // For positive-intent leads, killLeadSequence already set the terminal state
  // ('qualified' + aiPaused=true). Calling autoUpdateLeadStatus here would
  // risk it overwriting aiPaused back to false (it hardcodes aiPaused:false).
  if (!isPositiveIntent) {
    await autoUpdateLeadStatus(leadId, allMessages);
  }

  const mappedCompetitorMention = competitorMention ? {
    mentionFound: competitorMention.detected,
    competitors: competitorMention.competitor ? [competitorMention.competitor] : [],
    context: competitorMention.context,
    actionSuggested: competitorMention.response 
  } : null;

  const analysisResult: InboundMessageAnalysis = {
    leadId,
    messageId: message.id,
    timestamp,
    intent,
    deepIntent,
    objection,
    churnRisk,
    competitorMention: mappedCompetitorMention,
    qualityScore: qualityResult?.score || 50,
    suggestedAction,
    shouldAutoReply,
    urgencyLevel,
    analysisMetadata: {
      messageLength: messageBody.length,
      wordCount: messageBody.split(/\s+/).length,
      hasQuestion: messageBody.includes("?"),
      channel: lead.channel,
      conversationLength: allMessages.length,
    },
  };

  await storage.updateLead(leadId, {
    status: finalStatus as any,
    score: qualityResult?.score || lead.score,
    metadata: {
      ...(lead.metadata as Record<string, unknown> || {}),
      lastAnalysis: {
        timestamp: timestamp.toISOString(),
        intent: intent?.sentiment,
        intentLevel: deepIntent?.intentLevel,
        intentScore: deepIntent?.intentScore,
        buyerStage: deepIntent?.buyerStage,
        urgency: urgencyLevel,
        suggestedAction,
        qualityScore: qualityResult?.score,
        churnRisk: churnRisk?.churnRiskLevel,
        hasObjection: (objection && objection.confidence > 0.5) || (priceObjection && priceObjection.detected),
        objectionCategory: priceObjection?.detected ? 'price' : objection?.category,
        competitorMentioned: competitorMention?.detected,
        competitorName: competitorMention?.competitor,
        priceNegotiationResponse: priceObjection?.response
      },
    },
  });

  // NEW: Also upsert into lead_insights table for dedicated analytical queries
  try {
    await storage.upsertLeadInsight({
      leadId,
      userId: lead.userId,
      intent: deepIntent?.intentLevel || intent?.sentiment || "neutral",
      intentScore: Math.round((deepIntent?.intentScore || (intent?.confidence || 0.5)) * 100),
      summary: suggestedAction,
      nextNextStep: suggestedAction,
      competitors: competitorMention?.detected && competitorMention.competitor ? [competitorMention.competitor] : [],
      painPoints: objection && objection.confidence >= 0.5 ? [objection.category] : [],
      lastAnalyzedAt: timestamp,
      metadata: {
        deepIntent,
        objection,
        urgencyLevel
      }
    });
  } catch (insightErr) {
    console.error("Failed to upsert lead insight:", insightErr);
  }

  // NEW: Log intent detection to audit trail for dashboard activity
  try {
    await storage.createAuditLog({
      userId: lead.userId,
      leadId,
      integrationId: message.integrationId || lead.integrationId,
      action: 'intent_detected',
      details: {
        message: `AI detected ${deepIntent?.intentLevel || 'neutral'} intent from ${lead.name}`,
        intentLevel: deepIntent?.intentLevel,
        intentScore: deepIntent?.intentScore,
        suggestedAction,
        urgencyLevel
      }
    });
  } catch (auditErr) {
    console.error("Failed to log intent to audit trail:", auditErr);
  }

  // ─── [LEARNING LOOP] INTEGRATION ─────────────────────────────────────────
  if (deepIntent?.intentLevel === "high" || finalStatus === "warm" || finalStatus === "booked") {
    const campaignId = (lead.metadata as any)?.campaignId;
    if (campaignId) {
      log.info(`📚 [LEARNING] High intent detected. Extracting winning pattern for campaign ${campaignId}`);
      
      // 1. Extract and store winning pattern for the whole campaign
      learningEngine.extractWinningPattern(lead.userId, campaignId, leadId).catch(e => {
        log.warn("Pattern extraction failed", { error: e.message });
      });

      // 2. Feed back into Universal Sales AI memory for immediate cross-lead benefit
      universalSalesAI.learnFromInteraction({
        leadId,
        userId: lead.userId,
        messageType: "follow_up",
        leadResponse: "interested",
        sentiment: "positive",
        timestamp: new Date(),
        whatWorked: messageBody
      }).catch(e => log.warn("Universal AI learning failed", { error: e.message }));
    }
  }

  console.log(`✅ [ANALYZER] Analysis complete for lead ${leadId}:`, {
    urgency: urgencyLevel,
    qualityScore: qualityResult?.score,
    sentiment: intent?.sentiment,
    shouldAutoReply,
  });

  return analysisResult;
}

function calculateDaysAsLead(lead: Lead): number {
  if (!lead.createdAt) return 0;
  const created = new Date(lead.createdAt);
  const now = new Date();
  return Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
}

function determineUrgency(
  intent: IntentAnalysis | null,
  deepIntent: IntentDetectionResult | null,
  objection: ObjectionDetectionResult | null,
  churnRisk: ChurnRiskAssessment | null,
  competitorMention: CompetitorMentionResult | null,
  priceObjection?: any
): "critical" | "high" | "medium" | "low" {
  if (intent?.readyToBuy || intent?.wantsToSchedule) return "critical";
  if (deepIntent?.intentLevel === "high") return "critical";

  if (competitorMention && (competitorMention as any).detected) return "high";
  if ((objection && objection.confidence > 0.7) || (priceObjection && priceObjection.detected)) return "high";
  if (churnRisk?.churnRiskLevel === "high") return "high";

  if (intent?.isInterested && (intent.confidence || 0) > 0.7) return "medium";
  if (deepIntent?.intentLevel === "medium") return "medium";

  return "low";
}

function determineShouldAutoReply(
  lead: Lead,
  intent: IntentAnalysis | null,
  urgency: string,
  isPositiveIntent: boolean = false
): boolean {
  if (lead.aiPaused) return false;
  if (intent?.isNegative) return false;

  // CRITICAL: Never auto-reply to a lead that has shown positive intent.
  // A human must handle closing — an AI follow-up here loses the sale.
  if (isPositiveIntent) return false;
  if (intent?.readyToBuy || intent?.wantsToSchedule) return false;

  // HARDENING: Only auto-reply if urgency is high or critical, 
  // or if the lead is warm/interested with high confidence.
  if (urgency === "critical" || urgency === "high") return true;
  
  if (intent?.isInterested && (intent.confidence || 0) > 0.85) return true;

  // Default to false for low urgency/low confidence to prevent "AI hallucination" noise
  return false;
}

function determineBestAction(
  intent: IntentAnalysis | null,
  deepIntent: IntentDetectionResult | null,
  objection: ObjectionDetectionResult | null,
  churnRisk: ChurnRiskAssessment | null,
  competitorMention: CompetitorMentionResult | null,
  qualityResult: { score: number; recommendation: string } | null,
  priceObjection?: any
): string {
  if (intent?.readyToBuy) return "🔥 CLOSE NOW: Lead is ready to buy - send booking link immediately";
  if (intent?.wantsToSchedule) return "📅 BOOK CALL: Lead wants to schedule - propose meeting times";

  if (competitorMention && (competitorMention as any).detected) {
    const competitorName = (competitorMention as any).competitor;
    return `🚨 COMPETITOR ALERT: ${competitorName} mentioned - differentiate and close`;
  }

  if (priceObjection && priceObjection.detected) {
    return `💰 PRICE NEGOTIATION: Lead mentioned ${priceObjection.keywords[0] || 'price'}. Suggested: ${priceObjection.response}`;
  }

  if (objection && objection.confidence > 0.6) {
    return `💬 HANDLE OBJECTION (${objection.category}): ${objection.suggestedResponse}`;
  }

  if (churnRisk?.churnRiskLevel === "high") {
    return `⚠️ CHURN RISK HIGH: ${churnRisk.recommendedAction}`;
  }

  if (deepIntent?.intentLevel === "high") return "🎯 HIGH INTENT: Push for booking - lead is warm";
  if (deepIntent?.intentLevel === "medium") return "📊 MEDIUM INTENT: Send case study or social proof";

  if (intent?.hasQuestion) return "❓ ANSWER QUESTION: Lead needs information - respond helpfully";
  if (intent?.needsMoreInfo) return "📚 EDUCATE: Send relevant content to build interest";

  return qualityResult?.recommendation || "📩 NURTURE: Continue conversation with value";
}

export async function processInboundMessageWithAnalysis(
  leadId: string,
  messageBody: string,
  channel: "instagram" | "email"
): Promise<InboundMessageAnalysis | null> {
  try {
    const lead = await storage.getLeadById(leadId);
    if (!lead) {
      console.error(`Lead ${leadId} not found`);
      return null;
    }

    const messages = await storage.getMessagesByLeadId(leadId);

    // Try exact body match first, fall back to latest inbound message
    let latestMessage = messages.find(m => m.body === messageBody);
    if (!latestMessage && messages.length > 0) {
      const inboundMessages = messages.filter(m => m.direction === 'inbound');
      latestMessage = inboundMessages[inboundMessages.length - 1] || messages[messages.length - 1];
      console.log(`[InboundAnalyzer] Body match failed — using latest inbound message for lead ${leadId}`);
    }

    if (!latestMessage) {
      // Create a synthetic message object from the data we have
      console.log(`[InboundAnalyzer] No message found — creating synthetic message for analysis on lead ${leadId}`);
      latestMessage = {
        id: `synthetic-${Date.now()}`,
        leadId,
        userId: lead.userId,
        provider: channel,
        direction: 'inbound',
        body: messageBody,
        createdAt: new Date(),
        updatedAt: new Date(),
        isRead: true,
        isWarmup: false,
        metadata: {},
        subject: '',
        audioUrl: null,
        integrationId: lead.integrationId || null,
        externalId: null,
        trackingId: null,
      } as Message;
    }

    return await analyzeInboundMessage(leadId, latestMessage, lead);
  } catch (error) {
    console.error("Error processing inbound message:", error);
    return null;
  }
}




