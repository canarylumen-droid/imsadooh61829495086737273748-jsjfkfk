import { storage } from '@shared/lib/storage/storage.js';
import { db } from '@shared/lib/db/db.js';
import { messages } from '@audnix/shared';
import { eq } from 'drizzle-orm';
import type { IntentAnalysis } from '../analyzers/intent-analyzer.js';
import { PredictiveTimingAnalyzer } from './predictive-timing.js';

interface AutomatedReplyJob {
  userId: string;
  leadId: string;
  recipientId: string;
  channel: 'instagram';
  scheduledAt: Date;
  context: {
    lastMessage: string;
    intent?: IntentAnalysis;
    messageCount: number;
  };
}

interface Lead {
  id: string;
  userId: string;
  name: string;
  channel: string;
  status: string;
  externalId: string | null;
  email?: string | null;
  phone?: string | null;
  tags?: string[];
  aiPaused?: boolean;
  metadata?: Record<string, unknown>;
}

interface Message {
  id: string;
  body: string;
  direction: 'inbound' | 'outbound';
  createdAt: Date;
}

const pendingReplies = new Map<string, NodeJS.Timeout>();

export async function scheduleAutomatedDMReply(
  userId: string,
  leadId: string,
  recipientId: string,
  lastMessage: string,
  intent?: IntentAnalysis
): Promise<void> {
  try {
    console.log(`[DM_AUTO] Scheduling automated reply for lead ${leadId}`);

    // Check DB for existing pending follow-up
    const existingJob = await storage.getPendingFollowUp(leadId);

    if (existingJob) {
      console.log(`[DM_AUTO] Reply already scheduled in queue for lead ${leadId}, skipping`);
      return;
    }

    const conversationHistory = await getConversationHistory(leadId);

    // Use predictive timing analyzer for optimal delay
    const { delayMs, timingResult } = await calculateSmartDelayWithPrediction(leadId, intent, conversationHistory);
    const scheduledAt = new Date(Date.now() + delayMs);
    
    console.log(`[DM_AUTO] Predictive strategy: ${timingResult.followUpStrategy}, Expected ROI: ${timingResult.expectedROI}`);
    console.log(`[DM_AUTO] Reply scheduled in ${Math.round(delayMs / 1000)}s at ${scheduledAt.toISOString()}`);

    // Persist to DB using FollowUpQueue. The follow-up-worker will handle execution.
    await storage.createFollowUp({
      userId,
      leadId,
      channel: 'instagram',
      status: 'pending', // Mapped 'scheduled' -> 'pending'
      scheduledAt: scheduledAt,
      context: {
        last_message: lastMessage,
        intent,
        message_count: conversationHistory.length + 1
      }
    });

  } catch (error) {
    console.error('[DM_AUTO] Error scheduling automated reply:', error);
  }
}

async function calculateSmartDelayWithPrediction(
  leadId: string,
  intent?: IntentAnalysis,
  history?: Message[]
): Promise<{ delayMs: number; timingResult: any }> {
  const MIN_DELAY = 2 * 60 * 1000;
  const MAX_DELAY = 4 * 60 * 1000;

  // Analyze conversation behavior using PredictiveTimingAnalyzer
  const conversationMessages = (history || []).map(m => ({
    body: m.body,
    direction: m.direction as 'inbound' | 'outbound',
    createdAt: new Date(m.createdAt)
  }));

  const leadBehavior = PredictiveTimingAnalyzer.analyzeConversation(conversationMessages);
  const conversationInsights = PredictiveTimingAnalyzer.analyzeConversationInsights(conversationMessages);

  // Determine lead temperature based on intent
  let temperature: 'hot' | 'warm' | 'cold' = 'warm';
  if (intent?.readyToBuy || intent?.wantsToSchedule) {
    temperature = 'hot';
  } else if (intent?.isNegative || conversationInsights.isGhosting) {
    temperature = 'cold';
  } else if (intent?.isInterested || conversationInsights.showsBuyingIntent) {
    temperature = 'hot';
  }

  // Get predictive timing
  const timingResult = PredictiveTimingAnalyzer.predictOptimalTiming(
    leadBehavior,
    MIN_DELAY,
    temperature,
    conversationInsights
  );

  // Calculate delay based on predictive result
  let delayMs = timingResult.optimalSendTime.getTime() - Date.now();
  
  // Ensure delay is within bounds for DM (2-4 minutes for immediate responses)
  delayMs = Math.max(MIN_DELAY, Math.min(MAX_DELAY, delayMs));
  
  // Add some randomness for human-like timing
  delayMs += Math.random() * 60 * 1000;

  console.log(`[DM_AUTO] Predictive timing: temperature=${temperature}, ROI=${timingResult.expectedROI}, strategy="${timingResult.followUpStrategy}"`);

  // Store timing behavior in lead metadata for learning
  try {
    const lead = await storage.getLeadById(leadId);
    if (lead) {
      const existingMetadata = (lead.metadata as Record<string, any>) || {};
      await storage.updateLead(leadId, {
        metadata: {
          ...existingMetadata,
          timingBehavior: {
            preferredHours: leadBehavior.preferredHours,
            preferredDays: leadBehavior.preferredDays,
            avgResponseTimeMs: leadBehavior.averageResponseTimeMs,
            engagementScore: leadBehavior.engagementScore,
            lastAnalyzedAt: new Date().toISOString()
          },
          conversationInsights: {
            sentimentTrend: conversationInsights.sentimentTrend,
            showsBuyingIntent: conversationInsights.showsBuyingIntent,
            hasObjections: conversationInsights.hasObjections,
            isGhosting: conversationInsights.isGhosting,
            readyToClose: conversationInsights.readyToClose
          }
        }
      });
    }
  } catch (err) {
    console.error('[DM_AUTO] Error storing timing behavior:', err);
  }

  return { delayMs, timingResult };
}

// Legacy fallback for simple delay calculation
function calculateSmartDelay(intent?: IntentAnalysis, history?: Message[]): number {
  const MIN_DELAY = 2 * 60 * 1000;
  const MAX_DELAY = 4 * 60 * 1000;

  let minDelay = MIN_DELAY;
  let maxDelay = MAX_DELAY;

  if (intent?.readyToBuy || intent?.wantsToSchedule) {
    minDelay = 2 * 60 * 1000;
    maxDelay = 3 * 60 * 1000;
  } else if (intent?.isInterested) {
    minDelay = 2 * 60 * 1000;
    maxDelay = 4 * 60 * 1000;
  } else if (intent?.hasObjection) {
    minDelay = 3 * 60 * 1000;
    maxDelay = 5 * 60 * 1000;
  } else if (intent?.hasQuestion) {
    minDelay = 2 * 60 * 1000;
    maxDelay = 5 * 60 * 1000;
  } else {
    const isActiveConversation = history && history.length > 0 &&
      (Date.now() - new Date(history[history.length - 1].createdAt).getTime()) < 5 * 60 * 1000;

    if (isActiveConversation) {
      minDelay = 2 * 60 * 1000;
      maxDelay = 4 * 60 * 1000;
    }
  }

  minDelay = Math.max(minDelay, MIN_DELAY);
  maxDelay = Math.min(maxDelay, MAX_DELAY);

  return minDelay + Math.random() * (maxDelay - minDelay);
}

async function getConversationHistory(leadId: string): Promise<Message[]> {
  if (!db) return [];

  try {
    const messageHistory = await db
      .select({
        id: messages.id,
        body: messages.body,
        direction: messages.direction,
        createdAt: messages.createdAt
      })
      .from(messages)
      .where(eq(messages.leadId, leadId))
      .orderBy(messages.createdAt)
      .limit(20);

    return messageHistory.map((m: { id: string; body: string; direction: string; createdAt: Date }) => ({
      id: m.id,
      body: m.body,
      direction: m.direction as 'inbound' | 'outbound',
      createdAt: m.createdAt
    }));
  } catch (error) {
    console.error('[DM_AUTO] Error getting conversation history:', error);
    return [];
  }
}

export async function checkUserAutomationSettings(userId: string): Promise<{
  enabled: boolean;
  minDelayMinutes: number;
  maxDelayMinutes: number;
}> {
  const defaultSettings = {
    enabled: true,
    minDelayMinutes: 2,
    maxDelayMinutes: 8
  };

  try {
    const user = await storage.getUser(userId);
    if (!user) return defaultSettings;

    const metadata = user.metadata as Record<string, unknown> | null;
    return {
      enabled: metadata?.dmAutomationEnabled !== false,
      minDelayMinutes: (metadata?.dmMinDelayMinutes as number) || 2,
      maxDelayMinutes: (metadata?.dmMaxDelayMinutes as number) || 8
    };
  } catch (error) {
    console.error('[DM_AUTO] Error checking automation settings:', error);
    return defaultSettings;
  }
}




