/**
 * TIER 4: AI INTELLIGENCE SERVICE
 * 
 * Handles:
 * - Lead Intent Detection
 * - Smart Reply Suggestions
 * - Objection Pattern Recognition
 * - Deal Amount Prediction
 * - Churn Risk Scoring
 * - Competitor Mention Alerts
 */

import { generateReply } from "../core/ai-service.js";
import { MODELS } from "../utils/model-config.js";
import type { ConversationMessage, LeadProfile, BrandContext } from '@shared/types.js';

export interface IntentDetectionResult {
  intentLevel: "high" | "medium" | "low" | "not_interested";
  intentScore: number;
  buyerStage: "awareness" | "consideration" | "decision";
  signals: string[];
  reasoning: string;
  confidence?: number;
}

export interface SmartReplyOption {
  reply: string;
  confidence: number;
  reasoning: string;
  type?: "follow_up" | "objection" | "close" | "other";
}

export interface ObjectionDetectionResult {
  objectType: string;
  confidence: number;
  category: "price" | "timeline" | "already_using" | "not_convinced" | "other";
  suggestedResponse: string;
}

export interface DealPrediction {
  predictedAmount: number;
  confidence: number;
  factors: Record<string, number>;
  expectedCloseDate: Date;
}

export interface ChurnRiskAssessment {
  churnRiskLevel: "high" | "medium" | "low";
  riskScore: number;
  indicators: string[];
  recommendedAction: string;
}

export interface CompetitorMentionResult {
  mentionFound: boolean;
  competitors: string[];
  context: string;
  actionSuggested: string;
}

export interface SocialProfile {
  platform: "linkedin" | "twitter" | "instagram" | "github" | "other";
  url: string;
  handle?: string;
}

export interface LeadIntelligenceDashboard {
  intent: IntentDetectionResult;
  predictions: DealPrediction;
  churnRisk: ChurnRiskAssessment;
  suggestedActions: string[];
  nextBestAction: string;
  socialProfiles?: SocialProfile[];
  stats?: {
    totalInbound: number;
    totalOutbound: number;
    lastInteractionDays: number;
    hasReplied: boolean;
  };
}


// ============ ENGINE 1: LEAD INTENT DETECTION ============

export async function detectLeadIntent(
  messages: ConversationMessage[],
  lead: LeadProfile
): Promise<IntentDetectionResult> {
  if (!messages || messages.length === 0) {
    return {
      intentLevel: "low",
      intentScore: 10,
      buyerStage: "awareness",
      signals: ["no_engagement"],
      reasoning: "No messages yet",
    };
  }

  try {
    const conversationText = messages
      .map((m) => `${m.direction === "inbound" ? "LEAD" : "YOU"}: ${m.body}`)
      .join("\n");

    const company = lead.metadata?.company as string | undefined;
    const industry = lead.metadata?.industry as string | undefined;

    const response = await generateReply(
      "Analyze this sales conversation to detect buyer intent.",
      `CONVERSATION:
${conversationText}

LEAD PROFILE:
Company: ${company || "Unknown"}
Industry: ${industry || "Unknown"}

Determine:
1. Intent Level (high/medium/low/not_interested)
2. Intent Score (0-100)
3. Buyer Stage (awareness/consideration/decision)
4. Specific signals showing intent (keywords, questions, urgency)

Format as JSON:
{
  "intentLevel": "high|medium|low|not_interested",
  "intentScore": number,
  "buyerStage": "awareness|consideration|decision",
  "signals": ["signal1", "signal2"],
  "reasoning": "why this intent level"
}`,
      {
        model: MODELS.sales_reasoning,
        temperature: 0.3,
        maxTokens: 400,
        jsonMode: true
      }
    );

    const messageContent = response.text;
    if (!messageContent) {
      throw new Error("Empty response from OpenAI");
    }

    const result = JSON.parse(messageContent) as {
      intentLevel?: string;
      intentScore?: number;
      buyerStage?: string;
      signals?: string[];
      reasoning?: string;
    };

    return {
      intentLevel: (result.intentLevel as IntentDetectionResult["intentLevel"]) || "low",
      intentScore: result.intentScore || 20,
      buyerStage: (result.buyerStage as IntentDetectionResult["buyerStage"]) || "awareness",
      signals: result.signals || [],
      reasoning: result.reasoning || "",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error detecting intent:", errorMessage);
    return {
      intentLevel: "medium",
      intentScore: 50,
      buyerStage: "consideration",
      signals: ["unable_to_analyze"],
      reasoning: "Error in analysis",
    };
  }
}

// ============ ENGINE 2: SMART REPLY SUGGESTIONS ============

export async function suggestSmartReply(
  lastMessageFromLead: string,
  leadProfile: LeadProfile,
  brandContext: BrandContext,
  conversationHistory: ConversationMessage[] = []
): Promise<SmartReplyOption[]> {
  try {
    const firstName = leadProfile.name?.split(" ")[0] || "there";
    const company = leadProfile.metadata?.company as string | undefined;
    const industry = leadProfile.metadata?.industry as string | undefined;

    const response = await generateReply(
      `## IDENTITY
You are a senior sales strategist with deep expertise in crafting responses that advance deals.

## MISSION
Based on the lead's last message and conversation context, generate 3 distinct reply options that the sales rep can use. Each option should have a different strategic angle.

## 🔒 ANTI-HALLUCINATION RULES
1. ONLY use facts from the lead profile, brand context, and conversation history provided.
2. Do not invent details about the lead's business, pain points, or needs not present in the context.
3. Do not claim product capabilities, pricing, or results not present in the brand context.

## HARD CONSTRAINTS
1. Generate exactly 3 reply options with different strategic approaches.
2. Each reply under 100 words. Shorter is better.
3. Options should vary: direct/confident, consultative/questioning, and ROI-focused.
4. Sound like a real human, not a template.
5. Each reply should be sendable as-is — complete thoughts, no placeholders.
6. Confidence score must reflect how well the reply matches the lead's signal.

## OUTPUT FORMAT (JSON ARRAY ONLY)
[
  {
    "reply": "exact text to send",
    "confidence": 0-100,
    "reasoning": "why this approach works for this lead"
  }
]`,
      `Lead just said: "${lastMessageFromLead}"
Lead: ${firstName} at ${company || "their company"} (${industry || "their industry"})
Your Offer: ${brandContext.productInfo?.name || "Your solution"}

Generate 3 different reply options:
1. Most direct/confident
2. Most consultative/questions
3. Most ROI-focused

Format as JSON array of objects:
[
  {
    "reply": "exact text to send",
    "confidence": 85,
    "reasoning": "why this works"
  }
]

Keep replies under 100 words each.`,
      {
        model: MODELS.sales_reasoning,
        temperature: 0.7,
        maxTokens: 600,
        jsonMode: true
      }
    );

    const messageContent = response.text;
    if (!messageContent) {
      throw new Error("Empty response from AI service");
    }

    const replies = JSON.parse(messageContent) as SmartReplyOption[];
    return replies.slice(0, 3);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error suggesting reply:", errorMessage);
    return [
      {
        reply: "Thanks for reaching out. When would be a good time to chat about this?",
        confidence: 70,
        reasoning: "Safe, open-ended question",
      },
    ];
  }
}

// ============ ENGINE 3: OBJECTION PATTERN RECOGNITION ============

export async function detectObjection(
  messageFromLead: string
): Promise<ObjectionDetectionResult> {
  try {
    const response = await generateReply(
      "You are an expert in sales objections.",
      `Identify the objection in this message: "${messageFromLead}"

Determine:
1. Objection Type (what exactly are they objecting to?)
2. Category (price/timeline/already_using/not_convinced/other)
3. Confidence (how sure are you?)
4. Professional response to overcome it

Format as JSON:
{
  "objectType": "specific objection",
  "confidence": 85,
  "category": "price|timeline|already_using|not_convinced|other",
  "suggestedResponse": "how to overcome this"
}`,
      {
        model: MODELS.sales_reasoning,
        temperature: 0.6,
        maxTokens: 400,
        jsonMode: true
      }
    );

    const messageContent = response.text;
    if (!messageContent) {
      throw new Error("Empty response from AI service");
    }

    const objection = JSON.parse(messageContent) as {
      objectType?: string;
      confidence?: number;
      category?: string;
      suggestedResponse?: string;
    };

    return {
      objectType: objection.objectType || "unknown",
      confidence: objection.confidence || 50,
      category: (objection.category as ObjectionDetectionResult["category"]) || "other",
      suggestedResponse: objection.suggestedResponse || "Can we discuss this further?",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error detecting objection:", errorMessage);
    return {
      objectType: "unknown",
      confidence: 0,
      category: "other",
      suggestedResponse: "I understand your concern. Can we explore this together?",
    };
  }
}

export async function trackObjectionPattern(
  userId: string,
  objectionType: string,
  response: string,
  leadResponse: string,
  converted: boolean
): Promise<void> {
  console.log(`📊 Objection Pattern: ${objectionType} - ${converted ? "✅ CONVERTED" : "❌ NO CONVERT"}`);
  try {
    const { storage } = await import('@shared/lib/storage/storage.js');
    await storage.recordLearningPattern(userId, `objection_${objectionType}`, converted);
  } catch (error) {
    console.error("Failed to record learning pattern:", error);
  }
}

// ============ ENGINE 4: DEAL AMOUNT PREDICTION ============

export async function predictDealAmount(
  lead: LeadProfile,
  messages: ConversationMessage[] = [],
  user?: any // Added to access user offerDescription
): Promise<DealPrediction> {
  let baseAmount = 0;
  let confidence = 20;

  // Prefer the explicit offer description set by the user in settings
  if (user && user.offerDescription) {
    const extractedNumber = user.offerDescription.match(/\$?([\d,]+)/);
    if (extractedNumber && extractedNumber[1]) {
      baseAmount = parseInt(extractedNumber[1].replace(/,/g, ''), 10);
      confidence = 80;
    }
  }

  // If no offer set, check brand context (simulated via metadata or messages)
  if (baseAmount === 0) {
    // We no longer guess $5000 based on company size.
    // Wait until explicit pricing is mentioned or set.
    confidence = 10;
  }

  const inboundCount = messages.filter((m) => m.direction === "inbound").length;
  if (inboundCount >= 3 && baseAmount > 0) {
    confidence += 15;
  }

  // Deterministic estimation based on engagement (no Math.random in production)
  let daysToClose = 45; // baseline 45 days
  if (confidence >= 80) daysToClose = 14;
  else if (confidence >= 50) daysToClose = 30;
  
  // Adjust based on inbound activity
  if (inboundCount >= 5) daysToClose = Math.max(7, daysToClose - 14);

  const expectedCloseDate = new Date();
  expectedCloseDate.setDate(expectedCloseDate.getDate() + daysToClose);

  return {
    predictedAmount: Math.round(baseAmount),
    confidence: Math.min(100, confidence),
    factors: {
      offer_clarity: user?.offerDescription ? 0.6 : 0.1,
      engagement: Math.min(0.5, inboundCount * 0.1),
      timeline: confidence > 50 ? 0.3 : 0.1,
    },
    expectedCloseDate,
  };
}

// ============ ENGINE 5: CHURN RISK SCORING ============

export async function assessChurnRisk(
  lead: LeadProfile,
  messages: ConversationMessage[] = [],
  daysAsCustomer: number = 0
): Promise<ChurnRiskAssessment> {
  let riskScore = 50;
  const indicators: string[] = [];

  const lastMessageDate = messages[messages.length - 1]?.createdAt;
  if (lastMessageDate) {
    const daysSinceLastMessage = (Date.now() - new Date(lastMessageDate).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceLastMessage > 14) {
      riskScore += 30;
      indicators.push("No engagement for 2+ weeks");
    }
  }

  const inboundCount = messages.filter((m) => m.direction === "inbound").length;
  if (inboundCount === 0 && messages.length > 5) {
    riskScore += 20;
    indicators.push("No replies despite outreach");
  }

  if (daysAsCustomer < 7) {
    riskScore -= 20;
    indicators.push("New customer (first week)");
  }

  if (daysAsCustomer > 90) {
    riskScore -= 10;
    indicators.push("Long-term customer");
  }

  riskScore = Math.max(0, Math.min(100, riskScore));

  let churnRiskLevel: ChurnRiskAssessment["churnRiskLevel"];
  if (riskScore >= 70) churnRiskLevel = "high";
  else if (riskScore >= 40) churnRiskLevel = "medium";
  else churnRiskLevel = "low";

  let recommendedAction = "";
  if (churnRiskLevel === "high") {
    recommendedAction = "🚨 HIGH PRIORITY: Reach out immediately with special offer or check-in";
  } else if (churnRiskLevel === "medium") {
    recommendedAction = "📞 Schedule check-in call to discuss progress and upcoming wins";
  } else {
    recommendedAction = "✅ Monitor engagement, continue regular communications";
  }

  return {
    churnRiskLevel,
    riskScore,
    indicators,
    recommendedAction,
  };
}

// ============ ENGINE 6: COMPETITOR MENTION ALERTS ============

export async function detectCompetitorMention(
  messageText: string
): Promise<CompetitorMentionResult> {
  try {
    const response = await generateReply(
      "You are a sales intelligence expert.",
      `Analyze this message for any mention of competitors or alternative solutions: "${messageText}"
      
      Task:
      1. Identify if any competitor or alternative service is mentioned.
      2. Extract the name(s) of the competitor(s).
      3. Determine the context (e.g. comparing features, comparing price, already using them).
      
      Return a JSON object:
      {
        "mentionFound": boolean,
        "competitors": ["name1", "name2"],
        "context": "string (short description)",
        "actionSuggested": "string (how to handle this specifically)"
      }`,
      { model: MODELS.intelligence_synthesis, jsonMode: true, nga1Enforced: true }
    );

    const result = JSON.parse(response.text || '{}');
    return {
      mentionFound: !!result.mentionFound,
      competitors: result.competitors || [],
      context: result.context || "",
      actionSuggested: result.actionSuggested || ""
    };
  } catch (error) {
    console.error("Error detecting competitors:", error);
    return {
      mentionFound: false,
      competitors: [],
      context: "",
      actionSuggested: "",
    };
  }
}

// ============ UNIFIED AI INTELLIGENCE ENGINE ============

export async function generateLeadIntelligenceDashboard(
  lead: LeadProfile,
  messages: ConversationMessage[] = []
): Promise<LeadIntelligenceDashboard> {
  const [intent, predictions, churnRisk] = await Promise.all([
    detectLeadIntent(messages, lead),
    predictDealAmount(lead, messages),
    assessChurnRisk(lead, messages),
  ]);

  // Extract social profiles from metadata or messages
  const socialProfiles: SocialProfile[] = [];
  const metadata = lead.metadata || {};

  if (metadata.linkedin || metadata.linkedInUrl) socialProfiles.push({ platform: "linkedin", url: metadata.linkedin || metadata.linkedInUrl });
  if (metadata.twitter || metadata.twitterUrl) socialProfiles.push({ platform: "twitter", url: metadata.twitter || metadata.twitterUrl });
  if (metadata.instagram || metadata.instagramUrl) socialProfiles.push({ platform: "instagram", url: metadata.instagram || metadata.instagramUrl });

  // Dynamic Engagement Rank Adjustment
  // Base rank is the intentScore
  let engagementRank = intent.intentScore;

  // Bonus for inbound messages
  const inboundCount = messages.filter(m => m.direction === 'inbound').length;
  engagementRank += inboundCount * 5;

  // Bonus for recent activity
  if (messages.length > 0) {
    const lastMsg = messages[messages.length - 1];
    const hoursSinceLastMsg = (Date.now() - new Date(lastMsg.createdAt).getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastMsg < 24) engagementRank += 10;
  }

  // Bonus for profile completion
  if (lead.email) engagementRank += 5;
  if (lead.phone) engagementRank += 5;
  if (socialProfiles.length > 0) engagementRank += 10;

  // Cap at 100
  intent.intentScore = Math.min(100, engagementRank);

  const suggestedActions: string[] = [];

  if (intent.intentLevel === "high" || intent.intentScore > 80) {
    suggestedActions.push("🔥 HIGH INTENT: Move to next call immediately");
  } else if (intent.intentLevel === "medium" || intent.intentScore > 50) {
    suggestedActions.push("📈 MEDIUM INTENT: Send case study or social proof");
  } else {
    suggestedActions.push("❄️ LOW INTENT: Re-engage with educational content");
  }

  suggestedActions.push(churnRisk.recommendedAction);

  if (predictions.predictedAmount > 50000) {
    suggestedActions.push("💰 LARGE DEAL ($50k+): Escalate to senior sales");
  } else if (predictions.predictedAmount > 10000) {
    suggestedActions.push("📊 MEDIUM DEAL ($10-50k): Continue regular cadence");
  }

  const nextBestAction =
    intent.intentLevel === "high" || intent.intentScore > 80
      ? "Schedule call immediately - they're ready to buy"
      : intent.intentLevel === "medium" || intent.intentScore > 50
        ? "Send personalized case study"
        : "Re-engage with education content";

  const lastMsgAt = messages.length > 0 ? new Date(messages[messages.length - 1].createdAt).getTime() : new Date(lead.createdAt || Date.now()).getTime();
  const lastInteractionDays = Math.floor((Date.now() - lastMsgAt) / (1000 * 60 * 60 * 24));

  return {
    intent,
    predictions,
    churnRisk,
    suggestedActions,
    nextBestAction,
    socialProfiles: socialProfiles.length > 0 ? socialProfiles : undefined,
    stats: {
      totalInbound: messages.filter(m => m.direction === 'inbound').length,
      totalOutbound: messages.filter(m => m.direction === 'outbound').length,
      lastInteractionDays,
      hasReplied: messages.some(m => m.direction === 'inbound')
    }
  };
}




