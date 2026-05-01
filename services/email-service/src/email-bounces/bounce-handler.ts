import { db } from '@shared/lib/db/db.js';
import { bounceTracker, leads as leadsTable, integrations } from '@audnix/shared';
import { eq } from 'drizzle-orm';
import { mailboxHealthService } from '../email/mailbox-health-service.js';

/**
 * Bounce Handler - tracks email bounces and auto-disables invalid leads
 * Supports hard bounces, soft bounces, and spam complaints
 */

export async function recordBounce(
  userId: string,
  leadId: string,
  email: string,
  bounceType: 'hard' | 'soft' | 'spam',
  integrationId?: string
): Promise<void> {
  try {
    // Record bounce
    await db.insert(bounceTracker).values({
      userId,
      leadId,
      integrationId: integrationId || null,
      email,
      bounceType,
      timestamp: new Date(),
      metadata: {
        recordedAt: new Date().toISOString()
      }
    });

    if (integrationId) {
      await mailboxHealthService.checkSpamRisk(integrationId);
    }

    // If hard bounce or spam, mark lead as invalid
    if (bounceType === 'hard' || bounceType === 'spam') {
      await db
        .update(leadsTable)
        .set({
          status: 'not_interested',
          metadata: {
            bounceType,
            bouncedAt: new Date().toISOString()
          }
        })
        .where(eq(leadsTable.id, leadId));

      console.log(`Lead ${leadId} marked as invalid due to ${bounceType} bounce`);
    } else if (bounceType === 'soft') {
      // Soft bounces: retry later
      console.log(`Soft bounce for ${email} - will retry`);
    }
  } catch (error) {
    console.error('Error recording bounce:', error);
  }
}

export async function getBounceStats(userId: string): Promise<{
  hardBounces: number;
  softBounces: number;
  spamComplaints: number;
}> {
  try {
    const results = await db
      .select()
      .from(bounceTracker)
      .where(eq(bounceTracker.userId, userId));

    const stats = {
      hardBounces: results.filter((r: any) => r.bounceType === 'hard').length,
      softBounces: results.filter((r: any) => r.bounceType === 'soft').length,
      spamComplaints: results.filter((r: any) => r.bounceType === 'spam').length
    };

    return stats;
  } catch (error) {
    console.error('Error getting bounce stats:', error);
    return { hardBounces: 0, softBounces: 0, spamComplaints: 0 };
  }
}



