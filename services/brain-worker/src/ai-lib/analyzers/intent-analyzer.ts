import { generateReply } from '../core/ai-service.js';
import { MODELS } from '../utils/model-config.js';
import { storage } from '@shared/lib/storage/storage.js';
import { type Message } from '@audnix/shared';
import { AuditTrailService } from '@shared/lib/monitoring/audit-trail-service.js';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';

export interface IntentAnalysis {
  isInterested: boolean;
  isNegative: boolean;
  hasQuestion: boolean;
  hasObjection: boolean;
  wantsToSchedule: boolean;
  isAvailableForMeeting: boolean;
  keywords: string[];
  productMentioned?: string;
  offeredPrice?: number;
  isOOO: boolean;
  isWrongPerson: boolean;
  languageCode: string; // ISO 639-1 code
  detectedCountry?: string; // ISO 3166-1 alpha-2 code
  readyToBuy?: boolean;
  needsMoreInfo?: boolean;
  emotion?: string;
  urgency?: string;
  sentiment?: string;
  confidence?: number;
  style?: string;
  suggestedAction?: string;
  suggestedMeetingTime?: string | null;
}

export interface Lead {
  id: string | number;
  name: string;
  channel: string;
  status: string;
  tags?: string[];
  created_at?: string;
}



interface AnalysisRecord {
  analysis: IntentAnalysis;
}

// AI initialization removed in favor of unified ai-service

/**
 * Analyze lead message intent using GPT-4
 */
export async function analyzeLeadIntent(
  message: string,
  lead: Lead
): Promise<IntentAnalysis> {
  try {
    let conversationContext = '';
    let brandKnowledgeCtx = '';
    let fullLead: any = null;

    try {
      fullLead = await storage.getLead(lead.id.toString());
      const messages = await storage.getMessagesByLeadId(lead.id.toString());
      
      if (messages && messages.length > 0) {
        // Grab the last 15 messages for deep pipeline context
        conversationContext = messages.slice(-15).map(m => 
          `${m.direction === 'inbound' ? 'Lead' : 'Sales/AI'}: ${m.body}`
        ).join('\n\n');
      }

      if (fullLead && fullLead.userId) {
        const user = await storage.getUserById(fullLead.userId);
        const replyTone = (user?.metadata as any)?.replyTone || 'professional';
        
        brandKnowledgeCtx = [
          user?.brandGuidelinePdfText,
          `Preferred Response Tone: ${replyTone}`,
          await storage.getBrandKnowledge(fullLead.userId)
        ].filter(Boolean).join('\n---\n') || '';
      }
    } catch (e) {
      console.error('Failed to fetch conversation context and brand knowledge for AI', e);
    }

    const prompt = `Analyze this lead message for sales intent, sentiment, and pipeline data.

Lead Information:
- Name: ${lead.name}
- Channel: ${lead.channel}
- Current Status: ${lead.status}
- Tags: ${lead.tags?.join(', ') || 'none'}

Brand/Product Context (From Uploaded PDFs):
${brandKnowledgeCtx || 'None provided'}

Conversation History:
${conversationContext || 'No prior conversation'}

Latest Message: "${message}"

Analyze the entire thread context and the latest message. Return a JSON object with these exact fields:
{
  "isInterested": boolean,
  "isNegative": boolean,
  "hasQuestion": boolean,
  "hasObjection": boolean,
  "wantsToSchedule": boolean,
  "isAvailableForMeeting": boolean, // If they explicitly say yes to a meeting or suggest a date/time
  "suggestedMeetingTime": string | null, // Extract text like "Tuesday at 2pm" or "next week"
  "readyToBuy": boolean,
  "needsMoreInfo": boolean,
  "isOOO": boolean,
  "isWrongPerson": boolean,
  "languageCode": string, // ISO 639-1 (e.g. "en", "es", "zh", "de")
  "detectedCountry": string | null, // ISO 3166-1 alpha-2 (e.g. "US", "ES", "DE")
  "confidence": number (0-1),
  "sentiment": "positive" | "negative" | "neutral",
  "emotion": "curious" | "skeptical" | "frustrated" | "excited" | "neutral" | "urgent",
  "urgency": "high" | "medium" | "low",
  "style": "formal" | "casual" | "blunt" | "warm",
  "suggestedAction": string,
  "keywords": string[],
  "productMentioned": string | null, // If a specific product/service is discussed
  "offeredPrice": number | null // Extract explicit pricing or quoted amount if negotiation occurred
}

Focus on buying signals like:
- "interested", "love it", "perfect", "need this"
- "how much", "pricing", "cost", "payment" (Extract number to offeredPrice)
- "when can we", "schedule", "meet", "call", "demo"
- "sign up", "get started", "purchase", "buy"

Negative signals:
- "not interested", "no thanks", "unsubscribe", "stop"
- "too expensive", "can't afford", "not now"
- "already have", "using another", "competitor"

Return ONLY valid JSON, no explanation.`;

    const responseBody = await generateReply(
      'You are an elite sales intent analyzer. Analyze messages and return raw JSON only.',
      prompt,
      {
        model: MODELS.intent_classification,
        jsonMode: true,
        temperature: 0.1,
        maxTokens: 500
      }
    );

    const response = responseBody.text;
    if (!response) {
      throw new Error('No response from OpenAI');
    }

    const analysis = JSON.parse(response) as IntentAnalysis;

    // Intelligent Tagging Integration
    const tags = await suggestLeadTags(lead, message, analysis);

    // Determine new status based on intent
    let newStatus = lead.status;
    if (analysis.wantsToSchedule || analysis.readyToBuy) {
      newStatus = 'booked';
    } else if (analysis.isInterested) {
      newStatus = 'warm';
    } else if (analysis.isNegative) {
      newStatus = 'not_interested';
    } else {
      newStatus = 'replied';
    }

    // Pipeline automation: Auto-create or Update Deal based on AI
    try {
      if (fullLead && fullLead.userId) {
        const userId = fullLead.userId;
        const deals = await storage.getDeals(userId);
        const existingDeal = deals.find(d => d.leadId === fullLead.id);

        const dealValue = analysis.offeredPrice || Number((fullLead.metadata as any)?.intelligence?.predictions?.predictedAmount) || 500;
        
        // Let's only create/update if there's clear intent or an offered price
        if (analysis.offeredPrice || analysis.readyToBuy || analysis.wantsToSchedule || analysis.isInterested) {
          if (existingDeal) {
            // Update existing deal if status advanced or price changed
            const updates: any = {};
            if (analysis.offeredPrice && existingDeal.value !== analysis.offeredPrice) {
               updates.amount = analysis.offeredPrice;
               updates.metadata = { ...existingDeal.metadata, aiUpdatedPrice: true };
            }
            if ((analysis.readyToBuy || analysis.wantsToSchedule) && existingDeal.status === 'open') {
               updates.status = 'closed_won';
            }
            if (Object.keys(updates).length > 0) {
              await storage.updateDeal(existingDeal.id.toString(), userId, updates);
              wsSync.notifyDealsUpdated(userId);
            }
          } else {
            // Create a new deal based on AI intelligence
            await storage.createDeal({
              userId,
              leadId: fullLead.id,
              title: `AI Deal: ${fullLead.name} - ${analysis.productMentioned || 'Service'}`,
              amount: dealValue,
              status: (analysis.readyToBuy || analysis.wantsToSchedule) ? 'closed_won' : 'open',
              source: 'ai_extraction',
              metadata: { aiExtracted: true, intentAnalysis: analysis }
            });
            wsSync.notifyDealsUpdated(userId);
          }
        }
      }
    } catch (e) {
      console.error('Failed to auto-update deal pipeline from AI intent:', e);
    }

    // --- PHASE 49: Sentiment-Based Priority Override ---
    // If they are excited or urgent, force Category A (Score 100) immediately
    if (analysis.emotion === 'excited' || analysis.urgency === 'high') {
      console.log(`🔥 [Priority Boost] High intensity detected for lead ${lead.id}. Boosting to Category A.`);
      await storage.updateLead(lead.id.toString(), {
        score: 100, // VIP / Category A
        metadata: {
          ...(lead as any).metadata,
          priority_boost_reason: `Detected ${analysis.emotion} emotion / ${analysis.urgency} urgency`
        }
      });
    }

    // Log intent analysis to audit trail
    await AuditTrailService.logIntentDetected(lead.id.toString(), lead.id.toString(), analysis.sentiment || 'neutral', analysis.confidence || 0);

    return analysis;

  } catch (error) {
    console.error('Error analyzing intent:', error);
    return performBasicIntentAnalysis(message);
  }
}

/**
 * Basic keyword-based intent analysis as fallback
 */
function performBasicIntentAnalysis(message: string): IntentAnalysis {
  const lowerMessage = message.toLowerCase();

  const positiveKeywords = [
    'interested', 'yes', 'sure', 'love', 'great', 'perfect',
    'need', 'want', 'looking for', 'sounds good', 'tell me more',
    'how much', 'pricing', 'cost', 'when', 'available'
  ];

  const negativeKeywords = [
    'not interested', 'no', 'stop', 'unsubscribe', 'remove',
    'don\'t', 'cant', 'won\'t', 'never', 'spam', 'leave me alone'
  ];

  const schedulingKeywords = [
    'schedule', 'meeting', 'call', 'demo', 'appointment',
    'calendar', 'book', 'available', 'free', 'talk'
  ];

  const buyingKeywords = [
    'buy', 'purchase', 'sign up', 'register', 'start',
    'get started', 'ready', 'let\'s do', 'deal', 'sold'
  ];

  const hasPositive = positiveKeywords.some(kw => lowerMessage.includes(kw));
  const hasNegative = negativeKeywords.some(kw => lowerMessage.includes(kw));
  const hasScheduling = schedulingKeywords.some(kw => lowerMessage.includes(kw));
  const hasBuying = buyingKeywords.some(kw => lowerMessage.includes(kw));
  const hasQuestion = lowerMessage.includes('?') ||
    ['what', 'how', 'when', 'where', 'why', 'who'].some(q => lowerMessage.includes(q));

  return {
    isInterested: hasPositive && !hasNegative,
    isNegative: hasNegative,
    hasQuestion,
    hasObjection: lowerMessage.includes('but') || lowerMessage.includes('however'),
    wantsToSchedule: hasScheduling,
    isAvailableForMeeting: hasScheduling, // For basic analysis, we assume if they want to schedule they are available
    readyToBuy: hasBuying,
    needsMoreInfo: hasQuestion && !hasNegative,
    confidence: 0.6,
    sentiment: hasNegative ? 'negative' : hasPositive ? 'positive' : 'neutral',
    keywords: [],
    emotion: 'neutral',
    urgency: 'low',
    style: 'casual',
    isOOO: false,
    isWrongPerson: false,
    languageCode: 'en',
    productMentioned: undefined,
    offeredPrice: undefined
  };
}



export async function suggestLeadTags(lead: Lead, latestMessage?: string, analysis?: IntentAnalysis): Promise<string[]> {
  try {
    const messages = await storage.getMessagesByLeadId(lead.id.toString());
    const history = messages?.slice(-5).map(m => `${m.direction === 'inbound' ? 'Lead' : 'AI'}: ${m.body} `).join('\n') || 'No history';

    const prompt = `Analyze this conversation and suggest 3 - 5 technical tags for this lead.

  Lead: ${lead.name}
Channel: ${lead.channel}
    Current Tags: ${lead.tags?.join(', ') || 'none'}
    
    Conversation History:
    ${history}
    
    ${latestMessage ? `Latest Message: "${latestMessage}"` : ''}
    ${analysis ? `AI Analysis: ${JSON.stringify(analysis)}` : ''}

Rules:
- Include industry tags(e.g., "SaaS", "Real Estate", "Ecommerce")
  - Include intent tags(e.g., "High Intent", "Price Sensitive", "Technical Buyer")
    - Include status tags(e.g., "Decision Maker", "Information Seeker")
      - Return a string array of tags only.

        Example: ["SaaS", "High Intent", "Decision Maker", "Q1 Timeline"]
    Return JSON: { "tags": ["string"] } `;

    const responseBody = await generateReply(
      'You are an intelligent lead tagger.',
      prompt,
      {
        model: MODELS.intent_classification,
        jsonMode: true
      }
    );

    const result = JSON.parse(responseBody.text || '{"tags": []}');
    const newTags = Array.from(new Set([...(lead.tags || []), ...(result.tags || [])]));
    return newTags.slice(0, 10); // Limit to 10 tags
  } catch (error) {
    return lead.tags || [];
  }
}

/**
 * Analyze lead quality score
 */
export async function calculateLeadQualityScore(lead: Lead): Promise<{
  score: number;
  factors: {
    engagement: number;
    intent: number;
    fit: number;
    timing: number;
  };
  recommendation: string;
}> {
  const messages = await storage.getMessagesByLeadId(lead.id.toString());
  const analyses = (lead as any).metadata?.intentAnalysis ? [(lead as any).metadata.intentAnalysis] : [];

  const messageCount = messages?.length || 0;
  const responseRate = messages ?
    messages.filter((m: Message) => m.direction === 'inbound').length / Math.max(1, messages.filter((m: Message) => m.direction === 'outbound').length) : 0;
  const engagementScore = Math.min(100, (messageCount * 10) + (responseRate * 30));

  const recentAnalyses = analyses?.map((a: AnalysisRecord) => a.analysis) || [];
  const avgConfidence = recentAnalyses.length > 0 ?
    recentAnalyses.reduce((sum: number, a: IntentAnalysis) => sum + (a.confidence || 0), 0) / recentAnalyses.length : 0;
  const positiveCount = recentAnalyses.filter((a: IntentAnalysis) => a.isInterested || a.wantsToSchedule || a.readyToBuy).length;
  const intentScore = (avgConfidence * 50) + (positiveCount * 10);

  const fitScore = calculateFitScore(lead);

  const lastMessageDate = messages?.[0]?.createdAt ? new Date(messages[0].createdAt) : new Date(lead.created_at || Date.now());
  const daysSinceLastMessage = (Date.now() - lastMessageDate.getTime()) / (1000 * 60 * 60 * 24);
  const timingScore = Math.max(0, 100 - (daysSinceLastMessage * 12)); // Increased decay from 5 to 12

  const overallScore = Math.round(
    (engagementScore * 0.3) +
    (intentScore * 0.4) +
    (fitScore * 0.2) +
    (timingScore * 0.1)
  );

  let recommendation = '';
  if (overallScore >= 80) {
    recommendation = 'Hot lead - prioritize immediate follow-up and schedule meeting';
  } else if (overallScore >= 60) {
    recommendation = 'Warm lead - continue nurturing with personalized content';
  } else if (overallScore >= 40) {
    recommendation = 'Cool lead - maintain regular touchpoints';
  } else {
    recommendation = 'Cold lead - add to long-term nurture campaign';
  }

  return {
    score: overallScore,
    factors: {
      engagement: Math.round(engagementScore),
      intent: Math.round(intentScore),
      fit: Math.round(fitScore),
      timing: Math.round(timingScore)
    },
    recommendation
  };
}

function calculateFitScore(lead: Lead): number {
  let score = 50;

  const tags = lead.tags || [];

  if (tags.includes('enterprise')) score += 20;
  if (tags.includes('quality-focused')) score += 15;
  if (tags.includes('urgent')) score += 15;
  if (tags.includes('timeline-defined')) score += 10;

  if (tags.includes('price-sensitive')) score -= 10;
  if (tags.includes('cold')) score -= 20;

  if (lead.channel === 'instagram') score += 5;
  if (lead.channel === 'email') score += 10;

  return Math.max(0, Math.min(100, score));
}





