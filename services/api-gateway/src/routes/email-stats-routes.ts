import { Router, Request, Response } from 'express';
import { requireAuthOrApiKey, getCurrentUserId } from '../middleware/auth.js';
import { bounceHandler } from '@services/email-service/src/email/bounce-handler.js';
import { smtpAbuseProtection } from '@services/email-service/src/email/smtp-abuse-protection.js';
import { db } from '@shared/lib/db/db.js';
import { emailTracking, integrations, bounceTracker } from '@audnix/shared';
import { warmupMailboxes } from '@audnix/shared';
import { eq, and, sql, gte, desc } from 'drizzle-orm';

const router = Router();

/**
 * Get email bounce statistics
 */
router.get('/bounces/stats', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
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
router.get('/sending/limits', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
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
router.get('/warmup/status', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
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
router.get('/inbox-placement', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const days = Math.min(parseInt(req.query.days as string) || 30, 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const filterIntegrationId = req.query.integrationId as string | undefined;

    const userIntegrations = filterIntegrationId
      ? await db.select({ id: integrations.id, userId: integrations.userId })
          .from(integrations)
          .where(and(eq(integrations.userId, userId), eq(integrations.id, filterIntegrationId)))
      : await db.select({ id: integrations.id, userId: integrations.userId })
          .from(integrations)
          .where(eq(integrations.userId, userId));

    if (userIntegrations.length === 0) {
      res.json({ success: true, mailboxes: [], totals: { sent: 0, inbox: 0, spam: 0, bounce: 0, rate: '0%' } });
      return;
    }

    const integrationIds = userIntegrations.map(i => i.id);

    // 1. Get placement data from email_tracking
    const trackingRows = await db
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

    // 2. Get real bounce/spam data from bounce_tracker
    const bounceRows = await db
      .select({
        integrationId: bounceTracker.integrationId,
        bounceType: bounceTracker.bounceType,
        count: sql<number>`count(*)::int`,
      })
      .from(bounceTracker)
      .where(
        and(
          sql`${bounceTracker.integrationId} IN ${integrationIds}`,
          gte(bounceTracker.timestamp, since)
        )
      )
      .groupBy(bounceTracker.integrationId, bounceTracker.bounceType);

    const perMailbox: Record<string, { sent: number; inbox: number; spam: number; bounce: number; other: number }> = {};
    for (const id of integrationIds) {
      perMailbox[id] = { sent: 0, inbox: 0, spam: 0, bounce: 0, other: 0 };
    }

    // Apply email_tracking data
    for (const row of trackingRows) {
      const id = row.integrationId ?? '';
      if (!id) continue;
      if (!perMailbox[id]) perMailbox[id] = { sent: 0, inbox: 0, spam: 0, bounce: 0, other: 0 };
      perMailbox[id].sent += row.count;
      if (row.placement === 'inbox') perMailbox[id].inbox += row.count;
      else if (row.placement === 'spam') perMailbox[id].spam += row.count;
      else if (row.placement === 'bounce') perMailbox[id].bounce += row.count;
      else perMailbox[id].other += row.count;
    }

    // Apply bounce_tracker data (overrides email_tracking with real data)
    for (const row of bounceRows) {
      const id = row.integrationId ?? '';
      if (!id) continue;
      if (!perMailbox[id]) perMailbox[id] = { sent: 0, inbox: 0, spam: 0, bounce: 0, other: 0 };
      if (row.bounceType === 'hard' || row.bounceType === 'soft') {
        perMailbox[id].bounce += row.count;
      } else if (row.bounceType === 'spam') {
        perMailbox[id].spam += row.count;
      }
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
router.get('/domain-reputation', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const days = Math.min(parseInt(req.query.days as string) || 30, 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const filterIntegrationId = req.query.integrationId as string | undefined;

    const userIntegrations = filterIntegrationId
      ? await db.select({ id: integrations.id })
          .from(integrations)
          .where(and(eq(integrations.userId, userId), eq(integrations.id, filterIntegrationId)))
      : await db.select({ id: integrations.id })
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

/**
 * Get seed-based Inbox Placement score — combines seed test results + Postmaster spam rate
 * into a unified placement percentage (Instantly-style).
 *
 * Formula: finalPlacement = (seedScore * 0.8) + ((1 - spamRate) * 100 * 0.2)
 *
 * Returns the most recently completed seed test with per-provider breakdown.
 */
router.get('/seed-placement', requireAuthOrApiKey, async (_req: Request, res: Response): Promise<void> => {
  try {
    // 1. Find the most recent fully-checked seed test batch
    const batchResult = await db.execute<{
      campaign_id: string;
      test_id: string;
      total: number;
      checked: number;
      inbox: number;
      spam: number;
      last_checked: string;
    }>(sql`
      SELECT
        campaign_id,
        test_id,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE folder_found IS NOT NULL)::int AS checked,
        COUNT(*) FILTER (WHERE folder_found = 'inbox')::int AS inbox,
        COUNT(*) FILTER (WHERE folder_found = 'spam')::int AS spam,
        MAX(checked_at) AS last_checked
      FROM seed_results
      GROUP BY campaign_id, test_id
      HAVING COUNT(*) FILTER (WHERE folder_found IS NOT NULL) = COUNT(*)
      ORDER BY MAX(checked_at) DESC
      LIMIT 1
    `);

    // 2. Per-provider breakdown for the found batch
    let providerBreakdown: Array<{ provider: string; inbox: number; spam: number; total: number; rate: number }> = [];
    let seedScore = 0;
    let lastTestedAt: string | null = null;
    let testCampaignId: string | null = null;
    let hasSeeds = false;

    const batchRows = batchResult as unknown as any[];
    if (batchRows.length > 0) {
      const batch = batchRows[0];
      seedScore = batch.total > 0 ? (batch.inbox / batch.total) * 100 : 0;
      lastTestedAt = batch.last_checked;
      testCampaignId = batch.campaign_id;
      hasSeeds = true;

      const providerRows = await db.execute<{
        provider: string;
        inbox: number;
        spam: number;
        total: number;
      }>(sql`
        SELECT
          provider,
          COUNT(*) FILTER (WHERE folder_found = 'inbox')::int AS inbox,
          COUNT(*) FILTER (WHERE folder_found = 'spam')::int AS spam,
          COUNT(*)::int AS total
        FROM seed_results
        WHERE campaign_id = ${batch.campaign_id} AND test_id = ${batch.test_id}
        GROUP BY provider
      `);

      const providerRowsArray = providerRows as unknown as any[];
      providerBreakdown = providerRowsArray.map((r: any) => ({
        provider: r.provider,
        inbox: r.inbox,
        spam: r.spam,
        total: r.total,
        rate: r.total > 0 ? Math.round((r.inbox / r.total) * 100) : 0,
      }));
    }

    // 3. Get latest Postmaster spam rate
    const pmResult = await db.execute<{
      spam_rate: number;
      checked_at: string;
    }>(sql`
      SELECT spam_rate, checked_at
      FROM reputation_snapshots
      WHERE source = 'postmaster' AND spam_rate IS NOT NULL
      ORDER BY checked_at DESC
      LIMIT 1
    `);

    const pmRows = pmResult as unknown as any[];
    const postmasterSpamRate = pmRows.length > 0 ? pmRows[0].spam_rate : null;
    const postmasterScore = postmasterSpamRate !== null
      ? (1 - postmasterSpamRate) * 100
      : null;

    // 4. Compute final unified score
    let finalScore: number | null = null;
    if (hasSeeds && postmasterScore !== null) {
      finalScore = Math.round(seedScore * 0.8 + postmasterScore * 0.2);
    } else if (hasSeeds) {
      finalScore = Math.round(seedScore);
    } else if (postmasterScore !== null) {
      finalScore = Math.round(postmasterScore);
    }

    // 5. Check if seeds are configured at all
    const seedCountResult = await db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count FROM seed_results LIMIT 1
    `);
    const seedCountRows = seedCountResult as unknown as any[];
    const seedsConfigured = seedCountRows.length > 0 && seedCountRows[0].count > 0;

    res.json({
      success: true,
      seedsConfigured,
      hasSeeds,
      seedScore: Math.round(seedScore),
      postmasterSpamRate,
      postmasterScore: postmasterScore !== null ? Math.round(postmasterScore) : null,
      finalScore,
      providerBreakdown,
      lastTestedAt,
      campaignId: testCampaignId,
    });
  } catch (error: unknown) {
    console.error('Error getting seed placement:', error);
    res.json({
      success: true,
      seedsConfigured: false,
      hasSeeds: false,
      seedScore: 0,
      postmasterSpamRate: null,
      postmasterScore: null,
      finalScore: null,
      providerBreakdown: [],
      lastTestedAt: null,
      campaignId: null,
    });
  }
});

/**
 * POST /api/stats/seed-placement/retest
 * Triggers a re-test of the latest campaign by re-registering seeds.
 * The deliverability service's cron picks it up.
 */
router.post('/seed-placement/retest', requireAuthOrApiKey, async (_req: Request, res: Response): Promise<void> => {
  try {
    // Find the most recent campaign
    const latestCampaigns = await db.execute<{ id: string; name: string }>(sql`
      SELECT id, name FROM outreach_campaigns
      ORDER BY created_at DESC
      LIMIT 1
    `) as unknown as any[];
    const latestCampaign = latestCampaigns[0];

    if (!latestCampaign) {
      res.status(400).json({ success: false, error: 'No campaigns found to re-test' });
      return;
    }

    const deliverabilityUrl = process.env.DELIVERABILITY_SERVICE_URL || 'http://localhost:3100';

    // Ask the deliverability service to re-register seeds for this campaign
    const response = await fetch(`${deliverabilityUrl}/seed/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.INTERNAL_API_KEY || '',
      },
      body: JSON.stringify({
        campaignId: latestCampaign.id,
        testId: `retest-${Date.now()}`,
        sentAt: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      res.status(502).json({ success: false, error: `Deliverability service error: ${body}` });
      return;
    }

    const data = await response.json();

    res.json({
      success: true,
      message: 'Seed re-test initiated',
      campaignId: latestCampaign.id,
      registered: data.registered || 0,
    });
  } catch (error: unknown) {
    console.error('Error triggering seed re-test:', error);
    res.status(500).json({ error: 'Failed to trigger re-test' });
  }
});

export default router;
