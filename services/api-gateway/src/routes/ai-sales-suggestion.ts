import { Router, Request, Response } from "express";
import { requireAuthOrApiKey } from "../middleware/auth.js";
import { generateReply } from "@services/brain-worker/src/ai-lib/core/ai-service.js";
import { MODELS } from "@services/brain-worker/src/ai-lib/utils/model-config.js";

const router = Router();

interface LeadProfileInput {
  firstName: string;
  company?: string;
  industry?: string;
  painPoint?: string;
}

interface BrandContextInput {
  companyName: string;
  businessDescription: string;
  targetAudience?: string;
  tone?: string;
  offer?: string;
}

interface AnalysisDataInput {
  overall_score?: number;
}

interface SuggestBestRequestBody {
  leadProfile: LeadProfileInput;
  brandContext: BrandContextInput;
  analysisData?: AnalysisDataInput;
  messageType?: string;
}

interface SuggestFollowUpRequestBody {
  lastMessage: string;
  leadProfile: LeadProfileInput;
  brandContext: BrandContextInput;
  conversationHistory?: unknown[];
}

/**
 * POST /api/ai/suggest-best
 * INSTANT: Generate best sales-ready copy based on context
 * (No waiting for 7 days - works RIGHT NOW)
 */
router.post("/suggest-best", requireAuthOrApiKey, async (req: Request<unknown, unknown, SuggestBestRequestBody>, res: Response): Promise<void> => {
  try {
    const { leadProfile, brandContext, analysisData, messageType } = req.body;

    if (!leadProfile || !brandContext) {
      res.status(400).json({ error: "Missing lead or brand context" });
      return;
    }

    const prompt = `You are a world-class sales closer. Generate the BEST sales-ready message RIGHT NOW.

LEAD:
- Name: ${leadProfile.firstName}
- Company: ${leadProfile.company}
- Industry: ${leadProfile.industry}
- Pain Point: ${leadProfile.painPoint || "Unknown"}

YOUR BUSINESS:
- Company: ${brandContext.companyName}
- What you do: ${brandContext.businessDescription}
- Target: ${brandContext.targetAudience}
- Tone: ${brandContext.tone}
- Offer: ${brandContext.offer}
${analysisData ? `- Brand Clarity: ${analysisData.overall_score}%` : ""}

MESSAGE TYPE: ${messageType || "cold_outreach"}

RULES:
1. NO fluff. NO corporate speak.
2. Personalize with their company or industry.
3. Show you understand THEIR specific problem.
4. Lead with the benefit (not features).
5. ONE clear next step ("call" OR "question" OR "look at").
6. Keep under 100 words.
7. Confidence tone. No apologies. No "I think."
8. Make them feel like a winner, not a prospect.

Generate 3 OPTIONS ranked by sales effectiveness:

OPTION A (Most Direct - Highest Close Rate):
[message]

OPTION B (Most Consultative - Best for Consideration):
[message]

OPTION C (Most ROI-Focused - Best for Decision Makers):
[message]

For each, include 2-line reasoning why it works.`;

    const response = await generateReply(
      "You are a world-class sales closer. Generate the BEST sales-ready message RIGHT NOW.",
      prompt,
      {
        model: MODELS.sales_reasoning,
        temperature: 0.8,
        maxTokens: 800
      }
    );

    const suggestions = response.text || "";

    res.json({
      success: true,
      suggestions,
      lead: leadProfile.firstName,
      messageType,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error("Error generating suggestions:", error);
    res.status(500).json({ error: "Failed to generate suggestions" });
  }
});

/**
 * POST /api/ai/suggest-instant-follow-up
 * Generate instant follow-up based on lead response
 */
router.post("/suggest-instant-follow-up", requireAuthOrApiKey, async (req: Request<unknown, unknown, SuggestFollowUpRequestBody>, res: Response): Promise<void> => {
  try {
    const { lastMessage, leadProfile, brandContext } = req.body;

    if (!lastMessage || !leadProfile) {
      res.status(400).json({ error: "Missing message or lead" });
      return;
    }

    const prompt = `Lead just said: "${lastMessage}"

Lead: ${leadProfile.firstName} at ${leadProfile.company}
Your offer: ${brandContext.businessDescription}

Generate the BEST 1-line response to keep momentum. Make it feel natural, not salesy.

Requirements:
- Under 20 words
- Confident tone
- Keep conversation going
- Lead them closer to decision

Response:`;

    const response = await generateReply(
      "You are a world-class sales closer.",
      prompt,
      {
        model: MODELS.sales_reasoning,
        temperature: 0.7,
        maxTokens: 100
      }
    );

    const instantReply = response.text || "";

    res.json({
      success: true,
      instant_reply: instantReply,
      lead: leadProfile.firstName,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error("Error generating follow-up:", error);
    res.status(500).json({ error: "Failed to generate follow-up" });
  }
});

export default router;

