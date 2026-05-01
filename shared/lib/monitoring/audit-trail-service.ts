/**
 * Audit Trail Service
 * Logs all AI actions for compliance and monitoring
 */

import { db } from '@shared/lib/db/db.js';
import { auditTrail, pdfAnalytics } from "@audnix/shared";
import { eq, desc, and, sql, gte } from "drizzle-orm";

export type AuditActionType =
  | "ai_message_sent"
  | "opt_out_toggled"
  | "pdf_processed"
  | "upload_rate_limited"
  | "campaign_started"
  | "campaign_completed"
  | "campaign_pause_toggled"
  | "campaign_deleted"
  | "campaign_aborted"
  | "intent_detected"
  | "ai_reasoning"
  | "system_event";

export interface AuditAction {
  userId: string;
  leadId?: string;
  action: AuditActionType;
  messageId?: string;
  details: Record<string, unknown>;
}

export interface AuditTrailEntry {
  id: string;
  userId: string;
  leadId: string | null;
  action: string;
  messageId: string | null;
  details: Record<string, unknown>;
  createdAt: Date;
}

export interface PdfAnalyticsEntry {
  id: string;
  userId: string;
  fileName: string;
  fileSize: number;
  confidence: number;
  missingFields: string[];
  leadsExtracted: number;
  processedAt: Date;
}

export interface PdfAnalyticsStats {
  totalProcessed: number;
  avgConfidence: string;
  lowConfidenceCount: number;
  lowConfidencePercentage: string;
  totalLeadsExtracted: number;
}

export interface PdfAnalyticsResult {
  stats: PdfAnalyticsEntry[];
  analytics: Partial<PdfAnalyticsStats>;
}

export interface PdfQualityAlert {
  shouldAlert: boolean;
  message?: string;
  percentage?: number;
}

export class AuditTrailService {
  /**
   * Log AI message sent
   */
  static async logAiMessageSent(
    userId: string,
    leadId: string,
    messageId: string,
    channel: string,
    content: string,
    followUpNumber: number
  ): Promise<void> {
    try {
      await db.insert(auditTrail).values({
        userId,
        leadId,
        action: "ai_message_sent",
        messageId,
        details: {
          channel,
          contentLength: content.length,
          followUpNumber,
          timestamp: new Date().toISOString(),
        },
      });
      console.log(`✓ Audit: AI message sent to lead ${leadId} (${channel})`);
    } catch (error) {
      console.error("Audit trail error:", error);
    }
  }

  /**
   * Log opt-out toggle
   */
  static async logOptOutToggle(
    userId: string,
    leadId: string,
    isPaused: boolean
  ): Promise<void> {
    try {
      await db.insert(auditTrail).values({
        userId,
        leadId,
        action: "opt_out_toggled",
        details: {
          aiPaused: isPaused,
          timestamp: new Date().toISOString(),
        },
      });
      console.log(`✓ Audit: AI ${isPaused ? "paused" : "resumed"} for lead ${leadId}`);
    } catch (error) {
      console.error("Audit trail error:", error);
    }
  }

  /**
   * Log PDF processing with confidence
   */
  static async logPdfProcessed(
    userId: string,
    fileName: string,
    fileSize: number,
    confidence: number,
    missingFields: string[],
    leadsExtracted: number
  ): Promise<void> {
    try {
      await db.insert(pdfAnalytics).values({
        userId,
        fileName,
        fileSize,
        confidence,
        missingFields,
        leadsExtracted,
      });

      if (confidence < 0.4) {
        console.warn(
          `⚠️ LOW PDF CONFIDENCE (${(confidence * 100).toFixed(1)}%) for ${fileName}`
        );
      }

      console.log(
        `✓ Audit: PDF processed - ${fileName} (confidence: ${(confidence * 100).toFixed(1)}%, leads: ${leadsExtracted})`
      );
    } catch (error) {
      console.error("PDF analytics error:", error);
    }
  }

  /**
   * Log high-level campaign actions
   */
  static async logCampaignAction(
    userId: string,
    campaignId: string,
    action: "campaign_started" | "campaign_completed" | "campaign_pause_toggled" | "campaign_deleted" | "campaign_aborted",
    details: Record<string, unknown> = {}
  ): Promise<void> {
    try {
      await db.insert(auditTrail).values({
        userId,
        leadId: null, // Campaign-level action
        action,
        details: {
          campaignId,
          ...details,
          timestamp: new Date().toISOString(),
        },
      });
      console.log(`✓ Audit: Campaign ${action} (${campaignId})`);
    } catch (error) {
      console.error("Audit trail error:", error);
    }
  }

  /**
   * Log rate limit hit
   */
  static async logRateLimitHit(userId: string, reason: string): Promise<void> {
    try {
      await db.insert(auditTrail).values({
        userId,
        leadId: null,
        action: "upload_rate_limited",
        details: {
          reason,
          timestamp: new Date().toISOString(),
        },
      });
      console.log(`⚠️ Audit: Rate limit - ${reason} for user ${userId}`);
    } catch (error) {
      console.error("Audit trail error:", error);
    }
  }

  /**
   * Get audit history for a lead
   */
  static async getLeadAuditHistory(leadId: string): Promise<AuditTrailEntry[]> {
    try {
      const history = await db
        .select()
        .from(auditTrail)
        .where(eq(auditTrail.leadId, leadId))
        .orderBy(desc(auditTrail.createdAt))
        .limit(100);

      return history as AuditTrailEntry[];
    } catch (error) {
      console.error("Error fetching audit history:", error);
      return [];
    }
  }

  /**
   * Get PDF analytics for user
   */
  static async getPdfAnalytics(userId: string, limit = 30): Promise<PdfAnalyticsResult> {
    try {
      const stats = await db
        .select()
        .from(pdfAnalytics)
        .where(eq(pdfAnalytics.userId, userId))
        .orderBy(desc(pdfAnalytics.processedAt))
        .limit(limit);

      const typedStats = stats as PdfAnalyticsEntry[];
      const lowConfidenceCount = typedStats.filter((s) => s.confidence < 0.4).length;
      const avgConfidence =
        typedStats.reduce((sum, s) => sum + s.confidence, 0) / Math.max(1, typedStats.length);

      return {
        stats: typedStats,
        analytics: {
          totalProcessed: typedStats.length,
          avgConfidence: avgConfidence.toFixed(2),
          lowConfidenceCount,
          lowConfidencePercentage: ((lowConfidenceCount / Math.max(1, typedStats.length)) * 100).toFixed(1),
          totalLeadsExtracted: typedStats.reduce((sum, s) => sum + s.leadsExtracted, 0),
        },
      };
    } catch (error) {
      console.error("Error fetching PDF analytics:", error);
      return { stats: [], analytics: {} };
    }
  }

  /**
   * Alert if low confidence PDFs exceed threshold
   */
  static async checkPdfQualityThreshold(
    userId: string,
    threshold = 0.4,
    maxPercentage = 0.2
  ): Promise<PdfQualityAlert> {
    try {
      const { analytics } = await this.getPdfAnalytics(userId, 50);
      const lowPercentage = parseFloat(analytics.lowConfidencePercentage || "0") / 100;

      if (lowPercentage > maxPercentage) {
        console.warn(
          `🚨 ALERT: PDF quality issue for user ${userId}. ${analytics.lowConfidenceCount}/${analytics.totalProcessed} PDFs have confidence < ${threshold}`
        );

        return {
          shouldAlert: true,
          message: `${analytics.lowConfidenceCount} of ${analytics.totalProcessed} recent PDFs have low confidence. Consider verifying data quality.`,
          percentage: lowPercentage,
        };
      }

      return { shouldAlert: false };
    } catch (error) {
      console.error("Error checking PDF quality:", error);
      return { shouldAlert: false };
    }
  }

  /**
   * Log detected intent with deduplication (24h window per intent type)
   */
  static async logIntentDetected(userId: string, leadId: string, intent: string, score: number): Promise<void> {
    try {
      if (!db || !leadId) return;

      // Check for identical intent log for this lead in the last 24 hours
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const conditions = [
        eq(auditTrail.action, "intent_detected"),
        sql`(${auditTrail.details}->>'intent') = ${intent}`,
        gte(auditTrail.createdAt, yesterday)
      ];

      if (leadId) {
        conditions.push(eq(auditTrail.leadId, leadId));
      }

      const existing = await db
        .select()
        .from(auditTrail)
        .where(and(...conditions))
        .limit(1);

      if (existing.length > 0) return;

      await db.insert(auditTrail).values({
        userId,
        leadId,
        action: "intent_detected",
        details: {
          intent,
          score,
          timestamp: new Date().toISOString(),
        },
      });
      console.log(`✓ Audit: Intent "${intent}" detected for lead ${leadId}`);
    } catch (error) {
      console.error("Audit trail intent error:", error);
    }
  }

  /**
   * Log detailed AI reasoning for a specific decision
   */
  static async logReasoning(params: { userId: string; leadId?: string; event: string; reasoning: string; [key: string]: any }): Promise<void> {
    try {
      const { userId, leadId, event, reasoning, ...data } = params;
      await db.insert(auditTrail).values({
        userId,
        leadId: leadId || null,
        action: "ai_reasoning",
        details: {
          event,
          reasoning,
          ...data,
          timestamp: new Date().toISOString(),
        },
      });
      console.log(`👁️ Audit: Reasoning logged for ${event}`);
    } catch (error) {
      console.error("Audit reasoning error:", error);
    }
  }

  /**
   * Log a generic system event
   */
  static async logEvent(params: { userId: string; event: string; [key: string]: any }): Promise<void> {
    try {
      const { userId, event, ...data } = params;
      await db.insert(auditTrail).values({
        userId,
        action: "system_event",
        details: {
          event,
          ...data,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error("Audit event error:", error);
    }
  }
}




