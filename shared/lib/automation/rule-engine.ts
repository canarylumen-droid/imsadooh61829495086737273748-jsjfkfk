import { db } from '@shared/lib/db/db.js';
import { automationRules, leads, aiActionLogs, auditTrail, messages } from '@audnix/shared';
import { eq, and, desc, sql, lt, isNull } from 'drizzle-orm';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';
import { storage } from '@shared/lib/storage/storage.js';
import { invalidateStatsCache } from '@services/api-gateway/src/routes/dashboard-routes.js';

export class AutomationRuleEngine {
  /**
   * Evaluates automation rules for an incoming message/event (REACTIVE)
   */
  static async processEvent(userId: string, leadId: string, eventData: {
    channel: 'instagram' | 'email';
    intentScore: number;
    confidence: number;
    messageBody: string;
    messageId?: string;
  }) {
    console.log(`[AutomationEngine] Reactive evaluation for lead ${leadId} (${eventData.channel})`);

    try {
      const activeRules = await db
        .select()
        .from(automationRules)
        .where(
          and(
            eq(automationRules.userId, userId),
            eq(automationRules.isActive, true),
            sql`${automationRules.channel} IN (${eventData.channel}, 'all')`
          )
        );

      if (activeRules.length === 0) return;

      const lead = await storage.getLeadById(leadId);
      if (!lead) return;

      for (const rule of activeRules) {
        // Skip proactive-only rules in reactive flow (unless they are follow-up rules)
        if (rule.ruleType === 're_engagement' && !eventData.messageBody) continue;

        if (eventData.intentScore < rule.minIntentScore || eventData.intentScore > rule.maxIntentScore) continue;
        if (eventData.confidence < rule.minConfidence) continue;

        const lastActionAt = (lead.metadata as any)?.last_automation_action_at;
        if (lastActionAt) {
          const diffMins = (Date.now() - new Date(lastActionAt).getTime()) / 60000;
          if (diffMins < rule.cooldownMinutes) continue;
        }

        console.log(`[AutomationEngine] 🔥 Rule MATCHED: "${rule.name}"`);
        await this.executeRuleActions(rule, lead, eventData);
        
        await storage.updateLead(lead.id, {
          metadata: {
            ...(lead.metadata as any || {}),
            last_automation_action_at: new Date().toISOString(),
            last_automation_rule: rule.id
          }
        });
        break; 
      }
    } catch (error) {
      console.error('[AutomationEngine] Passive process error:', error);
    }
  }

  /**
   * Scans leads for proactive re-engagement rules (PROACTIVE)
   * This is called by the background worker.
   */
  static async processProactiveRules(userId: string) {
    console.log(`[AutomationEngine] 🔍 Scanning proactive rules for user ${userId}`);
    
    try {
      const proactiveRules = await db
        .select()
        .from(automationRules)
        .where(
          and(
            eq(automationRules.userId, userId),
            eq(automationRules.isActive, true),
            sql`${automationRules.ruleType} IN ('re_engagement', 'follow_up')`
          )
        );

      if (proactiveRules.length === 0) return;

      // Determine the minimum cooldown across all proactive rules to optimize the query
      // Default to 24h if none specified, but usually it's rule.cooldownMinutes
      const minCooldownMins = Math.min(...proactiveRules.map((r: any) => r.cooldownMinutes || 1440));
      const lookbackLimit = new Date(Date.now() - minCooldownMins * 60000);

      // Find leads who haven't moved in a while (dynamic threshold based on rules)
      const coldLeads = await db
        .select()
        .from(leads)
        .where(
          and(
            eq(leads.userId, userId),
            eq(leads.archived, false),
            // Use the calculated threshold for database efficiency
            sql`(${leads.lastMessageAt} < ${lookbackLimit.toISOString()} OR ${leads.lastMessageAt} IS NULL)`
          )
        );

      for (const lead of coldLeads) {
        for (const rule of proactiveRules) {
          // Check specific logic: e.g. "Rule: If cold for 3 days"
          // For now, we use the rule's cooldown as the "threshold" for re-engagement
          const lastEngaged = lead.lastMessageAt ? new Date(lead.lastMessageAt).getTime() : new Date(lead.createdAt).getTime();
          const inactiveMins = (Date.now() - lastEngaged) / 60000;
          
          if (inactiveMins >= rule.cooldownMinutes) {
            console.log(`[AutomationEngine] 💡 Proactive MATCH: "${rule.name}" for lead ${lead.name}`);
            
            // Execute with dummy event data since there's no inbound message
            await this.executeRuleActions(rule, lead, {
              channel: rule.channel === 'all' ? lead.channel : rule.channel,
              intentScore: 50, // Neutral
              confidence: 1.0,
              messageBody: "Proactive re-engagement trigger"
            });

            await storage.updateLead(lead.id, {
              metadata: {
                ...(lead.metadata as any || {}),
                last_automation_action_at: new Date().toISOString(),
                last_automation_rule: rule.id
              }
            });
            break;
          }
        }
      }
    } catch (err) {
      console.error('[AutomationEngine] Proactive scan error:', err);
    }
  }

  private static async executeRuleActions(rule: any, lead: any, eventData: any) {
    const actions = rule.allowedActions as string[];
    
    const actionTypeMap: Record<string, string> = {
      follow_up: 'follow_up',
      objection_handler: 'objection_handled',
      meeting_booking: 'calendar_booking',
      re_engagement: 'follow_up',
    };
    const actionType = actionTypeMap[rule.ruleType] || 'follow_up';

    await db.insert(aiActionLogs).values({
      userId: rule.userId,
      leadId: lead.id,
      actionType: actionType as any,
      decision: rule.requireHumanApproval ? 'wait' : 'act',
      intentScore: eventData.intentScore,
      confidence: eventData.confidence,
      reasoning: `Automation "${rule.name}" triggered. Actions: ${actions.join(', ')}`,
      createdAt: new Date()
    });

    await storage.createAuditLog({
      userId: rule.userId,
      leadId: lead.id,
      action: 'automation_triggered',
      details: { ruleName: rule.name, actions }
    });

    // 1. UPDATE LEAD STATUS
    if (eventData.intentScore >= 80 && lead.status !== 'converted') {
       await storage.updateLead(lead.id, { status: 'warm' });
    }

    // 2. AI REPLY (REPLACE Hallucinated Import)
    if (actions.includes('reply') && !rule.requireHumanApproval) {
      try {
        const { generateAIReply } = await import("@services/brain-worker/src/ai-lib/core/conversation-ai.js");
        const history = await storage.getMessagesByLeadId(lead.id);
        const reply = await generateAIReply(lead, history, eventData.channel);
        
        if (reply.text && !reply.blocked) {
          // Trigger autonomous send through standard dispatch
          const { MultiChannelOrchestrator } = await import('../multi-channel-orchestrator.js');
          await MultiChannelOrchestrator.dispatchMessage(rule.userId, lead.id, reply.text, {
            channel: eventData.channel,
            isAutonomous: true
          });
        }
      } catch (e) {
        console.error('[AutomationEngine] Reply failed:', e);
      }
    }

    // 3. CALENDAR BOOKING
    if (actions.includes('calendar') && !rule.requireHumanApproval) {
      try {
        const { BookingProposer } = await import('../calendar/booking-proposer.js');
        const proposer = new BookingProposer(rule.userId);
        const { suggestedSlots } = await proposer.proposeTimes(eventData.messageBody, {
           id: lead.id, 
           email: lead.email || '', 
           name: lead.name || '' 
        });

        if (suggestedSlots.length > 0) {
          const { MultiChannelOrchestrator } = await import('../multi-channel-orchestrator.js');
          await MultiChannelOrchestrator.dispatchMessage(rule.userId, lead.id, suggestedSlots[0].copy, {
            channel: eventData.channel,
            isAutonomous: true
          });
        }
      } catch (e) {
        console.error('[AutomationEngine] Calendar action failed:', e);
      }
    }

    // WebSocket / Cache Notifications
    wsSync.notifyActivityUpdated(rule.userId, { type: 'automation_triggered', leadId: lead.id, ruleName: rule.name });
    wsSync.notifyLeadsUpdated(rule.userId, { event: 'UPDATE', leadId: lead.id });
    invalidateStatsCache(rule.userId);
    wsSync.notifyStatsUpdated(rule.userId);
  }
}









