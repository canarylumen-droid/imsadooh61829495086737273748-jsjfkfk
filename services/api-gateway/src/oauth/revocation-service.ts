import { storage } from '@shared/lib/storage/storage.js';
import { googleCalendarOAuth } from './google-calendar.js';
import { calendlyOAuth } from './calendly.js';

export class RevocationService {
  /**
   * Completely isolate and clean up a user's presence, including revoking all remote OAuth tokens.
   * This ensures no orphaned tokens remain active on third-party providers.
   * @param userId - The UUID of the user to destroy
   * @param email - Optional email to log in deleted_accounts_log before deletion
   */
  async revokeAllAndDestroyUser(userId: string, email?: string): Promise<void> {
    try {
      console.log(`[RevocationService] Starting complete revocation and data destruction for user: ${userId}`);

      // 0. Log the email before deletion (data will be gone after CASCADE)
      if (email) {
        try {
          const { db } = await import('@shared/lib/db/db.js');
          const { deletedAccountsLog } = await import('@audnix/shared');
          await db.insert(deletedAccountsLog).values({ email, reason: 'user_initiated' });
          console.log(`[RevocationService] Logged deletion for email: ${email}`);
        } catch (logErr) {
          console.error(`[RevocationService] Failed to log deleted account email for user ${userId}:`, logErr);
        }
      }

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

      // 3. Clear all Redis queues/jobs for this user so nothing processes after deletion
      try {
        const { getRedisClient } = await import('@shared/lib/redis/redis.js');
        const client = await getRedisClient();
        if (client) {
          // Pattern-delete all user-scoped keys
          const keys = await client.keys(`*:${userId}:*`);
          if (keys.length > 0) await client.del(keys);
          // Also delete broad user keys
          const userKeys = await client.keys(`*${userId}*`);
          if (userKeys.length > 0) await client.del(userKeys);
        }
      } catch (err) {
        console.error(`[RevocationService] Failed to clear Redis queues for user: ${userId}`, err);
      }

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





