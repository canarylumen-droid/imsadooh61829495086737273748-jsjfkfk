import { createLogger } from '@services/api-gateway/src/core/logger.js';
import { db } from '@shared/lib/db/db.js';
import { leads, messages, users } from '@audnix/shared';
import { eq } from 'drizzle-orm';
import { objectionService } from '../../ai-lib/analyzers/objection-service.js';
import { generateAutonomousObjectionResponse } from '../../ai-lib/analyzers/autonomous-objection-responder.js';
import { MultiChannelOrchestrator } from '@shared/lib/multi-channel-orchestrator.js';
import { getBrandContext } from '../../ai-lib/context/brand-context.js';

const log = createLogger('OBJECTION-AGENT');

export class ObjectionAgent {
  /**
   * Handle high-priority objections using the Battle Card strategy.
   * Fetches context, generates a targeted response, and queues it.
   */
  async handleObjection(leadId: string, sentiment: number): Promise<void> {
    try {
      const lead = await db.query.leads.findFirst({
        where: eq(leads.id, leadId)
      });
      if (!lead) {
        log.warn(`[ObjectionAgent] Lead ${leadId} not found`);
        return;
      }

      // Fetch conversation history
      const history = await db.query.messages.findMany({
        where: eq(messages.leadId, leadId),
        orderBy: (messages, { asc }) => [asc(messages.createdAt)]
      });

      const lastInbound = history.filter(m => m.direction === 'inbound').pop();
      if (!lastInbound) {
        log.warn(`[ObjectionAgent] No inbound messages for lead ${leadId}`);
        return;
      }

      // Fetch user to get context
      const user = await db.query.users.findFirst({
        where: eq(users.id, lead.userId)
      });
      
      const brandContext = await getBrandContext(lead.userId);

      // Extract winning handles if not already cached
      await objectionService.extractWinningHandles(lead.userId);

      // Generate the battle card response
      log.info(`[ObjectionAgent] Formulating response for objection: "${lastInbound.body.substring(0, 50)}..."`);
      
      const objectionResponse = await generateAutonomousObjectionResponse(lastInbound.body, {
        userId: lead.userId,
        leadName: lead.name || "there",
        leadIndustry: (lead.metadata as any)?.industry || "general",
        previousMessages: history.slice(-5).map(m => ({
          role: m.direction === 'inbound' ? 'user' : 'assistant',
          content: m.body
        })),
        brandName: (brandContext as any)?.businessName || user?.businessName || "Our platform",
        userIndustry: (brandContext as any)?.industry || "all"
      });

      log.info(`[ObjectionAgent] Response formulated. Queuing dispatch.`, { leadId });

      // Save a negotiation/objection attempt
      await this.saveNegotiationAttempt(leadId);

      // Use the multi-channel orchestrator to dispatch
      await MultiChannelOrchestrator.dispatchMessage(lead.userId, leadId, objectionResponse.response, {
        channel: (lead.channel as 'email' | 'instagram') || 'email',
        isAutonomous: true,
        metadata: { source: 'objection-agent', sentiment }
      });

    } catch (error) {
      log.error(`[ObjectionAgent] Error handling objection`, { leadId, error: (error as Error).message });
    }
  }

  private async saveNegotiationAttempt(leadId: string) {
    const lead = await db.query.leads.findFirst({
      where: eq(leads.id, leadId)
    });
    if (!lead) return;
    
    const metadata = (lead.metadata || {}) as Record<string, any>;
    const currentCount = metadata.objectionHandlingAttempts || 0;
    
    await db.update(leads)
      .set({
        metadata: {
          ...metadata,
          objectionHandlingAttempts: currentCount + 1,
          lastObjectionHandledAt: new Date().toISOString()
        }
      })
      .where(eq(leads.id, leadId));
  }
}

export const objectionAgent = new ObjectionAgent();
