/**
 * AI DECISION ENGINE
 * 
 * Deterministic control layer for all AI-driven actions.
 * AI NEVER acts without approval from this engine.
 * 
 * Decision types: act | wait | skip | escalate
 * 
 * Requirements:
 * - Calendar booking: intent_score >= 60, timing_score >= 50
 * - Video delivery: intent_score >= 50, engagement detected
 * - All decisions logged with confidence, reasoning, timing rationale
 */

import { db } from '@shared/lib/db/db.js';
import { aiActionLogs, calendarSettings, calendarBookings, leads } from '@audnix/shared';
import { eq } from 'drizzle-orm';
import type { Lead } from '@audnix/shared';

export type ActionType = 'calendar_booking' | 'video_sent' | 'dm_sent' | 'follow_up' | 'objection_handled';
export type Decision = 'act' | 'wait' | 'skip' | 'escalate';

export interface DecisionContext {
  userId: string;
  leadId?: string;
  lead?: Lead;
  actionType: ActionType;
  intentScore: number;
  timingScore: number;
  confidence: number;
  metadata?: Record<string, any>;
}

export interface DecisionResult {
  decision: Decision;
  reasoning: string;
  intentScore: number;
  timingScore: number;
  confidence: number;
  shouldProceed: boolean;
}

export interface ActionLogEntry {
  userId: string;
  leadId?: string;
  actionType: ActionType;
  decision: Decision;
  intentScore?: number;
  timingScore?: number;
  confidence?: number;
  reasoning?: string;
  assetId?: string;
  assetType?: string;
  outcome?: string;
  metadata?: Record<string, any>;
}

export async function evaluateCalendarBookingDecision(
  context: DecisionContext
): Promise<DecisionResult> {
  const { userId, intentScore, timingScore, confidence } = context;
  
  const [settings] = await db
    .select()
    .from(calendarSettings)
    .where(eq(calendarSettings.userId, userId))
    .limit(1);
  
  const minIntent = settings?.minIntentScore ?? 60;
  const minTiming = settings?.minTimingScore ?? 50;
  const autoBookingEnabled = settings?.autoBookingEnabled ?? false;
  
  if (!autoBookingEnabled) {
    return {
      decision: 'skip',
      reasoning: 'Auto-booking is disabled in settings',
      intentScore,
      timingScore,
      confidence,
      shouldProceed: false,
    };
  }
  
  if (intentScore >= minIntent && timingScore >= minTiming) {
    return {
      decision: 'act',
      reasoning: `Intent (${intentScore}%) and timing (${timingScore}%) exceed thresholds (${minIntent}%, ${minTiming}%)`,
      intentScore,
      timingScore,
      confidence,
      shouldProceed: true,
    };
  }
  
  if (intentScore >= minIntent && timingScore < minTiming) {
    return {
      decision: 'wait',
      reasoning: `Intent high (${intentScore}%) but timing low (${timingScore}%). Waiting for better moment.`,
      intentScore,
      timingScore,
      confidence,
      shouldProceed: false,
    };
  }
  
  if (intentScore < 40) {
    return {
      decision: 'skip',
      reasoning: `Intent too low (${intentScore}%). Not ready for booking. Threshold is ${minIntent}%.`,
      intentScore,
      timingScore,
      confidence,
      shouldProceed: false,
    };
  }
  
  if (confidence < 0.6) {
    return {
      decision: 'escalate',
      reasoning: `Low confidence (${Math.round(confidence * 100)}%). Recommend human review.`,
      intentScore,
      timingScore,
      confidence,
      shouldProceed: false,
    };
  }
  
  return {
    decision: 'wait',
    reasoning: `Intent (${intentScore}%) below threshold (${minIntent}%). Continuing to nurture.`,
    intentScore,
    timingScore,
    confidence,
    shouldProceed: false,
  };
}

export async function evaluateVideoDeliveryDecision(
  context: DecisionContext
): Promise<DecisionResult> {
  const { intentScore, timingScore, confidence } = context;
  
  if (intentScore >= 50 && timingScore >= 40) {
    return {
      decision: 'act',
      reasoning: `Intent (${intentScore}%) and timing (${timingScore}%) suitable for video delivery`,
      intentScore,
      timingScore,
      confidence,
      shouldProceed: true,
    };
  }
  
  if (intentScore >= 30 && timingScore >= 60) {
    return {
      decision: 'act',
      reasoning: `Moderate intent (${intentScore}%) but good timing (${timingScore}%) - optimal moment for video`,
      intentScore,
      timingScore,
      confidence,
      shouldProceed: true,
    };
  }
  
  if (intentScore < 30) {
    return {
      decision: 'skip',
      reasoning: `Intent too low (${intentScore}%). Video may not resonate.`,
      intentScore,
      timingScore,
      confidence,
      shouldProceed: false,
    };
  }
  
  return {
    decision: 'wait',
    reasoning: `Timing not optimal (${timingScore}%). Waiting for better engagement moment.`,
    intentScore,
    timingScore,
    confidence,
    shouldProceed: false,
  };
}

export async function evaluateDMDecision(
  context: DecisionContext
): Promise<DecisionResult> {
  const { intentScore, timingScore, confidence } = context;
  
  if (intentScore >= 60 && timingScore >= 50) {
    return {
      decision: 'act',
      reasoning: `Intent (${intentScore}%) and timing (${timingScore}%) suitable for DM outreach`,
      intentScore,
      timingScore,
      confidence,
      shouldProceed: true,
    };
  }
  
  if (intentScore >= 40 && timingScore >= 70) {
    return {
      decision: 'act',
      reasoning: `Good timing (${timingScore}%) with moderate intent (${intentScore}%) - opportune moment for DM`,
      intentScore,
      timingScore,
      confidence,
      shouldProceed: true,
    };
  }
  
  if (intentScore < 30) {
    return {
      decision: 'skip',
      reasoning: `Intent too low (${intentScore}%). DM may feel intrusive.`,
      intentScore,
      timingScore,
      confidence,
      shouldProceed: false,
    };
  }
  
  if (timingScore < 30) {
    return {
      decision: 'wait',
      reasoning: `Poor timing (${timingScore}%). Wait for lead to be more active.`,
      intentScore,
      timingScore,
      confidence,
      shouldProceed: false,
    };
  }
  
  return {
    decision: 'wait',
    reasoning: `Intent (${intentScore}%) and timing (${timingScore}%) below thresholds. Continuing to monitor.`,
    intentScore,
    timingScore,
    confidence,
    shouldProceed: false,
  };
}

export async function evaluateEmailDecision(
  context: DecisionContext
): Promise<DecisionResult> {
  const { intentScore, timingScore, confidence } = context;
  
  if (intentScore >= 55 && timingScore >= 45) {
    return {
      decision: 'act',
      reasoning: `Intent (${intentScore}%) and timing (${timingScore}%) suitable for email follow-up`,
      intentScore,
      timingScore,
      confidence,
      shouldProceed: true,
    };
  }
  
  if (intentScore >= 35 && timingScore >= 65) {
    return {
      decision: 'act',
      reasoning: `Good timing (${timingScore}%) with moderate intent (${intentScore}%) - optimal for email`,
      intentScore,
      timingScore,
      confidence,
      shouldProceed: true,
    };
  }
  
  if (intentScore < 25) {
    return {
      decision: 'skip',
      reasoning: `Intent too low (${intentScore}%). Email likely to be ignored.`,
      intentScore,
      timingScore,
      confidence,
      shouldProceed: false,
    };
  }
  
  return {
    decision: 'wait',
    reasoning: `Timing (${timingScore}%) not optimal. Waiting for better engagement signals.`,
    intentScore,
    timingScore,
    confidence,
    shouldProceed: false,
  };
}

export async function evaluateFollowUpDecision(
  context: DecisionContext
): Promise<DecisionResult> {
  const { intentScore, timingScore, confidence, lead } = context;
  
  const daysSinceLastContact = lead?.lastMessageAt
    ? Math.floor((Date.now() - new Date(lead.lastMessageAt).getTime()) / (1000 * 60 * 60 * 24))
    : 999;
  
  if (daysSinceLastContact < 1) {
    return {
      decision: 'wait',
      reasoning: `Last contact less than 24h ago. Following up too soon may seem pushy.`,
      intentScore,
      timingScore,
      confidence,
      shouldProceed: false,
    };
  }
  
  if (intentScore >= 50 && daysSinceLastContact >= 2 && daysSinceLastContact <= 7) {
    return {
      decision: 'act',
      reasoning: `Good intent (${intentScore}%) and ${daysSinceLastContact} days since last contact - optimal for follow-up`,
      intentScore,
      timingScore,
      confidence,
      shouldProceed: true,
    };
  }
  
  if (daysSinceLastContact > 14) {
    return {
      decision: 'act',
      reasoning: `${daysSinceLastContact} days since last contact - re-engagement follow-up recommended`,
      intentScore,
      timingScore,
      confidence: confidence * 0.8,
      shouldProceed: true,
    };
  }
  
  return {
    decision: 'wait',
    reasoning: `Waiting for better timing. Last contact: ${daysSinceLastContact} days ago.`,
    intentScore,
    timingScore,
    confidence,
    shouldProceed: false,
  };
}

export function calculateTimingScore(lead: Lead | undefined): number {
  if (!lead) return 50;
  
  let score = 50;
  
  const lastMessage = lead.lastMessageAt;
  if (lastMessage) {
    const hoursSinceMessage = (Date.now() - new Date(lastMessage).getTime()) / (1000 * 60 * 60);
    
    if (hoursSinceMessage < 1) score += 30;
    else if (hoursSinceMessage < 4) score += 25;
    else if (hoursSinceMessage < 24) score += 15;
    else if (hoursSinceMessage < 72) score += 5;
    else score -= 10;
  }
  
  if (lead.warm) score += 10;
  
  if (lead.status === 'contacted' || lead.status === 'replied') score += 10;
  else if (lead.status === 'cold') score -= 20;
  else if (lead.status === 'not_interested') score -= 30;
  
  score += Math.min(lead.score / 5, 20);
  
  return Math.max(0, Math.min(100, score));
}

export async function logAIAction(entry: ActionLogEntry): Promise<void> {
  try {
    await db.insert(aiActionLogs).values({
      userId: entry.userId,
      leadId: entry.leadId || null,
      actionType: entry.actionType,
      decision: entry.decision,
      intentScore: entry.intentScore,
      timingScore: entry.timingScore,
      confidence: entry.confidence,
      reasoning: entry.reasoning,
      assetId: entry.assetId,
      assetType: entry.assetType,
      outcome: entry.outcome,
      metadata: entry.metadata || {},
    });
  } catch (error: any) {
    console.error('Failed to log AI action:', error.message);
  }
}

export async function evaluateAndLogDecision(
  context: DecisionContext
): Promise<DecisionResult> {
  let result: DecisionResult;
  
  switch (context.actionType) {
    case 'calendar_booking':
      result = await evaluateCalendarBookingDecision(context);
      break;
    case 'video_sent':
      result = await evaluateVideoDeliveryDecision(context);
      break;
    case 'dm_sent':
      result = await evaluateDMDecision(context);
      break;
    case 'follow_up':
      result = await evaluateFollowUpDecision(context);
      break;
    case 'objection_handled':
      result = await evaluateEmailDecision(context);
      break;
    default:
      result = {
        decision: 'wait',
        reasoning: 'Unknown action type, defaulting to wait',
        intentScore: context.intentScore,
        timingScore: context.timingScore,
        confidence: context.confidence,
        shouldProceed: false,
      };
  }
  
  await logAIAction({
    userId: context.userId,
    leadId: context.leadId,
    actionType: context.actionType,
    decision: result.decision,
    intentScore: result.intentScore,
    timingScore: result.timingScore,
    confidence: result.confidence,
    reasoning: result.reasoning,
    metadata: context.metadata,
  });
  
  return result;
}

export async function getRecentDecisions(
  userId: string,
  actionType?: ActionType,
  limit: number = 20
): Promise<any[]> {
  const query = db
    .select()
    .from(aiActionLogs)
    .where(eq(aiActionLogs.userId, userId))
    .orderBy(aiActionLogs.createdAt)
    .limit(limit);
  
  return query;
}



