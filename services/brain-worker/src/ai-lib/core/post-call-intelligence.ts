import { generateReply } from "./ai-service.js";
import { extractJson } from "@shared/lib/utils/json-util.js";

export interface PostCallAnalysis {
  outcome: "closed" | "followed_up" | "lost" | "no_show";
  coaching: {
    strengths: string[];
    weaknesses: string[];
    improvements: string[];
    progressAudit?: string; // Phase 13: Did they follow up on past promises?
  };
  buyingIntent: "high" | "medium" | "low" | "none";
  conversationalStage: "needs_identified" | "offer_made" | "invoice_requested" | "payment_sent" | "closed_won" | "unknown";
  primaryObjection?: {
    category: "pricing" | "competitor" | "trust" | "timing" | "features" | "other";
    snippet: string;
  };
  sentimentPivot?: {
    quote: string;
    shift: "positive" | "negative";
  };
  talkRatio?: number; // Estimated % of time the salesperson talked (e.g. 75)
  bookingFailureReason?: string;
  suggestedAction: string;
  agreedToPay?: boolean;
  paymentAmount?: string;
  confidence: number;
  
  // Advanced Predictive Metrics (Level 30 Intelligence)
  revenueImpactScore?: number; // 0-100 score of deal importance
  velocityPrediction?: "accelerating" | "stable" | "stalled";
  competitorRiskLevel?: "high" | "medium" | "low" | "none";
}

const POST_CALL_SYSTEM_PROMPT = `You are an elite Sales Director and Performance Coach. 
Analyze the provided meeting transcript and summary to determine the call outcome, BANT framework, objections, conversational dynamics, and coaching.

OUTCOME DEFINITIONS:
- "closed": Active deal won, product purchased, or a specific follow-up meeting DEFINITIVELY booked and confirmed.
- "followed_up": Prospect is interested but no firm meeting booked yet. Requires more nurturing.
- "lost": Clear rejection, not a fit, or explicit request to stop contact.
- "no_show": The transcript indicates the host waited but the guest never arrived.

EXTRACTION REQUIREMENTS:
1. CONVERSATIONAL STAGE & INTENT: Evaluate the 'buyingIntent' (high, medium, low, none) and 'conversationalStage' (needs_identified, offer_made, invoice_requested, payment_sent, closed_won).
2. OBJECTIONS: Identify the #1 explicit objection raised by the prospect (e.g., pricing, competitor, trust, timing). Extract the exact quote snippet.
3. CONVERSATIONAL DYNAMICS:
   - Talk Ratio: Estimate the percentage of time the Salesperson talked vs Prospect (return 0-100 as integer).
   - Sentiment Pivot: Find the exact quote where the conversation shifted explicitly positive or negative.
4. COACHING:
   - Identify 2-3 specific strengths in the salesperson's approach.
   - Identify 2-3 specific weaknesses or missed opportunities.
   - Provide 3 actionable improvements for the next call.
   - Progress Audit: If PAST CONTEXT is provided, grade if the salesperson followed up on prior promises.

5. PAYMENT EXTRACTION (CRITICAL):
   - Analyze if the prospect explicitly agreed to pay or buy the product on this call (must be high confidence, "yes I will pay", "send the link", etc.).
   - Extract the agreedToPay boolean (true/false).
   - If true, extract the paymentAmount (e.g., "$2,000", "€500/mo") if explicitly stated.
   - NOTE: If 'agreedToPay' is true, the system will autonomously email them the checkout link. DO NOT set to true unless explicitly agreed.

6. ADVANCED PREDICTIVE ANALYTICS:
   - Revenue Impact Score: 0-100 score based on deal size and company strategic fit.
   - Velocity Prediction: "accelerating" if they want to move faster, "stable" for normal pace, "stalled" if there are new blockers.
   - Competitor Risk: Evaluate if they are actively comparing or mentioned a competitor.

SUGGESTED ACTION:
- Autonomously decide the single most effective next step (e.g., "Send personalized case study", "Book follow-up in 3 days", "Draft Battle Card").

Respond ONLY in JSON format matching the PostCallAnalysis schema. Use proper JSON types.`;

export async function analyzeMeetingIntelligence(
  transcript: string,
  summary: string,
  pastContext?: string
): Promise<PostCallAnalysis> {
  const userPrompt = `
PAST CONTEXT (Previous Meeting Summaries):
${pastContext || "No prior meetings recorded."}

TRANSCRIPT:
${transcript.substring(0, 15000)}

SUMMARY:
${summary}

Analyze the call intelligence.`;

  try {
    const response = await generateReply(POST_CALL_SYSTEM_PROMPT, userPrompt, {
      jsonMode: true,
      temperature: 0.2,
    });

    const analysis = extractJson<PostCallAnalysis>(response.text);
    
    // Ensure default structure if AI misses anything, but preserve genuine analysis instead of mocking
    return {
      outcome: analysis.outcome || "followed_up",
      coaching: {
        strengths: analysis.coaching?.strengths || [],
        weaknesses: analysis.coaching?.weaknesses || [],
        improvements: analysis.coaching?.improvements || [],
        progressAudit: analysis.coaching?.progressAudit,
      },
      buyingIntent: analysis.buyingIntent || "none",
      conversationalStage: analysis.conversationalStage || "unknown",
      primaryObjection: analysis.primaryObjection,
      sentimentPivot: analysis.sentimentPivot,
      talkRatio: analysis.talkRatio,
      bookingFailureReason: analysis.bookingFailureReason,
      suggestedAction: analysis.suggestedAction || "Follow up via email",
      agreedToPay: analysis.agreedToPay,
      paymentAmount: analysis.paymentAmount,
      confidence: analysis.confidence || 0.8,
      revenueImpactScore: analysis.revenueImpactScore,
      velocityPrediction: analysis.velocityPrediction,
      competitorRiskLevel: analysis.competitorRiskLevel,
    };
  } catch (error) {
    console.error("Call intelligence analysis failed:", error);
    throw error;
  }
}
