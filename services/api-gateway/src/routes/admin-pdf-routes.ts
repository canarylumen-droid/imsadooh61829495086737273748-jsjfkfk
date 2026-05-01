import { Router, Request, Response } from "express";
import { requireAuth, getCurrentUserId } from "../middleware/auth.js";
import multer from "multer";
import { storage } from "@shared/lib/storage/storage.js";
import { db } from "@shared/lib/db/db.js";
import { sql } from "drizzle-orm";
import { generateReply } from "@services/brain-worker/src/ai-lib/core/ai-service.js";
import { MODELS } from "@services/brain-worker/src/ai-lib/utils/model-config.js";
import crypto from "crypto";
import { detectUVP, gatherCompetitorIntelligence } from "@services/brain-worker/src/orchestrator/agents/universal-sales-agent.js";
import { indexPdfChunks, ensureVectorSetup } from "@services/brain-worker/src/ai-lib/context/vector-search.js";
import { blobStorage } from "@shared/lib/storage/blob-storage.js";
import { acquireLock, releaseLock } from "@shared/lib/redis/redis.js";
import { refreshPdfTtl } from "@shared/lib/redis/brand-pdf-storage.js";
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

// Ensure vector infrastructure is ready on module load
ensureVectorSetup().catch(e => console.warn('[AdminPdf] Vector setup warning:', e.message));

const router = Router();

async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    // pdf-parse uses a weird export structure in some environments
    // It's often exported as the module itself
    const pdfParser = (pdf as any).default || pdf;

    // Ensure we are calling a function
    if (typeof pdfParser !== 'function') {
      console.error("pdf-parse is not a function:", typeof pdfParser);
      return "";
    }

    const data = await pdfParser(buffer);
    return data.text || "";
  } catch (error) {
    console.error("PDF extraction error:", error);
    return "";
  }
}
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB limit for brand PDFs
});

function generateFileHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

interface CachedPdfData {
  id: string;
  brand_context: BrandExtraction;
  extracted_text: string;
  analysis_score: number;
  analysis_items: any[];
  file_name: string;
  created_at: Date;
}

// AI initialization removed in favor of unified ai-service

interface BrandExtraction {
  companyName?: string;
  businessDescription?: string;
  industry?: string;
  uniqueValue?: string;
  targetAudience?: string;
  successStories?: string[];
  offer?: string;
  tone?: string;
  positioning?: "premium" | "mid" | "volume";
  objections?: Record<string, string>;
  brandLanguage?: {
    prefer?: string[];
    avoid?: string[];
  };
}

type DeepMergeValue = string | number | boolean | null | undefined | DeepMergeValue[] | { [key: string]: DeepMergeValue };
type DeepMergeObject = Record<string, DeepMergeValue>;

/**
 * Deep merge two objects, properly handling nested objects and arrays
 */
function deepMerge(target: DeepMergeObject, source: DeepMergeObject): DeepMergeObject {
  const result: DeepMergeObject = { ...target };

  for (const key in source) {
    if (source[key] === null || source[key] === undefined) {
      continue;
    }

    if (Array.isArray(source[key])) {
      const targetArray = result[key];
      const sourceArray = source[key] as DeepMergeValue[];
      result[key] = [...(Array.isArray(targetArray) ? targetArray : []), ...sourceArray];
    } else if (typeof source[key] === 'object' && !Array.isArray(source[key])) {
      const targetObj = result[key];
      const sourceObj = source[key] as DeepMergeObject;
      result[key] = deepMerge(
        (typeof targetObj === 'object' && targetObj !== null && !Array.isArray(targetObj))
          ? targetObj as DeepMergeObject
          : {},
        sourceObj
      );
    } else {
      result[key] = source[key];
    }
  }

  return result;
}

/**
 * Helper function to safely get error message
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * POST /api/brand-pdf/analyze
 * Analyze PDF for required brand context fields
 * Available to all authenticated users
 */
router.post(
  "/analyze",
  requireAuth,
  upload.single("pdf"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No PDF provided" });
        return;
      }

      const pdfTextRaw = await extractPdfText(req.file.buffer);
      const pdfText = pdfTextRaw.toLowerCase();

      const checks = [
        { name: "Company Overview", present: /company|business|about|overview|who we are/.test(pdfText), required: true },
        { name: "Offer/Pricing", present: /price|pricing|package|offer|plan|investment|program/.test(pdfText), required: true },
        { name: "Target Client", present: /ideal|target|client|audience|avatar|help|serve/.test(pdfText), required: true },
        { name: "Tone Style", present: /tone|style|voice|personality|brand|professional|friendly/.test(pdfText), required: true },
        { name: "Success Stories", present: /success|case study|win|result|testimonial|client|achieved/.test(pdfText), required: false },
        { name: "Objections", present: /objection|concern|hesitation|doubt|question|faq|worry/.test(pdfText), required: false },
        { name: "Brand Language", present: /language|words|avoid|prefer|slang|terminology/.test(pdfText), required: false },
      ];

      const presentCount = checks.filter((c) => c.present).length;
      const requiredCount = checks.filter((c) => c.required).length;
      const presentRequired = checks.filter((c) => c.required && c.present).length;

      const score = Math.round((presentCount / checks.length) * 100);

      const missingCritical = checks
        .filter((c) => c.required && !c.present)
        .map((c) => c.name);

      res.json({
        overall_score: score,
        items: checks,
        missing_critical: missingCritical,
        text_length: pdfTextRaw.length,
        recommendations: [
          presentRequired < requiredCount
            ? "Add more details about your required fields"
            : null,
          presentCount < 5
            ? "Include success stories and objection handling for better AI responses"
            : null,
          !checks.find((c) => c.name === "Brand Language")?.present
            ? "Add your preferred language and phrases to use"
            : null,
        ].filter(Boolean),
      });
    } catch (error: unknown) {
      console.error("Error analyzing PDF:", error);
      res.status(500).json({ error: getErrorMessage(error) });
    }
  }
);

/**
 * POST /api/brand-pdf/upload
 * Upload and store brand PDF - extracts and saves brand context
 * Caches PDF and extracted data in PostgreSQL for fast retrieval
 * Supports files up to 10 MB
 */
router.post(
  "/upload",
  requireAuth,
  upload.single("pdf"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = getCurrentUserId(req);
      if (!userId) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }

      if (!req.file) {
        res.status(400).json({ error: "No PDF provided" });
        return;
      }

      // PREVENT CONCURRENCY RACES: Use a distributed lock per user
      const lockKey = `brand-pdf-upload:${userId}`;
      const hasLock = await acquireLock(lockKey, 300); // 5 min timeout for large PDFs
      if (!hasLock) {
        res.status(429).json({ error: "An upload is already in progress. Please wait." });
        return;
      }

      try {
        const user = await storage.getUserById(userId);
        if (!user) {
          res.status(404).json({ error: "User not found" });
          return;
        }

      // Generate hash to check if PDF was already processed
      const fileHash = generateFileHash(req.file.buffer);

      // Check PostgreSQL cache first
      try {
        const cachedResult = await db.execute(sql`
          SELECT id, brand_context, extracted_text, analysis_score, file_name, file_size, created_at
          FROM brand_pdf_cache
          WHERE user_id = ${userId} AND file_hash = ${fileHash}
          LIMIT 1
        `);

        if (cachedResult.rows.length > 0) {
          const cached = cachedResult.rows[0] as any;
          const brandContext = cached.brand_context as BrandExtraction;
          const cachedFileSize = cached.file_size || req.file.size;

          console.log(`📦 Using cached brand PDF analysis for user ${userId}`);

          // Refresh the Redis TTL so the binary doesn't expire while still in use
          await refreshPdfTtl(userId).catch(() => {});

          // Update user metadata from cache (use cached file size, not current upload size)
          const existingMetadata = (user.metadata || {}) as DeepMergeObject;
          const brandMetadata: DeepMergeObject = {
            ...brandContext,
            brandPdfUploadedAt: cached.created_at,
            brandPdfFileName: cached.file_name,
            brandPdfSize: cachedFileSize,
            brandPdfCached: true,
          };
          const updatedMetadata = deepMerge(existingMetadata, brandMetadata);

          await storage.updateUser(userId, {
            metadata: {
              ...updatedMetadata,
              brandContext: cached.extracted_text?.substring(0, 50000) || undefined,
            },
            brandGuidelinePdfText: cached.extracted_text || undefined,
            businessName: brandContext.companyName || user.businessName,
          });

          res.json({
            success: true,
            message: "Brand PDF loaded from cache",
            cached: true,
            extracted: {
              companyName: brandContext.companyName,
              industry: brandContext.industry,
              targetAudience: brandContext.targetAudience,
              tone: brandContext.tone,
              hasSuccessStories: (brandContext.successStories?.length || 0) > 0,
              hasObjections: Object.keys(brandContext.objections || {}).length > 0,
            },
          });
          return;
        }
      } catch (cacheError) {
        console.warn("Cache check failed (table may not exist yet):", cacheError);
      }

      const pdfTextRaw = await extractPdfText(req.file.buffer);
      const pdfText: string = pdfTextRaw;

      if (!pdfText || pdfText.length < 50) {
        res.status(400).json({
          error: "PDF appears to be empty or too short",
          message: "Please upload a PDF with your brand information (at least 50 characters)"
        });
        return;
      }

      // Extract brand context using AI
      let brandContext: BrandExtraction = {};
      let analysisScore = 0;
      let analysisItems: any[] = [];

      if (pdfText) {
        try {
          const response = await generateReply(
            `You are a brand analyst. Extract the following information from the brand document.
Return a JSON object with these fields:
- companyName: The company/brand name
- businessDescription: What the business does (1-2 sentences)
- industry: The industry (e.g., "coaching", "agency", "saas", "ecommerce")
- uniqueValue: The unique value proposition
- targetAudience: Who they help/serve
- successStories: Array of brief success stories or testimonials
- offer: Their main offer/service/product
- tone: The communication tone (formal, casual, warm, professional)
- positioning: Market positioning (premium, mid, volume)
- objections: Common objections as key-value pairs {"objection": "response"}
- brandLanguage: { prefer: ["words to use"], avoid: ["words to avoid"] }

Only include fields you can confidently extract. Return valid JSON only.`,
            `Extract brand context from this document:\n\n${pdfText.substring(0, 8000)}`,
            {
              model: MODELS.lead_intelligence,
              jsonMode: true,
              temperature: 0.3,
              maxTokens: 2000
            }
          );

          const responseText = response.text;
          if (responseText) {
            brandContext = JSON.parse(responseText) as BrandExtraction;

            // ENHANCED ANALYSIS: Detect UVP and positioning automatically
            try {
              console.log("🔍 [AI] Detecting UVP and positioning from extracted context...");
              const uvpResult = await detectUVP(brandContext);

              // Merge UVP result into brand context
              brandContext = {
                ...brandContext,
                uniqueValue: uvpResult.uvp || brandContext.uniqueValue,
                positioning: uvpResult.positioning || brandContext.positioning,
              };

              // Add differentiators and "why you win" to objections or a new field
              if (uvpResult.differentiators && uvpResult.differentiators.length > 0) {
                brandContext.businessDescription = (brandContext.businessDescription || "") +
                  "\n\nKey Differentiators:\n- " + uvpResult.differentiators.join("\n- ");
              }
            } catch (uvpError) {
              console.warn("UVP detection failed, continuing with extracted context:", uvpError);
            }
          }
        } catch (aiError: unknown) {
          console.warn("AI extraction failed, using regex fallback:", aiError);
        }
      }

      // Fallback: Extract basic info with regex
      if (!brandContext.companyName) {
        const companyMatch = pdfText.match(/(?:company|brand|business)\s*(?:name)?[:\s]+([A-Z][a-zA-Z\s]+)/i);
        brandContext.companyName = companyMatch?.[1]?.trim() || user.businessName || user.name || undefined;
      }

      // Calculate analysis score
      const checks = [
        { name: "Company Name", present: !!brandContext.companyName },
        { name: "Industry", present: !!brandContext.industry },
        { name: "Target Audience", present: !!brandContext.targetAudience },
        { name: "Offer", present: !!brandContext.offer },
        { name: "Tone", present: !!brandContext.tone },
        { name: "Success Stories", present: (brandContext.successStories?.length || 0) > 0 },
        { name: "Objections", present: Object.keys(brandContext.objections || {}).length > 0 },
      ];
      analysisItems = checks;
      analysisScore = Math.round((checks.filter(c => c.present).length / checks.length) * 100);
      // Step 1: Store raw PDF binary in persistent storage (S3/R2 with Redis fallback)
      const storageKey = `brand-pdf:${userId}`;
      const savedPath = await blobStorage.store(storageKey, req.file.buffer);
      console.log(`☁️ PDF binary stored in BlobStorage: ${savedPath}`);

      // Step 2: Cache metadata + extracted text in PostgreSQL (no binary blob)
      try {
        const { brandPdfCache } = await import("@audnix/shared");
        await db.insert(brandPdfCache).values({
          userId,
          fileName: req.file.originalname,
          fileSize: req.file.size,
          fileHash,
          extractedText: pdfText.substring(0, 50000),
          brandContext,
          analysisScore,
          analysisItems,
          updatedAt: new Date()
        }).onConflictDoUpdate({
          target: [brandPdfCache.userId, brandPdfCache.fileHash],
          set: {
            brandContext,
            analysisScore,
            analysisItems,
            updatedAt: new Date()
          }
        });
        console.log(`💾 Brand PDF metadata cached in PostgreSQL for user ${userId} (${(req.file.size / 1024 / 1024).toFixed(2)} MB)`);
      } catch (cacheError) {
        console.warn("Failed to cache PDF using db.insert:", cacheError);
        
        // Fallback to raw SQL (no binary blob)
        try {
          await db.execute(sql`
            INSERT INTO brand_pdf_cache (user_id, file_name, file_size, file_hash, extracted_text, brand_context, analysis_score, analysis_items)
            VALUES (
              ${userId},
              ${req.file.originalname},
              ${req.file.size},
              ${fileHash},
              ${pdfText.substring(0, 50000)},
              ${JSON.stringify(brandContext)}::jsonb,
              ${analysisScore},
              ${JSON.stringify(analysisItems)}::jsonb
            )
            ON CONFLICT (user_id, file_hash) DO UPDATE SET
              brand_context = ${JSON.stringify(brandContext)}::jsonb,
              analysis_score = ${analysisScore},
              analysis_items = ${JSON.stringify(analysisItems)}::jsonb,
              updated_at = NOW()
          `);
        } catch (innerError) {
          console.error("Critical: Failed to store PDF metadata in BOTH drizzle and raw SQL:", innerError);
        }
      }

      // Deep merge with existing metadata to preserve nested objects
      const existingMetadata = (user.metadata || {}) as DeepMergeObject;
      const brandMetadata: DeepMergeObject = {
        companyName: brandContext.companyName,
        businessDescription: brandContext.businessDescription,
        industry: brandContext.industry,
        uniqueValue: brandContext.uniqueValue,
        targetAudience: brandContext.targetAudience,
        successStories: brandContext.successStories,
        offer: brandContext.offer,
        tone: brandContext.tone,
        positioning: brandContext.positioning,
        objections: brandContext.objections,
        brandLanguage: brandContext.brandLanguage,
        brandPdfUploadedAt: new Date().toISOString(),
        brandPdfFileName: req.file.originalname,
        brandPdfSize: req.file.size,
      };

      // Use deep merge to preserve existing nested data
      const updatedMetadata = deepMerge(existingMetadata, brandMetadata);

      // Save to user profile - PERSIST FULL EXTRACTED TEXT
      await storage.updateUser(userId, {
        metadata: {
          ...updatedMetadata,
          brandContext: pdfText.substring(0, 50000), // Store first 50k chars
        },
        brandGuidelinePdfText: pdfText,
        businessName: brandContext.companyName || user.businessName,
      });

      console.log(`✅ Brand PDF uploaded and processed for user ${userId}`);

      // PHASE 1.5: Autonomous Deep Research (Competitor Gaps & UVP)
      let intelligenceMetadata = (user as any).intelligenceMetadata || {};
      try {
        console.log("🔍 [DeepResearch] Starting autonomous competitive analysis...");
        const competitorAnalysis = await gatherCompetitorIntelligence(
          brandContext.industry || "B2B",
          brandContext.companyName || user.businessName || "Your Brand"
        );

        const uvpAnalysis = await detectUVP(brandContext);

        intelligenceMetadata = {
          ...intelligenceMetadata,
          competitors: competitorAnalysis.competitors,
          marketGaps: competitorAnalysis.gaps,
          opportunities: competitorAnalysis.opportunities,
          uvp: uvpAnalysis.uvp,
          differentiators: uvpAnalysis.differentiators,
          whyYouWin: uvpAnalysis.whyYouWin,
          lastResearchAt: new Date().toISOString(),
          sourceDocument: req.file.originalname
        };

        // Persist the strategic intelligence
        await storage.updateUser(userId, { 
          intelligenceMetadata: intelligenceMetadata as any 
        });
        console.log("💎 [DeepResearch] Intelligence metadata crystallized.");
      } catch (researchError) {
        console.warn("⚠️ [DeepResearch] Enrichment skipped due to AI error:", researchError);
      }

      // TRIGGER: If leads exist, start outreach immediately (boom)
      try {
        const { triggerAutoOutreach } = await import("@services/outreach-worker/src/sales-engine/outreach-engine.js");
        await triggerAutoOutreach(userId);
      } catch (triggerError) {
        console.warn("Failed to trigger auto-outreach after upload:", triggerError);
      }

      // PHASE 2: Index chunks into vector store for semantic RAG (CUMULATIVE VERSIONING)
      let chunksIndexed = 0;
      try {
        const cacheResult = await db.execute(sql`
          SELECT id FROM brand_pdf_cache WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 1
        `);
        const pdfId = (cacheResult.rows[0] as any)?.id || fileHash;
        
        // Pass options for cumulative memory (retain old, increment version)
        chunksIndexed = await indexPdfChunks(pdfText, userId, pdfId, req.file.originalname, {
          clearPrevious: false // RETAIN OLD MEMORY as per Level 10 requirement
        });
        console.log(`🔍 [VectorSearch] Indexed ${chunksIndexed} semantic chunks (cumulative) for user ${userId}`);
      } catch (vecError) {
        console.warn('Vector indexing failed (non-critical):', (vecError as Error).message);
      }

      res.json({
        success: true,
        message: "Brand PDF uploaded and processed successfully",
        cached: false,
        chunksIndexed,
        extracted: {
          companyName: brandContext.companyName,
          industry: brandContext.industry,
          targetAudience: brandContext.targetAudience,
          tone: brandContext.tone,
          hasSuccessStories: (brandContext.successStories?.length || 0) > 0,
          hasObjections: Object.keys(brandContext.objections || {}).length > 0,
        },
      });
    } catch (error: unknown) {
      console.error("Error uploading brand PDF:", error);
      res.status(500).json({ error: getErrorMessage(error) });
    } finally {
      // Always release the lock
      await releaseLock(`brand-pdf-upload:${userId}`).catch(() => {});
    }
  } catch (outerError) {
    console.error("Fatal error in upload route:", outerError);
    res.status(500).json({ error: getErrorMessage(outerError) });
  }
}
);

/**
 * GET /api/brand-pdf/context
 * Get current brand context for the user
 */
router.get(
  "/context",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = getCurrentUserId(req);
      if (!userId) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }

      const user = await storage.getUserById(userId);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const metadata = (user.metadata || {}) as Record<string, unknown>;

      res.json({
        hasBrandPdf: !!metadata.brandPdfUploadedAt,
        brandContext: {
          companyName: metadata.companyName || user.businessName,
          businessDescription: metadata.businessDescription,
          industry: metadata.industry,
          uniqueValue: metadata.uniqueValue,
          targetAudience: metadata.targetAudience,
          successStories: metadata.successStories || [],
          offer: metadata.offer,
          tone: metadata.tone || "warm",
          positioning: metadata.positioning || "premium",
          objections: metadata.objections || {},
          brandLanguage: metadata.brandLanguage || { prefer: [], avoid: [] },
        },
        uploadedAt: metadata.brandPdfUploadedAt,
        fileName: metadata.brandPdfFileName,
      });
    } catch (error: unknown) {
      console.error("Error fetching brand context:", error);
      res.status(500).json({ error: getErrorMessage(error) });
    }
  }
);

/**
 * PATCH /api/brand-pdf/context
 * Update brand context manually
 */
router.patch(
  "/context",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = getCurrentUserId(req);
      if (!userId) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }

      const user = await storage.getUserById(userId);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const updates = req.body as Record<string, unknown>;
      const existingMetadata = (user.metadata || {}) as DeepMergeObject;

      // Extract specific fields meant for top-level user columns
      const { uvp, businessLogo, ...otherUpdates } = updates;

      // Deep merge remaining updates with existing metadata
      const updatedMetadata = deepMerge(existingMetadata, {
        ...otherUpdates,
        brandContextUpdatedAt: new Date().toISOString(),
      } as DeepMergeObject);

      // Handle Intelligence Metadata steering
      const updatedIntelligence = uvp ? {
        ...(user.intelligenceMetadata as Record<string, any> || {}),
        uvp: uvp as string,
        lastResearchAt: new Date().toISOString()
      } : user.intelligenceMetadata;

      await storage.updateUser(userId, {
        metadata: updatedMetadata,
        businessName: (otherUpdates.companyName as string | undefined) || user.businessName,
        ...(businessLogo !== undefined && { businessLogo: businessLogo as string }),
        ...(uvp !== undefined && { intelligenceMetadata: updatedIntelligence })
      });

      res.json({
        success: true,
        message: "Brand context and intelligence steered successfully",
      });
    } catch (error: unknown) {
      console.error("Error updating brand context:", error);
      res.status(500).json({ error: getErrorMessage(error) });
    }
  }
);



/**
 * GET /api/brand-pdf/cache
 * Get cached PDF history for the user
 */
router.get(
  "/cache",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = getCurrentUserId(req);
      if (!userId) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }

      const result = await db.execute(sql`
        SELECT id, file_name, file_size, analysis_score, created_at, updated_at
        FROM brand_pdf_cache
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
        LIMIT 10
      `);

      res.json({
        cached: result.rows.length > 0,
        pdfs: result.rows.map((row: any) => ({
          id: row.id,
          fileName: row.file_name,
          fileSize: row.file_size,
          analysisScore: row.analysis_score,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })),
      });
    } catch (error: unknown) {
      console.error("Error fetching PDF cache:", error);
      res.json({ cached: false, pdfs: [] });
    }
  }
);

/**
 * DELETE /api/brand-pdf/cache
 * Clear all cached PDFs for the user
 */
router.delete(
  "/cache",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = getCurrentUserId(req);
      if (!userId) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }

      await db.execute(sql`
        DELETE FROM brand_pdf_cache WHERE user_id = ${userId}
      `);

      console.log(`🗑️ Cleared PDF cache for user ${userId}`);
      res.json({ success: true, message: "PDF cache cleared" });
    } catch (error: unknown) {
      console.error("Error clearing PDF cache:", error);
      res.status(500).json({ error: getErrorMessage(error) });
    }
  }
);

/**
 * GET /api/brand-pdf/context
 * Retrieve the current brand context from user metadata
 */
router.get(
  "/context",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = getCurrentUserId(req);
      if (!userId) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }

      const user = await storage.getUserById(userId);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      // Check if we have cached context in metadata
      const metadata = user.metadata as any;

      res.json({
        success: true,
        companyName: user.businessName || metadata?.companyName,
        industry: metadata?.industry,
        uniqueValue: metadata?.uniqueValue,
        targetAudience: metadata?.targetAudience,
        tone: metadata?.tone,
        positioning: metadata?.positioning,
        offer: metadata?.offer,
        hasPdf: !!metadata?.brandPdfUploadedAt,
        uploadedAt: metadata?.brandPdfUploadedAt,
        fileName: metadata?.brandPdfFileName,
      });
    } catch (error: unknown) {
      console.error("Error fetching brand context:", error);
      res.status(500).json({ error: getErrorMessage(error) });
    }
  }
);

/**
 * GET /api/brand-pdf/extracted-text
 * Return full extracted text for in-place editing in the UI
 */
router.get(
  "/extracted-text",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = getCurrentUserId(req);
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

      const result = await db.execute(sql`
        SELECT id, file_name, extracted_text, analysis_score, created_at
        FROM brand_pdf_cache
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
        LIMIT 1
      `);

      if (result.rows.length === 0) {
        res.json({ exists: false, text: null });
        return;
      }

      const row = result.rows[0] as any;

      // Also get chunk count from brand_embeddings
      const chunkResult = await db.execute(sql`
        SELECT COUNT(*) AS count FROM brand_embeddings WHERE user_id = ${userId}
      `).catch(() => ({ rows: [{ count: 0 }] }));
      const chunkCount = parseInt((chunkResult.rows[0] as any)?.count || '0');

      const user = await storage.getUserById(userId);

      res.json({
        exists: true,
        id: row.id,
        fileName: row.file_name,
        text: row.extracted_text || user?.brandGuidelinePdfText || "",
        analysisScore: row.analysis_score,
        chunkCount,
        createdAt: row.created_at,
        intelligenceMetadata: (user as any)?.intelligenceMetadata || {},
        businessLogo: (user as any)?.businessLogo,
      });
    } catch (error: unknown) {
      console.error("Error fetching extracted text:", error);
      res.status(500).json({ error: getErrorMessage(error) });
    }
  }
);

/**
 * PATCH /api/brand-pdf/extracted-text
 * Save edited PDF text + re-index vector chunks
 */
router.patch(
  "/extracted-text",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = getCurrentUserId(req);
      if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

      const { text, pdfId } = req.body as { text: string; pdfId: string };
      if (!text || !pdfId) {
        res.status(400).json({ error: "text and pdfId are required" });
        return;
      }

      // Update the stored extracted text
      await db.execute(sql`
        UPDATE brand_pdf_cache
        SET extracted_text = ${text.substring(0, 100000)}, updated_at = NOW()
        WHERE id = ${pdfId} AND user_id = ${userId}
      `);

      // Also update user's brandGuidelinePdfText
      await storage.updateUser(userId, { brandGuidelinePdfText: text });

      // Re-index all vector chunks from the edited text
      let chunksIndexed = 0;
      try {
        const cacheRow = await db.execute(sql`SELECT file_name FROM brand_pdf_cache WHERE id = ${pdfId}`);
        const fileName = (cacheRow.rows[0] as any)?.file_name || 'Edited Document';
        chunksIndexed = await indexPdfChunks(text, userId, pdfId, fileName);
      } catch (vecError) {
        console.warn('Re-indexing after edit failed:', (vecError as Error).message);
      }

      res.json({ success: true, chunksIndexed });
    } catch (error: unknown) {
      console.error("Error saving edited text:", error);
      res.status(500).json({ error: getErrorMessage(error) });
    }
  }
);

export default router;


