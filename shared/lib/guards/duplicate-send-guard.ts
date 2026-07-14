/**
 * DUPLICATE SEND GUARD v1
 * ================================
 * Prevents "Double-Dipping" where a lead accidentally receives the same 
 * message twice (e.g. from two different campaigns or mailboxes).
 */

import { db } from '@shared/lib/db/db.js';
import { messages } from '@audnix/shared';
import { and, eq, gte, sql } from 'drizzle-orm';

export class DuplicateSendGuard {
  /**
   * Checks if a lead has received a message with the same subject or body recently.
   * @param leadId The ID of the lead.
   * @param subject The subject line to check.
   * @param body The body content to check.
   * @param windowHours The lookback window (default 24h).
   */
  static async isDuplicate(
    leadId: string, 
    subject: string, 
    body: string, 
    windowHours: number = 24
  ): Promise<{ isDuplicate: boolean; reason?: string }> {
    const lookback = new Date();
    lookback.setHours(lookback.getHours() - windowHours);

    // Fetch messages to this lead in the window
    const recentMessages = await db.select()
      .from(messages)
      .where(and(
        eq(messages.leadId, leadId),
        eq(messages.direction, 'outbound'),
        gte(messages.createdAt, lookback)
      ));

    for (const msg of recentMessages) {
      // Direct subject match
      if (msg.subject?.trim().toLowerCase() === subject.trim().toLowerCase()) {
        return { isDuplicate: true, reason: `Subject already sent within ${windowHours}h: "${subject}"` };
      }

      // Fuzzy body match (to catch slightly varied AI generations that are effectively the same)
      const snippet = body.substring(0, 50).trim().toLowerCase();
      const existingSnippet = msg.body.substring(0, 50).trim().toLowerCase();
      
      if (snippet === existingSnippet) {
        return { isDuplicate: true, reason: `Content snippet already sent within ${windowHours}h` };
      }
    }

    return { isDuplicate: false };
  }
}
