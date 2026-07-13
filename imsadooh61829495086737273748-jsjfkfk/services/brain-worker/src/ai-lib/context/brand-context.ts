import { storage } from '@shared/lib/storage/storage.js';

export interface BrandContext {
  companyName: string;
  businessDescription?: string;
  industry?: string;
  uniqueValue?: string;
  targetAudience?: string;
  successStories?: string[];
  offer?: string;
  tone?: "formal" | "casual" | "warm" | "blunt";
  positioning?: "premium" | "mid" | "volume";
  objections?: Record<string, string>;
  brandLanguage?: {
    prefer?: string[];
    avoid?: string[];
  };
  // Auto-send links from brand PDF
  meetingLink?: string | null; // Calendly, Cal.com, booking link
  paymentLink?: string | null; // Stripe, PayPal, bank details
  appLink?: string | null; // SaaS app, download link
  contactEmail?: string | null;
  contactPhone?: string | null;
  // Booking automation preference: 'link' (just send link) or 'autonomous' (suggest slots)
  bookingPreference?: 'link' | 'autonomous';
  signature?: string;
  brandKnowledge?: string;
  persona?: {
    name: string;
    role: string;
    bio: string;
    style?: string;
  };
}

/**
 * Retrieve complete brand context for a user, optionally with a specific persona
 */
export async function getBrandContext(userId: string, personaId?: string): Promise<BrandContext> {
  try {
    const user = await storage.getUserById(userId);

    if (!user) {
      return getDefaultContext();
    }

    const metadata = user.metadata || {};
    let selectedPersona: any = null;

    if (personaId && metadata.personas && Array.isArray(metadata.personas)) {
      selectedPersona = metadata.personas.find((p: any) => p.id === personaId);
    }

    return {
      companyName: user.businessName || user.company || "your company",
      businessDescription:
        metadata.businessDescription ||
        metadata.pitch ||
        "helping clients grow their business",
      industry: metadata.industry,
      uniqueValue: metadata.uniqueValue || metadata.mainBenefit,
      targetAudience: metadata.targetAudience || metadata.idealClient,
      successStories: metadata.successStories || metadata.wins || [],
      offer: metadata.offer || metadata.packages,
      tone: metadata.tone || "warm",
      positioning: metadata.positioning || "premium",
      objections: metadata.objections || {},
      brandLanguage: metadata.brandLanguage || {
        prefer: [],
        avoid: [],
      },
      // Auto-send links from brand PDF or User Settings
      meetingLink: user.calendarLink || metadata.meeting_link || metadata.calendly_link || metadata.calendarLink || metadata.booking_link || null,
      paymentLink: user.defaultPaymentLink || metadata.payment_link || metadata.stripe_link || metadata.bank_details || null,
      appLink: metadata.app_link || metadata.signup_link || metadata.download_link || null,
      contactEmail: metadata.contact_email || user.email || null,
      contactPhone: metadata.contact_phone || null,
      bookingPreference: metadata.booking_preference || 'autonomous', // Default to autonomous for premium feel
      signature: metadata.signature || metadata.email_signature || `\n\nBest regards,\n${user.businessName || 'The Team'}`,
      brandKnowledge: [
        user.brandGuidelinePdfText,
        await storage.getBrandKnowledge(userId)
      ].filter(Boolean).join('\n---\n') || '',
      persona: selectedPersona ? {
        name: selectedPersona.name,
        role: selectedPersona.role,
        bio: selectedPersona.bio,
        style: selectedPersona.style
      } : undefined
    };
  } catch (error) {
    console.error("Error fetching brand context:", error);
    return getDefaultContext();
  }
}

function getDefaultContext(): BrandContext {
  return {
    companyName: "your company",
    businessDescription: "helping clients grow",
    tone: "warm",
    positioning: "premium",
  };
}

/**
 * Build industry-specific system prompt injection
 */
export function buildIndustryPrompt(brand: BrandContext): string {
  const industryKey = brand.industry?.toLowerCase() ?? "b2b";

  const industryGuides: Record<string, string> = {
    realestate:
      "Focus on urgency, timing windows, scarcity, and fast response. Emphasize market timing and deal windows.",
    agency:
      "Lead with ROI, bottleneck removal, predictable throughput. Talk about efficiency gains and capacity.",
    coaching:
      "Emphasize transformation, clarity, trust, and step-by-step progress. Build desire for the end state.",
    creator:
      "Focus on engagement growth, consistency, speed, and maintaining brand voice. Celebrate wins.",
    b2b:
      "Emphasize efficiency, reliability, scalability, and professionalism. Talk about team adoption.",
    ecommerce:
      "Lead with conversion rates, average order value, repeat purchases, and traffic quality.",
    saas:
      "Focus on churn reduction, expansion revenue, product adoption, and user engagement metrics.",
  };

  return industryGuides[industryKey] ?? industryGuides.b2b;
}

/**
 * Format complete brand context for AI system prompt
 */
export function formatBrandContextForPrompt(brand: BrandContext): string {
  let prompt = `# Brand Context

Company: ${brand.companyName}`;

  if (brand.businessDescription) {
    prompt += `\nWhat you do: ${brand.businessDescription}`;
  }

  if (brand.industry) {
    prompt += `\nIndustry: ${brand.industry}`;
    prompt += `\nIndustry Focus: ${buildIndustryPrompt(brand)}`;
  }

  if (brand.uniqueValue) {
    prompt += `\nYour unique value: ${brand.uniqueValue}`;
  }

  if (brand.targetAudience) {
    prompt += `\nTarget audience: ${brand.targetAudience}`;
  }

  if (brand.positioning) {
    prompt += `\nPositioning: ${brand.positioning} (adjust tone accordingly)`;
  }

  if (brand.offer) {
    prompt += `\nYour offer: ${brand.offer}`;
  }

  if (brand.successStories && brand.successStories.length > 0) {
    prompt += `\nSuccess stories: ${brand.successStories.join(", ")}`;
  }

  if (brand.objections && Object.keys(brand.objections).length > 0) {
    prompt += `\nCommon objections & how to handle them:`;
    for (const [objection, response] of Object.entries(brand.objections)) {
      prompt += `\n- "${objection}": Respond with "${response}"`;
    }
  }

  if (brand.brandLanguage) {
    if (brand.brandLanguage.prefer && brand.brandLanguage.prefer.length > 0) {
      prompt += `\nPreferred language: ${brand.brandLanguage.prefer.join(", ")}`;
    }
    if (brand.brandLanguage.avoid && brand.brandLanguage.avoid.length > 0) {
      prompt += `\nAvoid using: ${brand.brandLanguage.avoid.join(", ")}`;
    }
  }
  
  if (brand.brandKnowledge) {
    // Truncate to 20k chars to avoid bloating context window while keeping top facts
    const truncatedKnowledge = brand.brandKnowledge.length > 20000 
      ? brand.brandKnowledge.substring(0, 20000) + "... [truncated for brevity]"
      : brand.brandKnowledge;
    prompt += `\n\n# Advanced Brand Knowledge (from PDF/Scraping):\n${truncatedKnowledge}`;
  }
  
  
  if (brand.persona) {
    prompt += `\n\n# Your Identity (AI Persona)
You are representing: ${brand.persona.name}
Role: ${brand.persona.role}
Bio/Background: ${brand.persona.bio}`;
    if (brand.persona.style) {
      prompt += `\nWriting Style: ${brand.persona.style}`;
    }
  }
  
  prompt += `\n\n# Tone: Always sound like ${brand.persona?.name || brand.companyName}, but better.`;

  return prompt;
}

/**
 * Extract tone and positioning from brand data
 */
export function extractBrandPersonality(brand: BrandContext): {
  tone: "formal" | "casual" | "warm" | "blunt";
  confidence: "high" | "medium" | "low";
  urgency: "high" | "medium" | "low";
} {
  let confidence: "high" | "medium" | "low" = "medium";
  let urgency: "high" | "medium" | "low" = "medium";

  if (brand.positioning === "premium") {
    confidence = "high";
  }

  const industryLower = brand.industry?.toLowerCase();
  if (industryLower === "realestate" || industryLower === "sales") {
    urgency = "high";
  }

  return {
    tone: brand.tone ?? "warm",
    confidence,
    urgency,
  };
}

/**
 * Build a personalized objection response using brand context
 */
export async function buildPersonalizedObjectionResponse(
  objectionType: string,
  leadMessage: string,
  userId: string
): Promise<string> {
  const brand = await getBrandContext(userId);

  let response = '';

  // Check if brand has custom objection handling
  if (brand.objections && brand.objections[objectionType]) {
    response = brand.objections[objectionType];
  } else {
    // Build generic response with brand context
    const personality = extractBrandPersonality(brand);

    switch (objectionType) {
      case 'price':
        response = personality.confidence === 'high'
          ? `I understand investment is a consideration. With ${brand.companyName}, you're not just getting a service - you're getting ${brand.uniqueValue || 'exceptional results'}. Most of our clients see ROI within the first month.`
          : `Let's talk about what you'd get for your investment. ${brand.uniqueValue || 'Our solution'} is designed to deliver real value.`;
        break;
      case 'timing':
        response = `I totally get it - timing matters. But here's the thing: waiting often costs more than acting. ${brand.companyName} clients typically see results fast, so the sooner you start, the sooner you'll see the difference.`;
        break;
      case 'competitor':
        response = `That's a fair point - there are options out there. What sets ${brand.companyName} apart is ${brand.uniqueValue || 'our personalized approach and dedicated support'}. Would you like to see how we compare?`;
        break;
      case 'trust':
        response = brand.successStories && brand.successStories.length > 0
          ? `I hear you - trust is earned. ${brand.successStories[0]}. We have a track record of delivering for clients like you.`
          : `Trust is everything. We're confident in what we deliver, which is why we focus on transparent communication and measurable results.`;
        break;
      default:
        response = `Thanks for sharing that. At ${brand.companyName}, we're here to help you succeed. Let me address your concern directly...`;
    }
  }

  return response;
}


