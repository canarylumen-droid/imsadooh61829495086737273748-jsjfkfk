import { db } from '@shared/lib/db/db.js';
import { memoryEpisodes, aiLearningPatterns, leads } from "@audnix/shared";
import { eq, and, sql, desc } from "drizzle-orm";

export type EpisodeType = "success" | "failure" | "neutral";

export interface CreateEpisodeParams {
  userId: string;
  leadId?: string;
  type: EpisodeType;
  action: string;
  context: string;
  outcome: string;
  metadata?: Record<string, any>;
}

export class EpisodicMemoryService {
  /**
   * Records a new episodic memory event.
   * This is the foundation of the "Long Horizon Memory" and "Episodic Memory" requirements.
   */
  async recordEpisode(params: CreateEpisodeParams): Promise<string> {
    const [result] = await db.insert(memoryEpisodes).values({
      userId: params.userId,
      leadId: params.leadId || null,
      type: params.type,
      action: params.action,
      context: params.context,
      outcome: params.outcome,
      metadata: params.metadata || {},
    }).returning({ id: memoryEpisodes.id });

    // Asynchronously trigger pattern learning
    setImmediate(() => this.distillPattern(params));

    return result.id;
  }

  /**
   * Internal helper to distill patterns from episodes.
   * Updates aiLearningPatterns to strengthen or weaken autonomous behaviors.
   */
  private async distillPattern(params: CreateEpisodeParams) {
    try {
      const patternKey = `${params.action}:${params.type}`;
      
      const [existing] = await db.select()
        .from(aiLearningPatterns)
        .where(and(
          eq(aiLearningPatterns.userId, params.userId),
          eq(aiLearningPatterns.patternKey, patternKey)
        ))
        .limit(1);

      if (existing) {
        await db.update(aiLearningPatterns)
          .set({
            strength: existing.strength + (params.type === 'success' ? 5 : -2),
            successCount: params.type === 'success' ? existing.successCount + 1 : existing.successCount,
            failureCount: params.type === 'failure' ? existing.failureCount + 1 : existing.failureCount,
            lastUsedAt: new Date(),
          })
          .where(eq(aiLearningPatterns.id, existing.id));
      } else {
        await db.insert(aiLearningPatterns).values({
          userId: params.userId,
          patternKey,
          strength: params.type === 'success' ? 10 : 0,
          successCount: params.type === 'success' ? 1 : 0,
          failureCount: params.type === 'failure' ? 1 : 0,
          metadata: { firstAction: params.action }
        });
      }
    } catch (err) {
      console.error('[Memory] Pattern distillation failed:', err);
    }
  }

  /**
   * Retrieves relevant memory episodes for a specific lead or user.
   */
  async getRecentEpisodes(userId: string, leadId?: string, limit: number = 10) {
    let conditions = [eq(memoryEpisodes.userId, userId)];
    if (leadId) {
      conditions.push(eq(memoryEpisodes.leadId, leadId));
    }

    return await db.select()
      .from(memoryEpisodes)
      .where(and(...conditions))
      .orderBy(desc(memoryEpisodes.createdAt))
      .limit(limit);
  }

  /**
   * Records a lead status change event.
   * Now de-hardcoded: Records the raw transition and relies on the 
   * LearningDistiller agent to evaluate the true "Success/Failure" of the interaction.
   */
  async onLeadStatusChange(leadId: string, oldStatus: string, newStatus: string) {
    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
    if (!lead) return;

    // Record as neutral/raw for AI processing
    await this.recordEpisode({
      userId: lead.userId,
      leadId: lead.id,
      type: 'neutral',
      action: 'status_change',
      context: `Status transition: ${oldStatus} -> ${newStatus}`,
      outcome: `New status: ${newStatus}`,
      metadata: { 
        oldStatus, 
        newStatus, 
        channel: lead.channel,
        needs_ai_distillation: true // Flag for background worker
      }
    });
  }
}

export const episodicMemory = new EpisodicMemoryService();
