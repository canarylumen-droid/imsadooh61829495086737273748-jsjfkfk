import { MODELS } from "../utils/model-config.js";
import { storage } from '@shared/lib/storage/storage.js';
import type { Message, Lead } from "@audnix/shared";
import { storeConversationMemory, retrieveConversationMemory } from "../context/super-memory.js";
import { detectLanguage, getLocalizedResponse, updateLeadLanguage, type LanguageDetection } from './language-detector.js';
import { detectPriceObjection, saveNegotiationAttempt, generateNegotiationResponse, type PriceObjectionResult } from '../specialized/price-negotiation.js';
import { detectCompetitorMention, trackCompetitorMention, type CompetitorMentionResult } from '../analyzers/competitor-detection.js';
import { optimizeSalesLanguage } from '../formatters/sales-language-optimizer.js';
import { getBrandContext, formatBrandContextForPrompt } from '../context/brand-context.js';
import { appendLinkIfNeeded, detectAndGenerateLinkResponse } from '../analyzers/link-intent-detector.js';
import { BookingProposer } from '@shared/lib/calendar/booking-proposer.js';
import { analyzeLeadIntent, type IntentAnalysis } from '../analyzers/intent-analyzer.js';
import { generateAutonomousObjectionResponse } from '../analyzers/autonomous-objection-responder.js';
import { universalSalesAI } from "@services/brain-worker/src/orchestrator/agents/universal-sales-agent.js";
import { billingAgent } from "@services/brain-worker/src/orchestrator/agents/billing-agent.js";
import { evaluateAndLogDecision } from '../engines/decision-engine.js';
import { formatReplyForChannel } from '../formatters/channel-reply-formatter.js';
import { workerHealthMonitor } from '@shared/lib/monitoring/worker-health.js';
import { quotaService } from '@shared/lib/monitoring/quota-service.js';
import { getOAuthRedirectUrl } from "@shared/config/config/oauth-redirects.js";
import { encrypt, decrypt } from '@shared/lib/crypto/encryption.js';
import { db } from '@shared/lib/db/db.js';
import { users, integrations, notifications } from '@audnix/shared';
import { eq, and } from 'drizzle-orm';
import { generateReply, estimateTokens } from './ai-service.js';
import { getStyleMarkers, type StyleMarkers } from '../context/personality-learner.js';
import { getCalendlyPrefillLink } from '@shared/lib/integrations/calendly.js';
import { getLeadProfile } from '@shared/lib/calendar/lead-timezone-intelligence.js';
import { calculateSimilarity } from '../utils/utils.js';
import { getRegionalInstruction } from '../specialized/regional-norms.js';
import { objectionService } from '../analyzers/objection-service.js';
import { searchSimilarChunks } from '../context/vector-rpc.js';
import { videoMonitors } from '@audnix/shared';
import { HallucinationGuard } from './hallucination-guard.js';
import { handleLanguageDetection, localizeAndOptimize } from '../utils/language-util.js';
import { handleObjection } from '../utils/objection-handler.js';
import { getCustomKnowledge } from '@shared/lib/storage/custom-training-storage.js';
import {
  processObjection,
  recordTacticSent,
  classifyObjectionFromText,
  estimateObjectionIntensity,
  type ObjectionCategory,
} from '@shared/lib/intelligence/objection-state-machine.js';

const isDemoMode = false;
const PROMPT_VERSION = 'v1.3.0-osm';

/**
 * Detect if lead is actively engaged (replying immediately)
 */
export function isLeadActivelyReplying(messages: Message[]): boolean {
  if (messages.length < 2) return false;

  const lastTwoMessages = messages.slice(-2);
  const lastMessage = lastTwoMessages[1];
  const previousMessage = lastTwoMessages[0];

  if (!lastMessage || !previousMessage) return false;

  if (lastMessage.direction !== 'inbound') return false;

  const timeDiff = new Date(lastMessage.createdAt).getTime() - new Date(previousMessage.createdAt).getTime();
  const minutesDiff = timeDiff / (1000 * 60);

  return minutesDiff < 5;
}

/**
 * Calculate intelligent delay based on lead activity and behavior
 * Also considers DM-per-hour limits for Instagram (20/hour = 3min minimum between DMs)
 *
 * Active leads (replying immediately): 50s-1min
 * Normal replies: 3-8 minutes (respects Instagram 20/hour limit)
 * Follow-ups: 6-12 hours
 */
export function calculateReplyDelay(
  messageType: 'reply' | 'followup',
  messages: Message[] = [],
  channel?: string
): number {
  if (messageType === 'followup') {
    const baseHours = 6 + Math.random() * 6;
    const randomMinutes = Math.random() * 60;
    return (baseHours * 60 * 60 + randomMinutes * 60) * 1000;
  }

  const isActive = isLeadActivelyReplying(messages);
  const minDelayForInstagram = channel === 'instagram' ? 3 * 60 * 1000 : 0;

  if (isActive) {
    const baseSeconds = 50 + Math.random() * 10;
    const delay = baseSeconds * 1000;

    if (channel === 'instagram' && delay < minDelayForInstagram) {
      console.log(`🔥 Lead is actively engaged but respecting Instagram limit - replying in 3min`);
      return minDelayForInstagram;
    }

    console.log(`🔥 Lead is actively engaged - replying in ${Math.round(baseSeconds)}s`);
    return delay;
  } else {
    const baseMinutes = Math.max(3, 2 + Math.random() * 6);
    const randomSeconds = Math.random() * 60;
    // Standard delay for human-like response (2-4 minutes)
    const delay = Math.floor(Math.random() * (240000 - 120000 + 1) + 120000);
    return delay;
  }
}

/**
 * Determine if a lead is "warm" based on engagement
 */
export function assessLeadWarmth(messages: Message[], lead: Lead): boolean {
  if (messages.length < 3) return false;

  const inboundCount = messages.filter(m => m.direction === 'inbound').length;

  if (inboundCount >= 2) return true;

  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) return false;

  const hoursSinceLastMessage = (Date.now() - new Date(lastMessage.createdAt).getTime()) / (1000 * 60 * 60);

  if (hoursSinceLastMessage < 24 && inboundCount >= 1) return true;

  return false;
}

/**
 * Automatically update lead status in database based on conversation analysis
 */
export async function autoUpdateLeadStatus(
  leadId: string,
  messages: Message[]
): Promise<void> {
  const statusDetection = detectConversationStatus(messages);

  if (statusDetection.confidence < 0.7) {
    console.log(`⚠️ Low confidence (${statusDetection.confidence}) - skipping auto-update for lead ${leadId}`);
    return;
  }

  try {
    const lead = await storage.getLeadById(leadId);
    if (!lead) return;

    // TERMINAL STATE GUARD: never overwrite these statuses or reset aiPaused.
    // 'qualified' and 'converted' are human hand-off states set by the sequence killer.
    // 'booked' is protected further below. Touching any of these here would undo the kill.
    const TERMINAL_STATES = ['qualified', 'converted', 'booked'];
    if (TERMINAL_STATES.includes(lead.status)) {
      console.log(`[autoUpdateLeadStatus] Skipping — lead ${leadId} is in terminal state '${lead.status}'`);
      return;
    }

    const userResults = await db.select().from(users).where(eq(users.id, lead.userId)).limit(1);
    const oldStatus = lead.status;
    const newStatus = statusDetection.status;

    if (oldStatus === 'booked' && newStatus !== 'booked') {
      return;
    }

    if (oldStatus !== newStatus) {
      await storage.updateLead(leadId, {
        status: newStatus,
        aiPaused: false, // ENSURE AI is NOT paused on reply for autonomous mastery
        metadata: {
          ...(lead.metadata as Record<string, unknown> || {}),
          statusAutoUpdated: true,
          statusUpdateReason: statusDetection.reason,
          statusUpdateConfidence: statusDetection.confidence,
          previousStatus: oldStatus,
          statusUpdatedAt: new Date().toISOString()
        }
      });

      console.log(`✅ Auto-updated lead ${leadId} status: ${oldStatus} → ${newStatus} (AI Active)`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to auto-update lead status:', errorMessage);
  }
}

export interface ConversationStatusResult {
  status: "new" | "contacted" | "replied" | "booked" | "not_interested" | "cold" | "warm";
  confidence: number;
  reason?: string;
  shouldUseVoice?: boolean;
}

export interface AIReplyResult {
  text: string;
  useVoice: boolean;
  blocked?: boolean;
  blockedReason?: string;
  detections?: any;
  metadata?: any;
}

export interface MemoryRetrievalResult {
  success: boolean;
  context?: string;
  conversations?: any[];
  metadata?: any;
}

// Brand section is dynamically generated below

/**
 * Detect conversation intent and update lead status automatically
 */
export function detectConversationStatus(messages: Message[]): ConversationStatusResult {
  if (messages.length === 0) {
    return { status: 'new', confidence: 1.0 };
  }

  const recentMessages = messages.slice(-5);
  const allText = recentMessages.map(m => m.body.toLowerCase()).join(' ');

  const conversionKeywords = ['yes', 'book', 'schedule', 'ready', 'let\'s do it', 'sign me up', 'interested', 'when can we'];
  const hasConversionSignal = conversionKeywords.some(keyword => allText.includes(keyword));

  const rejectionKeywords = ['not interested', 'no thanks', 'remove me', 'stop', 'unsubscribe', 'leave me alone'];
  const hasRejection = rejectionKeywords.some(keyword => allText.includes(keyword));

  const hasEngagement = messages.filter(m => m.direction === 'inbound').length >= 2;
  const recentEngagement = messages.filter(m => {
    const hoursSince = (Date.now() - new Date(m.createdAt).getTime()) / (1000 * 60 * 60);
    return hoursSince < 24 && m.direction === 'inbound';
  }).length > 0;

  if (hasRejection) {
    return { status: 'not_interested', confidence: 0.9, reason: 'Lead explicitly declined', shouldUseVoice: false };
  }

  if (hasConversionSignal && hasEngagement) {
    return { status: 'booked', confidence: 0.85, reason: 'Lead showed strong buying intent', shouldUseVoice: true };
  }

  if (recentEngagement || hasEngagement) {
    return { status: 'warm', confidence: 0.8, reason: 'Lead actively responding', shouldUseVoice: true };
  }

  const lastInbound = messages.filter(m => m.direction === 'inbound').pop();
  if (lastInbound) {
    const daysSince = (Date.now() - new Date(lastInbound.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > 7) {
      return { status: 'cold', confidence: 0.75, reason: 'No response in 7+ days', shouldUseVoice: false };
    }
  }

  return { status: 'new', confidence: 0.6, shouldUseVoice: false };
}

/**
 * Generate AI response with platform-specific tone
 * Now includes brand context and personalized responses
 */
export async function generateAIReply(
  lead: Lead,
  conversationHistory: Message[],
  platform: 'instagram' | 'email',
  userContext?: { 
    businessName?: string; 
    brandVoice?: string;
    calendarLink?: string;
    isCalendlyConnected?: boolean;
    calendlyUserUri?: string;
    systemPromptSuffix?: string;
  }
): Promise<AIReplyResult> {

  if (isDemoMode) {
    throw new Error("Intelligence Engine Disconnected: System requires live API key for real-time inference.");
  }

  const personaId = (lead.metadata as any)?.personaId;
  const lastLeadMessage = conversationHistory.filter(m => m.direction === 'inbound').pop();

  // ─── PARALLEL CONTEXT GATHERING (Phase 2) ────────────────────────────────
  const [
    brandContext,
    user,
    memoryResult,
    memoryMessages,
    styleMarkers,
    ragChunks,
    intent,
    leadTzProfile,
    customKnowledge,
    customObjectionsPrompt
  ] = await Promise.all([
    getBrandContext(lead.userId, personaId).catch(() => ({}) as any),
    storage.getUserById(lead.userId).catch(() => null),
    retrieveConversationMemory(lead.userId, lead.id).catch(() => ({ context: '', lastTactic: null, successfulTactics: [] }) as any),
    getConversationContext(lead.userId, lead.id).catch(() => [] as any),
    getStyleMarkers(lead.userId).catch(() => ({})),
    lastLeadMessage ? searchSimilarChunks(lastLeadMessage.body, lead.userId, 4).catch(() => []) : Promise.resolve([]),
    lastLeadMessage ? analyzeLeadIntent(lastLeadMessage.body, {
      id: lead.id,
      name: lead.name || "Lead",
      channel: lead.channel,
      status: lead.status,
      tags: lead.tags || []
    }).catch(() => null) : Promise.resolve(null),
    getLeadProfile(lead.id).catch(() => null),
    getCustomKnowledge(lead.userId).catch(() => null),
    objectionService.formatCustomObjectionsForPrompt(lead.userId).catch(() => '')
  ]);

  // ─── NICHE + TIMEZONE INTELLIGENCE ───────────────────────────────────────
  const leadLocalTz   = leadTzProfile?.detectedTimezone || 'unknown local time';
  const leadNiche     = leadTzProfile?.niche || (lead.metadata as any)?.niche || (lead.metadata as any)?.industry || 'their industry';
  const leadCity      = leadTzProfile?.detectedCity || (lead as any).city || null;
  const preferredWindowStart = leadTzProfile?.preferredContactStart ?? 10;
  const preferredWindowEnd   = leadTzProfile?.preferredContactEnd   ?? 18;

  // --- DEDUPLICATION CONTEXT ---
  const lastOutbound = conversationHistory.filter(m => m.direction === 'outbound').pop();
  const lastOutboundBody = lastOutbound?.body || "";

  // ─── BOOKED LEAD HARD-BLOCK ───────────────────────────────────────────────
  // Booked leads receive ZERO AI messages — only reminders (handled by meeting-reminder-worker)
  if (lead.status === 'booked') {
    console.log(`[ConversationAI] 🔒 Lead ${lead.id} is BOOKED — blocking AI reply. Reminders only.`);
    return {
      text: '', // Empty string = caller must NOT send this message
      useVoice: false,
      blocked: true,
      blockedReason: 'booked'
    };
  }

  // Dynamic brand PDF processing: incorporate extracted text into system prompt
  const pdfText = user?.brandGuidelinePdfText || '';
  const brandVoice = (brandContext as any)?.tone || (brandContext as any)?.brandVoice || '';
  const brandGuidelines = pdfText || brandVoice || formatBrandContextForPrompt(brandContext) || "No specific brand guidelines provided.";

  // Full rich brand context (includes business description, UVP, positioning, persona, etc.)
  const fullBrandContext = formatBrandContextForPrompt(brandContext);
  const enrichedBrandContext = fullBrandContext && !brandGuidelines.includes(fullBrandContext)
    ? `\n\n## FULL BRAND CONTEXT (Rich Profile)\n${fullBrandContext}`
    : '';

  // Supplement with S3-backed custom training knowledge base
  let customKnowledgeContext = '';
  if (customKnowledge) {
    const ck = customKnowledge;
    if (ck.businessName || ck.brandVoice || ck.coreOffer || ck.customInstructions || (ck.faqs && ck.faqs.length > 0)) {
      customKnowledgeContext = `
### CUSTOM USER TRAINING KNOWLEDGE BASE (High Priority)
Business Name: ${ck.businessName || "N/A"}
Brand Voice / Tone: ${ck.brandVoice || "N/A"}
Core Offer Details: ${ck.coreOffer || "N/A"}
Custom Instructions: ${ck.customInstructions || "N/A"}
${ck.faqs && ck.faqs.length > 0 ? `Frequently Asked Questions:\n${ck.faqs.map((f: any) => `- Q: "${f.question}"\n  A: "${f.answer}"`).join('\n')}` : ''}
`;
    }
  }

  const isWarm = assessLeadWarmth(conversationHistory, lead);
  const detectionResult = detectConversationStatus(conversationHistory);

  const allMessages = [...memoryMessages, ...conversationHistory];

  // --- BRAND RAG (Semantic Retrieval) ---
  let ragContext = "";
  if (ragChunks.length > 0) {
    ragContext = `[RELEVANT BRAND KNOWLEDGE]:\n${ragChunks.map(c => `- ${c.content}`).join('\n')}`;
  }

  // --- [STRATEGY] PROCEDURAL MEMORY INJECTION ---
  let dynamicStrategySupplement = '';
  let leadProceduralMemory = '';
  const campaignId = (lead.metadata as any)?.campaignId;
  
  if (campaignId) {
    try {
      const [campaign, leadMem] = await Promise.all([
        storage.getOutreachCampaign(campaignId),
        storage.getCampaignLeadProceduralMemory(campaignId, lead.id)
      ]);

      if (campaign?.proceduralMemory) {
        const campMem = campaign.proceduralMemory as any;
        if (campMem.dynamicStrategySupplement) {
          dynamicStrategySupplement = campMem.dynamicStrategySupplement;
        }
      }
      
      leadProceduralMemory = leadMem?.strategy || (typeof leadMem === 'string' ? leadMem : '');
    } catch (memErr) {
      console.warn("[ConversationAI] Failed to fetch procedural memory:", memErr);
    }
  }

  // --- OBJECTION STATE MACHINE (PHASE 52+) ---
  // Multi-objection cross-conversation intelligence.
  // Replaces single-shot handler — every objection is aware of the full history,
  // never repeats a failed tactic, escalates intelligently, and injects a rich
  // priority context block into the main system prompt.
  const winningPlaybook = objectionService.formatPlaybookForPrompt(lead.userId);
  let objectionStateBlock = '';
  let objectionDecision: any = null;

  if (intent?.hasObjection || intent?.isNegative) {
    try {
      const rawText = lastLeadMessage?.body || '';
      const { category } = classifyObjectionFromText(rawText);
      const intensity = estimateObjectionIntensity(rawText);

      // Use AI-detected hidden objection if available, else use category
      const hiddenObjection =
        (intent as any)?.hiddenObjection ||
        (intent as any)?.objectionReason ||
        `${category} concern: ${rawText.substring(0, 80)}`;

      objectionDecision = await processObjection({
        leadId: lead.id,
        userId: lead.userId,
        leadName: lead.name || 'the lead',
        objectionText: rawText,
        category: category as ObjectionCategory,
        hiddenObjection,
        intensity,
        businessContext: {
          businessName: brandContext.companyName,
          coreOffer: brandContext.offer || (customKnowledge as any)?.coreOffer || 'our services',
          userIndustry: brandContext.industry || 'our industry',
          leadNiche: leadNiche,
          prioritizeCalls: (user?.config as any)?.prioritizeCalls !== false
        }
      });

      objectionStateBlock = objectionDecision.systemPromptBlock;

      // If flagged for human review, create a notification and still generate
      // one final reply — the AI will use the 'final_push' tactic
      if (objectionDecision.shouldFlagForHuman) {
        storage.createNotification({
          userId: lead.userId,
          type: 'system',
          title: '🧠 Lead Needs Human Touch',
          message: `${lead.name} has objected ${objectionDecision.state.totalObjections} times. AI has exhausted major tactics. Time for a human rep to step in.`,
          metadata: {
            leadId: lead.id,
            objectionState: objectionDecision.state,
            actionUrl: `/dashboard/inbox?leadId=${lead.id}`
          }
        }).catch((notifErr) => console.error('[ConversationAI] Failed to create notification:', notifErr));
      }
    } catch (osmErr: any) {
      console.error('[ConversationAI] Objection state machine failed, falling back to legacy handler:', osmErr.message);
      // Graceful fallback to the old single-shot handler
      const objectionResponse = await handleObjection(lastLeadMessage?.body || '', {
        userId: lead.userId,
        leadName: lead.name || 'there',
        leadIndustry: (lead.metadata?.industry as string) || 'general',
        previousMessages: allMessages,
        brandName: (brandContext as any)?.businessName || 'Our platform',
        userIndustry: (brandContext as any)?.industry || 'all'
      });
      return {
        text: objectionResponse.response,
        useVoice: false,
        detections: intent
      };
    }
    // NOTE: We do NOT return early here — we fall through to the main generation
    // flow so the objectionStateBlock is injected into the full system prompt,
    // giving the reply the benefit of deduplication + hallucination guards too.
  }

  // --- OOO & WRONG PERSON HANDLING (PHASE 30) ---
  if (intent?.isOOO) {
    console.log(`[ConversationAI] 🌴 OOO detected for lead ${lead.id}. Blocking AI response for rescheduling.`);
    return {
      text: '',
      useVoice: false,
      blocked: true,
      blockedReason: 'ooo',
      detections: intent
    };
  }

  if (intent?.isWrongPerson || (intent?.isNegative && (intent?.confidence || 0) > 0.9 && /wrong|not me|not the person/i.test(lastLeadMessage?.body || ""))) {
    console.log(`[ConversationAI] 👤 "Wrong Person" detected for lead ${lead.id}. Closing lead.`);
    await storage.updateLead(lead.id, { 
      status: 'not_interested',
      metadata: { 
        ...(lead.metadata as any || {}), 
        closedReason: 'wrong_person',
        closedAt: new Date().toISOString()
      }
    });
    return {
      text: '', // In case we want to send a "sorry" message, but usually better to stop
      useVoice: false,
      blocked: true,
      blockedReason: 'wrong_person',
      detections: intent
    };
  }

  // --- STRATEGIC DECISION LOGGING ---
  if (intent) {
    await evaluateAndLogDecision({
      userId: lead.userId,
      leadId: lead.id,
      actionType: intent.wantsToSchedule ? 'calendar_booking' : 'dm_sent',
      intentScore: (intent.confidence || 0) * 100,
      timingScore: 80, // Default for active conversation
      confidence: intent.confidence || 0,
      metadata: { intent }
    });
  }

  const enrichedContext = memoryResult.context
    ? `\n\nCONVERSATION INSIGHTS:\n${memoryResult.context}`
    : '';

  // Phase 23: Dynamic Context Pruning based on estimated tokens (Budget: 3,000 tokens)
  const CONTEXT_TOKEN_BUDGET = 3000;
  
  // ─── NICHE + TIMEZONE INTELLIGENCE ───────────────────────────────────────
  // (leadLocalTz, leadNiche, leadCity, preferredWindowStart, preferredWindowEnd are declared above)


  const leadIntelContext = `
LEAD PROFILE:
- Name: ${lead.name}
- Role: ${lead.role || 'Prospect'}
- Company: ${lead.company || 'Unknown'}
- Niche/Industry: ${leadNiche}
- City: ${leadCity || 'Unknown'}
- Channel: ${platform}
- Warmth: ${isWarm ? 'Warm – actively engaged' : 'Cold – early outreach'}
- Message count: ${conversationHistory.length}

KNOWN SCHEDULING INTELLIGENCE (do NOT disclose to lead):
- Their preferred contact window: ${preferredWindowStart}:00–${preferredWindowEnd}:00 local
- Use this window when suggesting meeting times
- Say "5pm your time" not "17:00 Africa/Lagos" — NEVER expose timezone names
- Suggest times like: "How does Thursday at 5pm work for you?"
`;

  const stylePrompt = intent?.style ? `[STYLE INSTRUCTION]\nMirror their ${intent.style} style.` : '';
  const emotionPrompt = intent?.emotion ? `[EMOTION INSTRUCTION]\nAcknowledge their ${intent.emotion} emotion.` : '';

  let currentTokenCount = estimateTokens(enrichedContext + stylePrompt + emotionPrompt + leadIntelContext);
  const messageContext: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  
  // Iterate backwards through history to fit within budget
  for (let i = allMessages.length - 1; i >= 0; i--) {
    const msg = allMessages[i];
    const msgTokens = estimateTokens(msg.body);
    if (currentTokenCount + msgTokens > CONTEXT_TOKEN_BUDGET) break;
    
    messageContext.unshift({
      role: msg.direction === 'inbound' ? 'user' : 'assistant',
      content: msg.body
    });
    currentTokenCount += msgTokens;
  }

  // --- STYLE & EMOTION INJECTION ---
  const platformTone: Record<string, string> = {
    instagram: 'casual, friendly, and conversational (NO emojis)',
    email: 'professional yet approachable, well-structured'
  };

  // ─── PHASE 53: PERSONALIZED MEDIA REFERENCE ──────────────────────────────
  let mediaInstruction = "";
  if (lead.score >= 90) {
    const activeVideos = await db.select().from(videoMonitors).where(eq(videoMonitors.userId, lead.userId)).limit(3);
    if (activeVideos.length > 0) {
      mediaInstruction = `
[PHASE 53] PERSONALIZED MEDIA ASSETS:
This is a High-Value lead. Use a personalized approach. 
If it feels natural (e.g. "I'd love to see a demo" or "How does this work?"), reference this video breakdown:
${activeVideos.map((v: any) => `- "${v.ctaText}": ${v.videoUrl}`).join('\n')}
Say something like: "I actually made a quick video breakdown showing exactly how we handle this: ${activeVideos[0].videoUrl}"
`;
    }
  }

  // ─── PHASE 51: CROSS-CHANNEL NARRATIVE ───────────────────────────────────
  const crossChannelHistory = allMessages.filter(m => m.provider !== platform && m.provider !== 'system');
  const narrativeSummary = crossChannelHistory.length > 0
    ? `\n[PHASE 51] CROSS-CHANNEL NARRATIVE HISTORY:\n` +
      crossChannelHistory.slice(-3).map(m => `- [${m.provider.toUpperCase()}]: ${m.body}`).join('\n') +
      `\nYou MUST ensure this reply fits the narrative established on other channels.`
    : '';

  // ─── STATUS-AWARE DYNAMIC PROMPT BUILDER ─────────────────────────────────
  const STATUS_PLAYBOOK: Record<string, string> = {
    new: `You're opening a fresh conversation. The recipient has NOT replied before.
Your job: Break the ice, earn attention, understand their situation.
Do NOT push for a specific outcome yet. Ask ONE smart, relevant question.
Be curious and direct. 2 sentences max.`,

    open: `Conversation is active but still early. They may have replied 1-2 times.
If you've exchanged 2+ messages: suggest a natural next step (a call, a meeting, sending info, etc.) based on the brand context.
If early stage: ask a sharper question, understand their needs.
Be direct. Never pad. 2-3 sentences.`,

    replied: `The recipient is responding and engaged.
Move toward the natural next step for THIS context. If the brand context suggests a call or meeting, suggest a specific time. If it's about sharing information, offer to send it. Match their energy. Be confident and human.`,

    warm: `High engagement. Clear interest signals.
Be direct about the next step as defined by the brand context — a call, a meeting, a proposal, a partnership discussion.
Suggest 1-2 specific options. Use their time window.
No fluff. Pure forward motion.`,

    cold: `Recipient has gone quiet (3+ days no reply).
Light touch — do NOT push hard. Pique curiosity.
One short message: something interesting, a relevant observation, or a thoughtful question.
1-2 sentences. Feel like a real human checking in, not a sequence resuming.`,

    no_show: `Recipient missed a scheduled appointment.
Don't shame them. Acknowledge it gracefully and make rescheduling feel easy.
Example: "Looks like something came up — no worries. Want to find another time that works?"
Keep it light, low pressure. 1-2 sentences.`,

    canceled: `Recipient cancelled their commitment.
Don't pressure. Be understanding, open the door softly.
Example: "All good — things happen. Whenever it makes sense, I'm here."
Offer 1 easy next step if appropriate. No hard pushing.`,

    not_interested: `Recipient has indicated they are not interested.
Send ONE final graceful message. Leave the door open for the future.
Example: "Totally understand — I'll leave you to it. If things change, you know where to find me."
Do NOT try to convince them otherwise. Respect their decision.`,

    hardened: `Recipient has been contacted multiple times and is resistant.
Last resort: minimal contact, maximum value. Share something genuinely useful.
NO ask. Just a resource, an insight, or a relevant observation.
If no response after this, stop the cadence.`,

    recovered: `Recipient was cold/lost and has now re-engaged.
Treat like an engaged lead. Jump back in with energy.
Reference what you discussed before if relevant. Move toward the appropriate next step.
Show you're glad they're back — subtly.`,

    booked: `SYSTEM STOP: This person has a confirmed commitment. No AI message should ever reach them.
Only reminders are authorised. Do not generate a response.`,
  };

  const currentStatus = lead.status || 'new';
  const statusInstruction = STATUS_PLAYBOOK[currentStatus] || STATUS_PLAYBOOK['contacted'];

  // --- GLOBAL LOCALIZATION (Phase 32) ---
  const languageCode = intent?.languageCode || 'en';
  const languageMap: Record<string, string> = {
    'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German',
    'it': 'Italian', 'pt': 'Portuguese', 'zh': 'Mandarin Chinese',
    'ar': 'Arabic', 'hi': 'Hindi'
  };
  const languageName = languageMap[languageCode] || 'English';

  const languageInstruction = languageCode !== 'en'
    ? `\n\n[GLOBAL LOCALIZATION]: The lead is communicating in ${languageName}. You MUST respond entirely in ${languageName}. Maintain the brand's tone, professionalism, and voice rules natively in ${languageName}. Use cultural business idioms, not literal translations.`
    : "";

  const regionalInstruction = getRegionalInstruction(intent?.detectedCountry || null);

  const inboundCount = conversationHistory.filter(m => m.direction === 'inbound').length;
  const shouldPushBooking = (currentStatus === 'contacted' && inboundCount >= 2) || currentStatus === 'replied' || currentStatus === 'warm';

  const systemPrompt = `## IDENTITY
You are an elite B2B sales closer and outreach expert. You write like a real human — sharp, confident, and impossible to ignore. Your job is to turn conversations into booked meetings, demo calls, or signed deals. You adapt your style when the user provides specific brand guidelines below.

## 🚨 PRIORITY HIERARCHY (FOLLOW THIS ORDER STRICTLY)
When sections below conflict, higher priority always wins:
1. **CUSTOM USER TRAINING** (highest) — User-defined brand voice, offers, FAQs, custom instructions
2. **CUSTOM OBJECTION/CONCERN RULES** — User-defined handling rules for common concerns
3. **BRAND GUIDELINES / BRAND PDF** — Brand voice, tone, business description, industry
4. **LEAD CONTEXT & RAG** — Lead data, conversation history, brand knowledge search
5. **GENERAL RULES** — Anti-hallucination, formatting, length constraints
6. **DEFAULT B2B SALES BEST PRACTICES** — Used when no brand guidelines or custom training are provided

${objectionStateBlock ? objectionStateBlock + '\n\n' : ''}${ragContext}

${customKnowledgeContext ? `
## 🏆 CUSTOM USER TRAINING — HIGHEST PRIORITY
${customKnowledgeContext}
` : ''}
${customObjectionsPrompt || ''}

${enrichedBrandContext}

${brandGuidelines !== "No specific brand guidelines provided." ? `
## BRAND GUIDELINES (FOLLOW EXACTLY)
${brandGuidelines}
` : ''}

${(brandContext as any)?.brandSnippets?.length > 0
  ? `## KEY BRAND MESSAGES (USE THESE NATURALLY):\n${(brandContext as any).brandSnippets.map((s: string) => `- ${s}`).join('\n')}`
  : ''}

${leadIntelContext}

${stylePrompt}

${emotionPrompt}

${languageInstruction}

${regionalInstruction}

## LEAD PRIORITY & STATUS
Priority: ${lead.score >= 85 ? 'PRIMARY (A) - Hot lead. High value. Move toward booking/close aggressively.' : lead.score >= 60 ? 'STANDARD (B) - Good potential. Nurture with value and build trust.' : 'LOW (C) - Early stage. Establish rapport and uncover needs.'}
Score: ${lead.score}/100

## PLATFORM & TONE
Channel: ${platform} — Tone: ${platformTone[platform]}

## CURRENT SITUATION PLAYBOOK (FOLLOW THIS EXACTLY)
Lead Status: ${currentStatus.toUpperCase()}
${statusInstruction}

${shouldPushBooking || brandGuidelines === "No specific brand guidelines provided."
  ? `## BOOKING INSTRUCTION (LEAD IS READY)
- Propose a specific day+time from their time window
- Examples: "How does Thursday at 5pm work?" or "Are you free Wednesday around 6pm? — 20 minutes max"
- NEVER say "slot available" — sound like a real human
- Keep it conversational, not transactional`
  : `## RELATIONSHIP INSTRUCTION (EARLY STAGE)
- Do NOT force a booking yet. Build the relationship first.
- Focus on understanding their needs and sharing relevant value.
- Let the brand context and conversation guide the approach.`
}

${winningPlaybook}
${leadProceduralMemory ? `\n## LONG-TERM STRATEGY: ${leadProceduralMemory}` : ''}
${dynamicStrategySupplement ? `\n## CAMPAIGN STRATEGY UPDATE: ${dynamicStrategySupplement}` : ''}
${mediaInstruction}

${narrativeSummary}

## 🔒 STRICT ANTI-HALLUCINATION RULES (ZERO TOLERANCE)
1. **GROUND IN CONTEXT ONLY**: You MUST ONLY use the facts, context, and data provided in the sections above. Do NOT invent, assume, or hallucinate any facts, links, features, pricing, or details not present in the provided context.
2. **IF UNKNOWN, SAY NOTHING**: If a question cannot be answered from the provided context, do NOT guess. Acknowledge only what you know. Never fabricate.
3. **NO FAKE STATS OR METRICS**: Never invent numbers, percentages, case studies, testimonials, or results. Only use explicitly provided data.
4. **NO FAKE FEATURES**: Never describe features, capabilities, or integrations that are not explicitly mentioned in the brand context.
5. **NO URL INVENTIONS**: Never create fake URLs, links, or website addresses. Only use links explicitly provided in context.

## 📋 HARD CONSTRAINTS (NEVER BREAK)
1. **GREETINGS BANNED**: NEVER use "Hey", "Hey there", "Hi there", "Hi [Name]!", "Dear", or any generic greeting. Lead with substance.
2. **OPENING MUST MATCH BRAND**: If brand guidelines are provided, STRICTLY follow the opening pattern and phrasing found there. If no brand guidelines, use the DEFAULT BEST PRACTICES below.
3. **NO TIMEZONE NAMES**: NEVER mention timezone names (Africa/Lagos, America/Chicago, UTC, EST, etc.) in replies. Write times naturally.
4. **NO ROBOTIC BOOKING LANGUAGE**: NEVER say "the following slots are available", "your slot is confirmed", "I have availability". Sound human.
5. **LENGTH LIMITS**: 
   - DMs: max 3 sentences
   - Email: max 2 short paragraphs
   - Never exceed these limits. Shorter is always better.
6. **NO FILLER OPENINGS**: NEVER start with a greeting followed by filler. Lead with something real from the brand or conversation context.
7. **TIME FORMAT**: If they ask what time, write it as "X your time" without naming the timezone.
8. **NO UNSOLICITED LINKS**: NEVER send a payment link, checkout URL, or signup link unless the lead explicitly agrees or asks for it.
9. **CONFLICT HANDLING**: Use: "I've got something on then — how about [day] at [time]?" (casual, no apology spiral).
10. **NO REPETITION**: ${lastOutboundBody ? `Do NOT repeat, rephrase, or echo our last message: "${lastOutboundBody.slice(0, 300)}${lastOutboundBody.length > 300 ? '...' : ''}"` : 'Each message must bring NEW value or a NEW angle. Never repeat yourself.'}
11. **CUSTOM TRAINING OVERRIDES ALL**: If the CUSTOM USER TRAINING section contains specific instructions, those ALWAYS take precedence over brand guidelines below them.

## ✅ STRONG B2B OPENERS (USE THESE PATTERNS)
- "Quick question — are you still dealing with [specific pain point from context]?"
- "I saw you're a [leadRole] at [company]. We just helped a similar team get [specific result]. Thursday at 2pm your time — worth 10 min?"
- "Makes sense. Most founders/owners feel that way before they see how it actually works. How about I show you — 15 min, no pitch?"
- "Noticed you're doing [X] at [company]. I've got a perspective on that from working with similar [industry] teams."

## ❌ WEAK OPENERS (NEVER USE)
- "Hey there! I hope this message finds you well. I was wondering if you might be interested in..."
- "Hi [Name], I understand you're busy but would love to connect..."
- "I have some availability next week. Let me know what works for you."
- "Our platform offers AI-powered solutions that can help your business grow (generic, no substance)."

## DEFAULT B2B BEST PRACTICES (USED WHEN NO BRAND GUIDELINES ARE PROVIDED)
If the BRAND GUIDELINES section says "No specific brand guidelines provided", use these defaults:
- Write like a confident peer, not a salesperson. Short sentences. Conversational tone.
- Lead with value or curiosity — never with a greeting.
- Focus on outcomes and results, not features.
- Use contractions: you're, don't, can't, we'll, I'm.
- One clear ask per message. Make it easy to say yes.
- If booking a call, suggest 1-2 specific times naturally.

## OUTPUT QUALITY CHECK (self-verify before responding)
- [ ] Did I use any context not provided? (If yes, remove it — hallucination)
- [ ] Does my opening lead with substance rather than a greeting?
- [ ] Is my message shorter than the max allowed length?
- [ ] Is the tone human, not robotic?
- [ ] Did I avoid all banned phrases and patterns?
- [ ] Did I respect the CUSTOM USER TRAINING section if present?
- [ ] Did I follow the BRAND GUIDELINES exactly if provided?
- [ ] Did I apply any custom handling rules if the lead raised a concern?
- [ ] Does my message align with the lead's status and conversation stage?
${enrichedContext}
${userContext?.systemPromptSuffix ? `
## 🚀 AUTONOMOUS MISSION OVERRIDE (HIGHEST PRIORITY — OVERRIDES ALL ABOVE):
${userContext.systemPromptSuffix}` : ''}`;

  const lastMessage = conversationHistory[conversationHistory.length - 1];
  if (!lastMessage || lastMessage.direction !== 'inbound') {
    const response = await generateReply(systemPrompt, "[No Inbound Message]", {
      model: user?.metadata?.aiModel as string || 'gpt-4o',
      temperature: 0,
      maxTokens: 500,
      history: messageContext,
      nga1Enforced: true
    });

    return {
      text: response?.text?.trim().replace(/^['"]|['"]$/g, '') || "Following up.",
      useVoice: false,
      detections: { ...(intent || {}), channelFormatted: true },
      metadata: { promptVersion: PROMPT_VERSION }
    } as AIReplyResult;
  }

  const languageDetection = await handleLanguageDetection(lead.id, lastMessage.body);

  const priceObjection: PriceObjectionResult = await detectPriceObjection(lastMessage.body);
  if (priceObjection.detected) {
    const response = await generateNegotiationResponse(priceObjection.severity || 'medium', lead.id);
    await saveNegotiationAttempt(lead.id, priceObjection.suggestedDiscount || 0, false);

      const localizedResponse = await localizeAndOptimize(response, languageDetection, 'objection');

    return {
      text: optimizeSalesLanguage(localizedResponse),
      useVoice: false,
      detections: { priceObjection, language: languageDetection }
    };
  }

  const competitorMention: CompetitorMentionResult = await detectCompetitorMention(lastMessage.body);
  if (competitorMention.detected && competitorMention.response) {
    await trackCompetitorMention(
      lead.userId,
      lead.id,
      competitorMention.competitor,
      competitorMention.context,
      competitorMention.sentiment
    );

    const localizedResponse = await localizeAndOptimize(competitorMention.response, languageDetection, 'product_info');

    return {
      text: optimizeSalesLanguage(localizedResponse),
      useVoice: false,
      detections: { competitorMention, language: languageDetection }
    };
  }


  try {
    // First check if lead is requesting a meeting, payment, or app link
    const linkIntent = await detectAndGenerateLinkResponse(lead.userId, lastMessage.body);

    const proposer = new BookingProposer(lead.userId);

    // NEW: Check if this is a confirmation of a previously suggested slot
    if (brandContext.bookingPreference === 'autonomous' || isWarm) {
       const bookingResult = await proposer.detectConfirmationAndBook(
         lastMessage.body, 
         conversationHistory, 
          {
            id: lead.id,
            email: lead.email || '',
            name: lead.name || ''
          }
       );
       
        if (bookingResult.booked && bookingResult.bookedTime) {
          // 1. Update Lead Status to 'booked'

         await storage.updateLead(lead.id, { 
           status: 'booked',
            metadata: { 
              ...(lead.metadata as Record<string, any>), 
              ai_booked_time: bookingResult.bookedTime,
              last_action: 'automated_booking'
            }
         });

         // 2. Clear follow-up queue for this lead
         await storage.clearFollowUpQueue(lead.id);

         // 3. Create a notification for the User
         await storage.createNotification({
           userId: lead.userId,
           type: 'conversion',
           title: 'Meeting Booked! 🚀',
           message: `AI successfully booked a meeting with ${lead.name} for ${new Date(bookingResult.bookedTime).toLocaleString()}`,
           metadata: { leadId: lead.id, time: bookingResult.bookedTime }
         });

         // 4. Format in lead's local time — never expose TZ name
         const leadLocalTime = leadTzProfile?.detectedTimezone
           ? new Intl.DateTimeFormat('en-US', {
               timeZone: leadTzProfile.detectedTimezone,
               weekday: 'long',
               hour: 'numeric',
               minute: '2-digit',
               hour12: true,
             }).format(new Date(bookingResult.bookedTime))
           : new Date(bookingResult.bookedTime).toLocaleString([], { weekday: 'long', hour: '2-digit', minute: '2-digit' });

         return {
           text: optimizeSalesLanguage(`Perfect — ${leadLocalTime} it is. You'll get a calendar invite shortly. Looking forward to it!`),
           useVoice: (detectionResult as any)?.shouldUseVoice === true && isWarm
         };
       }
       if (bookingResult.copy) {
         return {
           text: optimizeSalesLanguage(bookingResult.copy),
           useVoice: (detectionResult as any)?.shouldUseVoice === true && isWarm
         };
       }
    }

    // If meeting requested, check brand preference
    if (linkIntent.intentType === 'meeting') {
      const hasTimeMention = /at|on|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|next|morning|afternoon|evening|\d+/i.test(lastMessage.body);

      // If they prefer autonomous booking AND provided a time, propose slots
      if (brandContext.bookingPreference === 'autonomous' || hasTimeMention) {

        const { suggestedSlots, parsedIntent, needsClarification } = await proposer.proposeTimes(lastMessage.body, { id: lead.id, email: lead.email || '', name: lead.name || '' });

        if (suggestedSlots.length > 0) {
          // Use the natural copy generated by BookingProposer (niche-aware)
          const slotMessages = suggestedSlots.map(s => s.copy);
          const response = slotMessages.length === 1
            ? slotMessages[0]
            : `${slotMessages[0]} Or if that doesn't work, ${slotMessages[1]?.toLowerCase() || 'let me know what does.'}`;

          return {
            text: optimizeSalesLanguage(response),
            useVoice: detectionResult.shouldUseVoice === true && isWarm
          };
        }
      }

      // If they prefer link ONLY or AI couldn't find slots, send the direct link
      if (linkIntent.detected && linkIntent.confidence >= 0.5 && linkIntent.suggestedResponse) {
        console.log(`🔗 Sending direct booking link (Preference: ${brandContext.bookingPreference})`);
        return {
          text: optimizeSalesLanguage(linkIntent.suggestedResponse),
          useVoice: false,
          detections: { language: languageDetection }
        };
      }
    }

    // --- SEMANTIC DEDUPLICATION (PHASE 29) ---
    const lastOutbound = conversationHistory.filter(m => m.direction === 'outbound').pop();
    const lastOutboundBody = lastOutbound?.body || "";
    let similarity = 0;
    let retryCount = 0;
    let finalAiResponse = null;

    while (retryCount < 2) {
      const currentSystemPrompt = retryCount === 0 
        ? systemPrompt 
        : `${systemPrompt}\n\n[DEDUPLICATION ALERT]: Your previous attempt was too similar to our last message. REPHRASE COMPLETELY. Use a different opening and a different value proposition. Do not repeat sentences.`;

      finalAiResponse = await generateReply(currentSystemPrompt, lastMessage.body, {
        model: MODELS.sales_reasoning,
        temperature: retryCount === 0 ? 0 : 0.1,
        maxTokens: platform === 'email' ? 300 : 150,
        history: messageContext,
        nga1Enforced: true,
        isEmailBody: platform === 'email', // Enable unsubscribe check for email outreach only
        channel: platform
      });

      similarity = calculateSimilarity(finalAiResponse.text, lastOutboundBody);
      
      if (similarity < 0.8) {
        break; // Message is unique enough
      }
      
      console.warn(`[Deduplication] Duplicate detected (Score: ${similarity.toFixed(2)}). Retry ${retryCount + 1}/2...`);
      retryCount++;
    }

    if (similarity >= 0.8) {
      console.error(`[Deduplication] 🛑 Permanent duplicate for lead ${lead.id}. Blocking message.`);
      return {
        text: '',
        useVoice: false,
        blocked: true,
        blockedReason: 'duplicate'
      };
    }

    let aiResponse = finalAiResponse!;

    // --- PHASE 60: HALLUCINATION GUARD & BRAND ALIGNMENT ---
    const allowedLinks = [
      'audnixai.com', 
      'calendly.com', 
      'calendar.google.com',
      userContext?.calendarLink || '',
      ...(lead.metadata?.allowed_links as string[] || [])
    ].filter(Boolean);

    const verification = await HallucinationGuard.verify(aiResponse.text, {
      userId: lead.userId,
      leadId: lead.id,
      allowedLinks,
      brandContext: brandGuidelines
    });

    if (!verification.isValid) {
      console.warn(`[HallucinationGuard] 🛡️ Verification failed: ${verification.reason}. Retrying with strict rules...`);
      
      const strictSystemPrompt = `${systemPrompt}\n\n[STRICT COMPLIANCE ALERT]: Your previous response was rejected for: ${verification.reason}. 
DO NOT use bot phrases, DO NOT hallucinate links, and DO NOT mention technical timezones. 
ONLY use the following links if necessary: ${allowedLinks.join(', ')}.`;

      aiResponse = await generateReply(strictSystemPrompt, lastMessage.body, {
        model: MODELS.sales_reasoning,
        temperature: 0.5,
        maxTokens: platform === 'email' ? 300 : 150,
        history: messageContext,
        nga1Enforced: true,
        isEmailBody: platform === 'email',
        channel: platform
      });

      // Second-pass verification
      const secondPass = await HallucinationGuard.verify(aiResponse.text, {
        userId: lead.userId,
        leadId: lead.id,
        allowedLinks,
        brandContext: brandGuidelines
      });

      if (!secondPass.isValid) {
        console.error(`[HallucinationGuard] 🛑 Second-pass failed: ${secondPass.reason}. Blocking message to prevent hallucination.`);
        return {
          text: '',
          useVoice: false,
          blocked: true,
          blockedReason: 'hallucination_blocked'
        };
      }
    }

    // Phase 22 & 23: Billing Agent check for payment intent
    let responseText = await billingAgent.handlePaymentIntent(lead.id, aiResponse.text);

    // Phase 22 & 25: Post-generation persistence (Reset failures and track usage)
    try {
      await storage.updateLead(lead.id, {
          metadata: {
            ...(lead.metadata as any || {}),
            aiFailCount: 0,
            lastAIGenerationAt: new Date().toISOString(),
            lastPromptVersion: PROMPT_VERSION
          }
      });

      // Track usage for budget management
      if (user) {
        const currentUsage = (user.intelligenceMetadata as any)?.dailyTokenUsage || 0;
        await storage.updateUser(user.id, {
          intelligenceMetadata: {
            ...(user.intelligenceMetadata as any || {}),
            dailyTokenUsage: currentUsage + aiResponse.tokensUsed,
            lastAIGenerationAt: new Date().toISOString()
          }
        });
      }
    } catch (persistErr) {
      console.error("[ConversationAI] Metadata update failed (non-critical):", persistErr);
    }

    // Conditional Link Injection: NO tracking/links in 1st email
    const isFirstTouch = conversationHistory.length <= 1;

    if (!isFirstTouch) {
      // Append meeting/payment/app link if detected with lower confidence
      responseText = await appendLinkIfNeeded(lead.userId, lastMessage.body, responseText);

      if (platform === 'email' && brandContext.signature) {
        responseText += brandContext.signature;
      }
    } else {
      console.log(`🛡️ First touch detected for ${lead.email} - Sending plain text outreach (No tracking)`);
    }

    const optimizedText = optimizeSalesLanguage(responseText);

    const formattedReply = await formatReplyForChannel(optimizedText, platform, {
      leadName: lead.name || "there",
      brandName: (brandContext as any)?.businessName,
      replyContext: lastMessage?.body,
      urgency: intent?.readyToBuy ? "critical" : intent?.isInterested ? "high" : "medium",
      hasObjection: intent?.hasObjection,
      wantsToBook: intent?.wantsToSchedule,
    });

    console.log(`📝 Channel-formatted reply for ${platform}: ${formattedReply.message.substring(0, 100)}...`);

    // Record what tactic we actually sent so the state machine knows for next time
    if (objectionDecision && optimizedText) {
      recordTacticSent(lead.id, lead.userId, optimizedText.substring(0, 200)).catch(() => console.error('[ConversationAI] recordTacticSent failed'));
    }

    return {
      text: optimizedText,
      useVoice: false,
      detections: { ...(intent || {}), channelFormatted: true, osmTactic: objectionDecision?.nextTactic },
      metadata: { promptVersion: PROMPT_VERSION }
    } as AIReplyResult;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error("AI reply generation error:", errorMessage);
    
    // Phase 22: Circuit Breaker - increment failure count and auto-pause if needed
    try {
      const isPaused = await storage.incrementAIFailureCount(lead.id);
      if (isPaused) {
        console.warn(`[ConversationAI] 🛑 Lead ${lead.id} auto-paused due to repeated generation failures.`);
        
        await storage.createNotification({
          userId: lead.userId,
          type: 'system',
          title: 'AI Auto-Paused 🛑',
          message: `We've paused the AI for ${lead.name} because it hit consecutive generation errors. You might want to step in manually.`,
          metadata: { leadId: lead.id }
        });
      }
    } catch (trackErr) {
      console.error("[ConversationAI] Failed to track AI failure:", trackErr);
    }

    // Robust production fallback - localized and polite
    const fallbackText = await getLocalizedResponse(
      "Thanks for your message! Looking forward to connecting shortly.",
      languageDetection,
      'greeting'
    );
    
    return {
      text: optimizeSalesLanguage(fallbackText),
      useVoice: false
    };
  }
}

/**
 * Generate voice note script with intelligent name usage
 * - Cold leads: Use name once at the beginning
 * - Warm leads: Use name naturally when appropriate
 */
export async function generateVoiceScript(
  lead: Lead,
  conversationHistory: Message[]
): Promise<string> {
  if (isDemoMode) {
    throw new Error("Voice Service Offline: Live API credentials required.");
  }

  const lastMessages = conversationHistory.slice(-5).map(m => m.body).join('\n');
  const isWarm = assessLeadWarmth(conversationHistory, lead);

  const voiceMessages = conversationHistory.filter(m =>
    m.direction === 'outbound' && m.body.toLowerCase().includes('voice note')
  );
  const isFirstVoiceNote = voiceMessages.length === 0;

  const nameUsageGuideline = isWarm
    ? "Use their name naturally when it feels right (e.g., when emphasizing a point or asking a direct question)"
    : isFirstVoiceNote
      ? "Start with their name once at the beginning (e.g., 'Hey [Name]!') then don't repeat it"
      : "You can use their name once if it feels natural, but keep it minimal";

  const prompt = `Generate a brief, natural-sounding voice note script (10-20 seconds when spoken) for ${lead.name}.
    Important: This is a VOICE NOTE, not a commercial. Talk like you're walking and just had a quick thought.

Lead Status: ${isWarm ? 'WARM - engaged and interested' : 'COLD - new or minimal engagement'}
First Voice Note: ${isFirstVoiceNote ? 'Yes' : 'No'}

Recent conversation:
${lastMessages}

Requirements:
- Brief and conversational (2-4 sentences maximum)
- 10-20 seconds when spoken out loud (aim for 35-65 words - keep it punchy)
- Sound like a confident but CHILL salesman. No "radio voice".
- Use natural filler words sparingly (uh, so, actually, listen) to sound real
- ${nameUsageGuideline}
- Suggest booking a call/meeting or ask about their interest
- End with a clear question or call-to-action
- Speak with energy and enthusiasm without being pushy
- NO formal introductions like "My name is... and I'm calling from..."
- Start with a hook related to their last message if possible.

Script:`;

  try {
    const aiResponse = await generateReply(
      "You are a top-performing salesman creating personalized voice notes. You're confident, articulate, and genuinely helpful. You build trust quickly and guide leads toward action naturally.",
      prompt,
      {
        model: MODELS.sales_reasoning,
        temperature: 0.8,
        maxTokens: 120,
        nga1Enforced: true,
      }
    );

    return aiResponse.text || "Hey! Just wanted to check in and see if you'd like to discuss this further. Let me know!";
  } catch (error) {
    console.error("Voice script generation error:", error);
    return "Hey! Quick voice note - would love to connect and discuss how we can help. Let me know when you're free!";
  }
}

/**
 * Schedule AI follow-up with intelligent timing based on lead activity
 */
export async function scheduleFollowUp(
  userId: string,
  leadId: string,
  channel: string,
  messageType: 'reply' | 'followup' = 'followup',
  conversationHistory: Message[] = []
): Promise<Date> {
  const delay = calculateReplyDelay(messageType, conversationHistory);
  const scheduledTime = new Date(Date.now() + delay);

  const delaySeconds = Math.round(delay / 1000);
  console.log(`📅 Scheduled ${messageType} for lead ${leadId} in ${delaySeconds}s at ${scheduledTime.toISOString()}`);

  return scheduledTime;
}

/**
 * Store conversation in Super Memory for permanent long-term storage
 * Automatically called after each message exchange
 */
export async function saveConversationToMemory(
  userId: string,
  lead: Lead,
  messages: Message[]
): Promise<void> {
  if (messages.length === 0) return;

  try {
    const conversationData = {
      messages: messages.map(m => ({
        role: m.direction === 'inbound' ? 'user' : 'assistant',
        content: m.body,
        timestamp: new Date(m.createdAt).toISOString(),
      })),
      leadName: lead.name,
      leadChannel: lead.channel,
      metadata: {
        leadId: lead.id,
        leadStatus: lead.status,
        lastUpdated: new Date().toISOString(),
      },
    };

    const result = await storeConversationMemory(userId, lead.id, conversationData);

    if (result.success) {
      console.log(`✓ Conversation with ${lead.name} stored in permanent memory`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to save conversation to memory:', errorMessage);
  }
}

/**
 * Retrieve conversation context from Super Memory for better AI responses
 */
export async function getConversationContext(
  userId: string,
  leadId: string
): Promise<Message[]> {
  try {
    const result: MemoryRetrievalResult = await retrieveConversationMemory(userId, leadId);

    if (!result.success || !result.conversations) {
      console.log(`⚠️ Intelligence Memory: No context retrieved for lead ${leadId}`);
      return [];
    }

    if (result.conversations.length === 0) {
      return [];
    }

    const memories: Message[] = [];

    for (const conv of result.conversations) {
      if (!conv || !conv.content || !Array.isArray(conv.content.messages)) {
        console.warn('Super Memory: Invalid conversation format, skipping');
        continue;
      }

      for (const msg of conv.content.messages) {
        if (!msg || !msg.role || !msg.content) continue;

        memories.push({
          id: `memory-${Date.now()}-${Math.random()}`,
          leadId,
          userId,
          provider: (conv.content.channel as 'instagram' | 'gmail' | 'email' | 'system') || 'instagram',
          direction: msg.role === 'user' ? 'inbound' : 'outbound',
          body: msg.content,
          audioUrl: null,
          metadata: {},
          createdAt: new Date(msg.timestamp || Date.now()),
        } as Message);
      }
    }

    if (memories.length > 0) {
      console.log(`✓ Intelligence Memory: Retrieved ${memories.length} messages from permanent memory`);
    }

    return memories;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to retrieve conversation context:', errorMessage);
    return [];
  }
}
/**
 * Generate an elite "Day 1 Hook" outreach message
 * Focuses on curiosity, psychological triggers, and getting that FIRST reply.
 */
export async function generateExpertOutreach(
  lead: Lead,
  userId: string
): Promise<{ 
  subject: string, 
  body: string, 
  alternatives: string[],
  variant: 'curiosity' | 'result'
}> {
  const brandContext = await getBrandContext(userId);
  const user = await storage.getUserById(userId);
  const intelligence = (user as any)?.intelligenceMetadata || {};
  
  const offer = brandContext.offer || "your premium solution";
  const leadRole = lead.role || "Founder";
  const industry = (lead.metadata as any)?.industry || "your industry";
  const leadBio = lead.bio || "";

  // Semantically retrieve the best knowledge fragments for this specific lead/industry
  let ragContext = "";
  try {
    const relevantChunks = await searchSimilarChunks(`${lead.company} ${industry} ${leadRole}`, userId, 5);
    ragContext = relevantChunks.map(c => `[From ${c.fileName}]: ${c.content}`).join("\n\n");
  } catch (ragError) {
    console.warn("⚠️ [RAG] Outreach retrieval error:", ragError);
  }

  // Load custom training and objections
  const customKnowledge = await getCustomKnowledge(userId).catch(() => null);
  let customKnowledgeContext = '';
  if (customKnowledge) {
    const ck = customKnowledge;
    if (ck.businessName || ck.brandVoice || ck.coreOffer || ck.customInstructions || (ck.faqs && ck.faqs.length > 0)) {
      customKnowledgeContext = `
### CUSTOM USER TRAINING KNOWLEDGE BASE (High Priority)
Business Name: ${ck.businessName || "N/A"}
Brand Voice / Tone: ${ck.brandVoice || "N/A"}
Core Offer Details: ${ck.coreOffer || "N/A"}
Custom Instructions: ${ck.customInstructions || "N/A"}
${ck.faqs && ck.faqs.length > 0 ? `Frequently Asked Questions:\n${ck.faqs.map((f: any) => `- Q: "${f.question}"\n  A: "${f.answer}"`).join('\n')}` : ''}`;
    }
  }
  // Append extra instructions for retry (e.g., stricter anti-placeholder rules)
  const extraInstructions = (lead as any)?._extraInstructions;
  if (extraInstructions) {
    customKnowledgeContext += `\n${extraInstructions}`;
  }
  const customObjectionsPrompt = await objectionService.formatCustomObjectionsForPrompt(userId).catch(() => '');

  try {
    const systemPrompt = `## IDENTITY
You are an elite B2B sales copywriter in the tradition of Joe Sugarman and Chris Voss. You write cold emails that feel like a peer sending a sharp observation — not a sales pitch. Your words create curiosity gaps that demand replies.

## PRIORITY HIERARCHY
1. **CUSTOM TRAINING** (highest) — User-defined brand voice, offers, FAQs, handling rules
2. **BRAND CONTEXT** — Brand profile, positioning, differentiators, industry
3. **STRATEGIC INTELLIGENCE** — Research, market context, competitor landscape
4. **DEFAULT BEST PRACTICES** — Used when no brand context or custom training is available

## MISSION
Craft a cold email that gets a REPLY. That reply should open the door to a strategy call, demo, or meeting. Every word must serve this mission. No filler.

## CORE STRATEGY
1. **SUBJECT LINE**: Create curiosity or signal relevance. 5-8 words. Specific to them, not generic.
2. **THE OPENING**: Start with a sharp observation, a relevant question, or a clear reason for reaching out. Show you did your homework.
3. **THE ASK**: Clear, low-friction next step. Make it easy to say yes.
4. **PERSONALIZATION**: You're writing to a ${leadRole} in ${industry}. Reference their world.

${customKnowledgeContext ? `
## CUSTOM TRAINING (HIGHEST PRIORITY)
${customKnowledgeContext}
` : ''}
${customObjectionsPrompt || ''}

## BRAND CONTEXT (WHO YOU ARE AND WHAT YOU OFFER)
${formatBrandContextForPrompt(brandContext)}

## STRATEGIC INTELLIGENCE
- Market Gaps: ${JSON.stringify(intelligence.marketGaps || [])}
- Competitors: ${JSON.stringify(intelligence.competitors || [])}
- Differentiators: ${JSON.stringify(intelligence.differentiators || [])}
- Core UVP: ${intelligence.uvp || offer}
- Why You: ${intelligence.whyYouWin || ""}

## KNOWLEDGE BASE (Source material — DO NOT INVENT BEYOND THIS)
${ragContext || "No specific knowledge base fragments found."}

## 🔒 ANTI-HALLUCINATION RULES (STRICT)
1. **CONTEXT-BOUND**: ONLY use facts from the sections above. Do NOT invent case studies, stats, features, or results.
2. **NO FAKE METRICS**: Never claim specific results unless they appear in the brand context.
3. **NO INVENTED COMPETITORS**: Only name competitors explicitly listed above.
4. **NO MADE-UP CONTEXT**: Do not describe use cases not present in the offer or knowledge base.
5. **NO BRACKET PLACEHOLDERS**: Never output square brackets like [example] or angle brackets in the final email. The examples below use brackets as placeholders for demonstration only — you must replace them with REAL, SPECIFIC content or omit them entirely.
6. **NO TEMPLATE LEAKS**: If you don't know a specific detail, skip it. Do NOT leave bracket placeholders like [placeholder] or [unknown].

## COPYWRITING DIRECTIVES
1. **PEER-TO-PEER**: Speak as an equal to ${leadRole}s — confident, not salesy.
2. **THE CURIOSITY GAP**: Start with something that makes them want to know more.
3. **CLEAR ASK**: Every email needs an obvious next step. Make it easy to say yes.
4. **NO FLUFF**: Start with substance. No "I hope this finds you well", no intros.
5. **PERSONALIZATION**: ${leadBio}
6. **BREVITY**: Scannable in 5 seconds. Short paragraphs. Short sentences.
7. **CUSTOM TRAINING OVERRIDES**: If CUSTOM TRAINING specifies tone or messaging, those ALWAYS take precedence.

## ✅ GOOD B2B OUTREACH EXAMPLES
- Subject: "Quick thought on ${industry} [specific gap]"
  Body: "${lead.name}, most ${industry} ${leadRole}s I talk to are leaving 20-30% on the table because of [specific gap]. We just fixed this for a comparable company in 14 days. Worth a look?"

- Subject: "${lead.company} and the [shift] blindspot"
  Body: "There's a shift happening in ${industry} that most ${leadRole}s are missing — and it's costing them [result]. Curious if this is on your radar?"

## ❌ BAD EXAMPLES (NEVER USE)
- Subject: "Follow up" / "Checking in" / "Hello"
  Body: "Hi ${lead.name}, I hope you're doing well. I wanted to reach out because..."
- Any email that sounds templated or uses "I understand you're busy".

## DEFAULT B2B BEST PRACTICES (WHEN NO BRAND CONTEXT IS AVAILABLE)
If brand context is minimal or just says "No specific brand guidelines provided":
- Lead with a specific observation about their company, role, or industry
- Focus on outcomes (more revenue, saved time, reduced costs) not features
- Keep it to 3-4 short paragraphs. White space is your friend.
- End with a soft CTA — get the reply first, not the booking
- Sound like a peer, not a salesperson

## BRAND OFFER INTEL
${JSON.stringify(offer)}

## LEAD PROFILE
Name: ${lead.name}
Company: ${lead.company || "their company"}
Role: ${leadRole}
Industry: ${industry}

## OUTPUT FORMAT (JSON ONLY)
{
  "variants": [
    {
      "type": "curiosity",
      "subject": "Subject line (5-8 words, curiosity-driven, specific to them)",
      "body": "Email body (3-4 short paragraphs, focused opening, clear ask, no fluff)"
    },
    {
      "type": "result",
      "subject": "Subject line (5-8 words, outcome-focused)",
      "body": "Email body (3-4 short paragraphs, value-forward, clear next step)"
    }
  ]
}`;

    const aiResponse = await generateReply(systemPrompt, `Craft the opening disruption for ${lead.name} (${leadRole}) at ${lead.company || "their company"}. Use the brand offer to bridge their ${industry} gap and set up the bridge to a booked call.`, {
      model: MODELS.sales_reasoning,
      jsonMode: true,
      nga1Enforced: true
    });

    const rawText = aiResponse.text || '{}';
    let result: any;
    try {
      result = JSON.parse(rawText);
    } catch (parseErr) {
      throw new Error(`[generateExpertOutreach] AI returned invalid JSON: ${rawText.substring(0, 200)}`);
    }

    const variants = result.variants || [];
    if (!Array.isArray(variants) || variants.length === 0) {
       throw new Error(`[generateExpertOutreach] AI returned no variants`);
    }

    // Select variant based on lead ID (deterministic A/B split)
    // Convert first 2 chars of UUID lead.id to int and mod 2
    const leadSeed = lead.id ? parseInt(lead.id.substring(0, 2), 16) || 0 : 0;
    const variantIndex = leadSeed % variants.length;
    const selected = variants[variantIndex];

    return {
      subject: selected.subject,
      body: selected.body,
      alternatives: variants.map((v: any) => v.subject),
      variant: selected.type || (variantIndex === 0 ? 'curiosity' : 'result')
    };
  } catch (error: any) {
    const isQuotaError = error?.message?.includes('quota') || error?.status === 429;
    const isNga1Violation = error?.message?.includes('NGA-1') || error?.message?.includes('placeholder');

    if (isNga1Violation && !(lead as any)?._retried) {
      // Retry once with a stricter prompt — the AI leaked placeholders
      console.warn(`[ExpertOutreach] NGA-1 violation for ${lead.name}, retrying with strict anti-placeholder prompt...`);
      (lead as any)._retried = true;
      (lead as any)._extraInstructions = `

STRICT INSTRUCTION: You MUST NOT use ANY square brackets [ ] or angle brackets in your output. 
Replace all placeholders with real, specific content based on the lead's profile.
If you don't know a specific detail, simply omit it. Never leave brackets.`;
      return generateExpertOutreach(lead, userId);
    }

    if (isQuotaError) {
      console.error("🚀 [AI Quota Alert] Provider limit reached. Activating Elite Fallback Engine.");
    } else if (!isNga1Violation) {
      console.error("Expert Outreach Error (Switching to Elite Fallback):", error);
    }

    // Elite Fallback Engine - No generic strings
    const usp = typeof offer === 'string' ? offer.substring(0, 80) : "high-velocity neural optimization";
    const leadName = lead?.name || "there";
    const leadCompany = lead?.company || "your team";
    const leadTarget = leadRole === 'Founder' || leadRole === 'CEO' ? 'roadmap' : 'workflow';

    return {
      subject: `The ${leadRole} gap in ${industry} implementation`,
      body: `<p>Hey ${leadName},</p><p>I noticed a specific friction point in how ${leadCompany} is scaling its ${industry} operations. Most teams in your space miss the 20% shift that drives 80% of the conversion velocity.</p><p>I have a theory on how ${usp} maps to your current ${leadTarget}. Is efficiency a core focus for the team this quarter?</p>`,
      alternatives: [
        `Disruptive question for ${lead.company || "the team"}`,
        `Regarding the ${leadRole} roadmap at ${lead.company || "the company"}`,
        `Quick theory on ${industry} scalability`
      ],
      variant: 'curiosity'
    };
  }
}

/**
 * Generate a full 4-part AI Campaign Template Sequence
 * Uses Brand PDF context to create high-conversion, clickbait-style templates with placeholders.
 */
export async function generateCampaignTemplateSequence(
  userId: string,
  followupCount: number = 3,
  focus?: string, // Optional specific instruction from user
  delayDaysArr?: number[] // Array of days to wait between followups
): Promise<{
  subject: string;
  body: string;
  followups: Array<{ subject: string, body: string, delayDays: number, isBreakup?: boolean }>;
  autoReplyBody: string;
}> {
  const brandContext = await getBrandContext(userId);
  const user = await storage.getUserById(userId);
  
  const intelligence = (user as any)?.intelligenceMetadata || {};
  let ragContext = "Use general brand context.";
  try {
    const ragContextChunks = await searchSimilarChunks("Campaign sequence " + (focus || ""), userId, 3);
    if (ragContextChunks && ragContextChunks.length > 0) {
      ragContext = ragContextChunks.map(c => c.content).join("\n\n");
    }
  } catch (e) {
    console.warn('[ConversationAI] RAG context fetch failed, using default:', (e as Error)?.message);
  }

  // Combine brand config and PDF vector text if available
  const pdfIntel = user?.brandGuidelinePdfText 
    ? `BRAND PDF INTEL EXCERPTS: ${user.brandGuidelinePdfText.substring(0, 1500)}` 
    : "No PDF intel provided.";
    
  const offer = brandContext.offer || "your premium solution";
  const customFocus = focus ? `USER REQUESTED FOCUS: ${focus}` : "";

  // Load custom training and objections
  const customKnowledge = await getCustomKnowledge(userId).catch(() => null);
  let customKnowledgeContext = '';
  if (customKnowledge) {
    const ck = customKnowledge;
    if (ck.businessName || ck.brandVoice || ck.coreOffer || ck.customInstructions || (ck.faqs && ck.faqs.length > 0)) {
      customKnowledgeContext = `
### CUSTOM USER TRAINING KNOWLEDGE BASE (High Priority)
Business Name: ${ck.businessName || "N/A"}
Brand Voice / Tone: ${ck.brandVoice || "N/A"}
Core Offer Details: ${ck.coreOffer || "N/A"}
Custom Instructions: ${ck.customInstructions || "N/A"}
${ck.faqs && ck.faqs.length > 0 ? `Frequently Asked Questions:\n${ck.faqs.map((f: any) => `- Q: "${f.question}"\n  A: "${f.answer}"`).join('\n')}` : ''}`;
    }
  }
  const customObjectionsPrompt = await objectionService.formatCustomObjectionsForPrompt(userId).catch(() => '');

  // Prepare the explicit sequence strategy
  let sequenceStrategy = `Step 1 (Initial Email): Curiosity-driven pattern break. High impact, blunt.`;
  
  if (followupCount > 0) {
    let currentStep = 2;
    for (let i = 0; i < followupCount; i++) {
      const delayDays = delayDaysArr ? delayDaysArr[i] : 3;
      const isLast = i === followupCount - 1;
      const isSecond = i === 0;
      
      let stepStrategy = "";
      if (isLast) {
        stepStrategy = `The "Takeaway" approach (Polite, high-status breakup). Frame it around assuming they are too busy and pulling the offer away.`;
      } else if (isSecond) {
        stepStrategy = `Value-led insight. Provide a quick resource or industry observation.`;
      } else {
        stepStrategy = `Social proof or disruptive theory.`;
      }
      
      sequenceStrategy += `\n    Step ${currentStep} (Follow-Up ${i + 1}): [Sent ${delayDays} days later] - ${stepStrategy}`;
      currentStep++;
    }
  }

  try {
    const systemPrompt = `## IDENTITY
You are a world-class B2B sales copywriter specializing in cold email sequences. Every email you write is disruptive, curiosity-driven, and impossible to ignore. You understand timing, psychology, and the art of the follow-up.

## PRIORITY HIERARCHY
1. **CUSTOM TRAINING** (highest) — User-defined brand voice, offers, FAQ, handling rules
2. **BRAND INTEL** — Brand profile, offer, positioning
3. **STRATEGIC POSITIONING** — Market context, differentiators
4. **GENERAL RULES** — Curiosity gap, anti-hallucination, banned phrases

## MISSION
Build a ${1 + followupCount}-step cold email sequence plus an auto-reply template. Each message must feel like a real person following up naturally — not a drip campaign. Every email advances the conversation toward a booked call or meeting.

${customKnowledgeContext ? `
## CUSTOM TRAINING (HIGHEST PRIORITY — OVERRIDES ALL)
${customKnowledgeContext}
` : ''}
${customObjectionsPrompt || ''}

## SEQUENCE STRATEGY (EXACT TIMELINE AND PACING — FOLLOW THIS RELIGIOUSLY)
${sequenceStrategy}

## BRAND INTEL
Offer: ${JSON.stringify(offer)}
Company Name: ${(brandContext as any)?.businessName || 'Us'}

## STRATEGIC POSITIONING
- Market Gaps: ${JSON.stringify(intelligence.marketGaps || [])}
- Core Advantage: ${intelligence.whyYouWin || ""}
- Core UVP: ${intelligence.uvp || offer}

## KNOWLEDGE BASE (Source material — DO NOT INVENT BEYOND THIS)
${ragContext || "Use general brand context."}

${customFocus}

## 🔒 ANTI-HALLUCINATION RULES (STRICT — ZERO TOLERANCE)
1. **CONTEXT-BOUND**: ONLY use facts, figures, and claims from the sections above. Never invent case studies, stats, or testimonials.
2. **NO FAKE OUTCOMES**: Do not claim specific results unless the exact figure is in the brand context.
3. **NO INVENTED FEATURES**: Every capability mentioned must be traceable to the offer or knowledge base.
4. **PLACEHOLDERS ONLY**: Use EXACTLY {{firstName}}, {{company}}, {{industry}}. Optionally {{competitor_name}}, {{recent_news}} if the strategy calls for it. Never invent placeholder names.

## STRICT COPYWRITING RULES
1. **ZERO FLUFF**: NEVER use: "Just checking in", "Touching base", "Hope this finds you well", "I know you're busy", "Per my last email", "Following up". These instantly flag your message as spam.
2. **THE CURIOSITY GAP**: Email 1 must start bluntly with a disruptive observation or question. Focus on a real problem, not a feature.
3. **TIME AWARENESS**: Use pacing naturally. If step 3 is sent 14 days later, acknowledge the gap implicitly (e.g. "Been thinking about your [industry] situation..."). Never say "it's been X days".
4. **FOLLOW-UP COUNT EXACTNESS**: You MUST generate EXACTLY ${followupCount} follow-up steps. No more, no less.
5. **CUSTOM TRAINING OVERRIDES**: If CUSTOM TRAINING specifies tone, messaging, or approach, those ALWAYS take precedence over general rules.

## ✅ SEQUENCE PATTERNS
Email 1 — Pattern interrupt. Lead with something relevant to the recipient. Show you've done your homework. End with a low-friction ask.
Follow-up 1 — Add value. Share an insight, resource, or observation. New angle, not repetition.
Follow-up 2 — Breakup/takeaway. Polite, high-status. Offer to close the loop gracefully.
Auto-reply — Triggered when they respond. Conversational, human, pushes to a call or meeting.

## DEFAULT SEQUENCE BEHAVIOR (WHEN NO BRAND CONTEXT)
If brand context is minimal or missing, use standard B2B sequence best practices:
- Email 1: Sharp observation + curiosity gap + soft ask
- Follow-up 1: Value-add insight or resource + new angle
- Follow-up 2: Breakup — "If this isn't a priority, I'll close the loop here. Otherwise, let's chat."
- Auto-reply: Warm, conversational, pushes to calendar

## ❌ BAD PATTERNS (NEVER USE)
- Starting every email the same way
- Using pressure or guilt ("haven't heard back", "did you miss my email")
- Long paragraphs with feature dumps
- Robotic or templated language

## OUTPUT JSON FORMAT (EXACT — DO NOT ADD EXTRA FIELDS)
{
  "subject": "Email 1 Subject (5-8 words, curiosity-driven)",
  "body": "Email 1 Body (3-4 short paragraphs, pattern-interrupt opening, no fluff)",
  "followups": [
    { "subject": "Re: Subject line", "body": "Follow-up body advancing the conversation", "delayDays": 3 }
  ],
  "autoReplyBody": "Auto-reply body triggered on their reply (short, human, pushes to booking)"
}
(IMPORTANT: The followups array MUST have EXACTLY ${followupCount} items. Not ${followupCount + 1}. Not ${followupCount - 1}. EXACTLY ${followupCount}.)`;

    const aiResponse = await generateReply(systemPrompt, "Draft the 4-part master sequence now.", {
      model: MODELS.sales_reasoning,
      jsonMode: true,
      nga1Enforced: true
    });

    const result = JSON.parse(aiResponse.text || '{}');

    if (!result.subject || !result.body) throw new Error("Incomplete Campaign Sequence Generation");

    return {
      subject: result.subject || "quick question about {{company}}",
      body: result.body,
      followups: (result.followups || []).slice(0, followupCount).map((f: any, index: number) => ({
        subject: f.subject || `Re: ${result.subject}`,
        body: f.body || "",
        delayDays: delayDaysArr ? delayDaysArr[index] : (parseInt(f.delayDays) || 3),
        // Last follow-up is always a high-status Breakup/Takeaway
        isBreakup: index === followupCount - 1
      })),
      autoReplyBody: result.autoReplyBody || ""
    };
  } catch (error: any) {
    console.error("Template Sequence Generation Error:", error);
    
    // Fallback template
    return {
      subject: `{{company}} / ${(brandContext as any)?.businessName || 'Us'}`,
      body: `Hey {{firstName}},\n\nNoticed {{company}} is scaling in the {{industry}} space. Most teams miss the 20% shift that drives 80% of revenue right now.\n\nWe deployed a system using ${typeof offer === 'string' ? offer.substring(0, 50) : 'high-velocity optimization'} that fixes this.\n\nOpen to a quick framework overview next week?`,
      followups: [
        { 
          subject: `Re: {{company}} / ${(brandContext as any)?.businessName || 'Us'}`, 
          body: `Hey {{firstName}},\n\nJust bumping this. If efficiency is a focus for {{company}} this quarter, this would be highly relevant.`,
          delayDays: 3,
          isBreakup: false
        },
        {
          subject: `Re: {{company}} / ${(brandContext as any)?.businessName || 'Us'}`,
          body: `Hey {{firstName}} - guessing this isn't a priority right now.\n\nI'll stop reaching out.`,
          delayDays: 7,
          isBreakup: true
        }
      ],
      autoReplyBody: `Hey {{firstName}}! Thanks for getting back to me.\n\nI'd love to jump on a quick call to show you exactly how this works for {{company}}.\n\nDo you have 10 mins this week? Let me know a time that works for you.`
    };
  }
}




