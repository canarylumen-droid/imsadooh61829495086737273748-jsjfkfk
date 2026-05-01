import { db } from '@shared/lib/db/db.js';
import { messages, leads } from "@audnix/shared";
import { eq, and, desc, sql } from "drizzle-orm";

export interface ObjectionHandle {
  objection: string;
  response: string;
  successMetric: number;
}

/**
 * Phase 52: Objection Intelligence Service
 * Extracts and manages high-performing objection handlers across leads.
 */
export class ObjectionService {
  private playbookCache: Map<string, ObjectionHandle[]> = new Map();

  /**
   * Scans a lead's history for successful objection handles.
   * A 'success' is currently defined as an objection followed by a handle that resulted in 'booked' or 'replied' status.
   */
  async extractWinningHandles(userId: string): Promise<void> {
    try {
      // 1. Find leads that successfully converted
      const successfulLeads = await db
        .select()
        .from(leads)
        .where(
          and(
            eq(leads.userId, userId),
            sql`leads.status IN ('booked', 'replied')`
          )
        )
        .limit(50);

      const handles: ObjectionHandle[] = [];

      for (const lead of successfulLeads) {
        // 2. Fetch thread
        const thread = await db
          .select()
          .from(messages)
          .where(eq(messages.leadId, lead.id))
          .orderBy(desc(messages.createdAt))
          .limit(10);

        // 3. Find objection/response pairs
        // We look for: Inbound (Objection) -> Outbound (Handle) -> Continued Interest
        for (let i = 0; i < thread.length - 1; i++) {
          const msg = thread[i];
          const prev = thread[i + 1];

          if (msg.direction === 'outbound' && prev.direction === 'inbound') {
            const metadata = (prev.metadata as any) || {};
            if (metadata.hasObjection) {
              handles.push({
                objection: prev.body,
                response: msg.body,
                successMetric: 1.0 // High weight for booked leads
              });
            }
          }
        }
      }

      if (handles.length > 0) {
        this.playbookCache.set(userId, handles.slice(0, 20));
        console.log(`✅ [ObjectionService] Extracted ${handles.length} winning handles for user ${userId}`);
      }
    } catch (err) {
      console.error('[ObjectionService] Extraction failed:', err);
    }
  }

  /**
   * Retrieves the most relevant successful handle for a current objection
   */
  getBestHandle(userId: string, currentObjection: string): ObjectionHandle | null {
    const handles = this.playbookCache.get(userId) || [];
    if (handles.length === 0) return null;

    // Simple keyword matching for now - in prod would use semantic similarity
    const lowerObjection = currentObjection.toLowerCase();
    
    // Find handle with most overlap
    let best: ObjectionHandle | null = null;
    let maxOverlap = 0;

    for (const h of handles) {
      const keywords = h.objection.toLowerCase().split(' ').filter(w => w.length > 4);
      const overlap = keywords.filter(k => lowerObjection.includes(k)).length;
      
      if (overlap > maxOverlap) {
        maxOverlap = overlap;
        best = h;
      }
    }

    return best;
  }

  /**
   * Formats the playbook for injection into the AI prompt
   */
  formatPlaybookForPrompt(userId: string): string {
    const handles = this.playbookCache.get(userId) || [];
    if (handles.length === 0) return "";

    return `
### THE OBJECTION PLAYBOOK (Previous Successful Conversions)
Below are examples of how you successfully handled objections for this user in the past:
${handles.map(h => `- OBJECTION: "${h.objection}"\n  - WINNING_REPLY: "${h.response}"`).join('\n')}
Use these as stylistic and logical references for your current reply.
`;
  }
}

export const objectionService = new ObjectionService();



