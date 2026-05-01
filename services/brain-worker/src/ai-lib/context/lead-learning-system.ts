import { storage } from '@shared/lib/storage/storage.js';
import { type Lead, type Message } from "@audnix/shared";

// Local interfaces for internal behavior patterns

interface LeadBehaviorPattern {
  userId: string;
  leadId: string;
  responseTime: number;
  messageLength: number;
  preferredTime: string;
  sentimentTrend: 'positive' | 'neutral' | 'negative';
  engagementScore: number;
  temperature: 'hot' | 'warm' | 'cold';
  conversionSignals: string[];
  objectionPatterns: string[];
  lastUpdated: string;
}

interface SemanticMemoryRecord {
  content: string;
}

export class LeadLearningSystem {

  async analyzeAndLearn(leadId: string, _newMessage?: unknown): Promise<void> {
    try {
      const lead = await storage.getLeadById(leadId);
      if (!lead) return;

      const messages = await storage.getMessagesByLeadId(leadId);
      if (!messages || messages.length === 0) return;

      const behaviorPattern = this.calculateBehaviorPattern(messages, lead);

      // Save to lead metadata for persistence
      await storage.updateLead(leadId, {
        metadata: {
          ...lead.metadata,
          behavior_pattern: behaviorPattern
        }
      });

      console.log(`✅ Learned behavior pattern for lead ${leadId}`);
    } catch (error) {
      console.error('Error in lead learning system:', error);
    }
  }

  private calculateBehaviorPattern(messages: Message[], lead: Lead): LeadBehaviorPattern {
    const userMessages = messages.filter((m: Message) => m.direction === 'inbound');

    let totalResponseTime = 0;
    let responseCount = 0;
    for (let i = 1; i < messages.length; i++) {
      if (messages[i].direction === 'inbound' && messages[i - 1].direction === 'outbound') {
        const diff = new Date(messages[i].createdAt).getTime() - new Date(messages[i - 1].createdAt).getTime();
        totalResponseTime += diff / (1000 * 60);
        responseCount++;
      }
    }
    const avgResponseTime = responseCount > 0 ? totalResponseTime / responseCount : 0;

    const avgMessageLength = userMessages.reduce((sum: number, m: Message) => sum + m.body.length, 0) / (userMessages.length || 1);

    const timeSlots: Record<string, number> = { morning: 0, afternoon: 0, evening: 0, night: 0 };
    userMessages.forEach((m: Message) => {
      const hour = new Date(m.createdAt).getHours();
      if (hour >= 6 && hour < 12) timeSlots.morning++;
      else if (hour >= 12 && hour < 17) timeSlots.afternoon++;
      else if (hour >= 17 && hour < 22) timeSlots.evening++;
      else timeSlots.night++;
    });
    const preferredTime = Object.entries(timeSlots).reduce((a, b) => a[1] > b[1] ? a : b)[0];

    const recentMessages = userMessages.slice(-5);
    const positiveWords = ['yes', 'great', 'thanks', 'perfect', 'interested', 'good', 'awesome'];
    const negativeWords = ['no', 'not', "don't", 'busy', 'later', 'expensive', 'stop'];

    let positiveCount = 0;
    let negativeCount = 0;
    recentMessages.forEach((m: Message) => {
      const lower = m.body.toLowerCase();
      positiveWords.forEach((word: string) => { if (lower.includes(word)) positiveCount++; });
      negativeWords.forEach((word: string) => { if (lower.includes(word)) negativeCount++; });
    });

    const sentimentTrend: 'positive' | 'neutral' | 'negative' = positiveCount > negativeCount ? 'positive' :
      negativeCount > positiveCount ? 'negative' : 'neutral';

    const conversionSignals: string[] = [];
    const conversionPhrases = ['how much', 'price', 'buy', 'purchase', 'pay', 'link', 'checkout', 'demo', 'schedule'];
    userMessages.forEach((m: Message) => {
      const lower = m.body.toLowerCase();
      conversionPhrases.forEach((phrase: string) => {
        if (lower.includes(phrase) && !conversionSignals.includes(phrase)) {
          conversionSignals.push(phrase);
        }
      });
    });

    const objectionPatterns: string[] = [];
    const objectionPhrases = ['too expensive', 'not sure', 'need to think', 'maybe later', 'not now', 'not interested'];
    userMessages.forEach((m: Message) => {
      const lower = m.body.toLowerCase();
      objectionPhrases.forEach((phrase: string) => {
        if (lower.includes(phrase) && !objectionPatterns.includes(phrase)) {
          objectionPatterns.push(phrase);
        }
      });
    });

    let engagementScore = 50;

    if (avgResponseTime < 5) engagementScore += 20;
    else if (avgResponseTime < 30) engagementScore += 10;
    else if (avgResponseTime > 120) engagementScore -= 20;

    if (avgMessageLength > 100) engagementScore += 15;
    else if (avgMessageLength < 20) engagementScore -= 10;

    if (sentimentTrend === 'positive') engagementScore += 15;
    else if (sentimentTrend === 'negative') engagementScore -= 15;

    engagementScore += conversionSignals.length * 10;
    engagementScore -= objectionPatterns.length * 5;
    engagementScore = Math.max(0, Math.min(100, engagementScore));

    const temperature: 'hot' | 'warm' | 'cold' =
      engagementScore > 70 ? 'hot' :
        engagementScore > 40 ? 'warm' : 'cold';

    return {
      userId: lead.userId,
      leadId: lead.id,
      responseTime: Math.round(avgResponseTime),
      messageLength: Math.round(avgMessageLength),
      preferredTime,
      sentimentTrend,
      engagementScore: Math.round(engagementScore),
      temperature,
      conversionSignals,
      objectionPatterns,
      lastUpdated: new Date().toISOString()
    };
  }

  async getLeadInsights(leadId: string): Promise<LeadBehaviorPattern | null> {
    try {
      const lead = await storage.getLeadById(leadId);
      if (!lead?.metadata) return null;

      const metadata = lead.metadata as Record<string, any>;
      return metadata.behavior_pattern as LeadBehaviorPattern || null;
    } catch (error) {
      console.error('Error getting lead insights:', error);
      return null;
    }
  }
}

export const leadLearningSystem = new LeadLearningSystem();



