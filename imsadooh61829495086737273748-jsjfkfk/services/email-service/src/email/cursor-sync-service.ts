import { db } from '@shared/lib/db/db.js';
import { integrations } from "@audnix/shared";
import { eq, sql } from "drizzle-orm";

export class CursorSyncService {
  /**
   * Get the last known sync metadata for an integration
   */
  static async getMetadata(integrationId: string) {
    const [integration] = await db.select({
      syncMetadata: integrations.syncMetadata
    })
    .from(integrations)
    .where(eq(integrations.id, integrationId));
    
    return (integration?.syncMetadata as Record<string, any>) || {};
  }

  /**
   * Update sync metadata (e.g. uidnext, modseq)
   */
  static async updateMetadata(integrationId: string, folder: string, metadata: Record<string, any>) {
    const current = await this.getMetadata(integrationId);
    const updated = {
      ...current,
      [folder]: {
        ...(current[folder] || {}),
        ...metadata,
        lastSyncAt: new Date().toISOString()
      }
    };

    await db.update(integrations)
      .set({ syncMetadata: updated })
      .where(eq(integrations.id, integrationId));
  }

  /**
   * Determine the fetch range for IMAP
   * Returns { type: 'uid', range: '...' } or { type: 'seq', range: '...' }
   */
  static async getFetchRange(integrationId: string, folder: string, currentUidNext: number): Promise<{ type: 'uid' | 'seq', range: string }> {
    const meta = await this.getMetadata(integrationId);
    const folderMeta = meta[folder] || {};
    
    const lastUid = folderMeta.lastUid;
    
    if (lastUid && currentUidNext > lastUid) {
      // Fetch from last seen UID + 1 to the end
      return { type: 'uid', range: `${lastUid + 1}:*` };
    }

    // Fallback: fetch last 50 messages if no cursor or no new messages
    return { type: 'seq', range: '1:*' }; // Caller should handle slicing if needed
  }
}





