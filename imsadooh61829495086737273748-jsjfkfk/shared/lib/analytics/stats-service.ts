import { db } from '@shared/lib/db/db.js';
import { leads, messages, insights } from '@audnix/shared';
import { eq, and, gte, lte, count, sql, desc } from 'drizzle-orm';

export interface KPIStats {
  totalLeads: number;
  activeLeads: number;
  bookedLeads: number;
  repliedLeads: number;
  noShowLeads: number;
  emailsSent: number;
  conversionRate: number;           // (booked / totalLeads) * 100
  replyRate: number;                 // (replied / emailsSent) * 100
  bookingRate: number;               // (booked / replied) * 100
  sequenceROI: {                     // Funnel tracking
    sent: number;
    replied: number;
    booked: number;
  };
  topPerformingDay: string;
  avgResponseTimeHours: number;
  period: { start: Date; end: Date };
}

/**
 * Phase 14: Analytics & KPI Stats Service
 *
 * Calculates conversion metrics across the entire lead lifecycle:
 *   Outreach Sent → Replied → Booked → No-Show
 *
 * Results are written to the `insights` table for historical tracking.
 */
class StatsService {
  /**
   * Calculate KPI stats for a user over a given period.
   * Defaults to the last 30 days.
   */
  async getKPIStats(
    userId: string,
    options: { startDate?: Date; endDate?: Date } = {}
  ): Promise<KPIStats> {
    const endDate = options.endDate || new Date();
    const startDate =
      options.startDate ||
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

    if (!db) throw new Error('Database not configured');

    // ── 1. Lead Status Breakdown ─────────────────────────────────────────
    const leadStats = await db
      .select({
        status: leads.status,
        count: count(),
      })
      .from(leads)
      .where(
        and(
          eq(leads.userId, userId),
          gte(leads.createdAt, startDate),
          lte(leads.createdAt, endDate)
        )
      )
      .groupBy(leads.status);

    const statusMap: Record<string, number> = Object.fromEntries(
      leadStats.map((r: { status: string | null; count: number }) => [r.status || 'unknown', Number(r.count)])
    );

    const totalLeads: number = Object.values(statusMap).reduce((a: number, b: number) => a + b, 0);
    const bookedLeads: number = (statusMap['booked'] || 0) + (statusMap['completed'] || 0);
    const noShowLeads: number = statusMap['no_show'] || 0;
    const repliedLeads: number = statusMap['replied'] || 0;
    const activeLeads: number = statusMap['contacted'] || 0;

    // ── 2. Emails Sent ───────────────────────────────────────────────────
    const sentResult = await db
      .select({ count: count() })
      .from(messages)
      .where(
        and(
          eq(messages.userId, userId),
          eq(messages.direction, 'outbound'),
          eq(messages.isWarmup, false),
          gte(messages.createdAt, startDate),
          lte(messages.createdAt, endDate)
        )
      );

    const emailsSent = Number(sentResult[0]?.count || 0);

    // ── 3. Conversion Rates ──────────────────────────────────────────────
    const conversionRate = totalLeads > 0
      ? parseFloat(((bookedLeads / totalLeads) * 100).toFixed(1))
      : 0;

    const replyRate = emailsSent > 0
      ? parseFloat(((repliedLeads / emailsSent) * 100).toFixed(1))
      : 0;

    const bookingRate = repliedLeads > 0
      ? parseFloat(((bookedLeads / repliedLeads) * 100).toFixed(1))
      : 0;

    // ── 4. Top Performing Day ────────────────────────────────────────────
    const dayBreakdown = await db
      .select({
        day: sql<string>`TO_CHAR(${messages.createdAt}, 'Day')`,
        count: count(),
      })
      .from(messages)
      .where(
        and(
          eq(messages.userId, userId),
          eq(messages.direction, 'outbound'),
          eq(messages.isWarmup, false),
          gte(messages.createdAt, startDate),
          lte(messages.createdAt, endDate)
        )
      )
      .groupBy(sql`TO_CHAR(${messages.createdAt}, 'Day')`)
      .orderBy(desc(count()))
      .limit(1);

    const topPerformingDay = dayBreakdown[0]?.day?.trim() || 'N/A';

    // ── 5. Average Response Time (inbound follows outbound) ──────────────
    // We approximate: look at leads that have both directions in messages
    // and compute the average gap. This is simplified for efficiency.
    const avgResult = await db.execute(
      sql`
        SELECT AVG(EXTRACT(EPOCH FROM (inbound.created_at - outbound.created_at)) / 3600) AS avg_hours
        FROM messages AS inbound
        JOIN LATERAL (
          SELECT created_at FROM messages AS out
          WHERE out.lead_id = inbound.lead_id
            AND out.user_id = ${userId}
            AND out.direction = 'outbound'
            AND out.created_at < inbound.created_at
          ORDER BY out.created_at DESC LIMIT 1
        ) AS outbound ON true
        WHERE inbound.user_id = ${userId}
          AND inbound.direction = 'inbound'
          AND inbound.created_at >= ${startDate}
          AND inbound.created_at <= ${endDate}
      `
    );

    const avgResponseTimeHours = parseFloat(
      (avgResult.rows?.[0] as any)?.avg_hours || '0'
    );

    const stats: KPIStats = {
      totalLeads,
      activeLeads,
      bookedLeads,
      repliedLeads,
      noShowLeads,
      emailsSent,
      conversionRate,
      replyRate,
      bookingRate,
      sequenceROI: {
        sent: emailsSent,
        replied: repliedLeads,
        booked: bookedLeads,
      },
      topPerformingDay,
      avgResponseTimeHours: parseFloat(avgResponseTimeHours.toFixed(1)),
      period: { start: startDate, end: endDate },
    };

    return stats;
  }

  /**
   * Persist current KPI stats to the `insights` table for historical tracking.
   * Run this daily via a cron job or after campaign completion.
   */
  async persistInsights(userId: string): Promise<void> {
    if (!db) return;

    try {
      const stats = await this.getKPIStats(userId);

      await db.insert(insights).values({
        userId,
        period: { start: stats.period.start, end: stats.period.end },
        summary: `${stats.totalLeads} leads tracked. ${stats.bookedLeads} meetings booked (${stats.conversionRate}% conversion). Reply rate: ${stats.replyRate}%.`,
        metrics: {
          totalLeads: stats.totalLeads,
          conversions: stats.bookedLeads,
          conversionRate: stats.conversionRate,
          topChannel: 'email',
          topPerformingTime: stats.topPerformingDay,
          avgResponseTime: `${stats.avgResponseTimeHours}h`,
        },
        channelBreakdown: [
          {
            channel: 'email',
            count: stats.emailsSent,
            percentage: 100,
          },
        ],
      });

      console.log(`[StatsService] ✅ Insights persisted for user ${userId}`);
    } catch (err) {
      console.error('[StatsService] Failed to persist insights:', err);
    }
  }
}

export const statsService = new StatsService();



