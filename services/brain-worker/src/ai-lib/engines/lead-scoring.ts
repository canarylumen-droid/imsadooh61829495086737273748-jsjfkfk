import { storage } from '@shared/lib/storage/storage.js';
import type { Lead, Message } from '@audnix/shared';

interface LeadScore {
  score: number;
  breakdown: {
    engagement: number;
    responseTime: number;
    conversionSignals: number;
    sentiment: number;
    recency: number;
  };
  temperature: 'hot' | 'warm' | 'cold';
  priority: 'high' | 'medium' | 'low';
  recommendedAction: string;
}

/**
 * Calculate comprehensive lead score (0-100)
 */
export async function calculateLeadScore(leadId: string): Promise<LeadScore> {
  const lead = await storage.getLeadById(leadId);
  if (!lead) {
    throw new Error('Lead not found');
  }

  const messages = await storage.getMessagesByLeadId(leadId);
  
  const breakdown = {
    engagement: calculateEngagementScore(messages),
    responseTime: calculateResponseTimeScore(messages),
    conversionSignals: calculateConversionSignalScore(messages),
    sentiment: calculateSentimentScore(messages),
    recency: calculateRecencyScore(lead, messages)
  };

  const totalScore = Math.round(
    breakdown.engagement * 0.3 +
    breakdown.responseTime * 0.2 +
    breakdown.conversionSignals * 0.25 +
    breakdown.sentiment * 0.15 +
    breakdown.recency * 0.1
  );

  const temperature = getTemperature(totalScore);
  const priority = getPriority(totalScore);
  const recommendedAction = getRecommendedAction(totalScore, lead, messages);

  return {
    score: totalScore,
    breakdown,
    temperature,
    priority,
    recommendedAction
  };
}

function calculateEngagementScore(messages: Message[]): number {
  const inboundMessages = messages.filter(m => m.direction === 'inbound');
  const messageCount = inboundMessages.length;
  
  let score = 0;
  
  // Message frequency (0-40 points)
  if (messageCount >= 10) score += 40;
  else if (messageCount >= 5) score += 30;
  else if (messageCount >= 3) score += 20;
  else if (messageCount >= 1) score += 10;
  
  // Message length (0-30 points)
  const avgLength = inboundMessages.reduce((sum, m) => sum + (m.body?.length || 0), 0) / (messageCount || 1);
  if (!isNaN(avgLength)) {
    if (avgLength > 100) score += 30;
    else if (avgLength > 50) score += 20;
    else if (avgLength > 20) score += 10;
  }
  
  // Question asking (0-30 points)
  const questionsAsked = inboundMessages.filter(m => m.body && m.body.includes('?')).length;
  if (questionsAsked >= 3) score += 30;
  else if (questionsAsked >= 2) score += 20;
  else if (questionsAsked >= 1) score += 10;
  
  return Math.min(100, score);
}

function calculateResponseTimeScore(messages: Message[]): number {
  if (messages.length < 2) return 50;
  
  let totalResponseTime = 0;
  let responseCount = 0;
  
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].direction === 'inbound' && messages[i - 1].direction === 'outbound') {
      const t1 = new Date(messages[i].createdAt).getTime();
      const t2 = new Date(messages[i - 1].createdAt).getTime();
      if (isNaN(t1) || isNaN(t2)) continue;
      const timeDiff = t1 - t2;
      const minutes = timeDiff / (1000 * 60);
      totalResponseTime += minutes;
      responseCount++;
    }
  }
  
  if (responseCount === 0) return 50;
  
  const avgResponseTime = totalResponseTime / responseCount;
  
  // Fast responders get high scores
  if (avgResponseTime < 5) return 100;
  if (avgResponseTime < 15) return 80;
  if (avgResponseTime < 60) return 60;
  if (avgResponseTime < 180) return 40;
  if (avgResponseTime < 1440) return 20;
  return 10;
}

function calculateConversionSignalScore(messages: Message[]): number {
  const inboundMessages = messages.filter(m => m.direction === 'inbound');
  const allText = inboundMessages.map(m => m.body.toLowerCase()).join(' ');
  
  let score = 0;
  
  // High-intent keywords (20 points each, max 60)
  const highIntentKeywords = ['buy', 'purchase', 'price', 'cost', 'how much', 'payment'];
  highIntentKeywords.forEach(keyword => {
    if (allText.includes(keyword)) score += 20;
  });
  
  // Medium-intent keywords (10 points each, max 30)
  const mediumIntentKeywords = ['interested', 'tell me more', 'details', 'demo', 'trial'];
  mediumIntentKeywords.forEach(keyword => {
    if (allText.includes(keyword)) score += 10;
  });
  
  // Urgency signals (10 points)
  const urgencyKeywords = ['today', 'now', 'asap', 'urgent', 'quick'];
  if (urgencyKeywords.some(keyword => allText.includes(keyword))) score += 10;
  
  return Math.min(100, score);
}

function calculateSentimentScore(messages: Message[]): number {
  const inboundMessages = messages.filter(m => m.direction === 'inbound');
  const allText = inboundMessages.map(m => m.body.toLowerCase()).join(' ');
  
  const positiveWords = ['great', 'awesome', 'perfect', 'thanks', 'yes', 'love', 'excellent', 'amazing'];
  const negativeWords = ['no', 'not', "don't", 'never', 'stop', 'unsubscribe', 'expensive', 'too much'];
  
  let positiveCount = 0;
  let negativeCount = 0;
  
  positiveWords.forEach(word => {
    const matches = allText.match(new RegExp(`\\b${word}\\b`, 'g'));
    if (matches) positiveCount += matches.length;
  });
  
  negativeWords.forEach(word => {
    const matches = allText.match(new RegExp(`\\b${word}\\b`, 'g'));
    if (matches) negativeCount += matches.length;
  });
  
  if (positiveCount === 0 && negativeCount === 0) return 50;
  
  const sentimentRatio = positiveCount / (positiveCount + negativeCount);
  return Math.round(sentimentRatio * 100);
}

function calculateRecencyScore(lead: Lead, messages: Message[]): number {
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) return 0;
  
  const hoursSinceLastMessage = (Date.now() - new Date(lastMessage.createdAt).getTime()) / (1000 * 60 * 60);
  
  if (hoursSinceLastMessage < 1) return 100;
  if (hoursSinceLastMessage < 6) return 80;
  if (hoursSinceLastMessage < 24) return 60;
  if (hoursSinceLastMessage < 72) return 40;
  if (hoursSinceLastMessage < 168) return 20;
  return 10;
}

function getTemperature(score: number): 'hot' | 'warm' | 'cold' {
  if (score >= 70) return 'hot';
  if (score >= 40) return 'warm';
  return 'cold';
}

function getPriority(score: number): 'high' | 'medium' | 'low' {
  if (score >= 80) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

function getRecommendedAction(score: number, lead: Lead, messages: Message[]): string {
  if (score >= 80) {
    return 'High priority - Contact immediately with personalized offer';
  }
  if (score >= 70) {
    return 'Send voice message or book demo call today';
  }
  if (score >= 50) {
    return 'Follow up with value proposition and case study';
  }
  if (score >= 30) {
    return 'Nurture with educational content';
  }
  return 'Low priority - Add to long-term nurture sequence';
}

/**
 * Auto-update lead scores for all leads
 */
export async function updateAllLeadScores(userId: string): Promise<void> {
  const leads = await storage.getLeads({ userId, limit: 10000 });
  
  for (const lead of leads) {
    try {
      const scoreData = await calculateLeadScore(lead.id);
      const oldTemperature = lead.metadata?.temperature as string;
      const newTemperature = scoreData.temperature;
      
      await storage.updateLead(lead.id, {
        score: scoreData.score,
        warm: scoreData.temperature === 'hot' || scoreData.temperature === 'warm',
        metadata: {
          ...lead.metadata,
          scoreBreakdown: scoreData.breakdown,
          temperature: scoreData.temperature,
          priority: scoreData.priority,
          recommendedAction: scoreData.recommendedAction,
          lastScored: new Date().toISOString()
        }
      });

      // Send notification if temperature changed
      if (oldTemperature && oldTemperature !== newTemperature) {
        await notifyTemperatureChange(userId, lead, oldTemperature, newTemperature, scoreData);
      }
    } catch (error) {
      console.error(`Failed to score lead ${lead.id}:`, error);
    }
  }
}

/**
 * Notify user when lead temperature changes
 */
async function notifyTemperatureChange(
  userId: string,
  lead: any,
  oldTemp: string,
  newTemp: string,
  scoreData: LeadScore
): Promise<void> {
  let title = '';
  let message = '';
  let type: any = 'system';

  if (newTemp === 'hot' && oldTemp !== 'hot') {
    title = '🔥 Lead Heating Up!';
    message = `${lead.name} is now HOT (${scoreData.score}/100). ${scoreData.recommendedAction}`;
    type = 'lead_hot';
  } else if (newTemp === 'cold' && oldTemp !== 'cold') {
    title = '❄️ Lead Cooling Down';
    message = `${lead.name} went cold (${scoreData.score}/100). Consider re-engagement campaign.`;
    type = 'lead_cold';
  } else if (newTemp === 'warm' && oldTemp === 'cold') {
    title = '🌡️ Lead Warming Up';
    message = `${lead.name} is showing renewed interest (${scoreData.score}/100).`;
    type = 'lead_warm';
  }

  if (title) {
    await storage.createNotification({
      userId,
      type,
      title,
      message,
      metadata: {
        leadId: lead.id,
        leadName: lead.name,
        oldTemperature: oldTemp,
        newTemperature: newTemp,
        score: scoreData.score,
        priority: scoreData.priority,
        activityType: 'temperature_change'
      }
    });
  }
}



