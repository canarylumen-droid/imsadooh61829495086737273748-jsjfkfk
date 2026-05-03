/**
 * AI OBSERVER ENGINE v1
 * ================================
 * The "Listening" and "Planning" layer of the Autonomous SDR.
 * This engine periodically surveys leads to update their strategic 
 * procedural memory, ensuring continuity and intent-driven outreach.
 */

import { storage } from '@shared/lib/storage/storage.js';
import { db } from '@shared/lib/db/db.js';
import { leads, messages, aiActionLogs } from '@audnix/shared';
import { eq, and, desc, lt, sql } from 'drizzle-orm';
import { generateReply } from '../core/ai-service.js';
import { MODELS } from '../utils/model-config.js';

export class AIObserver {
  /**
   * Surveys all active leads for a user to update their strategy.
   * Runs as a "Pulse" every 12 hours.
   */
  static async survey(userId: string): Promise<void> {
    console.log(`[AI-Observer] Starting strategy survey for user ${userId}...`);

    // Fetch leads that are "Active" but silent for > 3 days, or "New"
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const activeLeads = await db.select()
      .from(leads)
      .where(and(
        eq(leads.userId, userId),
        eq(leads.archived, false),
        eq(leads.aiPaused, false),
        sql`${leads.lastMessageAt} < ${threeDaysAgo} OR ${leads.status} = 'new'`
      ))
      .limit(50); // Batch limit for performance

    for (const lead of activeLeads) {
      await this.planNextMove(lead);
    }

    // [PHASE 110] SEGMENT INTELLIGENCE: Analyze cohort-level bottlenecks
    await this.performCohortAnalysis(userId);

    console.log(`[AI-Observer] Survey complete for ${activeLeads.length} leads.`);
  }

  /**
   * Analyzes trends across lead cohorts (Industry/Niche) to find patterns.
   */
  private static async performCohortAnalysis(userId: string): Promise<void> {
    const allLeads = await db.select().from(leads).where(eq(leads.userId, userId));
    if (allLeads.length < 10) return; // Need a critical mass for analysis

    const stats: Record<string, { total: number; conversions: number; ghosted: number }> = {};

    for (const lead of allLeads) {
      const industry = (lead.metadata as any)?.industry || lead.metadata?.niche || 'General';
      if (!stats[industry]) stats[industry] = { total: 0, conversions: 0, ghosted: 0 };
      
      stats[industry].total++;
      if (lead.status === 'converted' || lead.status === 'replied') stats[industry].conversions++;
      if (lead.status === 'cold' && lead.lastMessageAt && (new Date().getTime() - lead.lastMessageAt.getTime() > 7 * 24 * 60 * 60 * 1000)) {
        stats[industry].ghosted++;
      }
    }

    // Find the "Crisis" cohort (high ghosting, low conversion)
    const crisisCohort = Object.entries(stats).find(([_, s]) => s.total >= 5 && (s.ghosted / s.total) > 0.5);

    if (crisisCohort) {
      const [industry, s] = crisisCohort;
      console.warn(`[AI-Observer] 🚨 Crisis detected in segment: ${industry} (${Math.round((s.ghosted / s.total) * 100)}% ghosted). Planning pivot.`);
      
      const prompt = `CRITICAL STRATEGIC ANALYSIS:
The segment "${industry}" has a 50%+ ghosting rate. Our current ROI-focused hooks are failing.

[TASK]
Propose a "Pattern Interrupter" strategy specifically for ${industry}. 
What should we change? (e.g., Change hook from "Price" to "Peace of Mind").
Keep it under 30 words.`;

      const pivot = await generateReply("You are a Senior Strategic Analyst.", prompt, { model: MODELS.sales_reasoning, nga1Enforced: true });
      
      // Update ALL leads in this segment with a "Strategic Alert" note
      await db.update(leads)
        .set({ 
          metadata: sql`jsonb_set(COALESCE(metadata, '{}'::jsonb), '{segment_pivot}', ${JSON.stringify(pivot.text)}::jsonb)`,
          updatedAt: new Date()
        })
        .where(and(eq(leads.userId, userId), sql`${leads.metadata}->>'industry' = ${industry} OR ${leads.metadata}->>'niche' = ${industry}`));
    }
  }

  /**
   * Analyzes a single lead's history and updates their procedural memory.
   */
  private static async planNextMove(lead: any): Promise<void> {
    // Fetch last 5 messages for context
    const recentMessages = await db.select()
      .from(messages)
      .where(eq(messages.leadId, lead.id))
      .orderBy(desc(messages.createdAt))
      .limit(5);

    const context = recentMessages.map(m => `${m.direction.toUpperCase()}: ${m.body}`).reverse().join('\n');

    const prompt = `You are a Senior SDR Strategist. Analyze the current state of this lead and plan the "Next Strategic Move".

LEAD: ${lead.name} at ${lead.company}
STATUS: ${lead.status}
HISTORY:
${context || 'No messages yet.'}

[GOAL]
Create a concise "Procedural Memory" note (max 50 words) that describes:
1. The lead's current intent/vibe.
2. The specific "Contextual Thread" we should maintain (e.g. "Keep talking about the Q3 budget objection").
3. The next logical goal (e.g. "Move to decision stage" or "Warm them up with a case study").

Return ONLY the strategy text.`;

    try {
      const response = await generateReply(
        "You are a Senior SDR Strategist.",
        prompt,
        { model: MODELS.sales_reasoning, temperature: 0.7, maxTokens: 150, nga1Enforced: true }
      );

      const strategy = response.text || 'Continue outreach focusing on ROI.';

      // Update lead's procedural memory
      await db.update(leads)
        .set({ 
          proceduralMemory: { 
            lastObservedAt: new Date().toISOString(),
            strategy,
            vibe: lead.status === 'replied' ? 'engaged' : 'cold'
          } as any,
          updatedAt: new Date()
        })
        .where(eq(leads.id, lead.id));

      // Log the observation
      await db.insert(aiActionLogs).values({
        userId: lead.userId,
        leadId: lead.id,
        actionType: 'observation',
        decision: 'wait',
        metadata: { strategy, originalStatus: lead.status },
        createdAt: new Date()
      });

    } catch (err) {
      console.error(`[AI-Observer] Planning failed for lead ${lead.id}:`, err);
    }
  }
}
