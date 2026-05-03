import { storage } from '@shared/lib/storage/storage.js';
import type { Message } from '@audnix/shared';
import { generateReply } from '../core/ai-service.js';

export interface CompetitorMentionResult {
  detected: boolean;
  competitor: string;
  context: 'positive' | 'negative' | 'neutral' | 'comparison';
  response: string;
  sentiment: number; // -1 to 1
}

const COMPETITORS = {
  manychat: {
    name: 'ManyChat',
    keywords: ['manychat', 'many chat', 'chatbot'],
    advantages: [
      'Unlike ManyChat, we use AI - not rigid keyword matching',
      'ManyChat is Instagram-only. We work across Instagram & Email',
      'We offer voice cloning - ManyChat doesn\'t',
      'Our AI learns from your conversations - ManyChat uses fixed templates'
    ]
  },
  commentguard: {
    name: 'CommentGuard',
    keywords: ['commentguard', 'comment guard'],
    advantages: [
      'CommentGuard is limited to 10 videos. We have unlimited monitoring',
      'We detect intent with AI - no keyword setup needed',
      'Our AI handles objections naturally - not canned responses',
      'We offer multi-language support automatically'
    ]
  },
  mobilemonkey: {
    name: 'MobileMonkey',
    keywords: ['mobilemonkey', 'mobile monkey'],
    advantages: [
      'MobileMonkey focuses on ads. We focus on converting DMs',
      'Our AI is conversational - not a bot flow',
      'We offer voice messages - they don\'t',
      'Lower pricing with better AI capabilities'
    ]
  },
  chatfuel: {
    name: 'Chatfuel',
    keywords: ['chatfuel', 'chat fuel'],
    advantages: [
      'Chatfuel requires coding. We\'re plug-and-play',
      'Our AI adapts in real-time - no template management',
      'We offer voice cloning for personal touch',
      'Better lead scoring and analytics'
    ]
  },
  generic: {
    name: 'Other Tools',
    keywords: ['bot', 'automation tool', 'crm', 'chat software'],
    advantages: [
      'We use advanced AI that understands context',
      'Human-like responses, not robotic templates',
      'Voice cloning for authentic communication',
      'Multi-channel: Instagram & Email in one place'
    ]
  }
};

/**
 * Detect competitor mentions in message
 */
export async function detectCompetitorMention(message: string): Promise<CompetitorMentionResult> {
  const lowerMessage = message.toLowerCase();

  // Find which competitor was mentioned
  let detectedCompetitor: string | null = null;
  let competitorData: any = null;

  for (const [key, data] of Object.entries(COMPETITORS)) {
    for (const keyword of data.keywords) {
      if (lowerMessage.includes(keyword)) {
        detectedCompetitor = key;
        competitorData = data;
        break;
      }
    }
    if (detectedCompetitor) break;
  }

  // --- PHASE 37: AI FALLBACK FOR UNKNOWN COMPETITORS ---
  if (!detectedCompetitor) {
    const aiDetection = await generateReply(
      `Analyze this message. Is the user mentioning a specific software competitor or automation tool? Return a JSON object: { "mentioned": boolean, "competitorName": string | null, "sentiment": number }`,
      message,
      { model: "gpt-4-mini", jsonMode: true, nga1Enforced: true }
    ).catch(() => null);
    
    try {
      const parsed = JSON.parse(aiDetection?.text || '{}');
      if (parsed.mentioned && parsed.competitorName) {
        const dynamicResponse = await generateDynamicBattleCard(parsed.competitorName, message);
        return {
          detected: true,
          competitor: parsed.competitorName,
          context: 'comparison',
          response: dynamicResponse,
          sentiment: parsed.sentiment || 0
        };
      }
    } catch (e) {}
  }

  if (!detectedCompetitor || !competitorData) {
    return {
      detected: false,
      competitor: '',
      context: 'neutral',
      response: '',
      sentiment: 0
    };
  }

  // Determine context and sentiment
  const context = determineContext(lowerMessage, competitorData.name);
  const sentiment = analyzeSentiment(lowerMessage);

  // Generate comparison response
  const response = generateComparisonResponse(competitorData, context);

  return {
    detected: true,
    competitor: competitorData.name,
    context,
    response,
    sentiment
  };
}

/**
 * PHASE 37: Generate a strategic comparison against a competitor we don't have static data for.
 */
async function generateDynamicBattleCard(competitorName: string, originalMessage: string): Promise<string> {
  const prompt = `The lead mentioned a competitor: "${competitorName}". 
Context: "${originalMessage}"

Our Product: Audnix (AI outreach engine, voice cloning, multi-channel Instagram/Email, autonomous intent detection).

Task: Generate a professional, short (1-2 sentence) "Battle Card" response. 
Focus on 1 specific advantage of Audnix over ${competitorName} (e.g. better AI, voice personalization, multi-channel setup).
Tone: Respectful but confident. 
Do NOT mention you are an AI.`;

  const reply = await generateReply("You are an expert sales representative.", prompt, { model: "gpt-4", nga1Enforced: true });
  return reply?.text || `Interesting! We actually handle things a bit differently than ${competitorName} by focusing on deep AI personalization and multi-channel outreach. Would you like to see how we compare?`;
}

/**
 * Determine the context of competitor mention
 */
function determineContext(message: string, competitorName: string): 'positive' | 'negative' | 'neutral' | 'comparison' {
  // Comparison keywords
  const comparisonKeywords = ['vs', 'versus', 'compared to', 'better than', 'worse than', 'difference'];
  if (comparisonKeywords.some(k => message.includes(k))) {
    return 'comparison';
  }

  // Negative context
  const negativeKeywords = ['but', 'however', 'disappointed', 'switched from', 'left', 'abandoned'];
  if (negativeKeywords.some(k => message.includes(k))) {
    return 'negative';
  }

  // Positive context
  const positiveKeywords = ['love', 'great', 'good', 'using', 'works well'];
  if (positiveKeywords.some(k => message.includes(k))) {
    return 'positive';
  }

  return 'neutral';
}

/**
 * Analyze sentiment towards competitor
 */
export function analyzeSentiment(message: string): number {
  const positiveWords = ['love', 'great', 'good', 'best', 'amazing', 'perfect'];
  const negativeWords = ['hate', 'bad', 'worst', 'terrible', 'disappointed', 'limited'];

  let score = 0;
  for (const word of positiveWords) {
    if (message.includes(word)) score += 0.2;
  }
  for (const word of negativeWords) {
    if (message.includes(word)) score -= 0.2;
  }

  return Math.max(-1, Math.min(1, score));
}

/**
 * Generate comparison response
 */
function generateComparisonResponse(competitorData: any, context: string): string {
  const advantage = competitorData.advantages[Math.floor(Math.random() * competitorData.advantages.length)];

  const responses = {
    comparison: [
      `Great question! ${advantage} 🚀`,
      `I'm glad you asked! ${advantage} Want me to show you?`,
      `Here's the key difference: ${advantage} Would you like a demo?`
    ],
    negative: [
      `I hear you! Many ${competitorData.name} users switch to us because ${advantage}`,
      `Totally understand! ${advantage} Let me show you the difference 💪`,
      `That's exactly why we built Audnix differently. ${advantage}`
    ],
    positive: [
      `${competitorData.name} is solid! But we take it further: ${advantage}`,
      `Nice choice with ${competitorData.name}! We actually go beyond that - ${advantage}`,
      `Respect for using ${competitorData.name}! Here's what makes us different: ${advantage}`
    ],
    neutral: [
      `Good to know! Here's how we compare: ${advantage}`,
      `Let me share what makes us unique: ${advantage}`,
      `I'll be honest - ${advantage} Want to see it in action?`
    ]
  };

  const options = responses[context as keyof typeof responses] || responses.neutral;
  return options[Math.floor(Math.random() * options.length)];
}

/**
 * Track competitor mentions for analytics
 */
export async function trackCompetitorMention(
  userId: string,
  leadId: string,
  competitor: string,
  context: string,
  sentiment: number
): Promise<void> {
  const lead = await storage.getLeadById(leadId);
  if (!lead) return;

  const mentions = (lead.metadata?.competitorMentions as any[]) || [];
  mentions.push({
    competitor,
    context,
    sentiment,
    timestamp: new Date().toISOString()
  });

  await storage.updateLead(leadId, {
    metadata: {
      ...lead.metadata,
      competitorMentions: mentions,
      lastCompetitorMention: competitor
    }
  });

  // Create notification for high-value competitive mentions
  if (context === 'comparison' || context === 'negative') {
    await storage.createNotification({
      userId,
      type: 'system',
      title: '🎯 Competitive Opportunity',
      message: `${lead.name} mentioned ${competitor}. Time to highlight your advantages!`,
      metadata: {
        leadId,
        competitor,
        context,
        activityType: 'competitor_mention'
      }
    });
  }
}

/**
 * Get competitor analytics
 */
export async function getCompetitorAnalytics(userId: string): Promise<{
  totalMentions: number;
  byCompetitor: Record<string, number>;
  sentiment: Record<string, number>;
  recentMentions: any[];
}> {
  const leads = await storage.getLeads({ userId, limit: 10000 });

  let totalMentions = 0;
  const byCompetitor: Record<string, number> = {};
  const sentimentScores: number[] = [];
  const recentMentions: any[] = [];

  for (const lead of leads) {
    const mentions = (lead.metadata?.competitorMentions as any[]) || [];
    totalMentions += mentions.length;

    for (const mention of mentions) {
      byCompetitor[mention.competitor] = (byCompetitor[mention.competitor] || 0) + 1;
      sentimentScores.push(mention.sentiment);

      if (recentMentions.length < 10) {
        recentMentions.push({
          leadName: lead.name,
          competitor: mention.competitor,
          context: mention.context,
          timestamp: mention.timestamp
        });
      }
    }
  }

  const avgSentiment = sentimentScores.length > 0
    ? sentimentScores.reduce((sum, s) => sum + s, 0) / sentimentScores.length
    : 0;

  return {
    totalMentions,
    byCompetitor,
    sentiment: {
      average: avgSentiment,
      positive: sentimentScores.filter(s => s > 0).length,
      negative: sentimentScores.filter(s => s < 0).length,
      neutral: sentimentScores.filter(s => s === 0).length
    },
    recentMentions: recentMentions.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )
  };
}




