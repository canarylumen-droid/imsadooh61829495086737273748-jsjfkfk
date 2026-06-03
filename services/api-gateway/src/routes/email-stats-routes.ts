import { Router, Request, Response } from 'express';
import { requireAuth, getCurrentUserId } from '../middleware/auth.js';
import { bounceHandler } from '@services/email-service/src/email/bounce-handler.js';
import { smtpAbuseProtection } from '@services/email-service/src/email/smtp-abuse-protection.js';
import { db } from '@shared/lib/db/db.js';
import { warmupMailboxes } from '@audnix/shared';
import { eq, and, sql } from 'drizzle-orm';

const router = Router();

/**
 * Get email bounce statistics
 */
router.get('/bounces/stats', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const stats = await bounceHandler.getBounceStats(userId);

    res.json({
      success: true,
      bounceStats: {
        hardBounces: stats.hardBounces,
        softBounces: stats.softBounces,
        spamBounces: stats.spamBounces,
        totalBounces: stats.totalBounces,
        bounceRate: `${stats.bounceRate}%`
      }
    });
  } catch (error: unknown) {
    console.error('Error getting bounce stats:', error);
    res.status(500).json({ error: 'Failed to get bounce statistics' });
  }
});

/**
 * Get SMTP rate limit status
 */
router.get('/sending/limits', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const stats = await smtpAbuseProtection.getStats(userId);
    const canSend = await smtpAbuseProtection.canSendEmail(userId);

    res.json({
      success: true,
      sending: {
        plan: stats.plan,
        sentThisHour: stats.sentThisHour,
        sentToday: stats.sentToday,
        hourlyLimit: stats.hourlyLimit,
        dailyLimit: stats.dailyLimit,
        canSendNow: canSend.allowed,
        remainingReason: !canSend.allowed ? canSend.reason : null,
        retryAfter: canSend.delay
      }
    });
  } catch (error: unknown) {
    console.error('Error getting sending limits:', error);
    res.status(500).json({ error: 'Failed to get sending limits' });
  }
});

/**
 * Get REAL P2P warmup status — queries live warmup_mailboxes
 */
router.get('/warmup/status', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;

    const mailboxes = await db
      .select()
      .from(warmupMailboxes)
      .where(eq(warmupMailboxes.userId, userId));

    const active = mailboxes.filter((m) => m.status === 'active').length;
    const total = mailboxes.length;
    const totalSentToday = mailboxes.reduce((sum, m) => sum + (m.dailySentCount || 0), 0);
    const totalReceivedToday = mailboxes.reduce((sum, m) => sum + (m.dailyReceivedCount || 0), 0);

    res.json({
      success: true,
      warmup: {
        totalMailboxes: total,
        activeMailboxes: active,
        totalSentToday,
        totalReceivedToday,
        status: active > 0 ? 'active' : total > 0 ? 'paused' : 'not_enrolled',
        message:
          active > 0
            ? `${active} mailbox(es) actively warming up`
            : total > 0
              ? 'All mailboxes paused — check pool health or daily limits'
              : 'No warmup mailboxes enrolled. Connect an email integration to start.',
      },
    });
  } catch (error: unknown) {
    console.error('Error getting warmup status:', error);
    res.status(500).json({ error: 'Failed to get warmup status' });
  }
});

export default router;
