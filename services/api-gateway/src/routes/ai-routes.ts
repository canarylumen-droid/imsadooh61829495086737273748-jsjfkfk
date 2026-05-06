import { Router, Request, Response } from "express";
import { eq, and, sql, or, isNull } from "drizzle-orm";
import { leads as leadsTable } from "@audnix/shared";
import { db } from "@shared/lib/db/db.js";
import multer from "multer";
import csvParser from "csv-parser";
import { Readable } from "stream";
import { storage } from "@shared/lib/storage/storage.js";
import { requireAuth, getCurrentUserId } from "../middleware/auth.js";
import { wsSync } from "@shared/lib/realtime/websocket-sync.js";

const upload = multer({ storage: multer.memoryStorage() });
import {
  generateAIReply,
  generateVoiceScript,
  scheduleFollowUp,
  detectConversationStatus,
  saveConversationToMemory,
  getConversationContext,
  autoUpdateLeadStatus
} from '@services/brain-worker/src/ai-lib/core/conversation-ai.js';
import { generateSmartReplies } from '@services/brain-worker/src/ai-lib/formatters/smart-replies.js';
import { calculateLeadScore, updateAllLeadScores } from '@services/brain-worker/src/ai-lib/engines/lead-scoring.js';
import { generateAnalyticsInsights } from '@services/brain-worker/src/ai-lib/engines/analytics-engine.js';
import { getCompetitorAnalytics } from '@services/brain-worker/src/ai-lib/analyzers/competitor-detection.js';
import { learnOptimalDiscount } from '@services/brain-worker/src/ai-lib/specialized/price-negotiation.js';
import { importInstagramLeads, importGmailLeads, importManychatLeads } from "@shared/lib/imports/lead-importer.js";
import { createCalendarBookingLink, generateMeetingLinkMessage } from "@shared/lib/calendar/google-calendar.js";
import { processPDF } from "@shared/lib/media/pdf-processor.js";
import { EmailVerifier } from "@shared/lib/scraping/email-verifier.js";
import { mapCSVColumnsToSchema, extractLeadFromRow, extractExtraFieldsAsMetadata, type LeadColumnMapping } from "@services/brain-worker/src/ai-lib/utils/csv-mapper.js";
import { parseEmailBody } from "@services/brain-worker/src/ai-lib/utils/body-parser.js";
import { checkGrammar, generateReply } from "@services/brain-worker/src/ai-lib/core/ai-service.js";
import { evaluateLeadDealValue } from "@services/brain-worker/src/ai-lib/engines/deal-evaluator.js";
import { leadEnrichmentWorker } from "@services/brain-worker/workers/lead-enrichment-worker.js";

const verifier = new EmailVerifier();
// Robust verification of key presence and format
if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY is missing from environment variables");
} else if (!process.env.GEMINI_API_KEY.startsWith("AIza")) {
  console.error("GEMINI_API_KEY appears to be in an invalid format (should start with AIza)");
}
import type { ProviderType, ChannelType } from '@shared/types.js';

type NotificationType = 'webhook_error' | 'billing_issue' | 'conversion' | 'lead_reply' | 'system' | 'insight';

const router = Router();

/**
 * GET /api/leads
 * Get all leads for the authenticated user with pagination and filtering
 */
router.get("/", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { channel, status, limit = "50", offset = "0", search, includeArchived, integrationId, excludeActiveCampaignLeads } = req.query;

    const user = await storage.getUser(userId);
    const isEnterprise = user?.plan === 'enterprise' || user?.plan === 'pro';
    const MAX_ALLOWED_LIMIT = isEnterprise ? 500000 : 20000;
    const limitNum = Math.min(parseInt(limit as string) || 200, MAX_ALLOWED_LIMIT);
    const offsetNum = parseInt(offset as string) || 0;

    // Get paginated leads directly from storage
    const leads = await storage.getLeads({
      userId,
      channel: channel as string | undefined,
      status: status as string | undefined,
      search: search as string | undefined,
      includeArchived: includeArchived === 'true',
      integrationId: integrationId as string | undefined,
      excludeActiveCampaignLeads: excludeActiveCampaignLeads === 'true',
      limit: limitNum,
      offset: offsetNum
    });

    // Get total count for pagination UI
    const totalLeads = await db.select({ count: sql<number>`count(*)` })
      .from(leadsTable)
      .where(and(
        eq(leadsTable.userId, userId),
        includeArchived === 'true' ? undefined : eq(leadsTable.archived, false),
        status && status !== 'all' ? eq(leadsTable.status, status as any) : undefined,
        channel ? eq(leadsTable.channel, channel as any) : undefined,
        integrationId ? or(eq(leadsTable.integrationId, integrationId as string), isNull(leadsTable.integrationId)) : undefined
      ));

    res.json({
      leads: leads,
      total: Number(totalLeads[0]?.count || 0),
      hasMore: leads.length === limitNum,
    });
  } catch (error: unknown) {
    console.error("Get leads error:", error);
    if (res.headersSent) return;
    res.status(500).json({ error: "Failed to fetch leads" });
  }
});

/**
 * Get advanced AI insights
 * GET /api/ai/insights
 */
router.get("/insights", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { period = '30d' } = req.query;
    const periodStr = period as string;

    const insights = await generateAnalyticsInsights(userId, periodStr);

    // Template-based summarization fallback (works without AI)
    const summary = generateTemplateSummary(insights, period as string);

    res.json({ ...insights, summary });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Failed to generate insights";
    console.error("Advanced insights error:", error);
    if (res.headersSent) return;
    res.status(500).json({ error: errorMessage });
  }
});

function generateTemplateSummary(insights: any, period: string): string | null {
  const { trends, predictions, topPerformers, recommendations } = insights;
  if (!trends) return null;

  const parts: string[] = [];

  // Lead growth
  if (trends.leadGrowth > 0) {
    parts.push(`Lead volume grew ${Math.abs(trends.leadGrowth).toFixed(2)}% this period`);
  } else if (trends.leadGrowth < 0) {
    parts.push(`Lead volume declined ${Math.abs(trends.leadGrowth).toFixed(2)}% this period`);
  } else {
    parts.push(`Lead volume is stable this period`);
  }

  // Conversion growth
  if (trends.conversionGrowth > 10) {
    parts.push(`with conversions up ${trends.conversionGrowth.toFixed(2)}%`);
  } else if (trends.conversionGrowth < -10) {
    parts.push(`but conversions dropped ${Math.abs(trends.conversionGrowth).toFixed(2)}%`);
  }

  // Top channel
  if (topPerformers?.channels?.length > 0) {
    const topChannel = topPerformers.channels[0];
    parts.push(`Your top channel is ${topChannel.channel || 'email'}`);
  }

  // Predictions
  if (predictions?.expectedConversions > 0) {
    parts.push(`AI projects ~${predictions.expectedConversions} conversions ahead`);
  }

  // First recommendation
  if (recommendations?.length > 0) {
    parts.push(recommendations[0]);
  }

  return parts.length > 0 ? parts.join('. ') + '.' : null;
}

/**
 * Get AI-powered insights and analytics
 * GET /api/ai/analytics
 */
router.get("/analytics", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { period = '30d' } = req.query;
    const periodStr = period as string;

    const daysBack = periodStr === '7d' ? 7 : periodStr === '30d' ? 30 : 90;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    startDate.setHours(0, 0, 0, 0);

    // Use SQL-level aggregations via storage
    const analytics = await storage.getAnalyticsSummary(userId, startDate);

    res.json({
      period,
      ...analytics,
      behaviorInsights: {
        ...analytics.summary,
        replyRate: analytics.summary.totalLeads > 0
          ? ((analytics.summary.leadsReplied / analytics.summary.totalLeads) * 100).toFixed(2)
          : '0',
        avgResponseTime: await (await import('@services/brain-worker/src/ai-lib/engines/analytics-engine.js')).calculateAvgResponseTime(userId),
        positiveSentimentRate: analytics.positiveSentimentRate
      }
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Failed to generate analytics";
    console.error("Analytics error:", error);
    if (res.headersSent) return;
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Generate a comprehensive weekly report
 * GET /api/ai/weekly-report
 */
router.get("/weekly-report", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);
    startDate.setHours(0, 0, 0, 0);

    const { integrationId } = req.query;
    const analytics = await storage.getAnalyticsSummary(userId, startDate, integrationId as string | undefined);

    const inboundVolume = analytics.summary.leadsReplied;
    const outboundVolume = analytics.summary.totalLeads;
    const replyRate = outboundVolume > 0 ? ((inboundVolume / outboundVolume) * 100).toFixed(2) : '0';

    const bestHour = analytics.summary.bestReplyHour;
    const bestHourStr = bestHour !== null ?
      new Date(new Date().setHours(bestHour, 0, 0, 0)).toLocaleTimeString('en-US', { hour: 'numeric', hour12: true })
      : 'Not enough data';

    const reportText = `## Weekly Performance Report\n**Period:** Last 7 Days\n\n### Overview\n- **Total Outreach Volume:** ${outboundVolume} leads engaged\n- **Inbound Replies:** ${inboundVolume} total replies\n- **Overall Reply Rate:** ${replyRate}%\n\n### Engagement Insights\n- **Most Active User Hour:** ${bestHourStr}\n- **Positive Sentiment Rate:** ${analytics.positiveSentimentRate}\n- **Conversions Generated:** ${analytics.summary.conversions}\n\n### Strategic Recommendations\n${bestHour !== null ? `To maximize your response rates, we recommend scheduling your campaigns to deploy around **${bestHourStr}**, matching your historically highest engagement period.` : 'Continue engaging leads to gather more data on optimal send times.'}`;

    res.json({ text: reportText });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Failed to generate weekly report";
    console.error("Weekly report error:", error);
    if (res.headersSent) return;
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Update all lead scores
 * POST /api/ai/score-all
 */
router.post("/score-all", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;

    await updateAllLeadScores(userId);

    res.json({
      success: true,
      message: "All leads scored successfully"
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Failed to score leads";
    console.error("Bulk scoring error:", error);
    if (res.headersSent) return;
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Import leads from CSV file upload
 * POST /api/leads/import-csv
 */
router.post("/import-csv", requireAuth, upload.single('csv'), async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const file = req.file;
    const previewMode = req.query.preview === 'true';
    const aiPaused = req.body.aiPaused === 'true';

    if (!file) {
      if (!res.headersSent) {
        res.status(400).json({ error: "No CSV file uploaded" });
      }
      return;
    }

    const results: any[] = [];
    const stream = Readable.from(file.buffer.toString('utf-8'));

    stream
      .pipe(csvParser())
      .on('data', (data: any) => results.push(data))
      .on('end', async () => {
        try {
          if (results.length === 0) {
            if (!res.headersSent) {
              res.status(400).json({ error: "CSV file is empty" });
            }
            return;
          }

          // 1. Map Columns (AI or Fallback — auto-skips AI if keys missing)
          const headers = Object.keys(results[0]);
          const aiKeysAvailable = !!(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY);
          const skipAI = !aiKeysAvailable || aiPaused;
          const mappingResult = await mapCSVColumnsToSchema(headers, results.slice(0, 3), skipAI);
          const mapping = mappingResult.mapping;

          // 2. Extract Leads — import everything we can
          const processedLeads = results.map(row => {
            const basicLead = extractLeadFromRow(row, mapping) as { name?: string; email?: string; phone?: string; company?: string; channel?: string; role?: string; bio?: string; replyEmail?: string };
            // Use company as name fallback
            if (!basicLead.name && basicLead.company) basicLead.name = basicLead.company;
            // Only skip truly empty rows
            if (!basicLead.name && !basicLead.email && !basicLead.company) return null;

            const metadata = extractExtraFieldsAsMetadata(row, mapping);
            if (mappingResult.unmappedColumns.length > 0) {
              metadata._unmapped_cols = mappingResult.unmappedColumns.join(',');
            }

            return {
              ...basicLead,
              replyEmail: basicLead.replyEmail || basicLead.email || null,
              metadata
            };
          }).filter(l => l !== null);

          // 3. Handle Preview vs Output
          if (previewMode) {
            res.json({
              preview: true,
              total: processedLeads.length,
              mapping: mappingResult.mapping,
              confidence: mappingResult.confidence,
              leads: processedLeads, // Return all leads
              allLeads: processedLeads
            });
            return;
          }

          // 4. Enforce Limits (Scaled for Autonomous High-Volume Growth)
          const user = await storage.getUserById(userId);
          const existingLeadsCount = await storage.getLeadsCount(userId);
          
          // Scaled Plan Limits:
          // Enterprise/Team: 500,000 leads
          // Pro: 100,000 leads
          // Trial/Starter: 10,000 leads
          const limit = (user?.subscriptionTier === 'enterprise' || user?.plan === 'enterprise' || user?.email === 'team.replyflow@gmail.com') 
            ? 500000 
            : (user?.subscriptionTier === 'pro' || user?.plan === 'pro' ? 100000 : 10000);

          if (existingLeadsCount >= limit) {
            if (!res.headersSent) {
              res.status(400).json({ error: `Lead limit reached (${limit} leads). Please upgrade your plan.` });
            }
            return;
          }

          // 5. Save to DB (Standalone Mode)
          const { db } = await import('@shared/lib/db/db.js');
          const { leads, aiProcessLogs } = await import('@audnix/shared');

          // Create process log
          const [processLog] = await db.insert(aiProcessLogs).values({
            userId,
            type: 'import_csv',
            status: 'processing',
            totalItems: processedLeads.length,
            processedItems: 0,
            metadata: {
              fileName: file.originalname,
              previewMode,
              skipAI
            }
          }).returning();

          // 6. Duplicate Detection & Verification
          const leadsToSave = [];
          const chunkSize = 50;
          let duplicateCount = 0;
          let filteredCount = 0;

          console.log(`[CSV Import] Verifying and saving ${processedLeads.length} leads...`);

          // Check for existing emails in the whole set first (or in chunks)
          const allEmails = processedLeads.map(l => l.email).filter((e): e is string => !!e);
          const existingEmails = await storage.getExistingEmails(userId, allEmails);
          const existingEmailSet = new Set(existingEmails);

          const localSeenEmails = new Set<string>();
          for (let i = 0; i < processedLeads.length; i += chunkSize) {
            const chunk = processedLeads.slice(i, i + chunkSize);

            // Filter out duplicates
            const uniqueChunk = chunk.filter(leadData => {
              if (leadData.email) {
                if (existingEmailSet.has(leadData.email) || localSeenEmails.has(leadData.email)) {
                  duplicateCount++;
                  return false;
                }
                localSeenEmails.add(leadData.email);
              }
              return true;
            });

            if (uniqueChunk.length === 0) continue;

            // Check if adding this chunk exceeds the limit
            if (leadsToSave.length + existingLeadsCount + uniqueChunk.length > limit) {
              const remainingSpace = limit - (leadsToSave.length + existingLeadsCount);
              if (remainingSpace <= 0) break;
              uniqueChunk.splice(remainingSpace);
            }

            const skipVerification = req.body.skipVerification === 'true';

            // Verification/Processing for the unique chunk (Resilient)
            let verifiedChunk;
            try {
              verifiedChunk = await Promise.all(uniqueChunk.map(async (leadData) => {
                if (leadData.email && !skipVerification) {
                  try {
                    // Verifier with timeout logic to prevent hangs
                    const verifyPromise = verifier.verify(leadData.email);
                    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000));
                    
                    const vResult: any = await Promise.race([verifyPromise, timeoutPromise]);
                    
                    return {
                      ...leadData,
                      verified: vResult.valid,
                      bouncy: !vResult.valid && vResult.reason.includes('rejected'),
                      metadata: {
                        ...leadData.metadata,
                        verification_reason: vResult.reason,
                        risk_level: vResult.riskLevel
                      }
                    };
                  } catch (e) {
                    console.warn(`[CSV Import] Verification skipped for ${leadData.email} (timeout or error)`);
                    return { ...leadData, verified: false };
                  }
                }
                return { ...leadData, verified: false };
              }));
            } catch (pErr) {
              console.error("[CSV Import] Verified chunk processing failed, falling back to raw data", pErr);
              verifiedChunk = uniqueChunk.map(l => ({ ...l, verified: false }));
            }

            const leadsChunk = verifiedChunk.map(leadData => ({
              userId,
              name: leadData.name || 'Unknown',
              email: leadData.email || null,
              replyEmail: leadData.replyEmail || (leadData as any).replyEmail || leadData.email || null, // Standardize reply email
              phone: leadData.phone || null,
              company: leadData.company || null,
              channel: 'email' as const,
              status: (leadData as any).bouncy ? 'bouncy' as const : 'new' as const,
              aiPaused,
              integrationId: req.body.integrationId || null,
              verified: (leadData as any).verified || false,
              metadata: {
                ...(leadData.metadata as any),
                imported_via: 'csv_upload',
                import_date: new Date().toISOString()
              }
            }));

            if (leadsChunk.length > 0) {
              try {
                const inserted = await db.insert(leads).values(leadsChunk as any).returning();
                leadsToSave.push(...inserted);
                filteredCount += verifiedChunk.filter(l => (l as any).bouncy).length;

                // Phase 1.1: Dispatch background timezone enrichment
                const { aiProcessingQueue } = await import('../core/queues.js');
                if (aiProcessingQueue) {
                  const enrichmentJobs = inserted.map(lead => ({
                    name: 'timezone-enrichment',
                    data: {
                      type: 'timezone-enrichment',
                      userId,
                      leadId: lead.id,
                      data: { useAI: true }
                    }
                  }));
                  await aiProcessingQueue.addBulk(enrichmentJobs).catch(err => 
                    console.warn(`[CSV Import] Failed to queue enrichment:`, err)
                  );
                }
              } catch (dbErr) {
                // If a chunk fails (e.g. malformed data), we don't want to kill the whole import
                console.error(`[CSV Import] Chunk starting at ${i} failed to insert:`, dbErr);
              }
            }

            // Update process log - separate block to ensure it updates even if insert fails
            try {
              await db.update(aiProcessLogs)
                .set({
                  processedItems: Math.min(i + chunkSize, processedLeads.length),
                  updatedAt: new Date()
                })
                .where(eq(aiProcessLogs.id, processLog.id));
            } catch (logErr) {
              console.warn("[CSV Import] Failed to update process log progress:", logErr);
            }
          }

          // Mark process as completed
          await db.update(aiProcessLogs)
            .set({
              status: 'completed',
              updatedAt: new Date(),
              metadata: {
                ...processLog.metadata,
                leadsImported: leadsToSave.length,
                duplicatesSkipped: duplicateCount,
                invalidFiltered: filteredCount
              }
            })
            .where(eq(aiProcessLogs.id, processLog.id));

          // Professional Distribution Trigger
          try {
            const { distributeLeadsFromPool } = await import('@services/outreach-worker/src/sales-engine/outreach-engine.js');
            await distributeLeadsFromPool(userId);
          } catch (distErr) {
            console.error('[CSV Import] Lead distribution failed:', distErr);
          }

          // Notify frontend to refresh data (no sound — the notification event handles that)
          wsSync.notifyLeadsUpdated(userId, { type: 'bulk_import', count: leadsToSave.length });
          wsSync.notifyStatsUpdated(userId, { integrationId: req.body.integrationId });

          res.json({
            success: true,
            leadsImported: leadsToSave.length,
            duplicatesSkipped: duplicateCount,
            invalidFiltered: filteredCount,
            processId: processLog.id,
            leads: leadsToSave.slice(0, 1000) // Return leads for immediate Wizard usage
          });

          // Create single aggregate notification for import (only one sound plays)
          if (leadsToSave.length > 0 || duplicateCount > 0 || filteredCount > 0) {
            try {
              await storage.createNotification({
                userId,
                type: 'lead_import',
                title: '📥 CSV Import Complete',
                message: `${leadsToSave.length} leads imported${duplicateCount > 0 ? `, ${duplicateCount} duplicates skipped` : ''}${filteredCount > 0 ? `, ${filteredCount} invalid filtered` : ''}.`,
                metadata: { source: 'csv_upload', count: leadsToSave.length, duplicates: duplicateCount, filtered: filteredCount, fileName: file.originalname }
              });
              // Single notification event — triggers one sound on the frontend
              wsSync.notifyNotification(userId, {
                type: 'lead_import',
                title: '📥 CSV Import Complete',
                message: `${leadsToSave.length} leads imported successfully.`,
                playSound: true
              });
            } catch (notifErr) {
              console.warn('[CSV Import] Failed to create notification:', notifErr);
            }
          }

          console.log(`[CSV Import] Success: Imported ${leadsToSave.length}, Skipped ${duplicateCount}, Filtered ${filteredCount}`);


        } catch (error: any) {
          console.error("CSV Processing Error:", error);
          if (!res.headersSent) {
            res.status(500).json({ error: "Failed to process CSV rows" });
          }
        }
      });

  } catch (error: any) {
    console.error("CSV Import API Error:", error);
    if (res.headersSent) return;
    res.status(500).json({ error: error.message });
  }
});
/**
 * Update lead details (status, aiPaused, etc.)
 * PATCH /api/leads/:leadId
 */
router.patch("/:leadId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { leadId } = req.params;
    const updates = req.body;

    const lead = await storage.getLeadById(leadId as string);
    if (!lead || lead.userId !== userId) {
      if (!res.headersSent) {
        res.status(404).json({ error: "Lead not found" });
      }
      return;
    }

    // Sanitize updates
    const allowedUpdates: Partial<typeof lead> = {};
    if (typeof updates.aiPaused === 'boolean') allowedUpdates.aiPaused = updates.aiPaused;
    if (updates.status) allowedUpdates.status = updates.status;
    if (updates.name) allowedUpdates.name = updates.name;
    if (updates.email) allowedUpdates.email = updates.email;
    if (updates.phone) allowedUpdates.phone = updates.phone;
    if (updates.metadata) allowedUpdates.metadata = updates.metadata;

    if (Object.keys(allowedUpdates).length === 0) {
      if (!res.headersSent) {
        res.status(400).json({ error: "No valid updates provided" });
      }
      return;
    }

    const updatedLead = await storage.updateLead(leadId, {
      ...allowedUpdates
    });

    if (updates.status && (updates.status === 'converted' || updates.status === 'booked' || updates.status === 'closed_won')) {
      evaluateLeadDealValue(userId, leadId as string).catch(err => 
        console.error("Deal evaluation failed:", err)
      );
    }

    // Notify via WebSocket
    const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
    wsSync.notifyLeadsUpdated(userId, { type: 'lead_updated', lead: updatedLead });

    res.json(updatedLead);
  } catch (error: unknown) {
    console.error("Update lead error:", error);
    if (res.headersSent) return;
    res.status(500).json({ error: "Failed to update lead" });
  }
});

/**
 * GET /api/leads/:leadId
 * Get a single lead by ID
 */
router.get("/:leadId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { leadId } = req.params;

    const lead = await storage.getLeadById(leadId as string);
    if (!lead || lead.userId !== userId) {
      if (!res.headersSent) {
        res.status(404).json({ error: "Lead not found" });
      }
      return;
    }

    res.json(lead);
  } catch (error: unknown) {
    console.error("Get lead error:", error);
    if (res.headersSent) return;
    res.status(500).json({ error: "Failed to fetch lead" });
  }
});

/**
 * Phase 39: Manually trigger deep research for a lead
 * POST /api/leads/:leadId/research
 */
router.post("/:leadId/research", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { leadId } = req.params;

    const lead = await storage.getLeadById(leadId as string);
    if (!lead || lead.userId !== userId) {
      if (!res.headersSent) {
        res.status(404).json({ error: "Lead not found" });
      }
      return;
    }

    // Trigger enrichment immediately (bypass worker tick)
    await leadEnrichmentWorker.enrichLead(lead);
    
    // Fetch updated lead
    const updatedLead = await storage.getLeadById(leadId as string);

    res.json({
      success: true,
      message: "Lead research initiated and completed",
      lead: updatedLead
    });
  } catch (error: unknown) {
    console.error("Lead research error:", error);
    if (res.headersSent) return;
    res.status(500).json({ error: "Failed to perform lead research" });
  }
});


/**
 * Send AI-generated reply to a lead
 * POST /api/ai/reply/:leadId
 */
router.post("/reply/:leadId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { leadId } = req.params;
    const { manualMessage } = req.body;
    const userId = getCurrentUserId(req)!;

    const lead = await storage.getLeadById(leadId as string);
    if (!lead) {
      console.warn(`[AI-Reply] Lead not found: ${leadId}`);
      if (!res.headersSent) {
        res.status(404).json({ error: "Lead not found" });
      }
      return;
    }

    // Allow owner or admin
    if (lead.userId !== userId) {
      const user = await storage.getUserById(userId);
      const isAdmin = user?.role?.toLowerCase() === 'admin';

      console.log(`[AI-Reply] Auth check: lead.userId=${lead.userId}, session.userId=${userId}, user.role=${user?.role}, orgId=${lead.organizationId}`);

      if (!isAdmin) {
        if (!lead.organizationId) {
          console.warn(`[AI-Reply] 403 Unauthorized: User ${userId} is not lead owner and lead has no organization.`);
          if (!res.headersSent) {
            res.status(403).json({ error: "Unauthorized (No Org)" });
          }
          return;
        }

        const orgMembers = await storage.getOrganizationMembers(lead.organizationId);
        const isMember = orgMembers.some(m => m.userId === userId);

        if (!isMember) {
          console.warn(`[AI-Reply] 403 Unauthorized: User ${userId} is not lead owner, admin, or org member for lead ${leadId}`);
          if (!res.headersSent) {
            res.status(403).json({ error: "Unauthorized (Not in Org)" });
          }
          return;
        }
      }
    }


    const messages = await storage.getMessagesByLeadId(leadId);

    const user = await storage.getUserById(userId);
    const userContext = {
      businessName: user?.company || undefined,
      brandVoice: user?.replyTone || 'professional'
    };

    const aiResponse = await generateAIReply(
      lead,
      messages,
      lead.channel as ChannelType,
      userContext
    );

    const messageBody = manualMessage || aiResponse.text;

    const message = await storage.createMessage({
      leadId: leadId as string,
      userId,
      provider: lead.channel as ProviderType,
      direction: "outbound",
      body: messageBody,
      audioUrl: null,
      metadata: {
        ai_generated: !manualMessage,
        should_use_voice: aiResponse.useVoice,
        detections: aiResponse.detections
      }
    });

    const statusDetection = detectConversationStatus([...messages, message]);
    const oldStatus = lead.status;
    const newStatus = statusDetection.status;

    const updatedLead = await storage.updateLead(leadId as string, {
      status: newStatus as any,
      lastMessageAt: new Date()
    });

    // Notify via WebSocket
    const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
    wsSync.notifyMessagesUpdated(userId, { leadId: leadId as string, message });
    wsSync.notifyLeadsUpdated(userId, { type: 'lead_updated', lead: updatedLead });

    if ((newStatus as string) === 'converted' || (newStatus as string) === 'booked' || (newStatus as string) === 'closed_won') {
      evaluateLeadDealValue(userId, leadId as string).catch(err => 
        console.error("Deal evaluation failed in auto-reply:", err)
      );
    }

    if (oldStatus !== newStatus) {
      let notificationTitle = '';
      let notificationMessage = '';
      let notificationType: any = 'system';

      if ((newStatus as any) === 'converted') {
        notificationTitle = '🎉 New Conversion!';
        notificationMessage = `${lead.name} from ${lead.channel} has converted! ${statusDetection.reason || ''}`;
        notificationType = 'conversion';
      } else if (newStatus === 'replied') {
        notificationTitle = '💬 Lead Reply';
        notificationMessage = `${lead.name} just replied to your message`;
        notificationType = 'lead_reply';
      } else if (newStatus === 'not_interested') {
        notificationTitle = '😔 Lead Not Interested';
        notificationMessage = `${lead.name} declined: ${statusDetection.reason || 'No interest shown'}`;
      } else if (newStatus === 'cold') {
        notificationTitle = '❄️ Lead Went Cold';
        notificationMessage = `${lead.name}: ${statusDetection.reason || 'No recent engagement'}`;
      }

      if (notificationTitle) {
        await storage.createNotification({
          userId,
          type: notificationType,
          title: notificationTitle,
          message: notificationMessage,
          metadata: {
            leadId: leadId as string,
            leadName: lead.name,
            oldStatus,
            newStatus,
            reason: statusDetection.reason,
            channel: lead.channel,
            activityType: 'status_change'
          }
        });
      }
    }

    const updatedMessages = [...messages, message];
    await saveConversationToMemory(userId, lead, updatedMessages);

    if ((statusDetection.status as any) !== 'converted' && (statusDetection.status as any) !== 'not_interested') {
      const followUpTime = await scheduleFollowUp(userId, leadId as string, lead.channel, 'followup');

      res.json({
        message,
        aiSuggestion: aiResponse.text,
        useVoice: aiResponse.useVoice,
        nextFollowUp: followUpTime,
        leadStatus: statusDetection.status
      });
    } else {
      res.json({
        message,
        leadStatus: statusDetection.status
      });
    }

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Failed to generate reply";
    console.error("AI reply error:", error);
    if (res.headersSent) return;
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Generate AI-drafted reply to a lead (does not send or save to DB)
 * POST /api/ai/draft-reply/:leadId
 */
router.post("/draft-reply/:leadId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { leadId } = req.params;
    const userId = getCurrentUserId(req)!;

    const lead = await storage.getLeadById(leadId as string);
    if (!lead) {
      if (!res.headersSent) {
        res.status(404).json({ error: "Lead not found" });
      }
      return;
    }

    // Allow owner or admin
    if (lead.userId !== userId) {
      const user = await storage.getUserById(userId);
      const isAdmin = user?.role?.toLowerCase() === 'admin';
      if (!isAdmin) {
        if (!res.headersSent) {
          res.status(403).json({ error: "Unauthorized" });
        }
        return;
      }
    }

    const messages = await storage.getMessagesByLeadId(leadId);
    const user = await storage.getUserById(userId);
    
    // Pass same context as the auto-reply
    const userContext = {
      businessName: user?.company || undefined,
      brandVoice: user?.replyTone || 'professional'
    };
    
    // Inject PDF intel if available (like Expert Outreach)
    if (user?.brandGuidelinePdfText) {
      userContext.brandVoice += `\nBRAND PDF GUIDELINES EXCERPT: ${user.brandGuidelinePdfText.substring(0, 1000)}`;
    }

    const aiResponse = await generateAIReply(
      lead,
      messages,
      lead.channel as ChannelType,
      userContext
    );

    res.json({
      draft: aiResponse.text
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Failed to generate draft";
    console.error("AI draft generation error:", error);
    if (res.headersSent) return;
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Generate voice note script for warm lead
 * POST /api/ai/voice/:leadId
 */
router.post("/voice/:leadId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { leadId } = req.params;
    const userId = getCurrentUserId(req)!;

    const lead = await storage.getLeadById(leadId);
    if (!lead || lead.userId !== userId) {
      if (!res.headersSent) {
        res.status(404).json({ error: "Lead not found" });
      }
      return;
    }

    const messages = await storage.getMessagesByLeadId(leadId);
    const voiceScript = await generateVoiceScript(lead, messages);

    res.json({
      script: voiceScript,
      duration: "10-15 seconds",
      leadName: lead.name
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Failed to generate voice script";
    console.error("Voice generation error:", error);
    if (res.headersSent) return;
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Import leads from connected platforms
 * POST /api/ai/import/:provider
 */
router.post("/import/:provider", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { provider } = req.params;
    const userId = getCurrentUserId(req)!;

    let results: { leadsImported: number; messagesImported: number; errors: string[] };

    switch (provider) {
      case 'instagram':
        results = await importInstagramLeads(userId);
        break;
      case 'gmail':
        results = await importGmailLeads(userId);
        break;

      case 'manychat':
        results = await importManychatLeads(userId);
        break;
      default:
        if (!res.headersSent) {
          res.status(400).json({ error: "Invalid provider" });
        }
        return;
    }

    res.json({
      success: results.errors.length === 0,
      leadsImported: results.leadsImported,
      messagesImported: results.messagesImported,
      errors: results.errors
    });

    // Create notification for platform import
    if (results.leadsImported > 0) {
      try {
        await storage.createNotification({
          userId,
          type: 'lead_import',
          title: '📥 Leads Imported',
          message: `${results.leadsImported} leads successfully imported from ${provider}.`,
          metadata: { source: provider, count: results.leadsImported }
        });
        const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
        // Send a specific event to trigger frontend refresh
        wsSync.notifyNotification(userId, {
          type: 'lead_import',
          count: results.leadsImported,
          title: '📥 Leads Imported',
          message: `${results.leadsImported} leads successfully imported from ${provider}.`
        });
      } catch (notifErr) {
        console.warn('[Platform Import] Failed to create notification:', notifErr);
      }
    }

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Failed to import leads";
    console.error("Import error:", error);
    if (res.headersSent) return;
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Bulk import leads from JSON
 * POST /api/ai/import-bulk
 */
router.post("/import-bulk", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { leads: leadsData, channel = 'email', aiPaused = false, integrationId } = req.body as {
      leads: Array<{ name?: string; email?: string; phone?: string; company?: string }>;
      channel?: 'email' | 'instagram';
      aiPaused?: boolean;
      integrationId?: string;
    };

    if (!Array.isArray(leadsData) || leadsData.length === 0) {
      if (!res.headersSent) {
        res.status(400).json({ error: "No leads data provided" });
      }
      return;
    }

    const user = await storage.getUserById(userId);
    const existingLeads = await storage.getLeads({ userId, limit: 10000 });
    const currentLeadCount = existingLeads.length;

    const maxLeads = 1000000; // Unlimited as per request

    if (currentLeadCount >= maxLeads) {
      res.status(400).json({
        error: `You've reached your plan's limit of ${maxLeads} leads. Delete some leads or upgrade your plan to add more.`,
        limitReached: true
      });
      return;
    }

    const { verifyDomainDns } = await (eval('import("@services/email-service/src/email/dns-verification.js")') as Promise<any>);
    const { generateContextAwareMessage } = await import("@services/brain-worker/src/orchestrator/agents/universal-sales-agent-integrated.js");

    const results = {
      leadsImported: 0,
      leadsUpdated: 0,
      leadsFiltered: 0,
      errors: [] as string[]
    };

    const leadsToImportCount = Math.min(leadsData.length, maxLeads - currentLeadCount);

    const newLeadsToInsert: any[] = [];

    for (let i = 0; i < leadsToImportCount; i++) {
      const leadData = leadsData[i];
      try {
        const name = leadData.name;
        const email = leadData.email;

        if (!email && !name) {
          results.errors.push(`Row ${i + 1}: Missing name and email`);
          continue;
        }

        const identifier = email || name || 'unknown';

        // --- ENHANCEMENT: 100% Lead Capture (Neural Filter to Metadata Only) ---
        // Instead of dropping leads, we just tag them so the user knows
        let deliverability = 'unverified';
        if (leadData.email) {
          const domain = leadData.email.split('@')[1];
          if (domain) {
            try {
              const dnsCheck = await verifyDomainDns(domain).catch(() => null);
              if (dnsCheck && (dnsCheck.overallStatus === 'poor' || !dnsCheck.mx.found)) {
                deliverability = 'risky';
              }
            } catch (e) { }
          }
        }

        newLeadsToInsert.push({
          userId,
          name: leadData.name || identifier.split('@')[0] || 'Unknown',
          email: leadData.email || null,
          phone: leadData.phone || null,
          channel: channel as 'email' | 'instagram',
          status: 'new',
          aiPaused: aiPaused,
          integrationId: integrationId || null,
          metadata: {
            ...leadData, // Preserve all original fields
            imported_from_csv: true,
            import_date: new Date().toISOString(),
            deliverability
          }
        });

        results.leadsImported++;
      } catch (error: any) {
        results.errors.push(`Row ${i + 1}: ${error.message}`);
      }
    }

    // --- BATCH INSERTION (PHASE 2 REQUIREMENT) ---
    // Chunked insert to handle 5k+ leads efficiently
    const chunkSize = 50;
    const finalLeads = [];
    for (let i = 0; i < newLeadsToInsert.length; i += chunkSize) {
      const chunk = newLeadsToInsert.slice(i, i + chunkSize);
      const inserted = await db.insert(leadsTable).values(chunk).returning();
      finalLeads.push(...inserted);

      // Phase 1.1: Dispatch background timezone enrichment
      const { aiProcessingQueue } = await import('../core/queues.js');
      if (aiProcessingQueue) {
        const enrichmentJobs = inserted.map(lead => ({
          name: 'timezone-enrichment',
          data: {
            type: 'timezone-enrichment',
            userId,
            leadId: lead.id,
            data: { useAI: true }
          }
        }));
        await aiProcessingQueue.addBulk(enrichmentJobs).catch(err => 
          console.warn(`[Bulk Import] Failed to queue enrichment:`, err)
        );
      }
    }

    res.json({
      success: results.leadsImported > 0 || results.leadsUpdated > 0,
      leadsImported: results.leadsImported,
      leadsUpdated: results.leadsUpdated,
      errors: results.errors.slice(0, 100), // Don't overwhelm response
      message: `Successfully processed ${results.leadsImported} new leads and ${results.leadsUpdated} updates. 100% capture enabled.`,
      leads: finalLeads // Return real leads with UUIDs
    });

    // Create notification for bulk import
    if (results.leadsImported > 0) {
      try {
        await storage.createNotification({
          userId,
          type: 'lead_import',
          title: '📥 Leads Imported',
          message: `${results.leadsImported} leads imported successfully`,
          metadata: { source: 'bulk_import', count: results.leadsImported }
        });
        const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
        wsSync.notifyNotification(userId, { type: 'lead_import', count: results.leadsImported });
        wsSync.notifyLeadsUpdated(userId, { type: 'leads_imported', count: results.leadsImported });
      } catch (notifErr) {
        console.warn('[Bulk Import] Failed to create notification:', notifErr);
      }
    }

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Failed to import leads";
    console.error("CSV Import error:", error);
    if (res.headersSent) return;
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Parse raw email body into structured JSON
 * POST /api/ai/parse-body
 */
router.post("/parse-body", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { body } = req.body;
    if (!body) {
      if (!res.headersSent) {
        res.status(400).json({ error: "No email body provided" });
      }
      return;
    }

    const parsedData = await parseEmailBody(body);
    res.json(parsedData);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Failed to parse email body";
    if (res.headersSent) return;
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Create calendar booking link for lead
 * POST /api/ai/calendar/:leadId
 */
router.post("/calendar/:leadId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { leadId } = req.params;
    const { sendMessage = true, createEvent = false, startTime, duration = 30 } = req.body;
    const userId = getCurrentUserId(req)!;

    const lead = await storage.getLeadById(leadId);
    if (!lead || lead.userId !== userId) {
      if (!res.headersSent) {
        res.status(404).json({ error: "Lead not found" });
      }
      return;
    }

    let bookingLink = await createCalendarBookingLink(userId, lead.name, duration);
    let eventData: { id?: string; hangoutLink?: string; htmlLink?: string } | null = null;

    if (createEvent && startTime) {
      try {
        const { GoogleCalendarOAuth } = await import('@services/api-gateway/src/oauth/google-calendar.js');

        const integration = await storage.getIntegration(userId, 'google_calendar');

        if (integration && integration.connected && integration.encryptedMeta) {
          const { decrypt } = await import('@shared/lib/crypto/encryption.js');
          const tokensStr = await decrypt(integration.encryptedMeta);
          const tokens = JSON.parse(tokensStr);
          const googleCalendar = new GoogleCalendarOAuth();

          const requestedStart = new Date(startTime);
          const leadTimezone = (lead.metadata as Record<string, unknown>)?.timezone as string || 'America/New_York';

          const availabilityCheck = await googleCalendar.findNextAvailableSlot(
            tokens.accessToken,
            requestedStart,
            duration,
            leadTimezone
          );

          eventData = await googleCalendar.createEvent(tokens.accessToken, {
            summary: `Meeting with ${lead.name}`,
            description: `AI Scheduled meeting with lead ${lead.name}`,
            startTime: availabilityCheck.suggestedStart,
            endTime: availabilityCheck.suggestedEnd,
            attendeeEmail: lead.email || undefined,
          });

          bookingLink = eventData?.hangoutLink || eventData?.htmlLink || bookingLink;

          if (!availabilityCheck.isOriginalTimeAvailable) {
            await storage.createMessage({
              leadId,
              userId,
              provider: lead.channel as ProviderType,
              direction: "outbound",
              body: availabilityCheck.message,
              metadata: {
                rescheduled: true,
                originalTime: requestedStart.toISOString(),
                newTime: availabilityCheck.suggestedStart.toISOString()
              }
            });
          }

          await storage.createNotification({
            userId,
            type: 'system',
            title: '📅 Meeting Booked',
            message: `Meeting scheduled with ${lead.name} for ${availabilityCheck.suggestedStart.toLocaleString()}${!availabilityCheck.isOriginalTimeAvailable ? ' (rescheduled)' : ''}`,
            metadata: {
              leadId,
              leadName: lead.name,
              meetingTime: availabilityCheck.suggestedStart.toISOString(),
              meetingUrl: bookingLink,
              activityType: 'meeting_booked',
              wasRescheduled: !availabilityCheck.isOriginalTimeAvailable
            }
          });
        }
      } catch (eventError) {
        console.error("Error creating calendar event:", eventError);
      }
    }

    const messageText = generateMeetingLinkMessage(
      lead.name,
      bookingLink,
      lead.channel as ChannelType
    );

    if (sendMessage) {
      const message = await storage.createMessage({
        leadId: leadId as string,
        userId,
        provider: lead.channel as ProviderType,
        direction: "outbound",
        body: messageText,
        metadata: {
          booking_link: bookingLink,
          event_id: eventData?.id,
          event_link: eventData?.htmlLink
        }
      });

      res.json({
        bookingLink,
        messageSent: true,
        message,
        event: eventData
      });
    } else {
      res.json({
        bookingLink,
        suggestedMessage: messageText,
        messageSent: false,
        event: eventData
      });
    }

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Failed to create booking link";
    console.error("Calendar booking error:", error);
    if (res.headersSent) return;
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Generate smart reply suggestions
 * GET /api/ai/smart-replies/:leadId
 */
router.get("/smart-replies/:leadId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { leadId } = req.params;
    const userId = getCurrentUserId(req)!;

    const lead = await storage.getLeadById(leadId);
    if (!lead || lead.userId !== userId) {
      if (!res.headersSent) {
        res.status(404).json({ error: "Lead not found" });
      }
      return;
    }

    const messages = await storage.getMessagesByLeadId(leadId);
    const lastMessage = messages[messages.length - 1];

    if (!lastMessage || lastMessage.direction !== 'inbound') {
      if (!res.headersSent) {
        res.status(400).json({ error: "No inbound message to reply to" });
      }
      return;
    }

    const smartReplies = await generateSmartReplies(leadId as string, lastMessage);

    res.json({
      leadId,
      leadName: lead.name,
      lastMessage: lastMessage.body,
      suggestions: smartReplies
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Failed to generate smart replies";
    console.error("Smart replies error:", error);
    if (res.headersSent) return;
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Get lead score
 * GET /api/ai/score/:leadId
 */
router.get("/score/:leadId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { leadId } = req.params;
    const userId = getCurrentUserId(req)!;

    const lead = await storage.getLeadById(leadId);
    if (!lead || lead.userId !== userId) {
      if (!res.headersSent) {
        res.status(404).json({ error: "Lead not found" });
      }
      return;
    }

    const scoreData = await calculateLeadScore(leadId as string);

    res.json({
      leadId,
      leadName: lead.name,
      ...scoreData
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Failed to calculate lead score";
    console.error("Lead scoring error:", error);
    if (res.headersSent) return;
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Get competitor analytics
 * GET /api/ai/competitor-analytics
 */
router.get("/competitor-analytics", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;

    const analytics = await getCompetitorAnalytics(userId);

    res.json(analytics);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Failed to get competitor analytics";
    console.error("Competitor analytics error:", error);
    if (res.headersSent) return;
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Get optimal discount percentage
 * GET /api/ai/optimal-discount
 */
router.get("/optimal-discount", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;

    const optimalDiscount = await learnOptimalDiscount(userId);

    res.json({
      optimalDiscount,
      message: `Based on your conversion history, ${optimalDiscount}% is the sweet spot`
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Failed to calculate optimal discount";
    console.error("Optimal discount error:", error);
    if (res.headersSent) return;
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Update brand info (re-upload brand context)
 * POST /api/ai/brand-info
 */
router.post("/brand-info", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { brandSnippets, promotions, siteUrl } = req.body;

    if (!brandSnippets || !Array.isArray(brandSnippets)) {
      if (!res.headersSent) {
        res.status(400).json({ error: "brandSnippets array required" });
      }
      return;
    }

    const { db } = await import('@shared/lib/db/db.js');
    const { brandEmbeddings } = await import('@audnix/shared');
    const { embed } = await import('@services/brain-worker/src/ai-lib/core/ai-service.js');

    await db.delete(brandEmbeddings).where(eq(brandEmbeddings.userId, userId));

    for (const snippet of brandSnippets as string[]) {
      const embedding = await embed(snippet);
      await db.insert(brandEmbeddings).values({
        userId,
        snippet,
        source: "brand_guidelines",
        embedding: JSON.stringify(embedding),
        metadata: {
          promotions: promotions || [],
          siteUrl: siteUrl || null,
          updatedAt: new Date().toISOString()
        }
      });
    }

    res.json({
      success: true,
      message: "Brand info updated! AI will now use this in all responses",
      snippetsCount: (brandSnippets as string[]).length
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Failed to update brand info";
    console.error("Brand info update error:", error);
    if (res.headersSent) return;
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Import leads from PDF file upload
 * POST /api/leads/import-pdf
 */
router.post("/import-pdf", requireAuth, upload.single("pdf"), async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;

    if (!req.file) {
      if (!res.headersSent) {
        res.status(400).json({ error: "No PDF file provided" });
      }
      return;
    }

    const user = await storage.getUserById(userId);
    const existingLeads = await storage.getLeads({ userId, limit: 10000 });
    const currentLeadCount = existingLeads.length;

    const planLimits: Record<string, number> = {
      'free': 10000,
      'trial': 10000,
      'starter': 25000,
      'pro': 100000,
      'enterprise': 500000
    };
    const maxLeads = planLimits[user?.subscriptionTier || user?.plan || 'trial'] || 10000;

    if (currentLeadCount >= maxLeads) {
      if (!res.headersSent) {
        res.status(400).json({
          error: `You've reached your plan's limit of ${maxLeads} leads. Delete some leads or upgrade your plan to add more.`,
          limitReached: true
        });
      }
      return;
    }

    const result = await processPDF(req.file.buffer, userId, {
      extractOffer: true,
      autoReachOut: false,
      integrationId: req.body.integrationId || undefined
    });

    if (!result.success) {
      throw new Error(result.error || "Failed to process PDF");
    }

    res.json({
      success: true,
      leadsImported: result.leadsCreated,
      emailsFound: result.leads?.filter(l => !!l.email).length || 0,
      phonesFound: result.leads?.filter(l => !!l.phone).length || 0,
      errors: [],
      message: `Successfully processed PDF and imported ${result.leadsCreated} leads`
    });

    // Start outreach boom if leads were imported
    if (result.leadsCreated > 0) {
      const { triggerAutoOutreach } = await import('@services/outreach-worker/src/sales-engine/outreach-engine.js');
      triggerAutoOutreach(userId).catch(e => console.error('Auto outreach failed:', e));
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Failed to import leads from PDF";
    console.error("PDF import error:", error);
    if (res.headersSent) return;
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * Run outreach campaign
 * POST /api/ai/run-outreach
 * 
 * With Redis: enqueues the campaign as a BullMQ job (crash-safe, resumes on restart).
 * Without Redis: falls back to synchronous execution.
 */
router.post("/run-outreach", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { leads, brandContext, runDemo = false } = req.body;

    if (!leads || !Array.isArray(leads) || leads.length === 0) {
      if (!res.headersSent) {
        res.status(400).json({ error: "No leads provided." });
      }
      return;
    }

    if (!brandContext || !brandContext.serviceName) {
      if (!res.headersSent) {
        res.status(400).json({ error: "Brand context (serviceName, valueProposition) is required." });
      }
      return;
    }

    // 1. Create or Find Outreach Campaign Record
    const campaign = await storage.createOutreachCampaign({
      userId,
      name: brandContext.serviceName,
      status: 'active',
      template: brandContext,
      metadata: { source: runDemo ? 'demo' : 'api' }
    });

    // 2. Resolve/Create Leads and Assign to Campaign
    const leadAssignments: { leadId: string }[] = [];
    for (const l of (leads as any[])) {
      let lead = await storage.getLeadByEmail(l.email, userId);
      if (!lead) {
        lead = await storage.createLead({
          userId,
          name: l.name,
          email: l.email,
          channel: 'email',
          status: 'new',
          metadata: { company: l.company, source: 'outreach_api' }
        }, { suppressNotification: true });
      }
      leadAssignments.push({ leadId: lead.id });
    }

    await storage.addLeadsToCampaign(campaign.id, leadAssignments);

    // 3. Dispatch to Queue
    const { dispatchOutreachCampaign } = await import('@shared/lib/queues/outreach-queue.js');
    const { jobId, queued } = await dispatchOutreachCampaign(userId, campaign.id);

    if (queued) {
      res.json({
        success: true,
        campaignId: campaign.id,
        jobId,
        message: `Enterprise outreach started for ${leads.length} leads. Tracking ID: ${campaign.id}`
      });
    } else {
      // Background worker not available (no Redis) - Run synchronously for this small batch
      // In production, we expect Redis to be present.
      const { runOutreachCampaignQueued } = await import('@services/outreach-worker/src/outreach-lib/outreach-runner.js');
      
      // Start processing but return immediately to avoid timeout (pseudo-background)
      setImmediate(() => {
        runOutreachCampaignQueued(userId, campaign.id).catch((err: any) => {
          console.error(`[OutreachSyncFallback] Campaign ${campaign.id} failed:`, err);
        });
      });

      res.json({
        success: true,
        campaignId: campaign.id,
        message: `Campaign started in local mode (No Redis found). Leads: ${leads.length}`
      });
    }

  } catch (error: any) {
    console.error("[API] Outreach Dispatch Failure:", error.message);
    if (res.headersSent) return;
    res.status(500).json({ error: error.message || "Failed to initiate outreach." });
  }
});


/**
 * AI Grammar Check
 * POST /api/ai/check-grammar
 */
router.post("/check-grammar", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { text } = req.body;
    if (!text) {
      res.status(400).json({ error: "No text provided" });
      return;
    }

    const result = await checkGrammar(text);
    res.json(result);
  } catch (error) {
    console.error("Grammar check error:", error);
    res.status(500).json({ error: "Failed to check grammar" });
  }
});

/**
 * AI Magic Pencil (Rewrite / Polish)
 * POST /api/ai/magic-pencil
 */
router.post("/magic-pencil", requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { text, tone = "professional", context = "" } = req.body;
    if (!text) {
      res.status(400).json({ error: "No text provided" });
      return;
    }

    const systemPrompt = `You are an elite sales communication coach. Rewrite the following message to be more effective, professional, and natural. 
Tone: ${tone}
Goal: Increase response rates and trust.
No matter what, keep it human and concise. Do NOT use corporate jargon.`;

    const userPrompt = `Message to rewrite: "${text}"
${context ? `Extra Context: ${context}` : ""}

Provide ONLY the rewritten message.`;

    const result = await generateReply(systemPrompt, userPrompt, { temperature: 0.7 });
    res.json({ rewrittenText: result.text.trim() });
  } catch (error) {
    console.error("Magic pencil error:", error);
    res.status(500).json({ error: "Failed to rewrite message" });
  }
});

export default router;



