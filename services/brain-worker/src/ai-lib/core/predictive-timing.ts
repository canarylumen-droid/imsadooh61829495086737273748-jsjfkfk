import type { MessageDirection } from '@shared/types.js';

interface ConversationMessage {
  body: string;
  direction: MessageDirection;
  createdAt: Date;
}

interface LeadBehavior {
  averageResponseTimeMs?: number;
  preferredHours?: number[];
  preferredDays?: number[];
  engagementScore?: number;
  lastActiveAt?: Date;
  timezone?: string;
  conversationDepth?: number;
  buyingSignals?: number;
  objectionCount?: number;
  ghostedCount?: number;
}

interface PredictiveTimingResult {
  optimalSendTime: Date;
  confidence: number;
  reason: string;
  adjustedForTimezone: boolean;
  shouldFollowUp: boolean;
  expectedROI: 'high' | 'medium' | 'low';
  followUpStrategy: string;
}

interface ConversationInsights {
  isWarmingUp: boolean;
  isGhosting: boolean;
  showsBuyingIntent: boolean;
  hasObjections: boolean;
  needsNurturing: boolean;
  readyToClose: boolean;
  sentimentTrend: 'improving' | 'declining' | 'stable';
}

export class PredictiveTimingAnalyzer {
  
  private static readonly BUYING_KEYWORDS = [
    'interested', 'price', 'cost', 'how much', 'pricing', 'demo', 'schedule',
    'call', 'meeting', 'buy', 'purchase', 'sign up', 'get started', 'ready',
    'when can', 'available', 'let\'s do', 'sounds good', 'perfect'
  ];
  
  private static readonly OBJECTION_KEYWORDS = [
    'expensive', 'not now', 'busy', 'later', 'think about', 'too much',
    'not sure', 'competitor', 'already have', 'budget', 'can\'t afford'
  ];
  
  private static readonly NEGATIVE_KEYWORDS = [
    'not interested', 'stop', 'unsubscribe', 'remove', 'spam', 'no thanks'
  ];

  static analyzeConversation(messages: ConversationMessage[]): LeadBehavior {
    if (messages.length === 0) {
      return { conversationDepth: 0, buyingSignals: 0, objectionCount: 0, ghostedCount: 0 };
    }

    const inboundMessages = messages.filter(m => m.direction === 'inbound');
    const outboundMessages = messages.filter(m => m.direction === 'outbound');
    
    const responseTimeDeltas: number[] = [];
    let ghostedCount = 0;
    
    for (let i = 1; i < messages.length; i++) {
      const current = messages[i];
      const previous = messages[i - 1];
      
      if (current.direction === 'inbound' && previous.direction === 'outbound') {
        const delta = current.createdAt.getTime() - previous.createdAt.getTime();
        if (delta > 0 && delta < 7 * 24 * 60 * 60 * 1000) {
          responseTimeDeltas.push(delta);
        }
        if (delta > 48 * 60 * 60 * 1000) {
          ghostedCount++;
        }
      }
    }

    const averageResponseTimeMs = responseTimeDeltas.length > 0
      ? responseTimeDeltas.reduce((a, b) => a + b, 0) / responseTimeDeltas.length
      : undefined;

    const hours = inboundMessages.map(m => m.createdAt.getHours());
    const hourCounts: Record<number, number> = {};
    hours.forEach(h => { hourCounts[h] = (hourCounts[h] || 0) + 1; });
    
    const preferredHours = Object.entries(hourCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([hour]) => parseInt(hour));

    const days = inboundMessages.map(m => m.createdAt.getDay());
    const dayCounts: Record<number, number> = {};
    days.forEach(d => { dayCounts[d] = (dayCounts[d] || 0) + 1; });
    
    const preferredDays = Object.entries(dayCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([day]) => parseInt(day));

    let buyingSignals = 0;
    let objectionCount = 0;
    
    const allText = inboundMessages.map(m => m.body.toLowerCase()).join(' ');
    
    this.BUYING_KEYWORDS.forEach(kw => {
      if (allText.includes(kw)) buyingSignals++;
    });
    
    this.OBJECTION_KEYWORDS.forEach(kw => {
      if (allText.includes(kw)) objectionCount++;
    });

    const recentMessages = inboundMessages.filter(m => {
      const hoursSince = (Date.now() - m.createdAt.getTime()) / (1000 * 60 * 60);
      return hoursSince < 72;
    });
    
    const engagementScore = Math.min(100, 
      recentMessages.length * 15 + 
      buyingSignals * 10 +
      (averageResponseTimeMs && averageResponseTimeMs < 3600000 ? 30 : 0) -
      ghostedCount * 5 -
      objectionCount * 3
    );

    const lastActiveAt = inboundMessages.length > 0
      ? inboundMessages[inboundMessages.length - 1].createdAt
      : undefined;

    return {
      averageResponseTimeMs,
      preferredHours,
      preferredDays,
      engagementScore,
      lastActiveAt,
      conversationDepth: messages.length,
      buyingSignals,
      objectionCount,
      ghostedCount
    };
  }

  static analyzeConversationInsights(messages: ConversationMessage[]): ConversationInsights {
    if (messages.length === 0) {
      return {
        isWarmingUp: false,
        isGhosting: false,
        showsBuyingIntent: false,
        hasObjections: false,
        needsNurturing: true,
        readyToClose: false,
        sentimentTrend: 'stable'
      };
    }

    const inboundMessages = messages.filter(m => m.direction === 'inbound');
    const outboundMessages = messages.filter(m => m.direction === 'outbound');
    
    const lastOutbound = outboundMessages[outboundMessages.length - 1];
    const lastInbound = inboundMessages[inboundMessages.length - 1];
    
    const hoursSinceLastInbound = lastInbound 
      ? (Date.now() - lastInbound.createdAt.getTime()) / (1000 * 60 * 60)
      : 999;
    
    const hoursSinceLastOutbound = lastOutbound
      ? (Date.now() - lastOutbound.createdAt.getTime()) / (1000 * 60 * 60)
      : 0;
    
    const isGhosting = hoursSinceLastOutbound > 0 && 
                       hoursSinceLastOutbound < hoursSinceLastInbound && 
                       hoursSinceLastInbound > 48;
    
    const recentTexts = inboundMessages
      .slice(-5)
      .map(m => m.body.toLowerCase())
      .join(' ');
    
    const showsBuyingIntent = this.BUYING_KEYWORDS.some(kw => recentTexts.includes(kw));
    const hasObjections = this.OBJECTION_KEYWORDS.some(kw => recentTexts.includes(kw));
    const hasNegative = this.NEGATIVE_KEYWORDS.some(kw => recentTexts.includes(kw));
    
    const firstHalf = inboundMessages.slice(0, Math.floor(inboundMessages.length / 2));
    const secondHalf = inboundMessages.slice(Math.floor(inboundMessages.length / 2));
    
    const firstHalfPositive = firstHalf.filter(m => 
      this.BUYING_KEYWORDS.some(kw => m.body.toLowerCase().includes(kw))
    ).length;
    const secondHalfPositive = secondHalf.filter(m =>
      this.BUYING_KEYWORDS.some(kw => m.body.toLowerCase().includes(kw))
    ).length;
    
    let sentimentTrend: 'improving' | 'declining' | 'stable' = 'stable';
    if (secondHalfPositive > firstHalfPositive + 1) sentimentTrend = 'improving';
    if (secondHalfPositive < firstHalfPositive - 1) sentimentTrend = 'declining';
    
    const readyToClose = showsBuyingIntent && 
                         !hasNegative && 
                         sentimentTrend !== 'declining' &&
                         messages.length >= 4;
    
    const needsNurturing = !showsBuyingIntent && 
                          !hasNegative && 
                          messages.length < 6;
    
    const isWarmingUp = sentimentTrend === 'improving' && messages.length >= 3;

    return {
      isWarmingUp,
      isGhosting,
      showsBuyingIntent,
      hasObjections,
      needsNurturing,
      readyToClose,
      sentimentTrend
    };
  }

  static predictOptimalTiming(
    behavior: LeadBehavior,
    baseDelayMs: number,
    temperature: 'hot' | 'warm' | 'cold',
    conversationInsights?: ConversationInsights
  ): PredictiveTimingResult {
    let optimalTime = new Date(Date.now() + baseDelayMs);
    let confidence = 0.5;
    let reason = 'Default timing based on lead temperature';
    let adjustedForTimezone = false;
    let shouldFollowUp = true;
    let expectedROI: 'high' | 'medium' | 'low' = 'medium';
    let followUpStrategy = 'Standard follow-up';

    if (conversationInsights?.isGhosting) {
      const daysSinceActive = behavior.lastActiveAt 
        ? (Date.now() - behavior.lastActiveAt.getTime()) / (1000 * 60 * 60 * 24)
        : 7;
      
      if (daysSinceActive < 3) {
        optimalTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
        followUpStrategy = 'Re-engagement: Wait 24h then send value-add message';
        expectedROI = 'medium';
      } else if (daysSinceActive < 7) {
        optimalTime = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
        followUpStrategy = 'Re-engagement: Wait 3 days with fresh angle';
        expectedROI = 'low';
      } else {
        shouldFollowUp = false;
        followUpStrategy = 'Cool off: Add to monthly nurture campaign instead';
        expectedROI = 'low';
        confidence = 0.8;
      }
      reason = `Ghosting detected (${Math.round(daysSinceActive)} days inactive)`;
      return { optimalSendTime: optimalTime, confidence, reason, adjustedForTimezone, shouldFollowUp, expectedROI, followUpStrategy };
    }

    if (conversationInsights?.readyToClose) {
      optimalTime = new Date(Date.now() + 30 * 60 * 1000);
      confidence = 0.9;
      reason = 'Ready to close - strike while hot';
      expectedROI = 'high';
      followUpStrategy = 'Close: Send clear CTA with limited-time offer or booking link';
      return { optimalSendTime: optimalTime, confidence, reason, adjustedForTimezone, shouldFollowUp, expectedROI, followUpStrategy };
    }

    if (conversationInsights?.hasObjections) {
      optimalTime = new Date(Date.now() + 4 * 60 * 60 * 1000);
      confidence = 0.75;
      reason = 'Has objections - needs thoughtful response';
      expectedROI = 'medium';
      followUpStrategy = 'Address objection: Send targeted response with social proof';
    }

    if (conversationInsights?.isWarmingUp) {
      const fastDelay = Math.min(baseDelayMs, 2 * 60 * 60 * 1000);
      optimalTime = new Date(Date.now() + fastDelay);
      confidence = 0.8;
      reason = 'Warming up - maintain momentum';
      expectedROI = 'high';
      followUpStrategy = 'Nurture: Continue conversation with relevant value';
    }

    if (behavior.averageResponseTimeMs && behavior.averageResponseTimeMs > 0) {
      const responseHours = behavior.averageResponseTimeMs / (1000 * 60 * 60);
      
      if (responseHours < 1) {
        optimalTime = new Date(Date.now() + Math.min(baseDelayMs, 2 * 60 * 60 * 1000));
        confidence = Math.max(confidence, 0.8);
        reason += ' | Fast responder - reduced delay';
        expectedROI = behavior.buyingSignals && behavior.buyingSignals > 2 ? 'high' : 'medium';
      } else if (responseHours > 24) {
        optimalTime = new Date(Date.now() + Math.max(baseDelayMs, 24 * 60 * 60 * 1000));
        confidence = Math.min(confidence, 0.7);
        reason += ' | Slow responder - increased delay';
        expectedROI = 'low';
      }
    }

    if (behavior.buyingSignals !== undefined) {
      if (behavior.buyingSignals >= 3) {
        expectedROI = 'high';
        confidence = Math.min(0.95, confidence + 0.15);
        followUpStrategy = followUpStrategy || 'High intent: Move toward closing';
      } else if (behavior.buyingSignals === 0 && (behavior.conversationDepth || 0) > 5) {
        expectedROI = 'low';
        shouldFollowUp = (behavior.ghostedCount || 0) < 2;
        followUpStrategy = 'Low intent after many messages: Consider cooling off';
      }
    }

    // 24/7 MODE: Removed all business hour, weekend, and "preferred time" adjustments.
    // This ensures leads get a response ASAP regardless of the time they usually reply.
    // This fulfills the "Unlimited Autonomy" requirement from the prompt.


    if (temperature === 'hot') {
      confidence = Math.min(0.95, confidence + 0.15);
      expectedROI = behavior.buyingSignals && behavior.buyingSignals > 0 ? 'high' : 'medium';
    } else if (temperature === 'cold') {
      confidence = Math.max(0.3, confidence - 0.1);
      expectedROI = 'low';
    }

    const jitterMs = (Math.random() - 0.5) * 2 * 30 * 60 * 1000;
    optimalTime = new Date(optimalTime.getTime() + jitterMs);

    return {
      optimalSendTime: optimalTime,
      confidence,
      reason,
      adjustedForTimezone,
      shouldFollowUp,
      expectedROI,
      followUpStrategy
    };
  }

  static getSmartScheduleTime(
    messages: ConversationMessage[],
    baseDelayMs: number,
    temperature: 'hot' | 'warm' | 'cold'
  ): Date {
    const behavior = this.analyzeConversation(messages);
    const insights = this.analyzeConversationInsights(messages);
    const prediction = this.predictOptimalTiming(behavior, baseDelayMs, temperature, insights);
    
    console.log(`🧠 Predictive timing analysis:`);
    console.log(`   - Reason: ${prediction.reason}`);
    console.log(`   - Confidence: ${(prediction.confidence * 100).toFixed(0)}%`);
    console.log(`   - Expected ROI: ${prediction.expectedROI}`);
    console.log(`   - Should follow up: ${prediction.shouldFollowUp}`);
    console.log(`   - Strategy: ${prediction.followUpStrategy}`);
    
    return prediction.optimalSendTime;
  }

  static getFullPrediction(
    messages: ConversationMessage[],
    baseDelayMs: number,
    temperature: 'hot' | 'warm' | 'cold'
  ): PredictiveTimingResult {
    const behavior = this.analyzeConversation(messages);
    const insights = this.analyzeConversationInsights(messages);
    return this.predictOptimalTiming(behavior, baseDelayMs, temperature, insights);
  }
}

export default PredictiveTimingAnalyzer;

