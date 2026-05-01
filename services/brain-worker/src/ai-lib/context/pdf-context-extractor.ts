/**
 * INTELLIGENT PDF CONTEXT EXTRACTOR
 * 
 * Extracts from brand PDFs:
 * - Testimonials + case studies
 * - Product/service details
 * - Unique value propositions
 * - Target audience
 * - Pricing
 * - Industry-specific language
 * - URLs to testimonial pages
 * 
 * Then brainstorms with internet research:
 * - Competitive positioning
 * - Market gaps
 * - Industry trends
 * - Optimal messaging angles
 */

import { generateReply } from "../core/ai-service.js";
import { MODELS } from "../utils/model-config.js";

export interface ExtractedPDFContent {
  company_name: string;
  industry: string;
  target_audience: string;
  main_offer: string;
  unique_value: string[];
  testimonials: Array<{ text: string; source: string; impact: string }>;
  case_studies: Array<{ title: string; results: string }>;
  pricing_options: string[];
  tone_examples: string[];
  success_metrics: string[];
  website_urls: string[];
  competitor_positioning: string;
  // NEW: Auto-send links extracted from PDF
  meeting_link: string | null; // Calendly, Cal.com, or any booking link
  payment_link: string | null; // Stripe, PayPal, bank details, invoice link
  app_link: string | null; // SaaS app, download link, signup page
  contact_email: string | null;
  contact_phone: string | null;
  social_links: string[];
  // Deep research results
  market_research: string | null;
  competitor_analysis: string[];
  industry_trends: string[];
}

interface IndustryGuidance {
  urgencyDrivers: string[];
  objectionHandling: Record<string, string>;
  sendingStrategy: string;
  closePatterns: string[];
}

export async function extractComprehensiveContext(pdfText: string): Promise<ExtractedPDFContent> {
  try {
    const extractionPrompt = `Analyze this brand PDF and extract EVERYTHING about their business:

${pdfText.substring(0, 6000)} 

Extract and return ONLY valid JSON (no markdown, no code blocks):
{
  "company_name": "exact name from PDF",
  "industry": "their industry vertical",
  "target_audience": "who they serve",
  "main_offer": "primary product/service",
  "unique_value": ["unique angle 1", "unique angle 2"],
  "testimonials": [{"text": "exact quote", "source": "name/company", "impact": "result metric"}],
  "case_studies": [{"title": "case study title", "results": "specific outcomes"}],
  "pricing_options": ["option 1", "option 2"],
  "tone_examples": ["sample brand language"],
  "success_metrics": ["metric 1", "metric 2"],
  "website_urls": ["url1", "url2"],
  "competitor_positioning": "how they position vs competitors",
  "meeting_link": "calendly.com/xxx or cal.com/xxx or any booking URL found",
  "payment_link": "stripe payment link, paypal.me, bank details, or invoice URL",
  "app_link": "SaaS app URL, signup page, or download link",
  "contact_email": "business email for contact",
  "contact_phone": "business phone number",
  "social_links": ["instagram", "twitter", "linkedin URLs"]
}

IMPORTANT: Look carefully for ANY booking/calendar links (Calendly, Cal.com, Acuity, etc).
Look for payment links (Stripe, PayPal, Gumroad, invoice details, bank transfer info).
Look for app/signup links if it's a SaaS or software product.
Be thorough and precise.`;

    const response = await generateReply(
      "You are a helpful assistant that extracts structured data from PDFs.",
      extractionPrompt,
      {
        model: MODELS.sales_reasoning,
        jsonMode: true,
        temperature: 0.3,
        maxTokens: 1500,
      }
    );

    const messageContent: string = response.text ?? "{}";

    let extracted: Partial<ExtractedPDFContent> = {};
    try {
      extracted = JSON.parse(messageContent) as Partial<ExtractedPDFContent>;
    } catch {
      const text = messageContent;
      extracted = {
        company_name: text.match(/company_name["\s:]*([^,\n}]*)/)?.[1] ?? "Unknown",
        industry: text.match(/industry["\s:]*([^,\n}]*)/)?.[1] ?? "B2B",
      };
    }

    const competitiveResearch = await researchCompetitivePosition(
      extracted.company_name ?? "Unknown",
      extracted.industry ?? "B2B",
      extracted.target_audience ?? "Businesses"
    );

    // Deep online research for the brand
    const deepResearch = await performDeepBrandResearch(
      extracted.company_name ?? "Unknown",
      extracted.industry ?? "B2B",
      extracted.website_urls ?? []
    );

    return {
      company_name: extracted.company_name ?? "Unknown",
      industry: extracted.industry ?? "B2B",
      target_audience: extracted.target_audience ?? "General",
      main_offer: extracted.main_offer ?? "Services",
      unique_value: extracted.unique_value ?? [],
      testimonials: extracted.testimonials ?? [],
      case_studies: extracted.case_studies ?? [],
      pricing_options: extracted.pricing_options ?? [],
      tone_examples: extracted.tone_examples ?? [],
      success_metrics: extracted.success_metrics ?? [],
      website_urls: extracted.website_urls ?? [],
      competitor_positioning: competitiveResearch ?? "Competitive",
      // New link fields
      meeting_link: (extracted as any).meeting_link || null,
      payment_link: (extracted as any).payment_link || null,
      app_link: (extracted as any).app_link || null,
      contact_email: (extracted as any).contact_email || null,
      contact_phone: (extracted as any).contact_phone || null,
      social_links: (extracted as any).social_links || [],
      // Deep research results
      market_research: deepResearch.market_research,
      competitor_analysis: deepResearch.competitor_analysis,
      industry_trends: deepResearch.industry_trends,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Error extracting PDF context:", errorMessage);
    return {
      company_name: "Unknown",
      industry: "B2B",
      target_audience: "General",
      main_offer: "Services",
      unique_value: [],
      testimonials: [],
      case_studies: [],
      pricing_options: [],
      tone_examples: [],
      success_metrics: [],
      website_urls: [],
      competitor_positioning: "Standard offering",
      meeting_link: null,
      payment_link: null,
      app_link: null,
      contact_email: null,
      contact_phone: null,
      social_links: [],
      market_research: null,
      competitor_analysis: [],
      industry_trends: [],
    };
  }
}

/**
 * DEEP BRAND RESEARCH - Goes online to analyze brand thoroughly
 */
export async function performDeepBrandResearch(
  companyName: string,
  industry: string,
  websiteUrls: string[]
): Promise<{
  market_research: string | null;
  competitor_analysis: string[];
  industry_trends: string[];
}> {
  try {
    const response = await generateReply(
      "You are a world-class market research analyst. Research deeply and provide actionable insights.",
      `Conduct DEEP research on this business and provide comprehensive analysis:

Company: ${companyName}
Industry: ${industry}
Known URLs: ${websiteUrls.join(", ") || "Not provided"}

Research and provide:

1. MARKET RESEARCH (500 words):
- Current market size and growth trajectory
- Key market segments and opportunities
- Customer pain points this company can solve
- Untapped opportunities in their space

2. COMPETITOR ANALYSIS (list top 5-7):
- Who are the main competitors?
- What are their weaknesses?
- How can ${companyName} outposition them?
- Pricing gaps in the market

3. INDUSTRY TRENDS (list 5-7):
- What's changing in ${industry}?
- New technologies affecting the space
- Customer behavior shifts
- Regulatory changes
- Where is the industry heading in 12-24 months?

Return as JSON:
{
  "market_research": "comprehensive market analysis paragraph",
  "competitor_analysis": ["competitor 1: weakness and opportunity", "competitor 2: weakness"],
  "industry_trends": ["trend 1 with implications", "trend 2"]
}`,
      {
        model: MODELS.sales_reasoning,
        jsonMode: true,
        temperature: 0.7,
        maxTokens: 1500,
      }
    );

    const content = response.text ?? "{}";
    try {
      const parsed = JSON.parse(content);
      return {
        market_research: parsed.market_research || null,
        competitor_analysis: parsed.competitor_analysis || [],
        industry_trends: parsed.industry_trends || [],
      };
    } catch {
      return {
        market_research: content,
        competitor_analysis: [],
        industry_trends: [],
      };
    }
  } catch (error) {
    console.error("Deep research error:", error);
    return {
      market_research: null,
      competitor_analysis: [],
      industry_trends: [],
    };
  }
}

export async function researchCompetitivePosition(
  businessName: string,
  industry: string,
  targetAudience: string
): Promise<string> {
  try {
    const responseResult = await generateReply(
      "You are a competitive positioning expert.",
      `Research the competitive landscape for:
          
Business: ${businessName}
Industry: ${industry}
Target Audience: ${targetAudience}

Provide:
1. Top 3-5 competitors in this space
2. How ${businessName} should position to dominate
3. Unique angles competitors are missing
4. Messaging recommendations to stand out

Format concisely and actionably.`,
      {
        model: MODELS.sales_reasoning,
        temperature: 0.7,
        maxTokens: 400
      }
    );

    return responseResult.text ?? "Standard positioning in market";
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Error researching competitive position:", errorMessage);
    return "Competitive offering in market";
  }
}

export async function brainstormMessageAngles(
  extractedContent: ExtractedPDFContent
): Promise<string[]> {
  try {
    const responseResult = await generateReply(
      "You are a creative sales copywriter.",
      `Based on this business context, brainstorm 5 KILLER messaging angles for sales outreach:

Company: ${extractedContent.company_name}
Industry: ${extractedContent.industry}
Offer: ${extractedContent.main_offer}
Unique Value: ${extractedContent.unique_value.join(", ")}
Success Metrics: ${extractedContent.success_metrics.join(", ")}
Competitive Position: ${extractedContent.competitor_positioning}

Create 5 punchy messaging angles that:
1. Stand out from competitors
2. Highlight their specific advantage
3. Use their language/tone
4. Drive high response rates

Format as numbered list.`,
      {
        model: MODELS.sales_reasoning,
        temperature: 0.8,
        maxTokens: 500
      }
    );

    const text: string = responseResult.text ?? "";
    return text
      .split("\n")
      .filter((line: string) => line.trim().match(/^\d/))
      .slice(0, 5);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Error brainstorming angles:", errorMessage);
    return [];
  }
}

export async function generateIndustrySpecificGuidance(
  extractedContent: ExtractedPDFContent
): Promise<IndustryGuidance> {
  try {
    const responseResult = await generateReply(
      `You are an expert in the ${extractedContent.industry} space.`,
      `Provide industry-specific sales guidance:

1. URGENCY DRIVERS - What makes THIS industry prospect take action fast?
2. COMMON OBJECTIONS - What do prospects in ${extractedContent.industry} typically say?
3. HOW TO HANDLE EACH - Responses that work in this industry
4. SENDING STRATEGY - Cadence, best times, channels
5. CLOSE PATTERNS - How million-dollar closers close in ${extractedContent.industry}

Format as JSON.`,
      {
        model: MODELS.sales_reasoning,
        jsonMode: true,
        temperature: 0.7,
        maxTokens: 800
      }
    );

    const text: string = responseResult.text ?? "{}";
    try {
      return JSON.parse(text) as IndustryGuidance;
    } catch {
      return {
        urgencyDrivers: ["ROI", "Time to value", "Competitive pressure"],
        objectionHandling: {
          price: "Focus on ROI and payback period",
          busy: "Keep it brief, 5-minute conversation",
          already_using: "Highlight what you do differently",
        },
        sendingStrategy: "3 touches over 2 weeks, avoid Mondays/Fridays",
        closePatterns: [
          "Start with small commitment",
          "Use social proof/testimonials",
          "Create urgency through scarcity",
        ],
      };
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Error generating guidance:", errorMessage);
    return {
      urgencyDrivers: [],
      objectionHandling: {},
      sendingStrategy: "",
      closePatterns: [],
    };
  }
}

