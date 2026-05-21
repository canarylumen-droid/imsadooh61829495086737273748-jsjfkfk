/**
 * UNIVERSAL AI SALES AGENT v4
 * ================================
 * Works for ANY business/agency - not just Audnix
 * 
 * Purpose: Help users close their first $1,000 deal + 5 clients in 1 week
 * Free trial users close first 2 clients FAST & EASILY
 * 
 * Workflow: Import → Verify → Analyze → Reach → Close
 * 
 * The AI:
 * - Searches the internet for competitor intelligence
 * - Learns from each lead interaction
 * - Knows their unique value proposition
 * - Extracts & uses testimonials intelligently
 * - Verifies every message before sending
 * - Adapts in real-time
 * - Talks like million-dollar closers
 */

import OpenAI from "openai";
import { MODELS } from "./model-config.js";
import type { BrandContext } from "../../../shared/types.js";
import { storage } from "../../storage.js";

// Initialize OpenAI if key is present, otherwise use fallback
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

if (!openai) {
  console.warn('⚠️ OpenAI API Key missing. Universal Sales Agent will use fallback logic.');
}

export interface SalesLeadProfile {
  id?: string;
  firstName: string;
  lastName?: string;
  companyName?: string;
  company?: string;
  industry?: string;
  painPoint?: string;
  companySize?: string;
  email?: string;
  phone?: string;
  stage?: "awareness" | "consideration" | "decision";
  temperature?: "hot" | "warm" | "cold";
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface SalesBrandContext {
  businessName?: string;
  companyName?: string;
  industry?: string;
  niche?: string;
  offer?: string;
  positioning?: "premium" | "mid" | "volume";
  voiceRules?: string;
  brandColors?: string;
  brandSnippets?: string[];
  senderName?: string;
  productInfo?: {
    name?: string;
    description?: string;
    price?: string;
    features?: string[];
    benefits?: string[];
  };
}

export interface MessageQualityResult {
  isGood: boolean;
  issues: string[];
  score: number;
  suggestions: string[];
}

export interface CompetitorIntelligence {
  competitors: string[];
  gaps: string[];
  opportunities: string[];
}

export interface UVPResult {
  uvp: string;
  positioning: "premium" | "mid" | "volume";
  differentiators: string[];
  whyYouWin: string;
}

export interface OptimizedMessageResult {
  message: string;
  quality: MessageQualityResult;
  reasoning: string;
}

// ============ UNIVERSAL WORD REPLACEMENTS (Works for ANY business) ============
export const UNIVERSAL_WORD_REPLACEMENTS: Record<string, string> = {
  // Financial framing (works for ANY offer)
  "buy": "join",
  "purchase": "activate",
  "price": "investment",
  "cost": "investment",
  "expensive": "premium",
  "pay": "commit",
  "payment": "agreement",
  "discount": "advantage",
  "fee": "investment",

  // Relationship framing
  "customer": "client",
  "user": "user",
  "client": "partner",
  "account": "portal",

  // Action framing
  "try": "run",
  "use": "activate",
  "deal": "opportunity",
  "follow-up": "reconnect",
  "checking in": "re-engaging",
  "contact": "reconnect",

  // Confidence framing
  "maybe": "for sure",
  "might": "will",
  "probably": "absolutely",
  "hope": "expect",
  "wait": "prepare",

  // Problem → Opportunity
  "problem": "opportunity",
  "issue": "situation",
  "struggle": "challenge",
};

// ============ ENGINE 1: UNIVERSAL TONE (Works for ANY business) ============
export function applyUniversalTone(text: string): string {
  let result = text;

  // Remove defensive language
  result = result.replace(/I'm sorry|apologize|unfortunately/gi, "");
  result = result.replace(/I think|I believe|I suppose/gi, "");

  // Inject confidence
  if (!result.includes("For sure") && !result.includes("Absolutely")) {
    result = "For sure — " + result;
  }

  // Link everything to RESULTS (works for any business)
  if (!result.includes("results") && !result.includes("outcome")) {
    result = result.replace(/help|support/, "drive results for");
  }

  return result;
}

// ============ ENGINE 2: SMART TESTIMONIAL EXTRACTION & USAGE ============
export interface Testimonial {
  text: string;
  source: string;
  industry?: string;
  outcome?: string; // e.g., "increased revenue by 40%"
  extracted_at: Date;
  effectiveness_score: number; // 0-100, based on lead response
}

export interface TestimonialSelectionProfile {
  industry?: string;
  companySzie?: string;
  painPoint?: string;
  stage?: string;
}

export async function extractTestimonialsfromPDF(pdfContent: string): Promise<Testimonial[]> {
  const testimonials: Testimonial[] = [];

  // Pattern 1: Direct testimonials ("They increased revenue by...")
  const directPattern = /"[^"]{50,200}"/g;
  const directMatches = pdfContent.match(directPattern) || [];

  for (const match of directMatches) {
    // Extract outcome metrics
    const outcomeMatch = match.match(/(\d+)%|(\$[\d,]+)|(\d+)x/);
    testimonials.push({
      text: match.replace(/"/g, ""),
      source: "PDF",
      outcome: outcomeMatch ? outcomeMatch[0] : undefined,
      extracted_at: new Date(),
      effectiveness_score: 75, // Start moderate, learn from responses
    });
  }

  // Pattern 2: URLs in PDF
  const urlPattern = /https?:\/\/[^\s)]+/g;
  const urls = pdfContent.match(urlPattern) || [];

  for (const url of urls) {
    if (
      url.includes("testimonial") ||
      url.includes("case-study") ||
      url.includes("review") ||
      url.includes("portfolio")
    ) {
      // In production, you'd fetch and parse these pages
      testimonials.push({
        text: `See results: ${url}`,
        source: url,
        extracted_at: new Date(),
        effectiveness_score: 70,
      });
    }
  }

  return testimonials;
}

export async function smartSelectTestimonial(
  testimonials: Testimonial[],
  leadProfile: TestimonialSelectionProfile
): Promise<Testimonial | null> {
  if (!testimonials || testimonials.length === 0) return null;

  // Sort by effectiveness score
  const sorted = testimonials.sort((a, b) => b.effectiveness_score - a.effectiveness_score);

  // Stage-based selection
  if (leadProfile.stage === "awareness") {
    // Pick quick, impressive testimonial
    return sorted.find((t) => t.outcome && (t.outcome.includes("%") || t.outcome.includes("x"))) || sorted[0];
  }

  if (leadProfile.stage === "consideration") {
    // Pick industry-specific testimonial
    if (leadProfile.industry) {
      return sorted.find((t) => t.industry === leadProfile.industry) || sorted[0];
    }
  }

  if (leadProfile.stage === "decision") {
    // Pick biggest transformation
    return sorted[0];
  }

  return sorted[0];
}

// ============ ENGINE 3: INTERNET COMPETITIVE INTELLIGENCE ============
export async function gatherCompetitorIntelligence(
  userIndustry: string,
  userNiche: string,
  leadCompany?: string
): Promise<CompetitorIntelligence> {
  try {
    if (!openai) {
      throw new Error("OpenAI not initialized");
    }

    const response = await (openai as OpenAI).chat.completions.create({
      model: MODELS.sales_reasoning,
      messages: [
        {
          role: "user",
          content: `You are a competitive intelligence expert.

Industry: ${userIndustry}
Niche: ${userNiche}
${leadCompany ? `Lead Company: ${leadCompany}` : ""}

Research and provide:
1. Top 3-5 competitors in this space
2. What competitors DON'T offer (gaps)
3. Unique angles to dominate (how to stand out)

Format:
COMPETITORS: [list]
GAPS: [list]
OPPORTUNITIES: [list]

Be specific and actionable.`,
        },
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    const text = response.choices[0]?.message?.content || "";

    // Parse response
    const competitors = text.match(/COMPETITORS:(.+?)(?=GAPS:|$)/s)?.[1]?.split("\n").filter(Boolean) || [];
    const gaps = text.match(/GAPS:(.+?)(?=OPPORTUNITIES:|$)/s)?.[1]?.split("\n").filter(Boolean) || [];
    const opportunities = text.match(/OPPORTUNITIES:(.+?)$/s)?.[1]?.split("\n").filter(Boolean) || [];

    return {
      competitors: competitors.map((c: string) => c.trim()),
      gaps: gaps.map((g: string) => g.trim()),
      opportunities: opportunities.map((o: string) => o.trim()),
    };
  } catch (error) {
    console.error("Error gathering competitive intelligence:", error);
    return { competitors: [], gaps: [], opportunities: [] };
  }
}

// ============ ENGINE 4: UVP DETECTION & POSITIONING ============
export async function detectUVP(brandContext: SalesBrandContext | BrandContext): Promise<UVPResult> {
  try {
    const industry = (brandContext as SalesBrandContext).industry || "B2B";
    const niche = (brandContext as SalesBrandContext).niche || "Sales";

    const competitive = await gatherCompetitorIntelligence(
      industry,
      niche,
      undefined
    );

    if (!openai) {
      throw new Error("OpenAI not initialized");
    }

    const response = await (openai as OpenAI).chat.completions.create({
      model: MODELS.sales_reasoning,
      messages: [
        {
          role: "user",
          content: `Based on this brand info, create their UNIQUE VALUE PROPOSITION.

Brand:
${JSON.stringify(brandContext, null, 2)}

Competitors don't offer:
${competitive.gaps.join(", ")}

Create:
1. Clear UVP (one sentence)
2. Positioning (premium/mid/volume)
3. 3 key differentiators
4. Why they win (emotional + logical)

Make it compelling and specific to their business.`,
        },
      ],
      temperature: 0.8,
      max_tokens: 400,
    });

    const text = response.choices[0]?.message?.content || "";
    const positioning = (brandContext as SalesBrandContext).positioning || "mid";

    return {
      uvp: text.split("\n")[0] || "",
      positioning: positioning,
      differentiators: competitive.gaps.slice(0, 3),
      whyYouWin: text.split("\n").slice(1).join("\n"),
    };
  } catch (error) {
    console.error("Error detecting UVP:", error);
    const offer = (brandContext as SalesBrandContext).offer || "Help your clients succeed";
    return {
      uvp: offer,
      positioning: "mid",
      differentiators: [],
      whyYouWin: "",
    };
  }
}

// ============ ENGINE 5: REAL-TIME LEARNING & ADAPTATION ============
export interface SalesLearnData {
  leadId: string;
  messageType: "cold_outreach" | "follow_up" | "objection_response" | "closing";
  leadResponse: "interested" | "objection" | "not_interested" | "converted" | "no_response";
  sentiment: "positive" | "neutral" | "negative";
  timestamp: Date;
  whatWorked?: string; // Free-form learning notes
}

export class UniversalSalesAI {
  private patterns: Record<string, number> = {};

  async learnFromInteraction(data: SalesLearnData): Promise<void> {
    const isSuccess = data.leadResponse === "converted" || data.leadResponse === "interested";
    const key = `${data.messageType}_${data.sentiment}`;

    // Track in memory for immediate use
    this.patterns[key] = (this.patterns[key] || 0) + (isSuccess ? 1 : -1);

    // Persist to database
    try {
      await storage.recordLearningPattern(data.leadId, key, isSuccess);
    } catch (error) {
      console.warn('⚠️ Pattern persistence failed, using memory fallback');
    }

    console.log(`📚 Learned: ${key} + ${data.leadResponse} (pattern strength: ${this.patterns[key]})`);
  }

  async getTopPerformingStrategy(userId: string): Promise<string> {
    try {
      const dbPatterns = await storage.getLearningPatterns(userId);
      if (dbPatterns && dbPatterns.length > 0) {
        return dbPatterns[0].patternKey;
      }
    } catch (error) {
      console.warn('⚠️ Pattern retrieval failed');
    }

    const sorted = Object.entries(this.patterns).sort((a, b) => b[1] - a[1]);
    return sorted[0]?.[0] || "cold_outreach_positive";
  }

  async adaptMessageBasedOnLearning(baseMessage: string, leadProfile: SalesLeadProfile): Promise<string> {
    const userId = (leadProfile as any).userId || "system";
    const topStrategy = await this.getTopPerformingStrategy(userId);

    if (topStrategy.includes("positive")) {
      return baseMessage.replace(/challenge|difficult/gi, "opportunity");
    } else if (topStrategy.includes("urgent")) {
      return "⏰ " + baseMessage;
    }

    return baseMessage;
  }
}

// ============ ENGINE 6: PRE-SEND VERIFICATION ============
export async function verifyMessageQuality(
  message: string,
  leadProfile: SalesLeadProfile,
  _brandContext: SalesBrandContext | BrandContext
): Promise<MessageQualityResult> {
  const issues: string[] = [];
  const suggestions: string[] = [];
  let score = 100;

  const companyName = leadProfile.companyName || leadProfile.company || "";
  const firstName = leadProfile.firstName || "";
  const industry = leadProfile.industry || "";

  // Check 1: Personalization
  if (
    !message.includes(companyName) &&
    !message.includes(firstName) &&
    !message.includes(industry)
  ) {
    issues.push("Not personalized enough");
    suggestions.push(`Add their company name or industry`);
    score -= 15;
  }

  // Check 2: Defensive language
  if (message.match(/I'm sorry|apologize|unfortunately|I think/i)) {
    issues.push("Contains defensive language");
    suggestions.push(`Remove: "I'm sorry", "unfortunately", "I think"`);
    score -= 20;
  }

  // Check 3: Clear CTA (Call to Action)
  if (!message.match(/let's|ready to|activate|join|interested|next step|when/i)) {
    issues.push("No clear next step");
    suggestions.push(`Add: "When can we...?" or "Ready to...?"`);
    score -= 15;
  }

  // Check 4: Length
  const wordCount = message.split(" ").length;
  if (wordCount > 150) {
    issues.push("Too long");
    suggestions.push(`Keep under 150 words (currently ${wordCount})`);
    score -= 10;
  }

  // Check 5: Benefit-focused
  if (!message.match(/result|outcome|achieve|save|increase|grow|improve/i)) {
    issues.push("Not results-focused");
    suggestions.push(`Tie to their specific outcome`);
    score -= 10;
  }

  return {
    isGood: score >= 70,
    issues,
    score,
    suggestions,
  };
}

// ============ ENGINE 7: DYNAMIC MESSAGE GENERATION ============
export async function generateSmartMessage(
  leadProfile: SalesLeadProfile,
  brandContext: SalesBrandContext | BrandContext,
  stage: "cold" | "follow_up" | "objection" | "closing",
  _additionalContext?: Record<string, unknown>
): Promise<string> {
  const uvp = await detectUVP(brandContext);
  const industry = leadProfile.industry || "General";
  const niche = (brandContext as SalesBrandContext).niche || "General";
  const companyName = leadProfile.companyName || leadProfile.company || "";

  const competitive = await gatherCompetitorIntelligence(
    industry,
    niche,
    companyName
  );

  const brandCompanyName = (brandContext as SalesBrandContext).companyName || brandContext.businessName || "This Business";
  const firstName = leadProfile.firstName || "";
  const painPoint = leadProfile.painPoint || "Unknown - find out";
  
  // Fetch deep brand context from user metadata if available
  let deepBrandContext = "";
  if (brandContext.userId) {
    const user = await storage.getUserById(brandContext.userId);
    if (user?.metadata?.brandContext) {
      deepBrandContext = user.metadata.brandContext;
    }
  }
  
  const pdfContext = (leadProfile as any).pdfContext || deepBrandContext;

  const stageText = stage === "cold"
    ? "First touch - grab attention"
    : stage === "follow_up"
      ? "They're interested - push momentum"
      : stage === "objection"
        ? "Handle objection - lead frame"
        : "Close them - make it easy to say yes";

  // Inject Lead History and Tags for better intent analysis
  const leadHistory = leadProfile.metadata?.conversationHistory || "No previous history";
  const leadTags = leadProfile.tags?.join(", ") || "No tags";

  const prompt = `You are a world-class sales closer who closes million-dollar deals.
Your goal: Make ${companyName} their first $1,000 close TODAY.

LEAD CONTEXT:
- History: ${leadHistory}
- Tags: ${leadTags}

BRAND: ${brandCompanyName}
UVP: ${uvp.uvp}
DIFFERENTIATORS: ${uvp.differentiators.join(", ")}
${pdfContext ? `BRAND PDF CONTEXT: ${pdfContext.substring(0, 3000)}` : ""}

LEAD: ${firstName} at ${companyName}
INDUSTRY: ${industry}
PAIN: ${painPoint}

STAGE: ${stageText}

WHAT COMPETITORS DON'T HAVE: ${competitive.gaps.join(", ")}

Write a message that:
1. ✅ Personalizes with their company/industry
2. ✅ Shows you understand their SPECIFIC pain
3. ✅ Highlights what competitors DON'T have (their gap)
4. ✅ Ends with a CLEAR next step
5. ✅ Sounds like a real person (confident, calm, ROI-focused)
6. ✅ NO defensive language
7. ✅ Keep under 120 words
8. ✅ Urgency without desperation

Message:`;

  try {
    if (!openai) {
      throw new Error("OpenAI not initialized");
    }

    const response = await (openai as OpenAI).chat.completions.create({
      model: MODELS.sales_reasoning,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.8,
      max_tokens: 300,
    });

    return response.choices[0]?.message?.content || "";
  } catch (error) {
    console.error("Error generating message:", error);
    return `Hi ${firstName}, quick question about ${companyName} — are you open to a 5-minute conversation?`;
  }
}

// ============ ENGINE 8: INTELLIGENT TESTIMONIAL INTEGRATION ============
export async function buildMessageWithTestimonial(
  baseMessage: string,
  testimonials: Testimonial[],
  leadProfile: SalesLeadProfile
): Promise<string> {
  const selectedTestimonial = await smartSelectTestimonial(testimonials, {
    industry: leadProfile.industry,
    companySzie: leadProfile.companySize,
    painPoint: leadProfile.painPoint,
    stage: "consideration",
  });

  if (!selectedTestimonial) {
    return baseMessage;
  }

  // Decide WHERE to put testimonial
  if (baseMessage.length < 80) {
    // Short message - add testimonial after
    return baseMessage + `\n\nBtw, similar companies report: ${selectedTestimonial.text}`;
  } else {
    // Longer message - weave it in
    return baseMessage.replace(/\?$/, `? We've seen similar companies ${selectedTestimonial.text}`);
  }
}

// ============ COMPLETE UNIVERSAL FLOW ============
export async function generateOptimizedMessage(
  leadProfile: SalesLeadProfile,
  brandContext: SalesBrandContext | BrandContext,
  testimonials: Testimonial[],
  stage: "cold" | "follow_up" | "objection" | "closing" = "cold"
): Promise<OptimizedMessageResult> {
  let message = await generateSmartMessage(leadProfile, brandContext, stage);

  if (testimonials.length > 0) {
    message = await buildMessageWithTestimonial(message, testimonials, leadProfile);
  }

  const quality = await verifyMessageQuality(message, leadProfile, brandContext);

  if (!quality.isGood && quality.suggestions.length > 0) {
    // Try again with suggestions
    message = message + `\n\n💡 Better version: ` + quality.suggestions[0];
  }

  const companyName = leadProfile.companyName || leadProfile.company || "";
  const firstName = leadProfile.firstName || "";
  const industry = leadProfile.industry || "";

  return {
    message,
    quality,
    reasoning: `Generated for ${firstName} at ${companyName} (${industry}) - Stage: ${stage}`,
  };
}

export const universalSalesAI = new UniversalSalesAI();
