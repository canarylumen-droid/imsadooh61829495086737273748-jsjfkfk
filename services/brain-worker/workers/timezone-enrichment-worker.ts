import { createLogger } from '@services/api-gateway/src/core/logger.js';
import { populateLeadProfile } from '@shared/lib/calendar/lead-timezone-intelligence.js';
import { storage } from '@shared/lib/storage/storage.js';

const log = createLogger('TIMEZONE-WORKER');

/**
 * Background worker to enrich leads with timezone and niche data.
 * This is decoupled from the import process to prevent timeouts.
 */
export const timezoneEnrichmentWorker = {
  async enrichLead(data: { leadId: string; userId: string; useAI?: boolean }) {
    const { leadId, userId, useAI = true } = data;
    
    try {
      log.info('Starting enrichment', { leadId, userId });
      
      const lead = await storage.getLeadById(leadId);
      if (!lead) {
        log.warn('Lead not found for enrichment', { leadId });
        return;
      }

      await populateLeadProfile(leadId, userId, {
        city: lead.metadata?.city || lead.metadata?.location || null,
        niche: lead.metadata?.niche || lead.metadata?.industry || null,
        company: lead.company,
        bio: lead.bio,
        useAI
      });

      log.info('Enrichment complete', { leadId });
    } catch (error: any) {
      log.error('Enrichment failed', { leadId, error: error.message });
      throw error; // Let BullMQ handle retry
    }
  }
};
