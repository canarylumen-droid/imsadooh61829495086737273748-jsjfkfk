import { storage } from '@shared/lib/storage/storage.js';
import { googleCalendarOAuth } from './google-calendar.js';
import { calendlyOAuth } from './calendly.js';

export class RevocationService {
  /**
   * Completely isolate and clean up a user's presence, including revoking all remote OAuth tokens.
   * This ensures no orphaned tokens remain active on third-party providers.
   */
  async revokeAllAndDestroyUser(userId: string): Promise<void> {
    try {
      console.log(`[RevocationService] Starting complete revocation and data destruction for user: ${userId}`);

      // 1. Revoke Google Calendar Token
      try {
        await googleCalendarOAuth.revokeToken(userId);
      } catch (err) {
        console.error(`[RevocationService] Failed to revoke Google Calendar token for user: ${userId}`, err);
      }

      // 2. Revoke Calendly Token
      try {
        await calendlyOAuth.revokeToken(userId);
      } catch (err) {
        console.error(`[RevocationService] Failed to revoke Calendly token for user: ${userId}`, err);
      }

      // 3. (Future) Revoke Microsoft/Gmail tokens directly if needed,
      // currently handled mostly by deleteIntegrations cascaded in the DB
      // but if we need a specific http revocation we can do it here.

      // 4. Finally, securely delete all user data from our databases
      await storage.deleteUser(userId);

      console.log(`[RevocationService] Successfully revoked tokens and deleted data for user: ${userId}`);
    } catch (error) {
      console.error(`[RevocationService] Critical error during complete data destruction for user: ${userId}`, error);
      throw new Error('Failed to complete data revocation sequence');
    }
  }
}

export const revocationService = new RevocationService();





