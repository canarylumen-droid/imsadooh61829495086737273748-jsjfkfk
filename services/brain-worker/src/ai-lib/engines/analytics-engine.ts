import { storage } from '@shared/lib/storage/storage.js';
import { db } from '@shared/lib/db/db.js';
import { messages, leads } from '@audnix/shared';
import { sql, eq, and, inArray } from 'drizzle-orm';
import type { Lead } from '@audnix/shared';

export interface AnalyticsInsights {
  period: string;
  trends: {
    leadGrowth: number;
    conversionGrowth: number;
    engagementGrowth: number;
  };
  predictions: {
    expectedConversions: number;
    projectedRevenue: number;
    riskLeads: string[];
  };
  recommendations: string[];
  topPerformers: {
    channels: Array<{ channel: string; performance: number }>;
    times: Array<{ hour: number; conversions: number }>;
  };
}

export async function generateAnalyticsInsights(
  userId: string,
  period: string = '30d',
  integrationId?: string
): Promise<AnalyticsInsights> {
  const daysBack = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);

  const leadOptions: any = { userId, limit: 10000 };
  if (integrationId) leadOptions.integrationId = integrationId;
  const allLeads = await storage.getLeads(leadOptions);
  const leadsList = allLeads.filter(l => new Date(l.createdAt) >= startDate);

  if (leadsList.length === 0 && allLeads.length === 0) {
    return {
      period,
      trends: { leadGrowth: 0, conversionGrowth: 0, engagementGrowth: 0 },
      predictions: { expectedConversions: 0, projectedRevenue: 0, riskLeads: [] },
      recommendations: ['Connect your mailbox to see real-time lead sync and AI outreach in action.'],
      topPerformers: { channels: [], times: [] }
    };
  }

  const trends = await calculateTrends(userId, daysBack, integrationId);
  const predictions = await generatePredictions(leadsList);
  const recommendations = await generateRecommendations(leadsList, trends);
  const topPerformers = await findTopPerformers(leadsList);

  return { period, trends, predictions, recommendations, topPerformers };
}

async function calculateTrends(userId: string, daysBack: number, integrationId?: string) {
  const previousPeriodStart = new Date();
  previousPeriodStart.setDate(previousPeriodStart.getDate() - (daysBack * 2));
  const currentPeriodStart = new Date();
  currentPeriodStart.setDate(currentPeriodStart.getDate() - daysBack);

  const leadOptions: any = { userId, limit: 10000 };
  if (integrationId) leadOptions.integrationId = integrationId;
  const allLeads = await storage.getLeads(leadOptions);

  const previousLeads = allLeads.filter(l => {
    const date = new Date(l.createdAt);
    return date >= previousPeriodStart && date < currentPeriodStart;
  });

  const currentLeadsList = allLeads.filter(l => {
    const date = new Date(l.createdAt);
    return date >= currentPeriodStart;
  });

  const leadGrowth = calculateGrowth(previousLeads.length, currentLeadsList.length);
  const conversionGrowth = calculateGrowth(
    previousLeads.filter(l => l.status === 'converted').length,
    currentLeadsList.filter(l => l.status === 'converted').length
  );

  // Use batched SQL query instead of N+1 per-lead message fetches
  const previousEngagement = previousLeads.length > 0
    ? await getBatchedAverageMessageCount(previousLeads.map(l => l.id)) : 0;
  const currentEngagement = currentLeadsList.length > 0
    ? await getBatchedAverageMessageCount(currentLeadsList.map(l => l.id)) : 0;
  const engagementGrowth = calculateGrowth(previousEngagement, currentEngagement);

  return { leadGrowth, conversionGrowth, engagementGrowth };
}

async function getBatchedAverageMessageCount(leadIds: string[]): Promise<number> {
  if (leadIds.length === 0 || !db) return 0;
  try {
    const result = await db.execute(sql`
      SELECT lead_id, COUNT(*) as msg_count
      FROM messages
      WHERE lead_id = ANY(${leadIds}::uuid[])
      GROUP BY lead_id
    `);
    const rows = result.rows as Array<{ lead_id: string; msg_count: string }>;
    const totalMessages = rows.reduce((sum, row) => sum + Number(row.msg_count), 0);
    return totalMessages / leadIds.length;
  } catch {
    return 0;
  }
}

function calculateGrowth(previous: number, current: number): number {
  if (previous === 0 && current === 0) return 0;
  if (previous === 0) return 100;
  return Math.round(((current - previous) / previous) * 100);
}

async function generatePredictions(leadsList: Lead[]) {
  const hotLeads = leadsList.filter(l => l.metadata?.temperature === 'hot');
  const warmLeads = leadsList.filter(l => l.metadata?.temperature === 'warm');

  const expectedConversions = Math.round(
    (hotLeads.length * 0.6) + (warmLeads.length * 0.3)
  );

  const projectedRevenue = expectedConversions * 500;

  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);

  const riskLeads = [...hotLeads, ...warmLeads]
    .filter(l => {
      const lastMessage = l.lastMessageAt ? new Date(l.lastMessageAt) : new Date(l.createdAt);
      return lastMessage < oneDayAgo;
    })
    .map(l => l.id)
    .slice(0, 10);

  return { expectedConversions, projectedRevenue, riskLeads };
}

async function generateRecommendations(leadsList: Lead[], trends: any): Promise<string[]> {
  const recommendations: string[] = [];

  if (leadsList.length === 0) {
    recommendations.push('Connect your mailbox to see real-time lead sync and AI outreach in action.');
    return recommendations;
  }

  if (trends.leadGrowth < 0) {
    recommendations.push('Lead generation is declining. Consider increasing marketing efforts or checking integration connections.');
  } else if (trends.leadGrowth > 50) {
    recommendations.push('Lead growth is strong! Ensure you have enough follow-up capacity.');
  }

  if (trends.conversionGrowth < -10) {
    recommendations.push('Conversion rate dropping. Review AI responses and consider adjusting messaging.');
  }

  const byChannel = leadsList.reduce((acc: any, lead) => {
    acc[lead.channel] = acc[lead.channel] || { total: 0, converted: 0 };
    acc[lead.channel].total++;
    if (lead.status === 'converted') acc[lead.channel].converted++;
    return acc;
  }, {});

  const bestChannel = Object.entries(byChannel)
    .map(([channel, data]: [string, any]) => ({
      channel,
      rate: data.total > 0 ? (data.converted / data.total) * 100 : 0
    }))
    .sort((a, b) => b.rate - a.rate)[0];

  if (bestChannel && bestChannel.rate > 0) {
    recommendations.push(`${bestChannel.channel} has the highest conversion rate (${bestChannel.rate.toFixed(1)}%). Focus more efforts here.`);
  } else if (leadsList.length > 0) {
    recommendations.push('No conversions detected yet. Try A/B testing different messaging scripts.');
  }

  const coldLeads = leadsList.filter(l => l.status === 'cold').length;
  if (coldLeads > leadsList.length * 0.3) {
    recommendations.push(`${coldLeads} leads went cold. Consider re-engagement campaigns with fresh angles.`);
  }

  return recommendations;
}

async function findTopPerformers(leadsList: Lead[]) {
  const byChannel = leadsList.reduce((acc: any, lead) => {
    acc[lead.channel] = acc[lead.channel] || { total: 0, converted: 0 };
    acc[lead.channel].total++;
    if (lead.status === 'converted') acc[lead.channel].converted++;
    return acc;
  }, {});

  const channels = Object.entries(byChannel)
    .map(([channel, data]: [string, any]) => ({
      channel,
      performance: data.total > 0 ? Math.round((data.converted / data.total) * 100) : 0
    }))
    .sort((a, b) => b.performance - a.performance);

  const times: Array<{ hour: number; conversions: number }> = [];
  for (let hour = 0; hour < 24; hour++) {
    const conversions = leadsList.filter(l => {
      if (l.status !== 'converted' || !l.lastMessageAt) return false;
      return new Date(l.lastMessageAt).getHours() === hour;
    }).length;
    times.push({ hour, conversions });
  }
  times.sort((a, b) => b.conversions - a.conversions);

  return {
    channels: channels.slice(0, 5),
    times: times.slice(0, 5)
  };
}

export async function calculateAvgResponseTime(userId: string, integrationId?: string): Promise<string> {
  if (!db) return "No data";
  try {
    const conditions = [eq(messages.userId, userId)];
    if (integrationId) conditions.push(eq(messages.integrationId, integrationId));

    const rows = await db.select({
      leadId: messages.leadId,
      direction: messages.direction,
      createdAt: messages.createdAt,
    })
      .from(messages)
      .where(and(...conditions))
      .orderBy(messages.leadId, messages.createdAt)
      .limit(5000);

    if (rows.length === 0) return "No data";

    const byLead: Record<string, Array<{ direction: string; createdAt: Date }>> = {};
    for (const row of rows) {
      if (!row.leadId) continue;
      if (!byLead[row.leadId]) byLead[row.leadId] = [];
      byLead[row.leadId].push({ direction: row.direction, createdAt: row.createdAt as unknown as Date });
    }

    let totalDiff = 0;
    let count = 0;

    for (const msgs of Object.values(byLead)) {
      msgs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      for (let i = 0; i < msgs.length - 1; i++) {
        if (msgs[i].direction === 'inbound' && msgs[i + 1].direction === 'outbound') {
          totalDiff += msgs[i + 1].createdAt.getTime() - msgs[i].createdAt.getTime();
          count++;
        }
      }
    }

    if (count === 0) return "No data";
    return `${Math.round(totalDiff / count / 60000)} minutes`;
  } catch {
    return "No data";
  }
}
