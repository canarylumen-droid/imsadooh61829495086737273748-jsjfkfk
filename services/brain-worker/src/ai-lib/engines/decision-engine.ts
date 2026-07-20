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
      reasoning: `${context.lead?.name || 'Lead'} is ready — intent ${intentScore}% with timing ${timingScore}%`,
      intentScore,
      timingScore,
      confidence,
      shouldProceed: true,
    };
  }
  
  if (intentScore >= minIntent && timingScore < minTiming) {
    return {
      decision: 'wait',
      reasoning: `${context.lead?.name || 'Lead'} wants to book (intent ${intentScore}%) but timing too early (${timingScore}%) — holding for better moment`,
      intentScore,
      timingScore,
      confidence,
      shouldProceed: false,
    };
  }
  
  if (intentScore < 40) {
    return {
      decision: 'skip',
      reasoning: `${context.lead?.name || 'Lead'} shows low interest (${intentScore}%) — not ready for booking yet`,
      intentScore,
      timingScore,
      confidence,
      shouldProceed: false,
    };
  }
  
  if (confidence < 0.6) {
    return {
      decision: 'escalate',
      reasoning: `Uncertain about ${context.lead?.name || 'lead'} (${Math.round(confidence * 100)}% confidence) — needs human review`,
      intentScore,
      timingScore,
      confidence,
      shouldProceed: false,
    };
  }
  
  return {
    decision: 'wait',
    reasoning: `${context.lead?.name || 'Lead'}'s intent (${intentScore}%) below ${minIntent}% threshold — continuing to nurture`,
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
      reasoning: `Good moment to send ${context.lead?.name || 'lead'} a video — intent ${intentScore}%, timing ${timingScore}%`,
      intentScore,
      timingScore,
      confidence,
      shouldProceed: true,
    };
  }
  
  if (intentScore >= 30 && timingScore >= 60) {
    return {
      decision: 'act',
      reasoning: `${context.lead?.name || 'Lead'} is engaged (timing ${timingScore}%) — video would land well despite moderate intent (${intentScore}%)`,
      intentScore,
      timingScore,
      confidence,
      shouldProceed: true,
    };
  }
  
  if (intentScore < 30) {
    return {
      decision: 'skip',
      reasoning: `${context.lead?.name || 'Lead'} too cold (${intentScore}%) — video may feel intrusive`,
      intentScore,
      timingScore,
      confidence,
      shouldProceed: false,
    };
  }
  
  return {
    decision: 'wait',
    reasoning: `Timing not right for ${context.lead?.name || 'lead'} (${timingScore}%) — waiting for stronger engagement signal`,
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
      reasoning: `${context.lead?.name || 'Lead'} is warm — sending DM now (intent ${intentScore}%, timing ${timingScore}%)`,
      intentScore,
      timingScore,
      confidence,
      shouldProceed: true,
    };
  }
  
  if (intentScore >= 40 && timingScore >= 70) {
    return {
      decision: 'act',
      reasoning: `${context.lead?.name || 'Lead'} is active (timing ${timingScore}%) — good moment for DM despite moderate intent (${intentScore}%)`,
      intentScore,
      timingScore,
      confidence,
      shouldProceed: true,
    };
  }
  
  if (intentScore < 30) {
    return {
      decision: 'skip',
      reasoning: `${context.lead?.name || 'Lead'} too cold (${intentScore}%) — DM would feel intrusive`,
      intentScore,
      timingScore,
      confidence,
      shouldProceed: false,
    };
  }
  
  if (timingScore < 30) {
    return {
      decision: 'wait',
      reasoning: `${context.lead?.name || 'Lead'} not active (timing ${timingScore}%) — waiting for engagement`,
      intentScore,
      timingScore,
      confidence,
      shouldProceed: false,
    };
  }
  
  return {
    decision: 'wait',
    reasoning: `${context.lead?.name || 'Lead'}'s intent (${intentScore}%) and timing (${timingScore}%) both below threshold — monitoring`,
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
      reasoning: `${context.lead?.name || 'Lead'} ready for follow-up — intent ${intentScore}%, timing ${timingScore}%`,
      intentScore,
      timingScore,
      confidence,
      shouldProceed: true,
    };
  }
  
  if (intentScore >= 35 && timingScore >= 65) {
    return {
      decision: 'act',
      reasoning: `${context.lead?.name || 'Lead'} is engaged (timing ${timingScore}%) — email will land despite moderate intent (${intentScore}%)`,
      intentScore,
      timingScore,
      confidence,
      shouldProceed: true,
    };
  }
  
  if (intentScore < 25) {
    return {
      decision: 'skip',
      reasoning: `${context.lead?.name || 'Lead'} too cold (${intentScore}%) — email would be ignored`,
      intentScore,
      timingScore,
      confidence,
      shouldProceed: false,
    };
  }
  
  return {
    decision: 'wait',
    reasoning: `${context.lead?.name || 'Lead'} timing too low (${timingScore}%) — waiting for engagement signal`,
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
      reasoning: `Just contacted ${context.lead?.name || 'lead'} <24h ago — too soon to follow up`,
      intentScore,
      timingScore,
      confidence,
      shouldProceed: false,
    };
  }
  
  if (intentScore >= 50 && daysSinceLastContact >= 2 && daysSinceLastContact <= 7) {
    return {
      decision: 'act',
      reasoning: `${context.lead?.name || 'Lead'} showed intent (${intentScore}%) ${daysSinceLastContact}d ago — time to follow up`,
      intentScore,
      timingScore,
      confidence,
      shouldProceed: true,
    };
  }
  
  if (daysSinceLastContact > 14) {
    return {
      decision: 'act',
      reasoning: `${context.lead?.name || 'Lead'} hasn't responded in ${daysSinceLastContact}d — sending re-engagement`,
      intentScore,
      timingScore,
      confidence: confidence * 0.8,
      shouldProceed: true,
    };
  }
  
  return {
    decision: 'wait',
    reasoning: `${context.lead?.name || 'Lead'}: intent ${intentScore}%, ${daysSinceLastContact}d since last contact — waiting for better timing`,
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



