import { storage } from '@shared/lib/storage/storage.js';
import { generateReply } from '../core/ai-service.js';
import { db } from '@shared/lib/db/db.js';
import { outreachCampaigns } from '@audnix/shared';
import { eq } from 'drizzle-orm';
import { MODELS } from '../utils/model-config.js';

export const learningEngine = {
  /**
   * Extract winning message patterns from a successful reply
   */
  async extractWinningPattern(userId: string, leadId: string, campaignId: string): Promise<void> {
    try {
      const messages = await storage.getMessagesByLeadId(leadId);
      const outbounds = messages.filter(m => m.direction === 'outbound');
      const inbounds = messages.filter(m => m.direction === 'inbound');

      if (outbounds.length === 0 || inbounds.length === 0) return;

      const latestOutbound = outbounds[outbounds.length - 1];
      const latestInbound = inbounds[inbounds.length - 1];

      const prompt = `Analyze this interaction. The lead just replied to our outreach.
      
      Our Outbound: "${latestOutbound.body}"
      Lead's Inbound: "${latestInbound.body}"
      
      Task: Identify what specific element of our outbound message likely triggered this reply (e.g. the specific hook, the value proposition, or the direct question).
      
      Return a JSON object:
      {
        "winningHook": "string",
        "patternType": "hook" | "value_prop" | "cta",
        "rationale": "string",
        "suggestedAdjustment": "string"
      }`;

      const analysis = await generateReply(
        "You are a sales communication analyst. Identify winning patterns in outreach.",
        prompt,
        { model: MODELS.intelligence_synthesis, jsonMode: true, nga1Enforced: true }
      );

      const result = JSON.parse(analysis.text || '{}');
      if (result.winningHook) {
        console.log(`[LEARNING_ENGINE] Extracted winning pattern for campaign ${campaignId}: ${result.winningHook}`);
        
        // Update lead's procedural memory
        const currentMemory = await storage.getCampaignLeadProceduralMemory(campaignId, leadId) || {};
        const newMemory = {
          ...currentMemory,
          winningPatterns: [
            ...(currentMemory.winningPatterns || []),
            {
              hook: result.winningHook,
              type: result.patternType,
              timestamp: new Date().toISOString()
            }
          ]
        };
        await storage.updateCampaignLeadProceduralMemory(campaignId, leadId, newMemory);

        // Also aggregate to campaign level memory
        const campaign = await storage.getOutreachCampaign(campaignId);
        if (campaign) {
            const campMemory = (campaign.proceduralMemory as any) || {};
            const patterns = campMemory.topPatterns || [];
            patterns.push(result.winningHook);
            
            // Keep only top 10 unique patterns
            const uniquePatterns = [...new Set(patterns)].slice(-10);
            
            await db.update(outreachCampaigns)
                .set({ 
                    proceduralMemory: { 
                        ...campMemory, 
                        topPatterns: uniquePatterns,
                        lastLearningUpdate: new Date().toISOString()
                    } 
                })
                .where(eq(outreachCampaigns.id, campaignId));
        }
      }
    } catch (error) {
      console.error('[LEARNING_ENGINE] Failed to extract winning pattern:', error);
    }
  }
};
