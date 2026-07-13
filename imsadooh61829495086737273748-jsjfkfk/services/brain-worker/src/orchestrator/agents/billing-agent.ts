import { createLogger } from '@services/api-gateway/src/core/logger.js';
import { db } from '@shared/lib/db/db.js';
import { leads, messages, users, notifications } from '@audnix/shared';
import { eq } from 'drizzle-orm';
import { detectAndGenerateLinkResponse, appendLinkIfNeeded } from '../../ai-lib/analyzers/link-intent-detector.js';
import { MultiChannelOrchestrator } from '@shared/lib/multi-channel-orchestrator.js';
import { storage } from '@shared/lib/storage/storage.js';

const log = createLogger('BILLING-AGENT');

export class BillingAgent {
  /**
   * Process a lead to check if they want to pay and inject the payment link.
   * If the payment link is missing, triggers a dashboard notification.
   */
  async handlePaymentIntent(leadId: string, aiResponse: string): Promise<string> {
    try {
      const lead = await db.query.leads.findFirst({
        where: eq(leads.id, leadId)
      });
      if (!lead) return aiResponse;

      const user = await db.query.users.findFirst({
        where: eq(users.id, lead.userId)
      });
      if (!user) return aiResponse;

      // Fetch latest inbound message
      const history = await db.query.messages.findMany({
        where: eq(messages.leadId, leadId),
        orderBy: (messages, { asc }) => [asc(messages.createdAt)]
      });
      const lastInbound = history.filter(m => m.direction === 'inbound').pop();
      if (!lastInbound) return aiResponse;

      // Check intent
      const intent = await detectAndGenerateLinkResponse(lead.userId, lastInbound.body);

      if (intent.detected && intent.intentType === 'payment') {
        log.info(`[BillingAgent] Payment intent detected for lead ${leadId}`);

        if (intent.link) {
          log.info(`[BillingAgent] Injecting payment link: ${intent.link}`);
          // Append link to response
          return await appendLinkIfNeeded(lead.userId, lastInbound.body, aiResponse);
        } else {
          // Phase 24: Pop-up / Notification Trigger if missing
          log.warn(`[BillingAgent] User ${lead.userId} has NO payment link configured!`);
          
          await db.insert(notifications).values({
            userId: lead.userId,
            type: 'billing_issue',
            title: 'Action Required: Add Payment Link',
            message: `Lead ${lead.name || lead.email} wants to buy, but you haven't set a default payment link! Go to Settings to add one.`,
            metadata: { leadId }
          });

          // Soften the response to stall the lead
          return `${aiResponse}\n\nI'll get that invoice/payment link sent over to you shortly so we can get started!`;
        }
      }

      return aiResponse;
    } catch (error) {
      log.error(`[BillingAgent] Error processing billing intent`, { error: (error as Error).message });
      return aiResponse;
    }
  }
}

export const billingAgent = new BillingAgent();
