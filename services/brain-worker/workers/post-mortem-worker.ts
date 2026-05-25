import { db } from '@shared/lib/db/db.js';
import { leads, users, messages } from "@audnix/shared";
import { eq, and, desc, sql } from "drizzle-orm";
import { generateReply } from "@services/brain-worker/src/ai-lib/core/ai-service.js";
import { workerHealthMonitor } from "@shared/lib/monitoring/worker-health.js";

/**
 * Phase 54: Automated "Lost Lead" Post-Mortem
 * Analyzes leads marked as 'not_interested' to extract strategic pivots.
 */
export class PostMortemWorker {
  private isProcessing: boolean = false;
  private interval: NodeJS.Timeout | null = null;
  private readonly INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

  start(): void {
    if (this.interval) return;
    console.log('[PostMortemWorker] 🔬 Starting — runs every 6 hours');
    workerHealthMonitor.registerWorker('PostMortemWorker');
    this.tick();
    this.interval = setInterval(() => this.tick(), this.INTERVAL_MS);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      console.log('[PostMortemWorker] 🛑 Stopped');
    }
  }

  async tick(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      // Find leads marked 'not_interested' that haven't been analyzed yet
      const lostLeads = await db
        .select()
        .from(leads)
        .where(
          and(
            eq(leads.status, 'not_interested'),
            sql`leads.metadata->'post_mortem' IS NULL`
          )
        )
        .limit(5);

      for (const lead of lostLeads) {
        await this.analyzeLostLead(lead);
      }
      workerHealthMonitor.recordSuccess('PostMortemWorker');
    } catch (err) {
      console.error('[PostMortemWorker] Tick failed:', err);
      workerHealthMonitor.recordError('PostMortemWorker', err instanceof Error ? err.message : String(err));
    } finally {
      this.isProcessing = false;
    }
  }

  private async analyzeLostLead(lead: any): Promise<void> {
    try {
      // 1. Get conversation history
      const history = await db
        .select()
        .from(messages)
        .where(eq(messages.leadId, lead.id))
        .orderBy(desc(messages.createdAt))
        .limit(15);

      if (history.length === 0) return;

      const chatLog = history.reverse().map(m => `${m.direction.toUpperCase()}: ${m.body}`).join('\n');

      // 2. Perform AI analysis
      const prompt = `
[LOST LEAD POST-MORTEM]
Analyze the following sales conversation that resulted in a "Not Interested" outcome.
Your goal is to identify the EXACT moment we lost them and suggest a strategic pivot for future similar leads.

CONVERSATION:
${chatLog}

Return a JSON object:
{
  "dropOffPoint": "string - describe the specific message or topic where interest died",
  "reason": "string - e.g. price sensitivity, timing, bad fit, personality clash",
  "pivotSuggestion": "string - how should we handle this differently next time?",
  "sentimentAtEnd": "string - friendly, annoyed, clinical"
}
`;

      const aiResponse = await generateReply("You are an expert sales analyst.", prompt, { model: 'gpt-4o-mini' as any }).catch(() => null);
      if (!aiResponse || typeof aiResponse.text !== 'string') return;

      // Extract JSON
      const aiText = aiResponse.text;
      const jsonStart = aiText.indexOf('{');
      const jsonEnd = aiText.lastIndexOf('}') + 1;
      if (jsonStart === -1) return;

      const analysis = JSON.parse(aiText.substring(jsonStart, jsonEnd));

      // 3. Save to metadata
      const updatedMetadata = {
        ...(lead.metadata as any || {}),
        post_mortem: analysis,
        analyzedAt: new Date().toISOString()
      };

      await db
        .update(leads)
        .set({ metadata: updatedMetadata })
        .where(eq(leads.id, lead.id));

      console.log(`📉 [PostMortem] Analyzed lost lead ${lead.id}: ${analysis.reason}`);

    } catch (err) {
      console.error(`[PostMortemWorker] Failed to analyze lead ${lead.id}:`, err);
    }
  }
}

export const postMortemWorker = new PostMortemWorker();





