/**
 * TIER 1: LEAD MANAGEMENT SERVICE
 * 
 * Handles:
 * - Lead Scoring (1-100)
 * - Lead Segmentation
 * - Lead Tags & Custom Fields
 * - Lead Deduplication
 * - Company Enrichment
 * - Activity Timeline
 */

import { generateReply } from './ai-service.js';
import { MODELS } from '../utils/model-config.js';

const isAIConfigured = !!(process.env.ZAI_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY);
import { storage } from '@shared/lib/storage/storage.js';
import type { Lead, Message } from "@audnix/shared";
import type { MessageDirection } from '@shared/types.js';

interface ScoringMessage {
  direction: MessageDirection;
  createdAt: Date | string;
  opened?: boolean;
  clicked?: boolean;
  metadata?: Record<string, unknown>;
}

interface SegmentCriteria {
  scoreMin?: number;
  scoreMax?: number;
  tags?: string[];
  industries?: string[];
  companySize?: string[];
  status?: string[];
}

interface LeadSegment {
  userId: string;
  segmentName: string;
  criteria: SegmentCriteria;
  createdAt: Date;
}

interface TimelineEvent {
  leadId: string;
  actionType: string;
  actionData: Record<string, unknown>;
  actorId?: string;
  timestamp: Date;
}

interface ConversationalStage {
  stage: "needs_identified" | "offer_made" | "invoice_requested" | "payment_sent" | "closed_won" | "unknown";
  buying_intent: "high" | "medium" | "low" | "none";
  objections_present: boolean;
  qualification_score: number;
}

interface CompanyEnrichment {
  company_name: string;
  company_size: string;
  industry: string;
  revenue_estimate: string;
  employee_count: number;
  website: string;
  linkedin_url: string;
  tech_stack: string[];
  competitors: string[];
}

// ============ LEAD SCORING (1-100) ============

export async function calculateLeadScore(lead: Lead, messages: ScoringMessage[] = []): Promise<number> {
  /**
   * Calculate lead score based on:
   * 1. Engagement (replies, opens) = 30%
   * 2. Company quality (size, industry) = 25%
   * 3. Industry fit = 20%
   * 4. Velocity (how fast replying) = 15%
   * 5. Time in pipeline = 10%
   */

  let score = 0;

  // 1. ENGAGEMENT SCORE (30 points)
  const engagementScore = calculateEngagementScore(messages);
  score += engagementScore * 0.3;

  // 2. COMPANY SCORE (25 points)
  const companyScore = calculateCompanyScore(lead);
  score += companyScore * 0.25;

  // 3. INDUSTRY SCORE (20 points)
  const industryScore = calculateIndustryScore(lead);
  score += industryScore * 0.2;

  // 4. VELOCITY SCORE (15 points)
  const velocityScore = calculateVelocityScore(messages);
  score += velocityScore * 0.15;

  // 5. TIME IN PIPELINE (10 points)
  const timeScore = calculateTimeScore(lead);
  score += timeScore * 0.1;

  return Math.min(100, Math.round(score));
}

function calculateEngagementScore(messages: ScoringMessage[]): number {
  if (!messages || messages.length === 0) return 0;

  // Count inbound messages (lead engagement)
  const inboundCount = messages.filter((m: ScoringMessage) => m.direction === "inbound").length;

  // Email opens (if tracked)
  const openCount = messages.filter((m: ScoringMessage) => m.opened).length;

  // Clicks (if tracked)
  const clickCount = messages.filter((m: ScoringMessage) => m.clicked).length;

  // Quick reply (within 2 hours) = high engagement
  const hasQuickReply = messages.some((m: ScoringMessage, i: number) => {
    if (i === 0 || m.direction !== "inbound") return false;
    const prevMessage = messages[i - 1];
    if (!m.createdAt || !prevMessage.createdAt) return false;
    const timeDiff = (new Date(m.createdAt).getTime() - new Date(prevMessage.createdAt).getTime()) / (1000 * 60 * 60);
    return !isNaN(timeDiff) && timeDiff < 2;
  });

  return Math.min(100, inboundCount * 20 + openCount * 10 + clickCount * 10 + (hasQuickReply ? 10 : 0));
}

function calculateCompanyScore(lead: Lead): number {
  let score = 0;

  const metadata = lead.metadata as Record<string, unknown> | null;
  const companySize = typeof metadata?.companySize === 'string' ? metadata.companySize : '';
  const companyWebsite = metadata?.companyWebsite;

  // Company size (larger = higher score)
  const sizeMap: Record<string, number> = {
    "1-10": 20,
    "11-50": 40,
    "51-200": 60,
    "201-500": 75,
    "500+": 100,
  };
  score += sizeMap[companySize] || 30;

  // Company has website / LinkedIn = established company
  if (companyWebsite) score += 15;

  return Math.min(100, score);
}

function calculateIndustryScore(lead: Lead): number {
  /**
   * Industry fit depends on user's focus
   * For now: high-value industries get higher scores
   */

  const highValueIndustries = [
    "technology",
    "finance",
    "healthcare",
    "real estate",
    "e-commerce",
    "saas",
    "consulting",
  ];

  const metadata = lead.metadata as Record<string, unknown> | null;
  const industry = typeof metadata?.industry === 'string' ? metadata.industry.toLowerCase() : '';

  if (highValueIndustries.some((ind: string) => industry.includes(ind))) {
    return 80;
  }

  return 50;
}

function calculateVelocityScore(messages: ScoringMessage[]): number {
  /**
   * Fast repliers = higher engagement
   * Measure: average time between message and reply
   */

  if (!messages || messages.length < 2) return 30;

  let totalTime = 0;
  let replyCount = 0;

  for (let i = 0; i < messages.length; i++) {
    if (messages[i].direction === "inbound" && i > 0) {
      const prevMessage = messages[i - 1];
      if (!messages[i].createdAt || !prevMessage.createdAt) continue;
      const timeDiff = (new Date(messages[i].createdAt).getTime() - new Date(prevMessage.createdAt).getTime()) / (1000 * 60);
      if (isNaN(timeDiff)) continue;
      totalTime += timeDiff;
      replyCount++;
    }
  }

  if (replyCount === 0) return 30;

  const avgTime = totalTime / replyCount;

  // Fast reply (< 30 min) = 100
  // Medium reply (30 min - 4 hours) = 70
  // Slow reply (> 4 hours) = 40
  if (avgTime < 30) return 100;
  if (avgTime < 240) return 70;
  return 40;
}

function calculateTimeScore(lead: Lead): number {
  /**
   * Newer leads might be fresh = higher score
   * Older leads in pipeline = higher score (persistence paying off)
   */

  const daysSinceCreated = (Date.now() - new Date(lead.createdAt).getTime()) / (1000 * 60 * 60 * 24);

  // Sweet spot: 5-30 days = 100 (fresh but with time for engagement)
  if (daysSinceCreated >= 5 && daysSinceCreated <= 30) return 100;
  if (daysSinceCreated < 5) return 60; // Too fresh
  if (daysSinceCreated > 90) return 40; // Too old (might be cold)

  return 70;
}

// ============ LEAD DEDUPLICATION ============

export async function findDuplicateLeads(
  lead: Lead,
  userLeads: Lead[]
): Promise<Array<{ lead: Lead; matchScore: number; matchFields: string[] }>> {
  /**
   * Find potential duplicates based on:
   * 1. Email match = 100%
   * 2. Phone match = 95%
   * 3. Email domain + first name = 80%
   * 4. Company + email domain = 75%
   */

  const duplicates: Array<{ lead: Lead; matchScore: number; matchFields: string[] }> = [];

  // Helper to extract first name from full name
  const getFirstName = (name: string | null): string => {
    if (!name) return '';
    return name.split(' ')[0].toLowerCase();
  };

  // Helper to get company from metadata
  const getCompany = (leadItem: Lead): string => {
    const metadata = leadItem.metadata as Record<string, unknown> | null;
    return typeof metadata?.company === 'string' ? metadata.company.toLowerCase() : '';
  };

  for (const otherLead of userLeads) {
    if (lead.id === otherLead.id) continue;

    let matchScore = 0;
    const matchFields: string[] = [];

    // Email exact match
    if (lead.email && lead.email === otherLead.email) {
      matchScore = 100;
      matchFields.push("email");
    }

    // Phone match
    if (lead.phone && lead.phone === otherLead.phone && lead.phone.length > 5) {
      matchScore = Math.max(matchScore, 95);
      matchFields.push("phone");
    }

    // Email domain + first name match
    if (lead.email && otherLead.email) {
      const leadDomain = lead.email.split("@")[1];
      const otherDomain = otherLead.email.split("@")[1];

      if (leadDomain === otherDomain && getFirstName(lead.name) === getFirstName(otherLead.name)) {
        matchScore = Math.max(matchScore, 80);
        matchFields.push("email_domain", "first_name");
      }
    }

    // Company + email domain match
    const leadCompany = getCompany(lead);
    const otherCompany = getCompany(otherLead);
    if (leadCompany && lead.email && otherCompany && otherLead.email) {
      const leadDomain = lead.email.split("@")[1];
      const otherDomain = otherLead.email.split("@")[1];

      if (leadDomain === otherDomain && leadCompany === otherCompany) {
        matchScore = Math.max(matchScore, 75);
        matchFields.push("company", "email_domain");
      }
    }

    if (matchScore >= 70) {
      duplicates.push({ lead: otherLead, matchScore, matchFields });
    }
  }

  return duplicates.sort((a: { matchScore: number }, b: { matchScore: number }) => b.matchScore - a.matchScore);
}

// ============ LEAD SEGMENTATION ============

export async function createLeadSegment(
  userId: string,
  segmentName: string,
  criteria: SegmentCriteria
): Promise<LeadSegment> {
  /**
   * Create dynamic segment based on criteria
   * Segments auto-update as leads change
   */

  return {
    userId,
    segmentName,
    criteria,
    createdAt: new Date(),
  };
}

export async function getLeadsInSegment(
  _userId: string,
  segmentCriteria: SegmentCriteria,
  allLeads: Lead[]
): Promise<Lead[]> {
  /**
   * Filter leads matching segment criteria
   */

  return allLeads.filter((lead: Lead) => {
    // Score filter
    if (segmentCriteria.scoreMin && (lead.score || 0) < segmentCriteria.scoreMin) return false;
    if (segmentCriteria.scoreMax && (lead.score || 0) > segmentCriteria.scoreMax) return false;

    const metadata = lead.metadata as Record<string, unknown> | null;
    const leadIndustry = typeof metadata?.industry === 'string' ? metadata.industry : '';
    const leadCompanySize = typeof metadata?.companySize === 'string' ? metadata.companySize : '';

    // Industry filter
    if (segmentCriteria.industries && segmentCriteria.industries.length > 0) {
      if (!segmentCriteria.industries.some((ind: string) => leadIndustry.includes(ind))) return false;
    }

    // Company size filter
    if (segmentCriteria.companySize && segmentCriteria.companySize.length > 0) {
      if (!segmentCriteria.companySize.includes(leadCompanySize)) return false;
    }

    return true;
  });
}

const oauth = null; // Placeholder for future use

// AI initialization removed in favor of unified ai-service

// ============ CONVERSATIONAL STAGE QUALIFICATION ============

export async function completeConversationalQualification(lead: Lead): Promise<ConversationalStage> {
  /**
   * Determine the stage of the conversation to know when to drop payment links
   * Score 0-100 (ready to buy = 100)
   */

  try {
    if (!isAIConfigured) {
      throw new Error("AI Providers not initialized");
    }

    // Fetch conversation history
    const messages = await storage.getMessagesByLeadId(lead.id);

    if (messages.length === 0) {
      return {
        stage: "unknown",
        buying_intent: "none",
        objections_present: false,
        qualification_score: 0,
      };
    }

    const conversationText = messages
      .map(m => `${m.direction === 'outbound' ? 'Assistant' : 'Lead'}: ${m.body}`)
      .join('\n');

    const prompt = `Analyze the following conversation and determine the sales stage for this lead.
    
Conversation:
${conversationText}

Criteria:
- stage: What stage is the conversation in? (needs_identified, offer_made, invoice_requested, payment_sent, closed_won)
- buying_intent: Is there explicitly stated buying intent? (high, medium, low, none)
- objections_present: Are there unresolved objections?
- qualification_score: Overall readiness to buy (0-100)

Return JSON only:
{
  "stage": "needs_identified" | "offer_made" | "invoice_requested" | "payment_sent" | "closed_won" | "unknown",
  "buying_intent": "high" | "medium" | "low" | "none",
  "objections_present": boolean,
  "qualification_score": number (0-100)
}`;

    const response = await generateReply(
      'You are a professional sales analyst tracking deal progression.',
      prompt,
      {
        model: MODELS.lead_intelligence,
        jsonMode: true,
        maxTokens: 150,
        temperature: 0.3
      }
    );

    const analysis = JSON.parse(response.text || '{}');

    return {
      stage: analysis.stage || "unknown",
      buying_intent: analysis.buying_intent || "none",
      objections_present: analysis.objections_present || false,
      qualification_score: analysis.qualification_score || 0,
    };
  } catch (error) {
    console.error('Qualification error:', error);
    return {
      stage: "unknown",
      buying_intent: "none",
      objections_present: false,
      qualification_score: 0,
    };
  }
}

// ============ LEAD COMPANY ENRICHMENT ============

export async function enrichLeadCompany(lead: Lead): Promise<CompanyEnrichment> {
  /**
   * Enrich lead with company data
   * In production: integrate with Clearbit, Hunter, etc.
   */

  const emailDomain = lead.email?.split("@")[1] || '';
  const metadata = lead.metadata as Record<string, unknown> | null;
  const company = typeof metadata?.company === 'string' ? metadata.company : (lead.company || '');
  const companySize = typeof metadata?.companySize === 'string' ? metadata.companySize : 'unknown';
  const industry = typeof metadata?.industry === 'string' ? metadata.industry : 'unknown';
  const revenue = typeof metadata?.revenue === 'string' ? metadata.revenue : 'unknown';
  const employees = typeof metadata?.employees === 'number' ? metadata.employees : 0;

  return {
    company_name: company,
    company_size: companySize,
    industry: industry,
    revenue_estimate: revenue,
    employee_count: employees,
    website: emailDomain ? `https://${emailDomain}` : "",
    linkedin_url: typeof metadata?.linkedin_url === 'string' ? metadata.linkedin_url : "",
    tech_stack: Array.isArray(metadata?.tech_stack) ? metadata.tech_stack : [],
    competitors: Array.isArray(metadata?.competitors) ? metadata.competitors : [],
  };
}

// ============ ACTIVITY TIMELINE ============

export async function addTimelineEvent(
  leadId: string,
  actionType: string,
  actionData: Record<string, unknown>,
  actorId?: string
): Promise<void> {
  console.log(`📝 Timeline: Lead ${leadId} - ${actionType}`, actionData);

  try {
    const lead = await storage.getLead(leadId);
    if (!lead) return;

    await storage.createAuditLog({
      leadId,
      userId: lead.userId,
      action: actionType,
      details: actionData
    });
  } catch (error) {
    console.error(`Failed to add timeline event for lead ${leadId}:`, error);
  }
}

export async function getLeadTimeline(leadId: string): Promise<TimelineEvent[]> {
  try {
    const lead = await storage.getLead(leadId);
    if (!lead) return [];
    
    const logs = await storage.getAuditLogs(lead.userId);
    return logs.filter(log => log.leadId === leadId).map(log => ({
      leadId: leadId,
      actionType: log.action,
      actionData: log.details as Record<string, unknown>,
      actorId: log.userId,
      timestamp: log.createdAt
    }));
  } catch (error) {
    console.error(`Failed to get timeline for lead ${leadId}:`, error);
    return [];
  }
}

// ============ LEAD TAGS & CUSTOM FIELDS ============

export async function addLeadTag(leadId: string, tagName: string): Promise<void> {
  console.log(`🏷️ Tagged: Lead ${leadId} with "${tagName}"`);
  try {
    const lead = await storage.getLead(leadId);
    if (lead) {
      const tags = lead.tags || [];
      if (!tags.includes(tagName)) {
        tags.push(tagName);
        await storage.updateLead(leadId, { tags });
      }
    }
  } catch (error) {
    console.error(`Failed to add tag to lead ${leadId}:`, error);
  }
}

export async function setCustomFieldValue(leadId: string, fieldName: string, value: unknown): Promise<void> {
  console.log(`📋 Custom field: Lead ${leadId} - ${fieldName} = ${value}`);
  try {
    const lead = await storage.getLead(leadId);
    if (lead) {
      const metadata = (lead.metadata || {}) as Record<string, unknown>;
      metadata[fieldName] = value;
      await storage.updateLead(leadId, { metadata });
    }
  } catch (error) {
    console.error(`Failed to set custom field for lead ${leadId}:`, error);
  }
}




