import { generateReply } from "./ai-service.js";
import { extractJson } from "@shared/lib/utils/json-util.js";

export interface PostCallAnalysis {
  outcome: "closed" | "followed_up" | "lost" | "no_show";
  coaching: {
    strengths: string[];
    weaknesses: string[];
    improvements: string[];
    progressAudit?: string; 
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
  talkRatio?: number; 
  bookingFailureReason?: string;
  suggestedAction: string;
  agreedToPay?: boolean;
  alreadyPaidOnCall?: boolean; // NEW: Detect if they paid during the meeting
  paymentMethodDetected?: string; // e.g. "PayPal", "Stripe", "Bank Transfer"
  paymentAmount?: string;
  confidence: number;
  
  revenueImpactScore?: number; 
  velocityPrediction?: "accelerating" | "stable" | "stalled";
  competitorRiskLevel?: "high" | "medium" | "low" | "none";
}

const POST_CALL_SYSTEM_PROMPT = `You are an elite Sales Director and Performance Coach. 
Analyze the provided meeting transcript to determine the call outcome and payment status.

OUTCOME DEFINITIONS:
- "closed": Active deal won, product purchased, or payment CONFIRMED on the call.
- "followed_up": Prospect is interested but no payment made yet.
- "lost": Clear rejection or not a fit.

PAYMENT INTELLIGENCE (CRITICAL):
1. 'agreedToPay': Set to true if the prospect agrees to buy and expects a link/invoice later.
2. 'alreadyPaidOnCall': Set to true ONLY if the transcript confirms the lead has ALREADY sent the money while on the call (e.g. "I've just sent it", "Money is gone", "Check your bank, it's paid").
3. 'paymentMethodDetected': Identify if they mentioned a specific platform (PayPal, Wise, Stripe, Bank Transfer).
4. 'paymentAmount': Extract the clean numeric amount.

NOTE: If 'alreadyPaidOnCall' is true, the system will mark them as CONVERTED immediately and will NOT send any follow-up billing emails. 
Be 95%+ confident before setting 'alreadyPaidOnCall' to true.

Respond ONLY in JSON format matching the PostCallAnalysis schema.`;

export async function analyzeMeetingIntelligence(
  transcript: string,
  summary: string,
  pastContext?: string
): Promise<PostCallAnalysis> {
  const userPrompt = `
PAST CONTEXT:
${pastContext || "No prior meetings."}

TRANSCRIPT:
${transcript.substring(0, 15000)}

SUMMARY:
${summary}

Analyze the call intelligence and payment status accurately.`;

  try {
    const response = await generateReply(POST_CALL_SYSTEM_PROMPT, userPrompt, {
      jsonMode: true,
      temperature: 0.1, // Low temperature for high accuracy on payment detection
    });

    const analysis = extractJson<PostCallAnalysis>(response.text);
    
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
      alreadyPaidOnCall: analysis.alreadyPaidOnCall,
      paymentMethodDetected: analysis.paymentMethodDetected,
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
