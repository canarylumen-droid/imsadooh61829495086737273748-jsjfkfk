import { Router, Request, Response } from 'express';
import { requireAuth, getCurrentUserId } from '../middleware/auth.js';
import { bounceHandler } from '@services/email-service/src/email/bounce-handler.js';
import { smtpAbuseProtection } from '@services/email-service/src/email/smtp-abuse-protection.js';
import { db } from '@shared/lib/db/db.js';
import { emailTracking, integrations } from '@audnix/shared';
import { warmupMailboxes } from '@audnix/shared';
import { eq, and, sql, gte, desc } from 'drizzle-orm';

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

/**
 * Get inbox placement stats — per-mailbox breakdown of inbox vs spam vs bounce
 */
router.get('/inbox-placement', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const days = Math.min(parseInt(req.query.days as string) || 30, 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const userIntegrations = await db
      .select({ id: integrations.id, userId: integrations.userId })
      .from(integrations)
      .where(eq(integrations.userId, userId));

    if (userIntegrations.length === 0) {
      res.json({ success: true, mailboxes: [], totals: { sent: 0, inbox: 0, spam: 0, bounce: 0, rate: '0%' } });
      return;
    }

    const integrationIds = userIntegrations.map(i => i.id);

    const rows = await db
      .select({
        integrationId: emailTracking.integrationId,
        placement: emailTracking.placement,
        count: sql<number>`count(*)::int`,
      })
      .from(emailTracking)
      .where(
        and(
          sql`${emailTracking.integrationId} IN ${integrationIds}`,
          gte(emailTracking.sentAt, since)
        )
      )
      .groupBy(emailTracking.integrationId, emailTracking.placement);

    const perMailbox: Record<string, { sent: number; inbox: number; spam: number; bounce: number; other: number }> = {};
    for (const id of integrationIds) {
      perMailbox[id] = { sent: 0, inbox: 0, spam: 0, bounce: 0, other: 0 };
    }

    for (const row of rows) {
      const id = row.integrationId ?? '';
      if (!id) continue;
      if (!perMailbox[id]) perMailbox[id] = { sent: 0, inbox: 0, spam: 0, bounce: 0, other: 0 };
      perMailbox[id].sent += row.count;
      if (row.placement === 'inbox') perMailbox[id].inbox += row.count;
      else if (row.placement === 'spam') perMailbox[id].spam += row.count;
      else if (row.placement === 'bounce') perMailbox[id].bounce += row.count;
      else perMailbox[id].other += row.count;
    }

    let totalSent = 0, totalInbox = 0, totalSpam = 0, totalBounce = 0;
    const mailboxList = integrationIds.map(id => {
      const m = perMailbox[id];
      totalSent += m.sent;
      totalInbox += m.inbox;
      totalSpam += m.spam;
      totalBounce += m.bounce;
      const inboxRate = m.sent > 0 ? Math.round((m.inbox / m.sent) * 100) : 0;
      return { integrationId: id, ...m, inboxRate };
    });

    res.json({
      success: true,
      mailboxes: mailboxList,
      totals: {
        sent: totalSent,
        inbox: totalInbox,
        spam: totalSpam,
        bounce: totalBounce,
        rate: totalSent > 0 ? `${Math.round((totalInbox / totalSent) * 100)}%` : '0%',
      },
    });
  } catch (error: unknown) {
    console.error('Error getting inbox placement stats:', error);
    res.status(500).json({ error: 'Failed to get inbox placement stats' });
  }
});

/**
 * Get domain reputation per mailbox — aggregates spam/bounce rates
 */
router.get('/domain-reputation', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const days = Math.min(parseInt(req.query.days as string) || 30, 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const userIntegrations = await db
      .select({ id: integrations.id })
      .from(integrations)
      .where(eq(integrations.userId, userId));

    const integrationIds = userIntegrations.map(i => i.id);
    if (integrationIds.length === 0) {
      res.json({ success: true, reputations: [] });
      return;
    }

    const rows = await db
      .select({
        integrationId: emailTracking.integrationId,
        placement: emailTracking.placement,
        count: sql<number>`count(*)::int`,
      })
      .from(emailTracking)
      .where(
        and(
          sql`${emailTracking.integrationId} IN ${integrationIds}`,
          gte(emailTracking.sentAt, since)
        )
      )
      .groupBy(emailTracking.integrationId, emailTracking.placement);

    const map: Record<string, { sent: number; spam: number; bounce: number }> = {};
    for (const id of integrationIds) map[id] = { sent: 0, spam: 0, bounce: 0 };

    for (const row of rows) {
      const id = row.integrationId ?? '';
      if (!id) continue;
      if (!map[id]) map[id] = { sent: 0, spam: 0, bounce: 0 };
      map[id].sent += row.count;
      if (row.placement === 'spam') map[id].spam += row.count;
      else if (row.placement === 'bounce') map[id].bounce += row.count;
    }

    const reputations = integrationIds.map(id => {
      const m = map[id];
      const spamRate = m.sent > 0 ? Math.round((m.spam / m.sent) * 100) : 0;
      const bounceRate = m.sent > 0 ? Math.round((m.bounce / m.sent) * 100) : 0;
      const score = Math.max(0, 100 - spamRate * 2 - bounceRate * 3);
      return { integrationId: id, sent: m.sent, spam: m.spam, bounce: m.bounce, spamRate, bounceRate, score };
    });

    res.json({ success: true, reputations });
  } catch (error: unknown) {
    console.error('Error getting domain reputation:', error);
    res.status(500).json({ error: 'Failed to get domain reputation' });
  }
});

export default router;
