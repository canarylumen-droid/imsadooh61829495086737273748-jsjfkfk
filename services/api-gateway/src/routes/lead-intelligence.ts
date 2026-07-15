import express, { Router, Request, Response } from "express";
import type { Lead } from "@audnix/shared";
import type { LeadProfile, ConversationMessage, BrandContext } from '@shared/types.js';
import { calculateLeadScore, findDuplicateLeads, enrichLeadCompany, addTimelineEvent, addLeadTag, setCustomFieldValue } from "@services/brain-worker/src/ai-lib/core/lead-management.js";
import { detectLeadIntent, suggestSmartReply, detectObjection, predictDealAmount, assessChurnRisk, generateLeadIntelligenceDashboard } from "@services/brain-worker/src/ai-lib/context/lead-intelligence.js";
import { generateOptimizedMessage } from "@services/brain-worker/src/orchestrator/agents/universal-sales-agent.js";
import { generateContextAwareMessage } from "@services/brain-worker/src/orchestrator/agents/universal-sales-agent-integrated.js";
import { requireAuthOrApiKey, getCurrentUserId } from "../middleware/auth.js";
import { storage } from "@shared/lib/storage/storage.js";

const router: Router = express.Router();

interface ScoringMessage {
  direction: "inbound" | "outbound";
  createdAt: Date | string;
  opened?: boolean;
  clicked?: boolean;
  metadata?: Record<string, unknown>;
}

interface ScoreRequestBody {
  lead: Lead;
  messages?: ScoringMessage[];
}

interface IntentRequestBody {
  lead: LeadProfile;
  messages?: ConversationMessage[];
}

interface SmartReplyRequestBody {
  lead: LeadProfile;
  lastMessageFromLead: string;
  brandContext?: BrandContext;
  conversationHistory?: ConversationMessage[];
}

interface ObjectionRequestBody {
  messageText: string;
  leadId: string;
}

interface DealPredictionRequestBody {
  lead: LeadProfile;
  messages?: ConversationMessage[];
}

interface ChurnRiskRequestBody {
  lead: LeadProfile;
  messages?: ConversationMessage[];
  daysAsCustomer?: number;
}

interface IntelligenceDashboardRequestBody {
  lead: LeadProfile;
  messages?: ConversationMessage[];
}

interface DuplicatesRequestBody {
  lead: Lead;
  userLeads?: Lead[];
}

interface EnrichCompanyRequestBody {
  lead: Lead;
}

interface TagRequestBody {
  leadId: string;
  tagName: string;
}

interface CustomFieldRequestBody {
  leadId: string;
  fieldName: string;
  value: unknown;
}

interface TimelineEventRequestBody {
  leadId: string;
  actionType: string;
  actionData: Record<string, unknown>;
  actorId?: string;
}

interface Testimonial {
  text: string;
  source: string;
  industry?: string;
  outcome?: string;
  extracted_at: Date;
  effectiveness_score: number;
}

interface GenerateMessageRequestBody {
  lead: LeadProfile;
  brandContext?: BrandContext;
  testimonials?: Testimonial[];
  stage?: "cold" | "follow_up" | "objection" | "closing";
}

// ============ LEAD SCORING ============
router.post("/score", requireAuthOrApiKey, async (req: Request<any, any, ScoreRequestBody>, res: Response): Promise<void> => {
  try {
    const { lead, messages } = req.body;
    const score = await calculateLeadScore(lead, messages);

    res.json({
      lead_id: lead.id,
      score,
      tier: score >= 80 ? "hot" : score >= 60 ? "warm" : "cold",
      message: score >= 80 ? "🔥 HOT LEAD - Close ASAP" : score >= 60 ? "🔥 Warm lead - nurture" : "❄️ Cold lead - follow-up",
    });
  } catch (error) {
    console.error("Error scoring lead:", error);
    res.status(500).json({ error: "Failed to score lead" });
  }
});

// ============ LEAD INTENT DETECTION ============
router.post("/intent", requireAuthOrApiKey, async (req: Request<any, any, IntentRequestBody>, res: Response): Promise<void> => {
  try {
    const { lead, messages } = req.body;
    const intent = await detectLeadIntent(messages || [], lead);

    res.json({
      lead_id: lead.id,
      ...intent,
      action: intent.intentLevel === "high" ? "📞 CALL NOW - they're ready" : "📧 Send case study",
    });
  } catch (error) {
    console.error("Error detecting intent:", error);
    res.status(500).json({ error: "Failed to detect intent" });
  }
});

// ============ SMART REPLY SUGGESTIONS ============
router.post("/smart-reply", requireAuthOrApiKey, async (req: Request<any, any, SmartReplyRequestBody>, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const { lead, lastMessageFromLead, conversationHistory } = req.body;
    let { brandContext } = req.body;

    // Fallback: Fetch brand context from user metadata if not provided
    if (!brandContext && userId) {
      const user = await storage.getUser(userId);
      if (user?.metadata) {
        brandContext = user.metadata as BrandContext;
      }
    }

    const suggestions = await suggestSmartReply(
      lastMessageFromLead,
      lead,
      brandContext || {} as BrandContext,
      conversationHistory || []
    );

    res.json({
      lead_id: lead.id,
      suggestions,
      recommendation: suggestions[0]?.reply || "No suggestions available",
    });
  } catch (error) {
    console.error("Error generating smart reply:", error);
    res.status(500).json({ error: "Failed to generate reply suggestions" });
  }
});

// ============ OBJECTION DETECTION ============
router.post("/detect-objection", requireAuthOrApiKey, async (req: Request<any, any, ObjectionRequestBody>, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { messageText, leadId } = req.body;

    const lead = await storage.getLeadById(leadId);
    if (!lead || lead.userId !== userId) {
        res.status(404).json({ error: "Lead not found" });
        return;
    }
    const objection = await detectObjection(messageText);

    res.json({
      lead_id: leadId,
      ...objection,
      action: `🚨 OBJECTION DETECTED: ${objection.objectType}`,
    });
  } catch (error) {
    console.error("Error detecting objection:", error);
    res.status(500).json({ error: "Failed to detect objection" });
  }
});

// ============ DEAL AMOUNT PREDICTION ============
router.post("/predict-deal", requireAuthOrApiKey, async (req: Request<any, any, DealPredictionRequestBody>, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { lead, messages } = req.body;
    
    // Verify ownership if lead ID provided
    if (lead.id) {
        const dbLead = await storage.getLeadById(lead.id);
        if (!dbLead || dbLead.userId !== userId) {
            res.status(404).json({ error: "Lead not found" });
            return;
        }
    }
    const prediction = await predictDealAmount(lead, messages || []);

    res.json({
      lead_id: lead.id,
      ...prediction,
      expectedCloseDate: prediction.expectedCloseDate?.toISOString(),
      confidence_label: prediction.confidence >= 80 ? "High" : prediction.confidence >= 50 ? "Medium" : "Low",
    });
  } catch (error) {
    console.error("Error predicting deal:", error);
    res.status(500).json({ error: "Failed to predict deal amount" });
  }
});

// ============ CHURN RISK ASSESSMENT ============
router.post("/churn-risk", requireAuthOrApiKey, async (req: Request<any, any, ChurnRiskRequestBody>, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { lead, messages, daysAsCustomer } = req.body;

    // Verify ownership if lead ID provided
    if (lead.id) {
        const dbLead = await storage.getLeadById(lead.id);
        if (!dbLead || dbLead.userId !== userId) {
            res.status(404).json({ error: "Lead not found" });
            return;
        }
    }
    const churnRisk = await assessChurnRisk(lead, messages || [], daysAsCustomer || 0);

    res.json({
      lead_id: lead.id,
      ...churnRisk,
      urgency: churnRisk.churnRiskLevel === "high" ? "🚨 ACT IMMEDIATELY" : "✅ Monitor",
    });
  } catch (error) {
    console.error("Error assessing churn risk:", error);
    res.status(500).json({ error: "Failed to assess churn risk" });
  }
});

// ============ COMPLETE LEAD INTELLIGENCE DASHBOARD ============
router.post("/intelligence-dashboard", requireAuthOrApiKey, async (req: Request<any, any, IntelligenceDashboardRequestBody>, res: Response): Promise<void> => {
  try {
    const { lead, messages } = req.body;
    
    // 1. Fetch latest lead data to check cache
    const userId = getCurrentUserId(req)!;
    const dbLead = await storage.getLead(lead.id);
    if (!dbLead) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }
    if (dbLead.userId !== userId) {
      res.status(403).json({ error: "Forbidden: lead does not belong to you" });
      return;
    }

    const metadata = dbLead.metadata || {};
    const lastMessageAt = dbLead.lastMessageAt ? new Date(dbLead.lastMessageAt).getTime() : 0;
    const intelligenceTimestamp = metadata.intelligenceGeneratedAt ? new Date(metadata.intelligenceGeneratedAt as string).getTime() : 0;

    // 2. Check if cache is valid (generated AFTER the last message)
    if (metadata.intelligence && intelligenceTimestamp > lastMessageAt) {
      console.log(`[Intelligence] Returning cached analysis for lead ${lead.id}`);
      
      const user = await storage.getUser(dbLead.userId);
      const calendarLink = user?.calendarLink || (user?.metadata as any)?.defaultCtaLink;

      res.json({
        lead_id: lead.id,
        ...(metadata.intelligence as any),
        actionContext: {
          calendarLink,
          ctaLink: (user?.metadata as any)?.defaultCtaLink
        },
        cached: true
      });
      return;
    }

    // 3. Generate new intelligence
    console.log(`[Intelligence] Generating FRESH analysis for lead ${lead.id}`);
    const dashboard = await generateLeadIntelligenceDashboard(dbLead as any, messages || []);

    // Fetch user to get calendar link
    const user = await storage.getUser(dbLead.userId);
    const calendarLink = user?.calendarLink || (user?.metadata as any)?.defaultCtaLink;

    // 4. Save to DB
      await storage.updateLead(lead.id, {
        metadata: {
          ...metadata,
          intelligence: dashboard,
          intelligenceGeneratedAt: new Date().toISOString()
        },
        // Blend intent score with existing score rather than replacing it entirely
        score: lead.score ? Math.round((lead.score + (dashboard.intent.intentScore || 0)) / 2) : (dashboard.intent.intentScore || 0)
      });

    res.json({
      lead_id: lead.id,
      ...dashboard,
      actionContext: {
        calendarLink,
        ctaLink: (user?.metadata as any)?.defaultCtaLink
      },
      cached: false
    });
  } catch (error) {
    console.error("Error generating dashboard:", error);
    res.status(500).json({ error: "Failed to generate intelligence dashboard" });
  }
});

// ============ FIND DUPLICATES ============
router.post("/find-duplicates", requireAuthOrApiKey, async (req: Request<any, any, DuplicatesRequestBody>, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { lead, userLeads } = req.body;
    
     // Verify ownership if lead ID provided
    if (lead.id) {
        const dbLead = await storage.getLeadById(lead.id);
        if (dbLead && dbLead.userId !== userId) {
             res.status(404).json({ error: "Lead not found" });
            return;
        }
    }
    const duplicates = await findDuplicateLeads(lead, userLeads || []);

    res.json({
      lead_id: lead.id,
      duplicates_found: duplicates.length,
      duplicates: duplicates.map((d) => ({
        duplicate_lead_id: d.lead.id,
        match_score: d.matchScore,
        match_fields: d.matchFields,
        suggested_action: d.matchScore >= 90 ? "⚠️ MERGE - likely duplicate" : "👀 REVIEW - possible duplicate",
      })),
    });
  } catch (error) {
    console.error("Error finding duplicates:", error);
    res.status(500).json({ error: "Failed to find duplicates" });
  }
});

// ============ COMPANY ENRICHMENT ============
router.post("/enrich-company", requireAuthOrApiKey, async (req: Request<any, any, EnrichCompanyRequestBody>, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { lead } = req.body;
    
    // Check cache first
    const dbLead = await storage.getLead(lead.id);
    if (dbLead && dbLead.userId !== userId) {
         res.status(404).json({ error: "Lead not found" });
         return;
    }
    
    if (dbLead?.metadata?.enrichment) {
      res.json({
        lead_id: lead.id,
        enrichment: dbLead.metadata.enrichment,
        action: "📊 Company data enriched (cached)",
      });
      return;
    }

    const enrichment = await enrichLeadCompany(lead);

    // Save to DB
    if (dbLead) {
      await storage.updateLead(lead.id, {
        metadata: {
          ...dbLead.metadata,
          enrichment
        }
      });
    }

    res.json({
      lead_id: lead.id,
      enrichment,
      action: "📊 Company data enriched - use for personalization",
    });
  } catch (error) {
    console.error("Error enriching company:", error);
    res.status(500).json({ error: "Failed to enrich company data" });
  }
});

// ============ ADD TAG ============
router.post("/tag", requireAuthOrApiKey, async (req: Request<any, any, TagRequestBody>, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { leadId, tagName } = req.body;

    const lead = await storage.getLeadById(leadId);
    if (!lead || lead.userId !== userId) {
        res.status(404).json({ error: "Lead not found" });
        return;
    }
    await addLeadTag(leadId, tagName);

    res.json({
      lead_id: leadId,
      tag_added: tagName,
      message: `✅ Tag "${tagName}" added`,
    });
  } catch (error) {
    console.error("Error adding tag:", error);
    res.status(500).json({ error: "Failed to add tag" });
  }
});

// ============ SET CUSTOM FIELD ============
router.post("/custom-field", requireAuthOrApiKey, async (req: Request<any, any, CustomFieldRequestBody>, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { leadId, fieldName, value } = req.body;

    const lead = await storage.getLeadById(leadId);
    if (!lead || lead.userId !== userId) {
        res.status(404).json({ error: "Lead not found" });
        return;
    }
    await setCustomFieldValue(leadId, fieldName, value);

    res.json({
      lead_id: leadId,
      field_set: fieldName,
      value,
      message: `✅ Custom field "${fieldName}" set`,
    });
  } catch (error) {
    console.error("Error setting custom field:", error);
    res.status(500).json({ error: "Failed to set custom field" });
  }
});

// ============ LOG TIMELINE EVENT ============
router.post("/timeline-event", requireAuthOrApiKey, async (req: Request<any, any, TimelineEventRequestBody>, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { leadId, actionType, actionData, actorId } = req.body;
    
    const lead = await storage.getLeadById(leadId);
    if (!lead || lead.userId !== userId) {
        res.status(404).json({ error: "Lead not found" });
        return;
    }
    await addTimelineEvent(leadId, actionType, actionData, actorId);

    res.json({
      lead_id: leadId,
      action_logged: actionType,
      message: `✅ Timeline event logged`,
    });
  } catch (error) {
    console.error("Error logging timeline:", error);
    res.status(500).json({ error: "Failed to log timeline event" });
  }
});

// ============ GENERATE OPTIMIZED MESSAGE WITH INTELLIGENCE ============
router.post("/generate-message-with-intelligence", requireAuthOrApiKey, async (req: Request<any, any, GenerateMessageRequestBody>, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    const { lead, testimonials, stage } = req.body;
    let { brandContext } = req.body;

    // Fallback: Fetch brand context from user metadata if not provided
    if (!brandContext && userId) {
      const user = await storage.getUser(userId);
      if (user?.metadata) {
        brandContext = user.metadata as BrandContext;
      }
    }

    const intelligence = await generateLeadIntelligenceDashboard(lead, []);

    const salesLeadProfile = {
      id: lead.id,
      name: lead.name,
      firstName: lead.firstName || lead.name.split(" ")[0],
      company: lead.company,
      industry: lead.industry,
      email: lead.email || undefined,
      phone: lead.phone || undefined,
      metadata: lead.metadata,
      userId: lead.userId
    };

    const message = await generateContextAwareMessage(
      salesLeadProfile,
      brandContext || {} as BrandContext,
      testimonials || [],
      []
    );

    res.json({
      lead_id: lead.id,
      message: message.message,
      quality: message.quality,
      intelligence: {
        intent: intelligence.intent.intentLevel,
        predicted_deal: intelligence.predictions.predictedAmount,
        churn_risk: intelligence.churnRisk.churnRiskLevel,
        next_action: intelligence.nextBestAction,
      },
      suggestion: `📧 Send to ${lead.name} → ${intelligence.nextBestAction}`,
    });
  } catch (error) {
    console.error("Error generating message with intelligence:", error);
    res.status(500).json({ error: "Failed to generate message" });
  }
});

// ============ FATHOM CALL HISTORY ============
router.get("/:id/fathom-calls", requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const leadId = req.params.id;

    const lead = await storage.getLeadById(leadId);
    if (!lead || lead.userId !== userId) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }

    const calls = await storage.getFathomCalls(leadId);
    res.json(calls);
  } catch (error) {
    console.error("Error fetching Fathom calls:", error);
    res.status(500).json({ error: "Failed to fetch meeting history" });
  }
});

export default router;

