/**
 * AUTONOMOUS OBJECTION RESPONDER
 * =============================
 * When a lead says "no", "maybe", "let me think", etc.
 * AI autonomously generates closing response (not just suggestions)
 * 
 * Turns EVERY objection into a sales opportunity
 * - "Let me think about it" → "Here's why you shouldn't wait..."
 * - "Too expensive" → "One deal pays for this all year..."
 * - "I need to talk to my partner" → "Let's get them on a call..."
 * 
 * NO MORE REJECTIONS - ONLY NEGOTIATIONS
 */

import { generateReply } from "../core/ai-service.js";
import { MODELS } from "../utils/model-config.js";
import {
  OBJECTIONS_DATABASE,
  getObjectionsByIndustry,
  type Objection
} from "@services/outreach-worker/src/sales-engine/objections-database.js";

interface LeadObjectionContext {
  userId: string;
  leadName: string;
  leadCompany?: string;
  leadIndustry: string;
  previousMessages: Array<{ role: string; content: string }>;
  brandName: string;
  userIndustry: string;
  pdfContext?: string;
}

/**
 * EXPAND OBJECTIONS DATABASE WITH AI-GENERATED EDGE CASES
 */
export const EXPANDED_OBJECTIONS: Objection[] = [
  // User's original 50+
  ...OBJECTIONS_DATABASE,
  // AI-GENERATED ADDITIONAL OBJECTIONS FOR EDGE CASES
  {
    id: "edge-busy",
    objection: "I'm too busy right now",
    category: "timing",
    industries: ["all"],
    reframes: [
      "Being busy is exactly why you need this - automation handles it while you focus",
      "Your busiest days are when this works hardest for you",
      "Not having time to follow up costs you MORE time later",
    ],
    stories: [
      "Overwhelmed founder thought they were too busy - now the system does outreach while they close",
    ],
    questions: [
      "What would it take for you to have 5 extra hours a week?",
      "If this brought you just ONE deal while you're busy, worth it?",
    ],
    closingTactics: [
      "Urgency flip: 'Your competitor has time - should you?'",
      "Efficiency play: 'This GIVES you time back'",
    ],
  },
  {
    id: "edge-skeptical",
    objection: "AI can't replicate my personal touch",
    category: "trust",
    industries: ["all"],
    reframes: [
      "AI learns YOUR voice - it IS your personal touch, but available 24/7",
      "Your competitor using AI has more personal touches than you do right now",
      "Personal touch matters, but not at 3am when leads are thinking",
    ],
    stories: [
      "Coach worried about losing authenticity - AI trained on HIS voice actually felt MORE authentic",
    ],
    questions: [
      "Do you personally reply to every lead at 3am?",
      "Would your leads prefer your touch at 24 hours or AI touch at 30 minutes?",
    ],
    closingTactics: [
      "Hybrid play: 'You close, AI warms them up'",
      "Voice ownership: 'This sounds like you because we trained it on you'",
    ],
  },
  {
    id: "edge-not-ready",
    objection: "Not the right time for us / Come back later",
    category: "timing",
    industries: ["all"],
    reframes: [
      "The RIGHT time is when you're behind - start now, be ahead later",
      "'Later' rarely comes - start today with test budget",
      "Your competitor isn't waiting for the 'right time'",
    ],
    stories: [
      "Founder said 'come back in 6 months' - competitor took their best 10 deals",
    ],
    questions: [
      "When IS the right time? Let's work backward",
      "What needs to change for it to be the right time?",
    ],
    closingTactics: [
      "Specific offer: 'Start with $199 pilot, no commitment'",
      "Competition urgency: 'Your competitor is piloting right now'",
    ],
  },
  {
    id: "edge-internal-resistance",
    objection: "My team doesn't think we need this",
    category: "social",
    industries: ["all"],
    reframes: [
      "Your team WILL see the value when leads convert - involve them",
      "Best teams adopt tools that make them look better",
      "Your team is right - you should prove this privately first",
    ],
    stories: [
      "Skeptical sales team saw one deal close with AI assist - now advocates",
    ],
    questions: [
      "What would convince your team?",
      "Want to run a silent pilot and surprise them with results?",
    ],
    closingTactics: [
      "Private pilot: 'Test for 2 weeks, show team results'",
      "Team wins: 'Your team gets credit for closed deals'",
    ],
  },
  {
    id: "edge-switching-cost",
    objection: "Too much hassle to switch / Set up looks hard",
    category: "fit",
    industries: ["all"],
    reframes: [
      "Setup is 15 minutes - switching AWAY from lost deals takes months",
      "Your current system isn't working, so switching is actually easy",
      "We handle setup for you - zero hassle path exists",
    ],
    stories: [
      "Agency thought setup was hard - we onboarded them in 20 mins, ROI in 3 days",
    ],
    questions: [
      "What part feels hard?",
      "If we did the setup, would that change things?",
    ],
    closingTactics: [
      "Concierge: 'We'll set it up with you, no confusion'",
      "Pain comparison: 'Current pain > setup pain'",
    ],
  },
];

/**
 * AUTONOMOUS OBJECTION RESPONSE GENERATOR
 */
export async function generateAutonomousObjectionResponse(
  leadMessage: string,
  context: LeadObjectionContext
): Promise<{
  response: string;
  strategy: string;
  confidence: number;
  nextAction: string;
}> {
  // Step 1: Identify objection intelligently
  const objection = await intelligentIdentifyObjection(leadMessage, context);

  // Step 2: Fetch Machine Learning patterns (Past Successes)
  let pastLearnings = "";
  try {
    const { storage } = await import('@shared/lib/storage/storage.js');
    const allPatterns = await storage.getLearningPatterns(context.userId);
    const industryPatterns = allPatterns
      .filter(p => p.patternKey.startsWith(`objection:${context.leadIndustry}`))
      .sort((a, b) => {
        const aScore = a.successCount / (a.successCount + a.failureCount || 1);
        const bScore = b.successCount / (b.successCount + b.failureCount || 1);
        return bScore - aScore;
      });
      
    if (industryPatterns.length > 0) {
      pastLearnings = industryPatterns.map(p => `- ${p.patternKey.replace('objection_', '')}: Success rate ${Math.round((p.successCount/(p.successCount+p.failureCount))*100)}%`).join('\n');
    }
  } catch (e) {
    console.warn("ML Learning lookup failed", e);
  }

  // Step 3: Generate tailored response using GPT-4
  const prompt = buildObjectionResponsePrompt(
    leadMessage,
    objection,
    context,
    EXPANDED_OBJECTIONS,
    pastLearnings
  );

  try {
    const responseBody = await generateReply(
      `You are an elite sales closer for ${context.brandName}. 
Your goal is to TURN THIS OBJECTION INTO A DEAL.
- Use the reframe strategies provided
- Tell a short story that makes them realize their mistake
- Ask a closing question
- Sound confident, not desperate
- Match the tone of their response
- Make it personal to them
- NO "I understand" - be direct and powerful`,
      prompt,
      {
        model: MODELS.objection_handling,
        temperature: 0.8,
        maxTokens: 200
      }
    );

    const response = responseBody.text || "Let's talk soon";

    return {
      response,
      strategy: objection?.category || "engagement",
      confidence: 0.9,
      nextAction: "Send immediately and track response",
    };
  } catch (error) {
    console.error("Error generating objection response:", error);
    // Fallback response
    return {
      response: buildFallbackResponse(leadMessage, objection),
      strategy: "fallback",
      confidence: 0.6,
      nextAction: "Send and monitor",
    };
  }
}

/**
 * IDENTIFY WHICH OBJECTION THIS IS
 */
/**
 * INTELLIGENT OBJECTION IDENTIFIER
 * Uses GPT-4o to identify the REAL objection even if hidden
 */
async function intelligentIdentifyObjection(leadMessage: string, context: LeadObjectionContext) {
  try {
    const prompt = `Identify the real sales objection in this message.
    
    Lead Message: "${leadMessage}"
    Industry: ${context.leadIndustry}
    Brand: ${context.brandName}
    
    PDF Context: ${context.pdfContext?.substring(0, 500) || "No specific PDF context"}

    Categorize as: pricing, timing, trust, authority, fit, social, decision, or competitive.
    Identify the "Hidden Objection" (the psychological state).

    Return JSON: { "category": "string", "hidden": "string", "intensity": 0-100 }`;

    const response = await generateReply(
      'You are an intelligent sales analyst.',
      prompt,
      {
        model: MODELS.objection_handling,
        jsonMode: true
      }
    );

    const result = JSON.parse(response.text || '{}');

    // Find matching template in database for reframes/stories
    const matched = EXPANDED_OBJECTIONS.find(o => o.category === result.category) ||
      EXPANDED_OBJECTIONS.find(o => o.id === 'edge-skeptical'); // Fallback

    return {
      ...matched,
      objection: result.hidden || matched?.objection,
      category: result.category || matched?.category
    };
  } catch (error) {
    return identifyObjection(leadMessage, context.leadIndustry);
  }
}

export async function identifyObjection(leadMessage: string, industry: string) {
  const cleanMessage = leadMessage.toLowerCase();
  const relevantObjections = EXPANDED_OBJECTIONS.filter(
    (o) => o.industries.includes(industry) || o.industries.includes("all")
  );

  // Score each objection
  const scored = relevantObjections.map((obj: Objection) => {
    const score = obj.objection
      .toLowerCase()
      .split(" ")
      .filter((word: string) => word.length > 3)
      .filter((word: string) => cleanMessage.includes(word)).length;
    return { objection: obj, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.score > 0 ? scored[0].objection : null;
}

/**
 * BUILD PROMPT FOR GPT-4 TO GENERATE RESPONSE
 */
function buildObjectionResponsePrompt(
  leadMessage: string,
  objection: any,
  context: LeadObjectionContext,
  allObjections: any[],
  pastLearnings: string = ""
): string {
  const reframes = objection?.reframes || [
    "Let's reframe this differently",
  ];
  const stories = objection?.stories || [];
  const questions = objection?.questions || [];
  const tactics = objection?.closingTactics || [];

  return `
LEAD SAID: "${leadMessage}"

LEAD CONTEXT:
- Name: ${context.leadName}
- Company: ${context.leadCompany || "Unknown"}
- Industry: ${context.leadIndustry}
- Previous messages: ${context.previousMessages.length} exchanges

OBJECTION TYPE: ${objection?.objection || "Uncertain"}
CATEGORY: ${objection?.category || "general"}

STRATEGIES YOU CAN USE:
Reframes: ${reframes.join(" | ")}
Stories: ${stories.join(" | ")}
Questions: ${questions.join(" | ")}
Closing Tactics: ${tactics.join(" | ")}

### ML-DRIVEN INTELLIGENCE (WHAT WORKED PREVIOUSLY)
${pastLearnings || "No specific patterns learned yet. Rely on baseline strategy."}

YOUR RESPONSE REQUIREMENTS:
1. Acknowledge their concern (don't dismiss it)
2. Use ONE reframe from above
3. Use ONE short story from above (2 sentences max)
4. Ask ONE powerful closing question
5. End with assumed action ("Let's set this up" not "Would you?")
6. Keep it under 80 words
7. Make it about THEM, not about the product
8. NO apologies, NO "I understand" - be direct

BRAND CONTEXT: We're helping ${context.userIndustry}s close deals 300% faster

Now write the closing message. Make it powerful. Turn this NO into YES.
`;
}

/**
 * FALLBACK RESPONSE GENERATOR (No API available)
 */
function buildFallbackResponse(leadMessage: string, objection: any): string {
  if (!objection) {
    return `I hear you. Quick question though - if we could save you 10 hours/week and bring in $5k more/month, would that change things? Let's talk for 5 mins Friday - no pressure, just clarity.`;
  }

  const fallbacks: Record<string, string> = {
    timing: `I get it - timing matters. Here's the thing: your competitor isn't waiting. How about we pilot this for 1 week on my dime, and you decide after seeing real results?`,
    price: `Fair point. But think about it: one deal pays for this all year. What if this brought you just ONE extra client? Worth a conversation?`,
    competitor: `So they're using [competitor]? Perfect - let's run them side by side. I'm confident our results speak louder. Let's do a quick comparison call?`,
    trust: `I appreciate the caution. That's smart. How about this - try the free tier for 7 days, see actual results, THEN decide. Sound fair?`,
    fit: `I hear you. Not everything fits perfectly off the bat. Let's spend 15 mins understanding YOUR specific needs and customize this. Deal?`,
    social: `Your concerns are valid. That's exactly why we train our AI on YOUR voice and processes. Your leads will never know it's AI. Want to see that?`,
    decision: `I get it - decisions are hard. Here's what's NOT hard: one deal with our system pays for months of investment. Let's lock in 30 mins this Friday?`,
  };

  return (
    fallbacks[objection?.category] ||
    `I understand. Here's what I'd suggest - let's get on a quick call and make sure this is right for you. What does your calendar look like Thursday?`
  );
}

/**
 * LEARN FROM EVERY OBJECTION
 * Track what works and what doesn't for this lead/industry combo
 */
export async function recordObjectionLearning(data: {
  leadId: string;
  industry: string;
  objectionType: string;
  responseUsed: string;
  leadReply: string;
  dealClosed: boolean;
}) {
  console.log(`[LEARNING] Objection handler improved from ${data.objectionType}`);
  try {
    const { storage } = await import('@shared/lib/storage/storage.js');
    const lead = await storage.getLead(data.leadId);
    if (lead) {
      await storage.recordLearningPattern(lead.userId, `objection_learning_${data.objectionType}`, data.dealClosed);
    }
  } catch (error) {
    console.error("Failed to record objection learning:", error);
  }
}




