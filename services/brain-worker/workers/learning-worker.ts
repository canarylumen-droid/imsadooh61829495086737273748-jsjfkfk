import { db } from '@shared/lib/db/db.js';
import { memoryEpisodes, aiLearningPatterns, leads, users } from "@audnix/shared";
import { eq, and, sql, desc, gte } from "drizzle-orm";

export class LearningWorker {
  /**
   * Periodic tick to distill high-level insights from episodic memory.
   * This implements the "Learning Autonomously" requirement.
   */
  async distillGlobalPatterns() {
    console.log(' [Learning] Starting global pattern distillation sweep...');
    
    // Process episodes from the last 24 hours
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    try {
      // 1. Analyze niche-specific success rates
      const nichePatterns = await db.execute(sql`
        SELECT 
          l.metadata->>'niche' as niche,
          l.channel,
          COUNT(*) as total_episodes,
          COUNT(*) FILTER (WHERE me.type = 'success') as success_count
        FROM memory_episodes me
        JOIN leads l ON me.lead_id = l.id
        WHERE me.created_at > ${yesterday.toISOString()}
        GROUP BY niche, l.channel
        HAVING COUNT(*) > 5
      `);

      for (const row of (nichePatterns.rows || [])) {
        const { niche, channel, total_episodes, success_count } = row as any;
        if (!niche) continue;

        const patternKey = `niche_success:${niche}:${channel}`;
        const strength = Math.round((success_count / total_episodes) * 100);

        // Update global patterns (system-wide learning)
        // Note: For now we update per-user or global depending on architecture.
        // Let's update for all active users to benefit from collective intelligence.
        const allUsers = await db.select({ id: users.id }).from(users);
        for (const user of allUsers) {
          await this.upsertPattern(user.id, patternKey, strength, success_count, total_episodes - success_count);
        }
      }

      console.log(' [Learning] Global pattern sweep complete.');
    } catch (err) {
      console.error(' [Learning] Distillation sweep failed:', err);
    }
  }

  /**
   * Autonomously processes "Raw" episodes that need AI evaluation.
   * This de-hardcodes the success/failure determination by using the 
   * LearningDistiller agent to analyze the conversation context.
   */
  async processRawEpisodes() {
    console.log(' [Learning] Distilling raw episodes...');
    const { learningDistiller } = await import('../src/orchestrator/agents/learning-distiller.js');

    const rawEpisodes = await db.select()
      .from(memoryEpisodes)
      .where(sql`metadata->>'needs_ai_distillation' = 'true'`)
      .limit(20);

    for (const episode of rawEpisodes) {
      try {
        // 1. Get conversation history for context
        const conversationHistory = await db.select()
          .from(leads) // We'd actually want messages here
          .where(eq(leads.id, episode.leadId!));
        
        // (Simplified for now: use the episode context/outcome)
        const distillation = await learningDistiller.distillEpisode(
          episode.outcome, // Use the "Outcome" as the proxy for transcript if missing
          (episode.metadata as any)?.oldStatus || 'unknown',
          (episode.metadata as any)?.newStatus || 'unknown',
          episode.context
        );

        // 2. Update the episode with the AI's findings
        await db.update(memoryEpisodes)
          .set({
            type: distillation.type,
            metadata: {
              ...(episode.metadata as any),
              needs_ai_distillation: false,
              ai_insight: distillation.insight,
              ai_suggested_action: distillation.suggestedAction,
              distilled_at: new Date().toISOString()
            }
          })
          .where(eq(memoryEpisodes.id, episode.id));

        // 3. Update the global pattern with the AI's strength
        await this.upsertPattern(
          episode.userId, 
          distillation.patternKey, 
          distillation.strength, 
          distillation.type === 'success' ? 1 : 0,
          distillation.type === 'failure' ? 1 : 0
        );

        console.log(` [Learning] Distilled episode ${episode.id.slice(-8)}: ${distillation.type} (${distillation.strength}/10)`);
      } catch (err) {
        console.error(` [Learning] Failed to distill episode ${episode.id}:`, err);
      }
    }
  }

  private async upsertPattern(userId: string, patternKey: string, strength: number, successes: number, failures: number) {
    const [existing] = await db.select()
      .from(aiLearningPatterns)
      .where(and(
        eq(aiLearningPatterns.userId, userId),
        eq(aiLearningPatterns.patternKey, patternKey)
      ))
      .limit(1);

    if (existing) {
      await db.update(aiLearningPatterns)
        .set({
          strength: Math.round((existing.strength + strength) / 2), // Moving average
          successCount: existing.successCount + successes,
          failureCount: existing.failureCount + failures,
          lastUsedAt: new Date(),
        })
        .where(eq(aiLearningPatterns.id, existing.id));
    } else {
      await db.insert(aiLearningPatterns).values({
        userId,
        patternKey,
        strength,
        successCount: successes,
        failureCount: failures,
        metadata: { source: 'distill_global' }
      });
    }
  }
}

export const learningWorker = new LearningWorker();
