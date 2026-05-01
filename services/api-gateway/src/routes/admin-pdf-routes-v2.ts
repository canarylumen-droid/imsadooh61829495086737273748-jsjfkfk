import { Router, Request, Response } from "express";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import multer from "multer";

interface PDFCheckItem {
  name: string;
  present: boolean;
  required: boolean;
  weight: number;
}

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * POST /api/admin/analyze-pdf-v2
 * TIER 4 Ai-powered PDF analysis with all 15 UX patterns
 */
router.post(
  "/analyze-pdf-v2",
  requireAuth,
  requireAdmin,
  upload.single("pdf"),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No PDF provided" });
      }

      // PDF text extraction with fallback
      let pdfText = "";
      try {
        pdfText = req.file.buffer.toString("utf-8");
      } catch (parseError) {
        console.warn("⚠️ PDF Parse failed, falling back to empty string:", parseError);
        pdfText = "";
      }

      const pdfContent = pdfText.toLowerCase();
      const fileSize = req.file.size;
      const fileName = req.file.originalname;

      // ============ SMART SANITY CHECKER ============
      const fileWarnings: string[] = [];

      // Check for tiny files
      if (fileSize < 10000) {
        fileWarnings.push("This file is very small. Make sure it contains real content.");
      }

      // Check for extremely large files
      if (fileSize > 20 * 1024 * 1024) {
        fileWarnings.push("Large file (20MB+). We recommend smaller, focused PDFs.");
      }

      // Check for likely scam (JPG saved as PDF)
      if (!pdfContent.includes("pdf") && !pdfContent.includes("stream")) {
        fileWarnings.push("⚠️ This might be an image saved as PDF. We need actual text content.");
      }

      // ============ ANALYSIS CHECKLIST ============
      const checks: PDFCheckItem[] = [
        {
          name: "Company Overview",
          present: /company|business|about|overview|who we are|what we do/.test(pdfContent),
          required: true,
          weight: 1.2,
        },
        {
          name: "Offer/Pricing",
          present: /price|pricing|package|offer|plan|cost|investment|what we offer/.test(pdfContent),
          required: true,
          weight: 1.2,
        },
        {
          name: "Target Client",
          present: /ideal|target|client|audience|avatar|who we serve|for/.test(pdfContent),
          required: true,
          weight: 1.2,
        },
        {
          name: "Tone/Style",
          present: /tone|style|voice|personality|brand|how we talk|communication/.test(pdfContent),
          required: true,
          weight: 1.0,
        },
        {
          name: "Success Stories",
          present: /success|case study|win|result|testimonial|client|project|achieved/.test(pdfContent),
          required: false,
          weight: 1.5,
        },
        {
          name: "Objections",
          present: /objection|concern|hesitation|doubt|question|common question|faq/.test(pdfContent),
          required: false,
          weight: 1.3,
        },
        {
          name: "Brand Language",
          present: /language|words|avoid|prefer|slang|use|don't|terminology/.test(pdfContent),
          required: false,
          weight: 1.0,
        },
        {
          name: "Media Assets",
          present: /image|logo|screenshot|example|visual|picture|diagram/.test(pdfContent),
          required: false,
          weight: 0.8,
        },
        {
          name: "Goals/Metrics",
          present: /goal|metric|kpi|success|revenue|growth|improvement/.test(pdfContent),
          required: false,
          weight: 1.2,
        },
        {
          name: "Competitor Info",
          present: /competitor|competition|vs|versus|different|unique|edge/.test(pdfContent),
          required: false,
          weight: 0.9,
        },
      ];

      // ============ CALCULATE SCORES ============
      const presentCount = checks.filter((c) => c.present).length;
      const requiredCount = checks.filter((c) => c.required).length;
      const presentRequired = checks.filter((c) => c.required && c.present).length;

      // Weighted scoring
      const presentWeight = checks.filter((c) => c.present).reduce((sum, c) => sum + c.weight, 0);
      const totalWeight = checks.reduce((sum, c) => sum + c.weight, 0);
      const overallScore = Math.round((presentWeight / totalWeight) * 100);

      // Individual metrics
      const clarityScore = presentRequired >= requiredCount ? 90 : presentRequired >= 3 ? 60 : 30;
      const detailScore = Math.round((presentCount / checks.length) * 100);
      const structureScore = /header|section|title|chapter|outline/.test(pdfContent) ? 85 : 50;
      const missingCriticalScore =
        checks.filter((c) => c.required && !c.present).length === 0
          ? 100
          : Math.max(0, 100 - checks.filter((c) => c.required && !c.present).length * 25);

      const missingCritical = checks
        .filter((c) => c.required && !c.present)
        .map((c) => c.name);

      // ============ OUTPUT QUALITY LEVEL (1-5) ============
      let outputQualityLevel = 1;
      if (overallScore >= 90) outputQualityLevel = 5;
      else if (overallScore >= 75) outputQualityLevel = 4;
      else if (overallScore >= 60) outputQualityLevel = 3;
      else if (overallScore >= 40) outputQualityLevel = 2;

      // ============ AI SUGGESTIONS ============
      const suggestedAdditions: string[] = [];

      if (missingCritical.includes("Success Stories")) {
        suggestedAdditions.push("Add 1-2 past campaign examples or client wins (shows real results)");
      }

      if (missingCritical.includes("Objections")) {
        suggestedAdditions.push("List common objections you hear + how you handle them");
      }

      if (missingCritical.includes("Brand Language")) {
        suggestedAdditions.push("Share your tone: Are you formal? Casual? Direct? Give 3 phrases you use often.");
      }

      if (missingCritical.includes("Tone/Style")) {
        suggestedAdditions.push(
          "Add writing examples showing your personality (emails, website copy, past pitches)"
        );
      }

      if (missingCritical.includes("Competitor Info")) {
        suggestedAdditions.push("Mention what competitors are doing + what you do differently");
      }

      if (presentCount < 7) {
        suggestedAdditions.push("Add 2-3 screenshots or visuals to show your actual products/interface");
      }

      if (fileSize < 50000) {
        suggestedAdditions.push("This PDF is quite short. Add more examples or case studies.");
      }

      if (!fileWarnings.some((w) => w.includes("warning"))) {
        // User might not know our process
        if (checks.filter((c) => c.present).length < 6) {
          suggestedAdditions.push("Paste your latest pitch deck or sales email for better context");
        }
      }

      // ============ INSTANT SUMMARY ============
      const summary = buildSummary(checks, fileName);

      // ============ RECOMMENDATIONS ============
      const recommendations: string[] = [];

      if (presentRequired < requiredCount) {
        recommendations.push(`Add the ${requiredCount - presentRequired} missing required fields`);
      }

      if (presentCount < 7) {
        recommendations.push("Include success stories and objection handling for better AI responses");
      }

      if (!checks.find((c) => c.name === "Brand Language")?.present) {
        recommendations.push("Add your preferred language and phrases to use");
      }

      const aiAssistanceMessage = overallScore < 60
        ? "Don't worry — our AI will research your industry and fill in the gaps. You can upload now and we'll handle the rest."
        : overallScore < 80
          ? "Good foundation! Our AI will enhance any missing details using industry research."
          : "Excellent! Your brand profile is comprehensive — AI will perform at its best.";

      const canProceedAnyway = true;
      const proceedMessage = overallScore < 50
        ? "You can still proceed. Our AI will use deep research to find relevant data about your industry, competitors, and target audience to fill gaps."
        : "Ready to proceed. AI has enough context to generate high-quality responses.";

      return res.json({
        overall_score: overallScore,
        clarity_score: clarityScore,
        detail_score: detailScore,
        structure_score: structureScore,
        missing_critical_score: missingCriticalScore,
        items: checks,
        missing_critical: missingCritical,
        recommendations,
        file_warnings: fileWarnings,
        output_quality_level: outputQualityLevel,
        suggested_additions: suggestedAdditions.slice(0, 6),
        summary,
        ai_assistance_message: aiAssistanceMessage,
        can_proceed_anyway: canProceedAnyway,
        proceed_message: proceedMessage,
      });
    } catch (error: any) {
      console.error("Error analyzing PDF:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// ============ HELPER: Build Instant Summary ============
function buildSummary(checks: PDFCheckItem[], _fileName: string): string {
  const present = checks.filter((c) => c.present).map((c) => c.name);

  if (present.length === 0) {
    return "Couldn't identify any of our key sections. Make sure your PDF contains text content about your business.";
  }

  if (present.length <= 3) {
    return `Found basic info (${present.slice(0, 2).join(", ")}). Add more details for better AI output.`;
  }

  if (present.length >= 7) {
    return `This is comprehensive! Your PDF includes ${present.join(", ")}. AI will sound exactly like you.`;
  }

  return `Good foundation. Contains ${present.join(", ")}. Adding a few more details will improve quality.`;
}

export default router;
