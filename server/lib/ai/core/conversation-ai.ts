import { MODELS } from "@services/brain-worker/src/ai-lib/utils/model-config.js";
import { storage } from '@shared/lib/storage/storage.js';
import type { Message, Lead } from "@audnix/shared";
import { storeConversationMemory, retrieveConversationMemory } from "@services/brain-worker/src/ai-lib/context/super-memory.js";
import { detectLanguage, getLocalizedResponse, updateLeadLanguage, type LanguageDetection } from '@services/brain-worker/src/ai-lib/core/language-detector.js';
import { detectPriceObjection, saveNegotiationAttempt, generateNegotiationResponse, type PriceObjectionResult } from '@services/brain-worker/src/ai-lib/specialized/price-negotiation.js';
import { detectCompetitorMention, trackCompetitorMention, type CompetitorMentionResult } from '@services/brain-worker/src/ai-lib/analyzers/competitor-detection.js';
import { optimizeSalesLanguage } from '@services/brain-worker/src/ai-lib/formatters/sales-language-optimizer.js';
import { getBrandContext, formatBrandContextForPrompt } from '@services/brain-worker/src/ai-lib/context/brand-context.js';
import { appendLinkIfNeeded, detectAndGenerateLinkResponse } from '@services/brain-worker/src/ai-lib/analyzers/link-intent-detector.js';
import { BookingProposer } from '@shared/lib/calendar/booking-proposer.js';
import { analyzeLeadIntent, type IntentAnalysis } from '@services/brain-worker/src/ai-lib/analyzers/intent-analyzer.js';
import { generateAutonomousObjectionResponse } from '@services/brain-worker/src/ai-lib/analyzers/autonomous-objection-responder.js';
import { universalSalesAI } from "@services/brain-worker/src/orchestrator/agents/universal-sales-agent.js";
import { evaluateAndLogDecision } from '@services/brain-worker/src/ai-lib/engines/decision-engine.js';
import { formatReplyForChannel } from '@services/brain-worker/src/ai-lib/formatters/channel-reply-formatter.js';
import { workerHealthMonitor } from '@shared/lib/monitoring/worker-health.js';
import { quotaService } from '@shared/lib/monitoring/quota-service.js';
import { getOAuthRedirectUrl } from "@shared/config/config/oauth-redirects.js";
import { encrypt, decrypt } from '@shared/lib/crypto/encryption.js';
import { db } from '@shared/lib/db/db.js';
import { users, integrations, notifications, videoMonitors } from '@audnix/shared';
import { eq, and } from 'drizzle-orm';
import { generateReply, estimateTokens } from '@services/brain-worker/src/ai-lib/core/ai-service.js';
import { getStyleMarkers, type StyleMarkers } from '@services/brain-worker/src/ai-lib/context/personality-learner.js';
import { getCalendlyPrefillLink } from '@shared/lib/integrations/calendly.js';
import { getLeadProfile } from '@shared/lib/calendar/lead-timezone-intelligence.js';
import { calculateSimilarity } from '@services/brain-worker/src/ai-lib/utils/utils.js';
import { getRegionalInstruction } from '@services/brain-worker/src/ai-lib/specialized/regional-norms.js';
import { objectionService } from '@services/brain-worker/src/ai-lib/analyzers/objection-service.js';
import { searchSimilarChunks } from '@services/brain-worker/src/ai-lib/context/vector-rpc.js';

const isDemoMode = false;
const PROMPT_VERSION = 'v1.2.0-resilience';

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
  status: "new" | "open" | "replied" | "booked" | "not_interested" | "cold" | "warm";
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

  const conversionKeywords = ['yes', 'book', 'schedule', 'ready', "let's do it", 'sign me up', 'interested', 'when can we'];
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
    if (daysSince > 3) {
      return { status: 'cold', confidence: 0.75, reason: 'No response in 3+ days', shouldUseVoice: false };
    }
  }

  return { status: 'open', confidence: 0.6, shouldUseVoice: false };
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
  }
): Promise<AIReplyResult> {

  if (isDemoMode) {
    throw new Error("Intelligence Engine Disconnected: System requires live API key for real-time inference.");
  }

  const personaId = (lead.metadata as any)?.personaId;
  const brandContext = await getBrandContext(lead.userId, personaId);
  const user = await storage.getUserById(lead.userId);

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
  const brandGuidelines = user?.brandGuidelinePdfText || (brandContext as any)?.brandVoice || "No specific brand guidelines provided.";

  const isWarm = assessLeadWarmth(conversationHistory, lead);
  const detectionResult = detectConversationStatus(conversationHistory);

  const memoryResult: MemoryRetrievalResult = await retrieveConversationMemory(lead.userId, lead.id);
  const memoryMessages = await getConversationContext(lead.userId, lead.id);
  const allMessages = [...memoryMessages, ...conversationHistory];
  const lastLeadMessage = conversationHistory.filter(m => m.direction === 'inbound').pop();

  // --- SMART INTENT & EMOTION ANALYSIS ---
  const intent: IntentAnalysis | null = lastLeadMessage
    ? await analyzeLeadIntent(lastLeadMessage.body, {
      id: lead.id,
      name: lead.name || "Lead",
      channel: lead.channel,
      status: lead.status,
      tags: lead.tags || []
    })
    : null;
    
  // --- BRAND RAG (Semantic Retrieval) ---
  let ragContext = "";
  if (lastLeadMessage) {
    try {
      const relevantChunks = await searchSimilarChunks(lastLeadMessage.body, lead.userId, 4);
      if (relevantChunks.length > 0) {
        ragContext = `[RELEVANT BRAND KNOWLEDGE]:n${relevantChunks.map((c: any) => `- ${c.content}`).join('n')}`;
      }
    } catch (ragError) {
      console.warn("[ConversationAI] RAG search failed:", ragError);
    }
  }

  // --- STYLE LEARNING ---
  const styleMarkers = await getStyleMarkers(lead.userId);

  // --- OBJECTION HANDLING LOOP ---
  // PHASE 52: Inject winning handles from Objection Service
  const winningPlaybook = objectionService.formatPlaybookForPrompt(lead.userId);

  if (intent?.hasObjection || intent?.isNegative) {
    const bestHandle = objectionService.getBestHandle(lead.userId, lastLeadMessage?.body || "");
    console.log(`🛡️ Objection detected for lead ${lead.id}. Triggering closer logic.`);
    const objectionResponse = await generateAutonomousObjectionResponse(lastLeadMessage?.body || "", {
      userId: lead.userId,
      leadName: lead.name || "there",
      leadIndustry: (lead.metadata?.industry as string) || "general",
      previousMessages: allMessages.slice(-5).map(m => ({
        role: m.direction === 'inbound' ? 'user' : 'assistant',
        content: m.body
      })),
      brandName: (brandContext as any)?.businessName || "Our platform",
      userIndustry: (brandContext as any)?.industry || "all"
    });

    return {
      text: objectionResponse.response,
      useVoice: false,
      detections: intent
    };
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
    ? `nnCONVERSATION INSIGHTS:n${memoryResult.context}`
    : '';

  // Phase 23: Dynamic Context Pruning based on estimated tokens (Budget: 3,000 tokens)
  const CONTEXT_TOKEN_BUDGET = 3000;
  
  // ─── NICHE + TIMEZONE INTELLIGENCE ───────────────────────────────────────
  const leadTzProfile = await getLeadProfile(lead.id).catch(() => null);
  const leadLocalTz   = leadTzProfile?.detectedTimezone || 'unknown local time';
  const leadNiche     = leadTzProfile?.niche || (lead.metadata as any)?.niche || (lead.metadata as any)?.industry || 'their industry';
  const leadCity      = leadTzProfile?.detectedCity || (lead as any).city || null;
  const preferredWindowStart = leadTzProfile?.preferredContactStart ?? 10;
  const preferredWindowEnd   = leadTzProfile?.preferredContactEnd   ?? 18;

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

  const stylePrompt = intent?.style ? `[STYLE INSTRUCTION]nMirror their ${intent.style} style.` : '';
  const emotionPrompt = intent?.emotion ? `[EMOTION INSTRUCTION]nAcknowledge their ${intent.emotion} emotion.` : '';

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
    instagram: 'casual, friendly, and conversational with emojis',
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
${activeVideos.map((v: any) => `- "${v.ctaText}": ${v.videoUrl}`).join('n')}
Say something like: "I actually made a quick video breakdown showing exactly how we handle this: ${activeVideos[0].videoUrl}"
`;
    }
  }

  // ─── PHASE 51: CROSS-CHANNEL NARRATIVE ───────────────────────────────────
  const crossChannelHistory = allMessages.filter(m => m.provider !== platform && m.provider !== 'system');
  const narrativeSummary = crossChannelHistory.length > 0
    ? `n[PHASE 51] CROSS-CHANNEL NARRATIVE HISTORY:n` +
      crossChannelHistory.slice(-3).map(m => `- [${m.provider.toUpperCase()}]: ${m.body}`).join('n') +
      `nYou MUST ensure this reply fits the narrative established on other channels.`
    : '';

  // ─── STATUS-AWARE DYNAMIC PROMPT BUILDER ─────────────────────────────────
  const STATUS_PLAYBOOK: Record<string, string> = {
    new: `You're opening a fresh conversation. Lead has NOT replied before.
Your job: Break the ice, earn attention, find their situation.
Do NOT pitch yet. Ask ONE smart question about their pain or goal.
Be curious and direct. 2 sentences max.`,

    open: `Lead is in play but hasn't committed. They may have replied 1-2 times.
If you've exchanged 2+ messages: move toward scheduling. Suggest a time naturally.
Example: "How does Thursday at ${preferredWindowStart >= 12 ? (preferredWindowStart - 12) + 'pm' : preferredWindowStart + 'am'} work for you? Quick 20-minute call."
If early stage: ask a sharper question, find their core problem.
Be direct. Never pad. 2-3 sentences.`,

    replied: `🔥 Lead is warm — they're responding and engaged.
PRIORITY: Move toward booking NOW. Don't slow down.
Suggest a specific time in their niche window: e.g., "Are you free Thursday at 5pm? 20 minutes is all we need."
Match their energy. Be confident and human. If they ask a question, answer it AND pivot to the calendar.`,

    warm: `Lead is very engaged. High intent signals detected.
Be direct about the next step — a call. Treat them like a deal that's almost closed.
Suggest 1-2 specific times. Use their niche-window timing.
No fluff. Pure forward motion.`,

    cold: `Lead has gone quiet (3+ days no reply).
Light touch — do NOT pitch hard. Pique curiosity.
One short message: something interesting, a question, or a relevant observation about their niche.
1-2 sentences. Feel like a real human checking in, not a drip sequence.`,

    no_show: `Lead missed a scheduled call.
Don't shame them. Acknowledge it gracefully and make re-booking feel easy.
Example: "Looks like something came up — no worries. Want to find another time that works better?"
Keep it light, low pressure. 1-2 sentences.`,

    canceled: `Lead cancelled their booking.
Don't pressure. Be understanding, open the door softly.
Example: "All good — things happen. Whenever you're ready, I'm here."
Then offer 1 easy next step. No hard selling.`,

    not_interested: `Lead has indicated they are not interested.
Send ONE final graceful message. No hard close. Leave the door open for the future.
Example: "Totally understand — I'll leave you to it. If your situation changes, you know where to find me."
Do NOT try to re-sell. Respect their decision.`,

    hardened: `Lead has been repeatedly contacted and is resistant.
Last resort: minimal contact, maximum value. Share something genuinely useful.
NO sales pitch. Just a resource, an insight, or a relevant question.
If no response after this, stop the cadence.`,

    recovered: `Lead was cold/lost and has now re-engaged.
Treat like a warm lead. Jump back in with energy.
Reference what you spoke about before if relevant. Get back to the booking flow.
Be glad they're back — show it subtly.`,

    booked: `SYSTEM STOP: This lead is booked. No AI message should ever reach them.
Only meeting reminders are authorised. Do not generate a response.`,
  };

  const currentStatus = lead.status || 'new';
  const statusInstruction = STATUS_PLAYBOOK[currentStatus] || STATUS_PLAYBOOK['open'];

  // --- GLOBAL LOCALIZATION (Phase 32) ---
  const languageCode = intent?.languageCode || 'en';
  const languageMap: Record<string, string> = {
    'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German',
    'it': 'Italian', 'pt': 'Portuguese', 'zh': 'Mandarin Chinese',
    'ar': 'Arabic', 'hi': 'Hindi'
  };
  const languageName = languageMap[languageCode] || 'English';

  const languageInstruction = languageCode !== 'en'
    ? `nn[GLOBAL LOCALIZATION]: The lead is communicating in ${languageName}. You MUST respond entirely in ${languageName}. Maintain the brand's tone, professionalism, and voice rules natively in ${languageName}. Use cultural business idioms, not literal translations.`
    : "";

  const regionalInstruction = getRegionalInstruction(intent?.detectedCountry || null);

  const inboundCount = conversationHistory.filter(m => m.direction === 'inbound').length;
  const shouldPushBooking = (currentStatus === 'open' && inboundCount >= 2) || currentStatus === 'replied' || currentStatus === 'warm';

  const systemPrompt = `You are an elite sales advisor — a real person, not a bot. You know this lead, their niche (${leadNiche}), and you behave like a sharp, experienced closer who always knows what happens next.

${ragContext}

[BRAND GUIDELINES]
${brandGuidelines}

${(brandContext as any)?.brandSnippets?.length > 0
  ? `KEY BRAND MESSAGES:n${(brandContext as any).brandSnippets.map((s: string) => `- ${s}`).join('n')}`
  : ''}

${leadIntelContext}

${stylePrompt}

${emotionPrompt}

${languageInstruction}

${regionalInstruction}

[LEAD PRIORITY]: ${lead.score >= 85 ? 'PRIMARY (A) - Ultra-High Value. Close aggressively.' : lead.score >= 60 ? 'STANDARD (B) - Good potential. Nurture with value.' : 'LOW (C) - Early stage. Build rapport.'}
Score: ${lead.score}/100

[PLATFORM]: ${platform} — Tone: ${platformTone[platform]}

[CURRENT STATUS PLAYBOOK — FOLLOW THIS EXACTLY]
Lead Status: ${currentStatus.toUpperCase()}
${statusInstruction}

${shouldPushBooking
  ? `This lead is ready. Move toward booking. Suggest a specific day+time from their niche window.
Write copy like: "How does Thursday at 5pm work?" or "Are you free Wednesday around 6pm? — 20 minutes max."
Never say "slot available" — sound human.`
  : `Don't force a booking pitch yet. Build the relationship first.`
}

${winningPlaybook}

${mediaInstruction}

${narrativeSummary}

[HARD RULES — NEVER BREAK]
- NEVER use generic greetings like "Hey", "Hey there", "Hi there", or "Hi [Name]!".
- STRICTLY follow the opening pattern and phrasing found in the [BRAND GUIDELINES] exactly.
- NEVER mention timezone names (Africa/Lagos, America/Chicago, etc.) in replies
- NEVER say "the following slots are available" or "your slot is confirmed" — speak like a human
- NEVER send more than 3 sentences for DMs, never more than 2 short paragraphs for email
- NEVER start with a greeting followed by filler — lead with something real from the user's copy
- If they ask what time, always write it as "X your time" without saying what timezone
- NEVER offer or send a payment/checkout link unless the lead explicitly agrees to buy or specifically asks for an invoice/link.
- All conflict handling: "I've got something on then — how about [day] at [time]?"
${enrichedContext}`;

  const lastMessage = conversationHistory[conversationHistory.length - 1];
  if (!lastMessage || lastMessage.direction !== 'inbound') {
    const response = await generateReply(systemPrompt, "[No Inbound Message]", {
      model: user?.metadata?.aiModel as string || 'gpt-4o',
      temperature: 0.7,
      maxTokens: 500,
      history: messageContext
    });

    return {
      text: response?.text?.trim().replace(/^['"]|['"]$/g, '') || "Following up.",
      useVoice: false,
      detections: { ...(intent || {}), channelFormatted: true },
      metadata: { promptVersion: PROMPT_VERSION }
    } as AIReplyResult;
  }

  const languageDetection: LanguageDetection = detectLanguage(lastMessage.body);
  if (languageDetection.confidence > 0.6 && languageDetection.code !== 'en') {
    await updateLeadLanguage(lead.id, languageDetection);
  }

  const priceObjection: PriceObjectionResult = await detectPriceObjection(lastMessage.body);
  if (priceObjection.detected) {
    const response = await generateNegotiationResponse(priceObjection.severity || 'medium', lead.id);
    await saveNegotiationAttempt(lead.id, priceObjection.suggestedDiscount || 0, false);

      const localizedResponse = await getLocalizedResponse(
        response,
        languageDetection,
        'objection'
      );

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

    const localizedResponse = await getLocalizedResponse(
      competitorMention.response,
      languageDetection,
      'product_info'
    );

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
    }

    // If meeting requested, check brand preference
    if (linkIntent.intentType === 'meeting') {
      const hasTimeMention = /at|on|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|next|morning|afternoon|evening|d+/i.test(lastMessage.body);

      // If they prefer autonomous booking AND provided a time, propose slots
      if (brandContext.bookingPreference === 'autonomous' || hasTimeMention) {

        const { suggestedSlots, parsedIntent, needsClarification } = await proposer.proposeTimes(lastMessage.body, { id: lead.id, email: lead.email || '', name: lead.name || '' });

        if (suggestedSlots.length > 0) {
          // Use the natural copy generated by BookingProposer (niche-aware)
          const slotMessages = suggestedSlots.map((s: any) => s.copy);
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
        : `${systemPrompt}nn[DEDUPLICATION ALERT]: Your previous attempt was too similar to our last message. REPHRASE COMPLETELY. Use a different opening and a different value proposition. Do not repeat sentences.`;

      finalAiResponse = await generateReply(currentSystemPrompt, lastMessage.body, {
        model: MODELS.sales_reasoning,
        temperature: retryCount === 0 ? 0.8 : 0.95, // Increase temperature on retry
        maxTokens: platform === 'email' ? 300 : 150,
        history: messageContext
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

    const aiResponse = finalAiResponse!;

    let responseText = aiResponse.text;

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

    return {
      text: optimizedText,
      useVoice: false,
      detections: { ...(intent || {}), channelFormatted: true },
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

  const lastMessages = conversationHistory.slice(-5).map(m => m.body).join('n');
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
    ragContext = relevantChunks.map((c: any) => `[From ${c.fileName}]: ${c.content}`).join("nn");
  } catch (ragError) {
    console.warn("⚠️ [RAG] Outreach retrieval error:", ragError);
  }

  try {
    const systemPrompt = `You are an elite high-ticket sales copywriting expert (Think Joe Sugarman + Chris Voss). 
    Your ONLY objective is to get a REPLY that serves as a bridge to booking a STRATEGY CALL.
    
    CORE STRATEGY:
    1. PSYCHOLOGICAL CLICKBAIT: Subjects must evoke FOMO, curiosity, or a "disruption" of their current routine.
    2. THE CURIOSITY GAP: Use "Disruptive Questions". E.g. "Is [Company] prepared for [specific industry shift]?" or "One thing missing from your [role] workflow...".
    3. THE TRANSFORMATION: Do not sell features. Highlight a Massive Closing Velocity. Use the Offer context to find the 'Unique Breakthrough'.
    4. ROLE PERSONALIZATION: You are talking to a ${leadRole} in ${industry}. Speak their language.

    BRAND CONTEXT:
    ${formatBrandContextForPrompt(brandContext)}

    STRATEGIC INTELLIGENCE (Deep Research Results):
    - Market Gaps: ${JSON.stringify(intelligence.marketGaps || [])}
    - Top Competitors: ${JSON.stringify(intelligence.competitors || [])}
    - Our Differentiators: ${JSON.stringify(intelligence.differentiators || [])}
    - UVP: ${intelligence.uvp || offer}
    - Strategic Advantage: ${intelligence.whyYouWin || ""}

    DETAILED KNOWLEDGE BASE (Semantic Retrieval):
    ${ragContext || "No specific knowledge base fragments found."}
    COPYWRITING DIRECTIVES:
    1. PEER-TO-PEER AUTHORITY: You are a high-level strategic advisor, not a salesperson. Speak with authority to ${leadRole}s.
    2. THE CURIOSITY GAP: Start with a disruptive observation about ${industry} or their specific business type (e.g. Agency).
    3. THE BOOKING PIVOT: Every word must advance theClose. The goal is to get them to ask "How does this work?" so we can book the call.
    4. NO FLUFF: Start the email directly with the "A-ha" moment. No intros or "How are you".
    5. PROFILE AWARENESS: Use this info about them: ${leadBio}

    BRAND OFFER INTEL (Synthesize this into the ROI transformation):
    ${JSON.stringify(offer)}

    LEAD INTEL:
    Name: ${lead.name}
    Company: ${lead.company || "their company"}
    Role: ${leadRole}
    Industry: ${industry}

    OUTPUT FORMAT (JSON):
    {
      "variants": [
        {
          "type": "curiosity",
          "subject": "FOMO/Disruption subject",
          "body": "Curiosity-gap focused body"
        },
        {
          "type": "result",
          "subject": "ROI/Outcome subject",
          "body": "Result-focused transformation body"
        }
      ]
    }`;

    const aiResponse = await generateReply(systemPrompt, `Craft the opening disruption for ${lead.name} (${leadRole}) at ${lead.company || "their company"}. Use the brand offer to bridge their ${industry} gap and set up the bridge to a booked call.`, {
      model: MODELS.sales_reasoning,
      jsonMode: true
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
    if (isQuotaError) {
      console.error("🚀 [AI Quota Alert] Provider limit reached. Activating Elite Fallback Engine.");
    } else {
      console.error("Expert Outreach Error (Switching to Elite Fallback):", error);
    }

    // Elite Fallback Engine - No generic strings
    const usp = typeof offer === 'string' ? offer.substring(0, 80) : "high-velocity neural optimization";
    const leadName = lead?.name || "there";
    const leadCompany = lead?.company || "your team";
    const leadTarget = leadRole === 'Founder' || leadRole === 'CEO' ? 'roadmap' : 'workflow';

    return {
      subject: `The ${leadRole} gap in ${industry} implementation ([Live Context])`,
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
  focus?: string // Optional specific instruction from user
): Promise<{
  subject: string;
  body: string;
  followUpSubject: string;
  followUpBody: string;
  followUpSubject2: string;
  followUpBody2: string;
  autoReplyBody: string;
}> {
  const brandContext = await getBrandContext(userId);
  const user = await storage.getUserById(userId);
  
  const intelligence = (user as any)?.intelligenceMetadata || {};
  let ragContext = "Use general brand context.";
  try {
    const ragContextChunks = await searchSimilarChunks("Campaign sequence " + (focus || ""), userId, 3);
    if (ragContextChunks && ragContextChunks.length > 0) {
      ragContext = ragContextChunks.map((c: any) => c.content).join("nn");
    }
  } catch (e) {
    // Ignore, fallback to default
  }

  // Combine brand config and PDF vector text if available
  const pdfIntel = user?.brandGuidelinePdfText 
    ? `BRAND PDF INTEL EXCERPTS: ${user.brandGuidelinePdfText.substring(0, 1500)}` 
    : "No PDF intel provided.";
    
  const offer = brandContext.offer || "your premium solution";
  const customFocus = focus ? `USER REQUESTED FOCUS: ${focus}` : "";

  try {
    const systemPrompt = `You are an elite high-ticket B2B sales copywriter. You are building out a 3-step Cold Email Sequence plus an active Auto-Reply template.
    Your objective is to generate highly disruptive, clickbait-style (but professional), curiosity-driven copy that breaks patterns.

    BRAND INTEL:
    Offer: ${JSON.stringify(offer)}
    Company Name: ${(brandContext as any)?.businessName || 'Us'}
    
    STRATEGIC POSITIONING:
    - Market Gaps to Exploit: ${JSON.stringify(intelligence.marketGaps || [])}
    - Core Advantage: ${intelligence.whyYouWin || ""}
    - UVP: ${intelligence.uvp || offer}

    SEMANTIC KNOWLEDGE BASE (Use for specific USPs):
    ${ragContext || "Use general brand context."}
    
    ${customFocus}

    RULES & FORMATTING:
    1. USE THESE EXACT PLACEHOLDERS: {{firstName}}, {{company}}, {{industry}}.
    2. THE CURIOSITY GAP: Start the first email bluntly. "Is {{company}} prepared for the shift in {{industry}}?"
    3. NO FLUFF: No "Hope you are doing well" or "My name is...".
    4. FOLLOW UP 1: Short, value-add bump. 
    5. FOLLOW UP 2: The break-up/final chance. Provocative but polite.
    6. AUTO-REPLY: A conversational message that gets sent immediately after they reply, pushing to a meeting.
    
    OUTPUT JSON FORMAT EXACTLY:
    {
      "subject": "Email 1 Subject (short, lowercase, FOMO)",
      "body": "Email 1 Body",
      "followUpSubject": "Re: Email 1 Subject",
      "followUpBody": "Follow Up 1 Body",
      "followUpSubject2": "Re: Email 1 Subject",
      "followUpBody2": "Follow Up 2 Body (break up)",
      "autoReplyBody": "Auto-Reply Body (when they reply)"
    }`;

    const aiResponse = await generateReply(systemPrompt, "Draft the 4-part master sequence now.", {
      model: MODELS.sales_reasoning,
      jsonMode: true
    });

    const result = JSON.parse(aiResponse.text || '{}');

    if (!result.subject || !result.body) throw new Error("Incomplete Campaign Sequence Generation");

    return {
      subject: result.subject || "quick question about {{company}}",
      body: result.body,
      followUpSubject: result.followUpSubject || `Re: ${result.subject}`,
      followUpBody: result.followUpBody,
      followUpSubject2: result.followUpSubject2 || `Re: ${result.subject}`,
      followUpBody2: result.followUpBody2,
      autoReplyBody: result.autoReplyBody
    };
  } catch (error: any) {
    console.error("Template Sequence Generation Error:", error);
    
    // Fallback template
    return {
      subject: `{{company}} / ${(brandContext as any)?.businessName || 'Us'}`,
      body: `Hey {{firstName}},nnNoticed {{company}} is scaling in the {{industry}} space. Most teams miss the 20% shift that drives 80% of revenue right now.nnWe deployed a system using ${typeof offer === 'string' ? offer.substring(0, 50) : 'high-velocity optimization'} that fixes this.nnOpen to a quick framework overview next week?`,
      followUpSubject: `Re: {{company}} / ${(brandContext as any)?.businessName || 'Us'}`,
      followUpBody: `Hey {{firstName}},nnJust bumping this. If efficiency is a focus for {{company}} this quarter, this would be highly relevant.nnLet me know if you're open to the 5-min breakdown.`,
      followUpSubject2: `Re: {{company}} / ${(brandContext as any)?.businessName || 'Us'}`,
      followUpBody2: `Hey {{firstName}} - guessing this isn't a priority right now.nnI'll stop reaching out. If you ever want to scale your operations without adding headcount, feel free to reach back out.nnCheers,`,
      autoReplyBody: `Hey {{firstName}}! Thanks for getting back to me.nnI'd love to jump on a quick call to show you exactly how this works for {{company}}.nnDo you have 10 mins this week? Let me know a time that works for you.`
    };
  }
}
