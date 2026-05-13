import { db } from '@shared/lib/db/db.js';
import { leadInsights, outreachCampaigns, campaignLeads } from '@audnix/shared';
import { eq, and, gt, sql } from 'drizzle-orm';
import { generateReply } from '../core/ai-service.js';
import { storage } from '@shared/lib/storage/storage.js';
import { MODELS } from '../utils/model-config.js';

export async function processObjectionLoop() {
  console.log('🚀 [OBJECTION_LOOP] Starting daily objection handling refinement...');

  try {
    // 1. Get all active campaigns
    const activeCampaigns = await db.select().from(outreachCampaigns).where(eq(outreachCampaigns.status, 'active'));

    for (const campaign of activeCampaigns) {
      console.log(`[OBJECTION_LOOP] Analyzing campaign: ${campaign.name} (${campaign.id})`);

      // 2. Aggregate insights for leads in this campaign from the last 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const rows = await db.select({
        painPoints: leadInsights.painPoints,
        intent: leadInsights.intent,
        summary: leadInsights.summary
      })
      .from(leadInsights)
      .innerJoin(campaignLeads, eq(leadInsights.leadId, campaignLeads.leadId))
      .where(and(
        eq(campaignLeads.campaignId, campaign.id),
        gt(leadInsights.createdAt, sevenDaysAgo)
      ));

      if (rows.length < 3) {
        console.log(`[OBJECTION_LOOP] Not enough data for campaign ${campaign.id} (${rows.length} insights). Skipping.`);
        continue;
      }

      // 3. Extract common patterns
      const allPainPoints = rows.flatMap(r => (r.painPoints as string[]) || []);
      const allSummaries = rows.map(r => r.summary).filter(Boolean);
      
      const prompt = `Analyze these aggregated insights from a sales campaign.
      
      Pain Points: ${allPainPoints.join(', ')}
      Key Summaries: ${allSummaries.join(' | ')}
      
      Task: Identify the top 3 recurring objections or hesitations. For each, provide a specific "Rebuttal Strategy" that our AI agent should use in future follow-ups for this campaign.
      
      Return a JSON object:
      {
        "topObjections": [
          { "objection": "string", "frequency": "high|medium", "strategy": "string" }
        ],
        "systemPromptSupplement": "string (A paragraph of instruction for the AI agent)"
      }`;

      const analysis = await generateReply(
        "You are a sales strategy optimizer. Refine objection handling based on real-world feedback.",
        prompt,
        { model: MODELS.sales_reasoning, jsonMode: true, nga1Enforced: true }
      );

      const result = JSON.parse(analysis.text || '{}');
      
      if (result.systemPromptSupplement) {
        console.log(`[OBJECTION_LOOP] Updating procedural memory for campaign ${campaign.id}`);
        
        const currentMemory = (campaign.proceduralMemory as any) || {};
        await storage.updateCampaignProceduralMemory(campaign.id, {
          ...currentMemory,
          objectionStrategies: result.topObjections,
          dynamicStrategySupplement: result.systemPromptSupplement,
          lastStrategyUpdate: new Date().toISOString()
        });
      }
    }
  } catch (error) {
    console.error('[OBJECTION_LOOP] Failed to process objection loop:', error);
  }
}
