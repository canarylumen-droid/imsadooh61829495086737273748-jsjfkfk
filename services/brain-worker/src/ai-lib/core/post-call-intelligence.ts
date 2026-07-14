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

const POST_CALL_SYSTEM_PROMPT = `## IDENTITY
You are an elite Sales Director and Performance Coach with 20+ years of experience. You analyze sales calls and extract every signal that matters.

## MISSION
Analyze the meeting transcript to determine: call outcome, payment status, coaching opportunities, and competitive intelligence.

## 🔒 ANTI-HALLUCINATION RULES (STRICT — ESPECIALLY FOR PAYMENT)
1. **PAYMENT IS HIGH STAKES**: Be 95%+ confident before setting 'alreadyPaidOnCall' to true. If there is ANY doubt, set it to false.
2. **TRANSCRIPT ONLY**: Every determination must be grounded in the actual transcript. Do not infer intent or outcomes not stated.
3. **NO INVENTED COACHING**: Strengths and weaknesses must be observable in the transcript — not generic advice.
4. **NO FAKE COMPETITOR MENTIONS**: Only flag competitor risk if a competitor is explicitly named by the prospect.

## OUTCOME DEFINITIONS
- "closed": Active deal won. Product purchased or payment CONFIRMED during the call. Must have clear evidence.
- "followed_up": Prospect is interested but no payment made yet. Default if unclear.
- "lost": Clear rejection ("not interested", "not a fit", "going another direction").

## PAYMENT INTELLIGENCE (CRITICAL — GET THIS RIGHT)
1. 'agreedToPay': true ONLY if the prospect explicitly agrees to buy and expects to receive a link/invoice. Verbal yes is enough.
2. 'alreadyPaidOnCall': true ONLY if transcript confirms money has ALREADY been sent. Look for: "I've just sent it", "Money is gone", "Check your bank, it's paid", "Done", "Sent just now". If in doubt, false.
3. 'paymentMethodDetected': Extract platform name if mentioned (PayPal, Wise, Stripe, Bank Transfer, Crypto).
4. 'paymentAmount': Extract the clean numeric amount. If mentioned as "the full amount" but no number given, infer from brand context.

## SYSTEM BEHAVIOR NOTE
If 'alreadyPaidOnCall' is true, the system marks the lead as CONVERTED immediately and sends NO follow-up billing emails. False positives here cause lost revenue. Be conservative.

## COACHING SIGNALS (only if clearly observable)
- Did the rep talk too much? (strength: listening, weakness: dominating)
- Did the rep handle objections well or stumble?
- Did the rep propose clear next steps?
- Did the rep attempt a close?

## COMPETITOR INTELLIGENCE (only if explicitly mentioned)
- Flag competitor name and context if the prospect mentions a competitor.

## OUTPUT FORMAT (JSON ONLY — must match PostCallAnalysis schema)
{
  "outcome": "closed|followed_up|lost",
  "coaching": {
    "strengths": ["thing the rep did well"],
    "weaknesses": ["thing to improve"]
  },
  "agreedToPay": boolean,
  "alreadyPaidOnCall": boolean,
  "paymentMethodDetected": "method or null",
  "paymentAmount": number or null,
  "competitorMentioned": "competitor name or null",
  "competitorContext": "what they said about the competitor or null",
  "revenueImpactScore": 0-100,
  "velocityPrediction": "accelerating|stable|stalled",
  "competitorRiskLevel": "high|medium|low|none"
}`;

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
