import OpenAI from "openai";
import { MODELS } from "./model-config.js";
import { storage } from "../../storage.js";
import type { Message, Lead } from "../../../shared/schema.js";
import { storeConversationMemory, retrieveConversationMemory } from "./super-memory.js";
import { detectLanguage, getLocalizedResponse, updateLeadLanguage, type LanguageDetection } from './language-detector.js';
import { detectPriceObjection, saveNegotiationAttempt, generateNegotiationResponse, type PriceObjectionResult } from './price-negotiation.js';
import { detectCompetitorMention, trackCompetitorMention, type CompetitorMentionResult } from './competitor-detection.js';
import { optimizeSalesLanguage } from './sales-language-optimizer.js';
import { getBrandContext, formatBrandContextForPrompt } from './brand-context.js';
import { appendLinkIfNeeded, detectAndGenerateLinkResponse } from './link-intent-detector.js';
import { BookingProposer } from '../calendar/booking-proposer.js';
import { analyzeLeadIntent } from './intent-analyzer.js';
import { generateAutonomousObjectionResponse } from './autonomous-objection-responder.js';
import { universalSalesAI } from './universal-sales-agent.js';
import { evaluateAndLogDecision } from './decision-engine.js';
import { formatReplyForChannel } from './channel-reply-formatter.js';

// Initialize OpenAI if key is present, otherwise use fallback
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

if (!openai) {
  console.warn('⚠️ OpenAI API Key missing. Conversation AI will use fallback responses.');
}

const isDemoMode = false;

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
    return (baseMinutes * 60 + randomSeconds) * 1000;
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

    const oldStatus = lead.status;
    const newStatus = statusDetection.status;

    if (oldStatus === 'converted' && newStatus !== 'converted') {
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
  status: "new" | "open" | "replied" | "converted" | "not_interested" | "cold";
  confidence: number;
  reason?: string;
  shouldUseVoice?: boolean;
}

export interface AIReplyResult {
  text: string;
  useVoice: boolean;
  detections?: any;
}

export interface MemoryRetrievalResult {
  success: boolean;
  context?: string;
  conversations?: any[];
  metadata?: any;
}

const brandPromptSection = `[BRAND CONTEXT PLACEHOLDER]`;

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
    return { status: 'converted', confidence: 0.85, reason: 'Lead showed strong buying intent', shouldUseVoice: true };
  }

  if (recentEngagement) {
    return { status: 'replied', confidence: 0.8, reason: 'Lead actively responding', shouldUseVoice: true };
  }

  if (hasEngagement) {
    return { status: 'open', confidence: 0.7, reason: 'Lead engaged in conversation', shouldUseVoice: false };
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
  userContext?: { businessName?: string; brandVoice?: string }
): Promise<AIReplyResult> {

  if (isDemoMode) {
    throw new Error("Neural Engine Disconnected: System requires live API key for real-time inference.");
  }

  const brandContext = await getBrandContext(lead.userId);
  const user = await storage.getUserById(lead.userId);

  const isWarm = assessLeadWarmth(conversationHistory, lead);
  const detectionResult = detectConversationStatus(conversationHistory);

  const memoryResult: MemoryRetrievalResult = await retrieveConversationMemory(lead.userId, lead.id);
  const memoryMessages = await getConversationContext(lead.userId, lead.id);
  const allMessages = [...memoryMessages, ...conversationHistory];
  const lastLeadMessage = conversationHistory.filter(m => m.direction === 'inbound').pop();

  // --- NEURAL INTENT ANALYSIS ---
  const intent = lastLeadMessage
    ? await analyzeLeadIntent(lastLeadMessage.body, {
      id: lead.id,
      name: lead.name || "Lead",
      channel: lead.channel,
      status: lead.status,
      tags: lead.tags || []
    })
    : null;

  // --- OBJECTION HANDLING LOOP ---
  if (intent?.hasObjection || intent?.isNegative) {
    console.log(`🛡️ Objection detected for lead ${lead.id}. Triggering closer logic.`);
    const objectionResponse = await generateAutonomousObjectionResponse(lastLeadMessage?.body || "", {
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

  // --- STRATEGIC DECISION LOGGING ---
  if (intent) {
    await evaluateAndLogDecision({
      userId: lead.userId,
      leadId: lead.id,
      actionType: intent.wantsToSchedule ? 'calendar_booking' : 'dm_sent',
      intentScore: intent.confidence * 100,
      timingScore: 80, // Default for active conversation
      confidence: intent.confidence,
      metadata: { intent }
    });
  }

  const messageContext: Array<{ role: 'user' | 'assistant'; content: string }> = allMessages.slice(-10).map(m => ({
    role: m.direction === 'inbound' ? 'user' as const : 'assistant' as const,
    content: m.body
  }));

  const enrichedContext = memoryResult.context
    ? `\n\nCONVERSATION INSIGHTS:\n${memoryResult.context}`
    : '';

  const platformTone: Record<string, string> = {
    instagram: 'casual, friendly, and conversational with emojis',
    email: 'professional yet approachable, well-structured'
  };

  const systemPrompt = `You are an elite high-ticket sales advisor. You're a real person - not a bot - and your ONLY objective is to guide this conversation towards a BOOKED STRATEGY CALL.

[BRAND GUIDELINES & MATERIALS]
${user?.brandGuidelinePdfText || "No additional guidelines provided."}

${brandPromptSection}

Platform: ${platform}
Tone: ${platformTone[platform]}
Lead Name: ${lead.name}
Lead Status: ${isWarm ? 'WARM - READY FOR BOOKING 🔥' : 'NEW - BUILDING AUTHORITY ❄️'}

How You Talk:
- Like a peer, not a subordinate. You are a strategic advisor, not a salesperson.
- Use contractions (you're, don't, let's, can't) - it sounds real
- No "I appreciate your interest" or "kindly". Start with the insight.
- Every message must be a bridge. If they ask a question, answer it and immediately pivot to: "Actually, it's easier to map this against your specific roadmap. Are you open to a 10min sync?"
- Short sentences. 2-3 sentences max for DMs, a short paragraph for email.
- BE PUNCHY AND DIRECT. Do not "yap" or use unnecessary filler words. One strong point per message is better than three weak ones.
- If the lead wants to book or schedule, use this link: ${(user as any)?.calendarLink || "our booking page"}.

Your Personality:
- Confident but chill - you know what you're offering is good
- Genuinely helpful - you actually care about solving their problem
- Real and honest - no fakeness
- Fun energy but professional - people enjoy talking to you
- Smart but humble - you explain things clearly without showing off
- Great at reading situations - if they're hesitant, you feel it

When They Object:
- Don't get defensive - acknowledge their concern like a real person would
- Reframe around what matters to THEM, not the features
- Use questions that make them think about their actual problem
- Show real examples from people like them
- Create a sense of "this could actually change how I work" - not hype, just truth

Handling Objections & Concerns:
PRICE OBJECTIONS:
- Never get defensive or rush them
- Acknowledge their concern: "I completely understand"
- Reframe around value, not cost: highlight transformation, results, ROI
- Create emotional urgency with thought-provoking questions:
  * "Would you rather invest $X now to be financially free, or wait for the 'perfect time' that might never come?"
  * "What's the cost of staying where you are for another year?"
  * "How much is peace of mind worth to you?"
- Paint the picture of their future WITH your solution vs WITHOUT it

COMPETITOR COMPARISONS ("I found someone cheaper"):
- Stay confident and professional - never defensive or begging
- Acknowledge their finding: "I hear you"
- Reframe with value logic: "Would you rather invest [your price] knowing it solves [their specific problem] completely, or pay [lower price] and potentially come back to repeat the same process when it doesn't work?"
- Plant the seed of doubt professionally: "Good luck with that. But when it doesn't deliver what you need, I'll be here to help clean up the mess and get you real results."
- End with a truth question that makes them think: "Quick question - if price was the same, which solution would you choose? That's your answer right there."
- Make them question their decision and realize cheap often costs more in the long run

INAPPROPRIATE LANGUAGE OR BEHAVIOR:
- Stay professional and composed - never match their energy
- Acknowledge without engaging: "I hear you" or "I understand you're frustrated"
- Gently redirect to the value you offer: "I'm here to help you [achieve X]. Would you like to discuss that?"
- If persistent, maintain boundaries: "I respect your perspective. Let's focus on how I can best support you."
- Never argue, never take it personally - be the mature professional

HESITATION OR DELAY TACTICS ("Let me ask my wife/boss/etc"):
- Validate their process: "That makes sense"
- Create gentle urgency: "Just curious - what would need to happen for you to feel confident moving forward today?"
- Frame the decision emotionally: "If this could [solve their problem], would waiting make sense?"

Real Talk - How to Handle Different Situations:

WHEN THEY MENTION PRICE/COST:
- Real people talk about money - don't avoid it or get defensive
- Acknowledge it honestly: "I know, money matters"
- Show them the real ROI or transformation
- Ask: "What would this need to do for you to justify the investment?" (Makes them think about actual value)
- Use their wins: "People like you usually save time and money here"

WHEN THEY SAY THEY'RE ALREADY USING SOMETHING ELSE:
- Be confident, not jealous: "That's cool you're testing things"
- Real comparison: "The difference is usually significant - saves people 10+ hours per week"
- Truth bomb: "Sometimes you don't realize you need something better until you try it"
- Ask for a conversation: "5 mins to show you?" - not pushy, just curious

WHEN THEY SAY THEY'RE NOT SURE OR BUSY:
- Don't oversell - they can feel it
- Be real: "Most people feel that way at first, then see the value pretty fast"
- Make it easy: "How about I send you a quick video showing exactly how it works?"
- Give them space: "No pressure - if something changes, you know where to find me"

WHEN THEY SEEM SKEPTICAL:
- Don't try to convince them - show them instead
- Use proof: "Check out what someone similar did in the first month..."
- Ask honest questions: "What would prove this to you?"
- Respect their skepticism: "Smart to be careful - I'd do the same"

Core Strategy:
- Match the platform vibe: ${platformTone[platform]}
- ${isWarm ? 'They like you already - be direct, confident, suggest the next step' : 'Build trust first - show you understand them'}
${detectionResult.shouldUseVoice ? '- They seem engaged - maybe a voice message feels more personal?' : ''}
- End with a real question, not a sales close
- Make them see their future with/without this
- Create FOMO that feels natural, not icky${enrichedContext}`;

  const lastMessage = conversationHistory[conversationHistory.length - 1];
  if (!lastMessage || lastMessage.direction !== 'inbound') {
    return { text: optimizeSalesLanguage("Thanks for reaching out! How can I help you?"), useVoice: false };
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

  const competitorMention: CompetitorMentionResult = detectCompetitorMention(lastMessage.body);
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

    // If meeting requested, check brand preference
    if (linkIntent.intentType === 'meeting') {
      const hasTimeMention = /at|on|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|next|morning|afternoon|evening|\d+/i.test(lastMessage.body);

      // If they prefer autonomous booking AND provided a time, propose slots
      if (brandContext.bookingPreference === 'autonomous' || hasTimeMention) {
        const proposer = new BookingProposer(lead.userId);
        const { suggestedSlots, parsedIntent, needsClarification } = await proposer.proposeTimes(lastMessage.body);

        if (suggestedSlots.length > 0) {
          const firstSlot = new Date(suggestedSlots[0]);
          const timeStr = firstSlot.toLocaleString([], { weekday: 'long', hour: '2-digit', minute: '2-digit' });
          const dateStr = firstSlot.toLocaleString([], { month: 'short', day: 'numeric' });

          let response = "";
          if (suggestedSlots.length === 1 || isWarm) {
            response = `I've got a spot open on ${timeStr} (${dateStr}) - does that work for you? I can lock it in for us right now.`;
          } else {
            const timeList = suggestedSlots.slice(0, 3).map(s => {
              const d = new Date(s);
              return d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
            }).join(', ');
            response = `I've got some space mid-week! Specifically: ${timeList}. Do any of those work, or would you prefer to just pick a time that suits you better here: ${linkIntent.link}`;
          }

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

    if (!openai) {
      throw new Error("OpenAI not initialized");
    }

    const completion = await openai.chat.completions.create({
      model: MODELS.sales_reasoning,
      messages: [
        { role: "system", content: systemPrompt },
        ...messageContext
      ],
      temperature: 0.8,
      max_tokens: platform === 'email' ? 300 : 150,
    });

    let responseText = completion.choices[0]?.message?.content || "";

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
      text: formattedReply.message,
      useVoice: detectionResult.shouldUseVoice === true && isWarm,
      detections: { ...(intent || {}), channelFormatted: true }
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error("AI reply generation error:", errorMessage);
    return {
      text: optimizeSalesLanguage("Thanks for your message! Let me get back to you shortly with more details."),
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
    throw new Error("Voice Protocol Offline: Live API credentials required.");
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

Lead Status: ${isWarm ? 'WARM - engaged and interested' : 'COLD - new or minimal engagement'}
First Voice Note: ${isFirstVoiceNote ? 'Yes' : 'No'}

Recent conversation:
${lastMessages}

Requirements:
- Brief and conversational (2-4 sentences maximum)
- 10-20 seconds when spoken out loud (aim for 40-80 words)
- Sound like a confident, knowledgeable salesman who builds genuine connections
- ${nameUsageGuideline}
- Suggest booking a call/meeting or ask about their interest
- End with a clear question or call-to-action
- Be warm, personable, and solution-focused
- Show you understand their needs and can help
- Speak with energy and enthusiasm without being pushy

Script:`;

  try {
    if (!openai) {
      throw new Error("OpenAI not initialized");
    }

    const completion = await openai.chat.completions.create({
      model: MODELS.sales_reasoning,
      messages: [
        { role: "system", content: "You are a top-performing salesman creating personalized voice notes. You're confident, articulate, and genuinely helpful. You build trust quickly and guide leads toward action naturally." },
        { role: "user", content: prompt }
      ],
      temperature: 0.8,
      max_tokens: 120,
    });

    return completion.choices[0]?.message?.content || "Hey! Just wanted to check in and see if you'd like to discuss this further. Let me know!";
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
      console.log(`⚠️ Super Memory: No context retrieved for lead ${leadId}`);
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
      console.log(`✓ Super Memory: Retrieved ${memories.length} messages from permanent memory`);
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
): Promise<{ subject: string, body: string, alternatives: string[] }> {
  const brandContext = await getBrandContext(userId);
  const offer = brandContext.offer || "your premium solution";
  const leadRole = lead.role || "Founder";
  const industry = (lead.metadata as any)?.industry || "your industry";
  const leadBio = lead.bio || "";

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
      "subjects": [
        "short provocative version (Fear of Missing Out / Professional)",
        "result-oriented version",
        "human peer-to-peer version"
      ],
      "best_subject_index": 0,
      "body_html": "3-4 punchy sentences. High-contrast plain text style HTML (<p>). Focus on the 20% shift that drives 80% results. End with a curiosity-focused question."
    }`;

    if (!openai) throw new Error("Neural Engine Offline");

    const completion = await openai.chat.completions.create({
      model: MODELS.sales_reasoning,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Craft the opening disruption for ${lead.name} (${leadRole}) at ${lead.company || "their company"}. Use the brand offer to bridge their ${industry} gap and set up the bridge to a booked call.` }
      ],
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(completion.choices[0]?.message?.content || '{}');

    if (!result.subjects || !result.body_html) throw new Error("Incomplete Intel Generation");

    return {
      subject: result.subjects[result.best_subject_index] || result.subjects[0],
      body: result.body_html,
      alternatives: result.subjects
    };
  } catch (error) {
    console.error("Expert Outreach Error (Switching to Elite Fallback):", error);

    // Elite Fallback Engine - No generic strings
    const usp = typeof offer === 'string' ? offer.substring(0, 80) : "high-velocity neural optimization";
    const leadTarget = leadRole === 'Founder' || leadRole === 'CEO' ? 'roadmap' : 'workflow';

    return {
      subject: `The ${leadRole} gap in ${industry} implementation ([Live Context])`,
      body: `<p>Hey ${lead.name},</p><p>I noticed a specific friction point in how ${lead.company || "your team"} is scaling its ${industry} operations. Most teams in your space miss the 20% shift that drives 80% of the conversion velocity.</p><p>I have a theory on how ${usp} maps to your current ${leadTarget}. Is efficiency a core focus for the team this quarter?</p>`,
      alternatives: [
        `Disruptive question for ${lead.company || "the team"}`,
        `Regarding the ${leadRole} roadmap at ${lead.company || "the company"}`,
        `Quick theory on ${industry} scalability`
      ]
    };
  }
}
