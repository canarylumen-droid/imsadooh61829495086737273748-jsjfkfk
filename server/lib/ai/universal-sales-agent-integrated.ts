/**
 * INTEGRATION LAYER
 * Connects Universal Sales Agent with TIER 1 & TIER 4 Features
 * 
 * When generating messages, ALSO consider:
 * - Lead intent (are they ready?)
 * - Deal prediction (what's the deal worth?)
 * - Churn risk (are they slipping?)
 * - Smart objection handling
 */

import type { ConversationMessage, BrandContext, LeadProfile } from "../../../shared/types.js";
import type { Lead } from "../../../shared/schema.js";
import {
  generateOptimizedMessage,
  universalSalesAI,
  type SalesLeadProfile,
  type SalesBrandContext,
  type Testimonial,
  type OptimizedMessageResult
} from "./universal-sales-agent.js";
import { calculateLeadScore } from "./lead-management.js";
import {
  detectLeadIntent,
  suggestSmartReply,
  predictDealAmount,
  assessChurnRisk,
  type IntentDetectionResult,
  type ChurnRiskAssessment,
  type SmartReplyOption
} from "./lead-intelligence.js";
import {
  generateAutonomousObjectionResponse,
  recordObjectionLearning
} from "./autonomous-objection-responder.js";
import {
  generateFollowRequest,
  shouldAskForFollow,
  handleFollowResponse
} from "./follow-request-handler.js";

interface LeadWithProfile extends SalesLeadProfile {
  id: string;
  userId: string;
  organizationId?: string | null;
  externalId?: string | null;
  verified?: boolean;
  verifiedAt?: Date | null;
  name?: string;
  brandName?: string;
  userIndustry?: string;
  pdfContext?: string;
  channel?: string;
  status?: string;
  role?: string | null;
  bio?: string | null;
}

interface ScoringMessage {
  direction: "inbound" | "outbound";
  createdAt: Date | string;
  opened?: boolean;
  clicked?: boolean;
  metadata?: Record<string, unknown>;
}

interface ContextAwareMessageResult {
  message: string;
  quality: OptimizedMessageResult["quality"];
  intelligence: {
    score: number;
    intent: IntentDetectionResult["intentLevel"];
    dealValue: number;
    churnRisk: ChurnRiskAssessment["churnRiskLevel"];
  };
  explanation: string;
  autonomousClosing: string;
}

interface AutoObjectionResponse {
  response: string;
  strategy: string;
  confidence: number;
  nextAction: string;
}

interface LeadResponseResult {
  intent: IntentDetectionResult;
  suggestedReplies: SmartReplyOption[];
  autonomousResponse: AutoObjectionResponse | null;
  nextAction: string;
}

interface FollowUpResult {
  action: "skip" | "wait" | "send_followup";
  reason?: string;
  days_until_next_followup?: number;
  message?: string;
  type?: string;
  reasoning?: string;
}

function convertToSchemaLead(lead: LeadWithProfile): Lead {
  return {
    id: lead.id,
    userId: lead.userId,
    organizationId: lead.organizationId || null,
    externalId: lead.externalId || null,
    name: lead.name || lead.firstName || "Lead",
    email: lead.email || null,
    phone: lead.phone || null,
    company: lead.company || null,
    role: lead.role || null,
    bio: lead.bio || null,
    channel: "email" as const,
    status: "new" as const,
    verified: lead.verified || false,
    verifiedAt: lead.verifiedAt || null,
    score: 0,
    warm: false,
    lastMessageAt: null,
    aiPaused: false,
    pdfConfidence: null,
    tags: lead.tags || [],
    metadata: lead.metadata || {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function convertToLeadProfile(lead: LeadWithProfile): LeadProfile {
  return {
    id: lead.id,
    userId: lead.userId,
    name: lead.name || lead.firstName || "Lead",
    firstName: lead.firstName,
    email: lead.email,
    phone: lead.phone,
    channel: "email" as const,
    status: "new" as const,
    score: 0,
    warm: false,
    tags: [],
    metadata: lead.metadata || {},
    organizationId: lead.organizationId || null,
    verified: lead.verified || false,
    verifiedAt: lead.verifiedAt || null,
    createdAt: new Date(),
    updatedAt: new Date(),
    aiPaused: false,
  };
}

function convertToScoringMessages(messages: ConversationMessage[]): ScoringMessage[] {
  return messages.map(m => ({
    direction: m.direction,
    createdAt: m.createdAt,
    opened: false,
    clicked: false,
    metadata: m.metadata
  }));
}

export async function generateContextAwareMessage(
  lead: LeadWithProfile,
  brandContext: SalesBrandContext | BrandContext,
  testimonials: Testimonial[],
  messages: ConversationMessage[] = []
): Promise<ContextAwareMessageResult> {
  /**
   * Generate message that considers:
   * 1. Lead score (warm/hot/cold)
   * 2. Lead intent (ready to buy?)
   * 3. Deal prediction (what's it worth?)
   * 4. Churn risk (are they slipping?)
   */

  const schemaLead = convertToSchemaLead(lead);
  const leadProfile = convertToLeadProfile(lead);
  const scoringMessages = convertToScoringMessages(messages);

  // Get all insights in parallel
  const [score, intent, prediction, churnRisk] = await Promise.all([
    calculateLeadScore(schemaLead, scoringMessages),
    detectLeadIntent(messages, leadProfile),
    predictDealAmount(leadProfile, messages),
    assessChurnRisk(leadProfile, messages),
  ]);

  // Determine message stage based on intelligence
  let stage: "cold" | "follow_up" | "objection" | "closing" = "cold";
  if (score >= 80 && intent.intentLevel === "high") stage = "closing";
  else if (score >= 60 && intent.buyerStage === "decision") stage = "objection";
  else if (score >= 50) stage = "follow_up";

  // INJECT BRAND PDF CONTEXT IF AVAILABLE
  const user = await storage.getUserById(lead.userId);
  const pdfContext = (user?.metadata as any)?.businessDescription || (user?.metadata as any)?.extracted_text || "";
  
  const enhancedLead = {
    ...lead,
    pdfContext: pdfContext || lead.pdfContext
  };

  // Generate base message
  const baseMessage = await generateOptimizedMessage(enhancedLead, brandContext, testimonials, stage);

  // Enhance message based on intelligence
  let enhancedMessage = baseMessage.message;

  // If high deal value, mention ROI more
  if (prediction.predictedAmount > 50000) {
    enhancedMessage = enhancedMessage.replace(/results/i, "significant ROI improvement - we're talking $50k+ impact");
  }

  // If churn risk is high, add urgency
  if (churnRisk.churnRiskLevel === "high") {
    enhancedMessage = "⏰ Quick check-in: " + enhancedMessage;
  }

  // If intent is high, add confidence
  if (intent.intentLevel === "high") {
    enhancedMessage = enhancedMessage.replace(/\?$/, "? (Perfect timing - let's move forward)");
  }

  // Map stage to messageType for learning
  const messageTypeMap: Record<string, "cold_outreach" | "follow_up" | "objection_response" | "closing"> = {
    cold: "cold_outreach",
    follow_up: "follow_up",
    objection: "objection_response",
    closing: "closing"
  };

  // Learn from this generation
  await universalSalesAI.learnFromInteraction({
    leadId: lead.id,
    messageType: messageTypeMap[stage],
    leadResponse: "no_response",
    sentiment: "neutral",
    timestamp: new Date(),
  });

  return {
    message: enhancedMessage,
    quality: baseMessage.quality,
    intelligence: {
      score,
      intent: intent.intentLevel,
      dealValue: prediction.predictedAmount,
      churnRisk: churnRisk.churnRiskLevel,
    },
    explanation: `Score: ${score}/100 | Intent: ${intent.intentLevel} | Deal: $${prediction.predictedAmount} | Risk: ${churnRisk.churnRiskLevel}`,
    autonomousClosing: "Enabled - AI will autonomously respond to objections to close deals",
  };
}

export async function handleLeadResponseWithLearning(
  lead: LeadWithProfile,
  theirMessage: string,
  messages: ConversationMessage[]
): Promise<LeadResponseResult> {
  /**
   * When lead responds:
   * 1. Detect if they're interested
   * 2. Detect any objections
   * 3. AUTONOMOUSLY RESPOND TO OBJECTIONS (turn them into closes)
   * 4. Learn for next time
   */

  const leadProfile = convertToLeadProfile(lead);

  const brandContext: BrandContext = {
    businessName: lead.brandName || "Our platform",
    productInfo: {
      name: lead.brandName || "Our solution",
    }
  };

  // Get intent immediately
  const intent = await detectLeadIntent(messages, leadProfile);

  // CHECK: Did they agree to follow us? (Instagram specific logic)
  if (lead.channel === 'instagram') {
    const followResult = await handleFollowResponse(lead.id, theirMessage, 'instagram');
    if (followResult.wantsToFollow && followResult.followButtonUrl) {
      return {
        intent: {
          intentLevel: "high",
          intentScore: 0.9,
          buyerStage: "decision",
          signals: ["confirmed_follow"],
          reasoning: "Lead expressed strong interest by agreeing to follow."
        },
        suggestedReplies: [{
          reply: `That's great! Here is the link to follow our page: ${followResult.followButtonUrl} \n\nLooking forward to staying connected!`,
          confidence: 1.0,
          reasoning: "Encourages social follow as requested"
        }],
        autonomousResponse: {
          response: `Awesome! You can follow us right here: ${followResult.followButtonUrl} \n\nI share exclusive tips there daily. Let me know once you've followed!`,
          strategy: "social_conversion",
          confidence: 1.0,
          nextAction: "Monitor for follow based on platform webhook"
        },
        nextAction: "Send Instagram Profile Link"
      };
    }
  }

  // AUTONOMOUS OBJECTION HANDLING: If they said "no", "maybe", or raised objection
  let autonomousResponse: AutoObjectionResponse | null = null;

  const lowerMessage = theirMessage.toLowerCase();
  if (intent.intentLevel === "low" || intent.intentLevel === "not_interested" ||
    lowerMessage.includes("let me") ||
    lowerMessage.includes("not sure") ||
    lowerMessage.includes("no") ||
    lowerMessage.includes("maybe") ||
    lowerMessage.includes("think")) {

    // GENERATE AUTONOMOUS CLOSING RESPONSE
    autonomousResponse = await generateAutonomousObjectionResponse(theirMessage, {
      leadName: lead.name || lead.firstName || "there",
      leadCompany: lead.company || lead.companyName,
      leadIndustry: (lead.metadata?.industry as string) || "general",
      previousMessages: messages.map((m) => ({
        role: m.direction === "inbound" ? "user" : "assistant",
        content: m.body
      })),
      brandName: lead.brandName || "Our platform",
      userIndustry: lead.userIndustry || "all",
      pdfContext: lead.pdfContext,
    });

    // Record what we learned
    await recordObjectionLearning({
      leadId: lead.id,
      industry: (lead.metadata?.industry as string) || "general",
      objectionType: "identified",
      responseUsed: autonomousResponse.response,
      leadReply: theirMessage,
      dealClosed: false,
    });
  }

  // Get smart reply suggestions (backup)
  const smartReplies = await suggestSmartReply(theirMessage, leadProfile, brandContext, messages);

  // CHECK: Should we ask for a follow? (Growth Hack)
  if (lead.channel === 'instagram') {
    const shouldAsk = await shouldAskForFollow(lead.id);
    if (shouldAsk) {
      const followRequestMsg = await generateFollowRequest({
        leadName: lead.name || "friend",
        leadStatus: lead.status as any, // Cast status to match
        isBrand: !!lead.organizationId,
        channel: 'instagram'
      });

      // Add as a high-confidence suggestion
      smartReplies.unshift({
        reply: followRequestMsg,
        confidence: 0.95,
        reasoning: "Growth hack: Encourages engagement via follow request"
      });
    }
  }

  // Learn from this interaction
  await universalSalesAI.learnFromInteraction({
    leadId: lead.id,
    messageType: intent.intentLevel === "high" ? "follow_up" : "objection_response",
    leadResponse: intent.intentLevel === "high" ? "interested" : "objection",
    sentiment: theirMessage.includes("!") || theirMessage.includes("?") ? "positive" : "neutral",
    timestamp: new Date(),
    whatWorked: autonomousResponse ? "autonomous objection closed" : smartReplies[0]?.reply,
  });

  return {
    intent,
    suggestedReplies: smartReplies,
    autonomousResponse,
    nextAction: autonomousResponse
      ? "Send autonomous closing response - turn objection to YES"
      : intent.intentLevel === "high" ? "Schedule call" : "Send case study",
  };
}

export async function autoGenerateFollowUp(
  lead: LeadWithProfile,
  messages: ConversationMessage[],
  daysSinceLastContact: number
): Promise<FollowUpResult> {
  /**
   * Automatically generate best follow-up based on:
   * - Lead score
   * - Intent level  
   * - Days since last contact
   * - Deal value
   */

  const schemaLead = convertToSchemaLead(lead);
  const leadProfile = convertToLeadProfile(lead);
  const scoringMessages = convertToScoringMessages(messages);

  const score = await calculateLeadScore(schemaLead, scoringMessages);
  const intent = await detectLeadIntent(messages, leadProfile);

  // Skip if too hot (already in conversation)
  if (messages.length > 0 && messages[messages.length - 1] && daysSinceLastContact < 1) {
    return { action: "skip", reason: "Lead responded recently" };
  }

  // Follow up cadence based on score
  let shouldFollowUp = false;
  let followUpType = "";

  if (score >= 80) {
    // Hot lead: follow up if 2+ days
    shouldFollowUp = daysSinceLastContact >= 2;
    followUpType = "urgency";
  } else if (score >= 60) {
    // Warm lead: follow up if 5+ days
    shouldFollowUp = daysSinceLastContact >= 5;
    followUpType = "value";
  } else {
    // Cold lead: follow up if 10+ days
    shouldFollowUp = daysSinceLastContact >= 10;
    followUpType = "new_angle";
  }

  if (!shouldFollowUp) {
    return { action: "wait", days_until_next_followup: Math.ceil(daysSinceLastContact) };
  }

  // Generate contextual follow-up
  let followUpMessage = "";
  const industry = (lead.metadata?.industry as string) || "your industry";
  const company = lead.company || lead.companyName || "your company";
  const firstName = lead.firstName || "there";

  if (followUpType === "urgency") {
    followUpMessage = `Quick update: We've helped ${industry} companies like yours see results in 30 days. Timeline working for you?`;
  } else if (followUpType === "value") {
    followUpMessage = `${firstName}, wanted to share a case study that might be relevant to ${company}. Similar company: 40% faster results. Worth a 5-min chat?`;
  } else {
    followUpMessage = `Different angle on ${company}: Most of your competitors are missing one key thing. Can I show you?`;
  }

  return {
    action: "send_followup",
    message: followUpMessage,
    type: followUpType,
    reasoning: `Score ${score}/100, Intent: ${intent.intentLevel}, Days since contact: ${daysSinceLastContact}`,
  };
}
