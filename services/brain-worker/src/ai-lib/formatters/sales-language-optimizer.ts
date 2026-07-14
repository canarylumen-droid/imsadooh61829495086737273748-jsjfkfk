/**
 * MILLIONAIRE CLOSER SALES LANGUAGE ENGINE v3
 * 40+ Word Replacements + 10 Dominant Frame Engines
 * 
 * Non-negotiable rules:
 * 1. Never defensive
 * 2. Always lead the frame
 * 3. Identity-based persuasion
 * 4. Every message advances the close
 */

export type LeadTone = "casual" | "formal" | "blunt" | "warm";

export interface SalesOptimizationContext {
  companyName?: string;
  industry?: string;
  offer?: string;
  leadTone?: LeadTone;
  positioning?: string;
}

export interface ObjectionHandlerContext {
  industry?: string;
  positioning?: string;
}

// ============ ENGINE 1: WORD REPLACEMENT ENGINE ============
export const WORD_REPLACEMENTS: Record<string, string> = {
  // Financial framing
  "buy": "join",
  "purchase": "activate",
  "price": "investment",
  "cost": "investment",
  "expensive": "premium",
  "pay": "invest",
  "payment": "commitment",
  "charge": "investment level",
  "discount": "advantage",
  "fee": "investment",
  "afford": "invest",

  // Relationship framing
  "customer": "client",
  "user": "client",
  "customer service": "client success",
  "user account": "client portal",
  "support team": "success team",

  // Action framing
  "try": "run",
  "use": "activate",
  "contract": "agreement",
  "deal": "opportunity",
  "follow-up": "reconnect",
  "follow up": "reconnect",
  "checking in": "re-engaging",
  "calling back": "reconnecting",
  "reaching out": "re-engaging",
  "contact": "reconnect",

  // Confidence framing
  "maybe": "for sure",
  "might": "will",
  "could": "will",
  "probably": "most certainly",
  "I'm not sure": "what I can tell you for sure is",
  "hope": "expect",
  "wait": "prepare",
  "consider": "evaluate",
  "possibly": "absolutely",

  // Problem framing
  "problem": "situation",
  "issue": "opportunity",
  "complaint": "feedback",
  "struggle": "challenge",
  "difficult": "complex",
  "hard": "challenging",

  // Speed framing
  "quickly": "immediately",
  "fast": "instantly",
  "soon": "now",

  // Value framing
  "feature": "advantage",
  "tool": "system",
  "service": "solution",
  "offer": "opportunity",
  "product": "solution",
};

export function applyWordReplacements(text: string): string {
  if (!text) return text;
  let result = text;

  const sortedReplacements = Object.entries(WORD_REPLACEMENTS)
    .sort((a, b) => b[0].length - a[0].length);

  for (const [weak, dominant] of sortedReplacements) {
    const regex = new RegExp(`\\b${weak}\\b`, "gi");
    result = result.replace(regex, (match: string) => {
      if (match[0] === match[0].toUpperCase()) {
        return dominant.charAt(0).toUpperCase() + dominant.slice(1);
      }
      return dominant;
    });
  }

  return result;
}

// ============ ENGINE 2: TONE ENGINE ============
export function applyMillionaireCloserTone(text: string): string {
  let result = text;

  // Remove defensive language
  result = result.replace(/I think|I believe|I suppose/gi, "");
  result = result.replace(/I'm sorry|apologize/gi, "appreciate");
  result = result.replace(/Unfortunately|regrettably/gi, "Here's what matters");
  result = result.replace(/I need to|Let me/gi, "");

  // Note: Removed automatic "For sure —" prefix to keep responses natural and DM-style

  // Inject ROI language
  if (!result.includes("return") && !result.includes("conversion") && !result.includes("ROI")) {
    if (result.includes("client") || result.includes("team")) {
      result = result.replace(/clients|teams/, "clients in your space consistently see");
    }
  }

  return result;
}

// ============ ENGINE 3: INDUSTRY MIRRORING ENGINE ============
export const INDUSTRY_PATTERNS: Record<string, string> = {
  realEstate: "urgency,timing,scarcity,fast response",
  agency: "ROI,bottleneck,throughput,predictable",
  coaching: "transformation,clarity,trust,step-by-step",
  creator: "engagement,speed,consistency,brand tone",
  b2b: "efficiency,reliability,scalability,professionalism",
  ecommerce: "conversion,average order value,repeat purchase,traffic quality",
  saas: "churn,expansion revenue,product adoption,user engagement",
};

export function getIndustryFraming(industry: string | undefined | null): string {
  if (!industry) return INDUSTRY_PATTERNS.b2b;
  return INDUSTRY_PATTERNS[industry.toLowerCase()] || INDUSTRY_PATTERNS.b2b;
}

// ============ ENGINE 4: OBJECTION CRUSHING ENGINE ============
export const OBJECTION_RESPONSES: Record<string, string> = {
  price: "It's a premium investment, yes — and clients in your space consistently make back far more because the system reconnects leads you normally lose. That's why serious operators don't hesitate on this.",

  thinking: "For sure — most of our best clients took a moment too. What they realized quickly is that delaying meant losing more leads in the meantime. What specific part are you evaluating?",

  cheaper: "Totally — just keep in mind cheaper tools automate, they don't convert. Audnix reconnects, handles objections, adapts to tone, and follows the same decision process a real closer would. So the difference in results is massive.",

  later: "Understood. Just remember every day you wait, more leads go cold. If you'd like, I can help you activate it now so it starts recovering conversions immediately.",

  unsure: "What I can tell you for sure is this — teams that activate right now see the biggest jump because you're starting with warm leads. What part feels unclear?",

  already_using: "That's cool you're testing things — the difference is usually 10+ hours saved per week plus better conversions. What tool are you currently running?",

  busy: "Most people feel that way at first. Then they see the value pretty fast once warm leads start converting again. When's a good time to reconnect?",

  not_interested: "No pressure — if something changes, you know where to find me. Real question though — what would need to be different for this to make sense?",
};

// ============ ENGINE 5: RE-ENGAGEMENT ENGINE ============
export const REENGAGEMENT_PATTERNS: string[] = [
  "Noticed a friction point in your current [INDUSTRY] roadmap — most miss the 20% shift that drives 80% of the conversion velocity. Worth a quick sync?",

  "Circling back because the gap we identified in [INDUSTRY] usually doesn't stay open long. Ready to bridge the scale gap with a strategy session?",

  "One nuance I missed — the speed of the [INDUSTRY] breakthrough is exactly where your competitive edge lies. Should we sync on the implementation?",

  "Question specifically for the [ROLE] perspective — is efficiency at [COMPANY] still the priority this quarter or have targets shifted?",

  "Closing the loop here — if the high-velocity optimization isn't a fit for [COMPANY], totally understand. But I'll archive this roadmap theory unless you want to sync.",
];

// ============ ENGINE 6: BRAND CONTEXT ENGINE ============
export function injectBrandContext(text: string, context: SalesOptimizationContext | null | undefined): string {
  if (!context) return text;

  let result = text;

  if (context.companyName) {
    result = result.replace(/\[COMPANY\]|your company/gi, context.companyName);
  }

  if (context.industry) {
    result = result.replace(/\[INDUSTRY\]/gi, context.industry);
    result = result.replace(/your space/gi, `the ${context.industry} space`);
  }

  if (context.offer) {
    result = result.replace(/\[OFFER\]/gi, context.offer);
  }

  return result;
}

// ============ ENGINE 7: URGENCY ENGINE ============
export function generateUrgencyFrame(industry: string | undefined | null, daysSinceContact: number): string {
  const urgencyMaps: Record<string, Record<number, string>> = {
    realEstate: {
      1: "Most of the lift happens in the first 48 hours once activation starts.",
      3: "Every day you wait is a lead that goes cold in your market.",
      7: "Window is closing — market moves fast in real estate.",
    },
    agency: {
      1: "Best ROI is always in the first week of activation.",
      3: "Every day delays recovery of warm leads.",
      7: "Competitors aren't waiting — they're already reconnecting.",
    },
  };

  const industryKey = industry?.toLowerCase() || 'agency';
  const map = urgencyMaps[industryKey] || urgencyMaps.agency;
  const dayKey = daysSinceContact > 7 ? 7 : daysSinceContact;
  return map[dayKey] || map[1];
}

// ============ ENGINE 8: CONVERSION ENGINE ============
export const CLOSE_VARIATIONS: string[] = [
  "Ready to activate and get this running for [COMPANY] today?",
  "If everything makes sense, I can prepare your activation now.",
  "So let's get this agreement in motion — you good to activate this week?",
  "Perfect — let's join you into the system and get started.",
  "When can we get you activated? This week or next?",
];

// ============ ENGINE 9: PERSONALITY ADAPTATION ENGINE ============
export function detectLeadTone(messages: string[]): LeadTone {
  if (!messages || messages.length === 0) return "warm";

  const combined = messages.join(" ").toLowerCase();

  const formalWords = ["regarding", "furthermore", "proposed", "hereby"];
  const casualWords = ["lol", "hey", "cool", "awesome", "totally"];
  const bluntWords = ["no", "won't", "can't", "don't"];

  const formalCount = formalWords.filter((w) => combined.includes(w)).length;
  const casualCount = casualWords.filter((w) => combined.includes(w)).length;
  const bluntCount = bluntWords.filter((w) => combined.includes(w)).length;

  if (bluntCount > 2) return "blunt";
  if (formalCount > 2) return "formal";
  if (casualCount > 2) return "casual";
  return "warm";
}

export function adjustToneForLead(text: string, leadTone: LeadTone): string {
  if (!text) return text;

  switch (leadTone) {
    case "casual":
      return text.replace(/\./g, "").toLowerCase() + ".";
    case "formal":
      return text.replace(/awesome|cool|lol/gi, "certainly");
    case "blunt":
      return text.split(". ").slice(0, 1).join(". ") + ".";
    case "warm":
    default:
      return text;
  }
}

// ============ ENGINE 10: MEMORY ENGINE ============
export function injectMemoryCallbacks(text: string, conversationHistory: string[] | null | undefined): string {
  if (!conversationHistory || conversationHistory.length === 0) return text;

  let result = text;

  const lastMessage = conversationHistory[conversationHistory.length - 1] || "";

  if (lastMessage.includes("timing") && !result.includes("timing")) {
    result = result.replace(/So|Therefore/, "Since timing matters, as you mentioned,");
  }

  if (lastMessage.includes("goal") && !result.includes("goal")) {
    result = result.replace(/Next step/, "Given your goal,");
  }

  return result;
}

// ============ NON-NEGOTIABLE RULES ENFORCEMENT ============
export function enforceNonNegotiableRules(text: string): string {
  if (!text) return text;

  let result = text;

  // Rule 1: NEVER DEFENSIVE
  const defensivePatterns: RegExp[] = [
    /I understand your concern/gi,
    /I know the price seems high/gi,
    /apologize/gi,
    /unfortunately/gi,
  ];

  for (const pattern of defensivePatterns) {
    result = result.replace(pattern, "");
  }

  // Rule 2: ALWAYS LEAD THE FRAME
  result = result.replace(/Let me explain/gi, "Here's how this works");
  result = result.replace(/I hope/gi, "I expect");

  // Rule 3: IDENTITY-BASED
  if (result.includes("client") && !result.includes("serious")) {
    result = result.replace(/clients/, "serious, high-performing clients");
  }

  // Rule 4: ADVANCE THE CLOSE - Keep natural, don't force em-dashes
  // Note: Removed automatic " — ready to activate?" suffix to keep DM-style messages natural

  return result;
}

// ============ COMPLETE OPTIMIZATION PIPELINE ============
export function optimizeSalesLanguage(text: string, context?: SalesOptimizationContext | null): string {
  if (!text) return text;

  let optimized = text;

  // 1. Apply word replacements
  optimized = applyWordReplacements(optimized);

  // 2. Apply tone engine
  optimized = applyMillionaireCloserTone(optimized);

  // 3. Inject brand context
  if (context) {
    optimized = injectBrandContext(optimized, context);
  }

  // 4. Enforce non-negotiable rules
  optimized = enforceNonNegotiableRules(optimized);

  // 5. Adjust for lead personality
  if (context?.leadTone) {
    optimized = adjustToneForLead(optimized, context.leadTone);
  }

  return optimized;
}

/**
 * Make a sales message more conversational and natural
 */
export function makeConversational(text: string): string {
  if (!text) return text;

  let result = text;

  // Remove corporate jargon
  result = result.replace(/at your earliest convenience/gi, 'when you can');
  result = result.replace(/moving forward/gi, 'next');
  result = result.replace(/circle back/gi, 'follow up');
  result = result.replace(/reach out/gi, 'contact');
  result = result.replace(/touch base/gi, 'connect');
  result = result.replace(/synergy/gi, 'collaboration');
  result = result.replace(/leverage/gi, 'use');
  result = result.replace(/utilize/gi, 'use');
  result = result.replace(/facilitate/gi, 'help');
  result = result.replace(/regarding/gi, 'about');

  // Add contractions for natural flow
  result = result.replace(/\bI am\b/g, "I'm");
  result = result.replace(/\bYou are\b/g, "You're");
  result = result.replace(/\bWe are\b/g, "We're");
  result = result.replace(/\bThey are\b/g, "They're");
  result = result.replace(/\bIt is\b/g, "It's");
  result = result.replace(/\bDo not\b/g, "Don't");
  result = result.replace(/\bWill not\b/g, "Won't");
  result = result.replace(/\bCan not\b/g, "Can't");
  result = result.replace(/\bShould not\b/g, "Shouldn't");
  result = result.replace(/\bWould not\b/g, "Wouldn't");

  return result;
}

/**
 * Handle objections with sales-optimized language
 */
export function handleObjectionWithSalesLanguage(
  objection: string,
  response: string,
  context?: ObjectionHandlerContext | null
): string {
  if (!response) return response;

  let optimized = response;

  // Apply word replacements
  optimized = applyWordReplacements(optimized);

  // Apply tone engine
  optimized = applyMillionaireCloserTone(optimized);

  // Industry-specific framing
  if (context?.industry) {
    optimized = injectBrandContext(optimized, context);
  }

  // Enforce non-negotiable rules
  optimized = enforceNonNegotiableRules(optimized);

  return optimized;
}
