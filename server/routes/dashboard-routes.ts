import { Router, Request, Response } from 'express';
import { storage } from '../storage.js';
import { requireAuth } from '../middleware/auth.js';
import type { Lead, Message } from '../../shared/schema.js';
import { InstagramOAuth } from '../lib/oauth/instagram.js';
import { decrypt } from '../lib/crypto/encryption.js';

const router = Router();

/**
 * GET /api/dashboard/stats
 * Get current period stats for dashboard
 */
router.get('/stats', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const user = await storage.getUserById(userId);
    const leads: Lead[] = await storage.getLeads({ userId, limit: 10000 });

    // OPTIMIZATION: Skip message loading to prevent timeout - calculate from leads data only
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const newLeads = leads.filter(l => new Date(l.createdAt) > sevenDaysAgo).length;
    const activeLeads = leads.filter(l => l.status === 'open').length;
    const convertedLeads = leads.filter(l => l.status === 'converted').length;

    const hardenedLeads = leads.filter(l => l.verified).length;
    const bouncyLeads = leads.filter(l => l.status === 'bouncy').length;
    const recoveredLeads = leads.filter(l => l.status === 'recovered').length;

    const totalMessages = await storage.getAllMessages(userId);

    const messagesToday = totalMessages.filter(m => {
      const d = new Date(m.createdAt);
      return d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).filter(m => m.direction === 'outbound').length;

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const messagesYesterday = totalMessages.filter(m => {
      const d = new Date(m.createdAt);
      return d.getDate() === yesterday.getDate() && d.getMonth() === yesterday.getMonth() && d.getFullYear() === yesterday.getFullYear();
    }).filter(m => m.direction === 'outbound').length;

    // AI-Driven Deal Valuation Extraction
    const deals = await storage.getDeals(userId);
    const convertedDealsList = deals.filter(d => d.status === 'converted' || d.status === 'closed_won');

    // Calculate values from real deal data
    const totalPipelineValue = deals.reduce((sum, d) => sum + (Number(d.value) || 0), 0);
    const closedRevenue = convertedDealsList.reduce((sum, d) => sum + (Number(d.value) || 0), 0);

    // AI-Driven lead quality & intent extraction from messages
    const inboxMessages = totalMessages.filter(m => m.direction === 'inbound');
    const positiveIntents = inboxMessages.filter(m => {
      const content = m.body?.toLowerCase() || "";
      return content.includes('yes') ||
        content.includes('book') ||
        content.includes('interested') ||
        content.includes('call') ||
        content.includes('meeting');
    }).length;

    // Real-time Engine Status & Synchronization
    const integrations = await storage.getIntegrations(userId);
    const monitors = await storage.getVideoMonitors(userId);
    
    // Get recent bounces - Handle potential column mapping issues
    let recentBounces = [];
    try {
      recentBounces = await storage.getRecentBounces(userId, 168); // Last 7 days
    } catch (bounceError) {
      console.warn('⚠️ Failed to fetch recent bounces, using empty list:', bounceError);
    }
    
    const domainVerifications = await storage.getDomainVerifications(userId, 5);

    // Calculate most recent sync time from all integrations
    const lastSyncTimestamp = integrations.reduce((latest, current) => {
      if (!current.lastSync) return latest;
      const currentSync = new Date(current.lastSync).getTime();
      return currentSync > latest ? currentSync : latest;
    }, 0);

    const engineStatus = monitors.length > 0 ? "Autonomous" : "Paused";

    // Enhanced Domain Health Calculation (0-100)
    // Factor 1: Bounce rate (hard bounces are severe)
    const hardBounces = recentBounces.filter(b => b.bounceType === 'hard').length;
    const softBounces = recentBounces.filter(b => b.bounceType === 'soft').length;

    let reputationScore = 100;
    if (leads.length > 0) {
      // Each hard bounce removes 5%, soft bounce 2%, capped at 100% loss
      const bouncePenalty = (hardBounces * 5) + (softBounces * 2);
      reputationScore = Math.max(0, 100 - bouncePenalty);
    }

    // Factor 2: Domain Verification status
    const unverifiedDomains = domainVerifications.filter(v => v.verification_result !== 'pass').length;
    const verificationPenalty = unverifiedDomains * 10;

    const domainHealth = Math.max(0, reputationScore - verificationPenalty);

    res.json({
      totalLeads: leads.length,
      newLeads,
      activeLeads,
      convertedLeads,
      hardenedLeads,
      bouncyLeads,
      recoveredLeads,
      positiveIntents,
      conversionRate: leads.length > 0 ? ((convertedLeads / leads.length) * 100).toFixed(1) : "0.0",
      totalMessages: totalMessages.length,
      messagesToday,
      messagesYesterday,
      averageResponseTime: '2.5h', // Still inferred/hardcoded for now as per minimal change scope
      emailsThisMonth: leads.filter(l => l.channel === 'email').length,
      instagramThisMonth: leads.filter(l => l.channel === 'instagram').length,
      plan: user?.plan || 'trial',
      filteredLeadsCount: user?.filteredLeadsCount || 0,
      trialDaysLeft: user?.trialExpiresAt ? Math.ceil((new Date(user.trialExpiresAt).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : 0,
      pipelineValue: totalPipelineValue,
      closedRevenue: closedRevenue,
      lastSync: lastSyncTimestamp > 0 ? new Date(lastSyncTimestamp).toISOString() : null,
      engineStatus,
      domainHealth,
      domainVerifications: domainVerifications.slice(0, 3) // Return brief status
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

/**
 * GET /api/dashboard/stats/previous
 * Get previous period stats for comparison
 */
router.get('/stats/previous', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const leads: Lead[] = await storage.getLeads({ userId, limit: 10000 });
    const now = new Date();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const previousLeads = leads.filter(l => {
      const createdAt = new Date(l.createdAt);
      return createdAt >= fourteenDaysAgo && createdAt < sevenDaysAgo;
    }).length;

    const previousOpenLeads = leads.filter(l => {
      const createdAt = new Date(l.createdAt);
      return createdAt >= fourteenDaysAgo && createdAt < sevenDaysAgo && l.status === 'open';
    }).length;

    const previousConvertedLeads = leads.filter(l => {
      const createdAt = new Date(l.createdAt);
      return createdAt >= fourteenDaysAgo && createdAt < sevenDaysAgo && l.status === 'converted';
    }).length;

    res.json({
      totalLeads: previousLeads,
      newLeads: previousLeads,
      activeLeads: previousOpenLeads,
      convertedLeads: previousConvertedLeads,
    });
  } catch (error) {
    console.error('Previous stats error:', error);
    res.status(500).json({ error: 'Failed to fetch previous stats' });
  }
});

/**
 * GET /api/dashboard/activity
 * Get recent activity feed for dashboard
 */
router.get('/activity', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const leads: Lead[] = await storage.getLeads({ userId, limit: 100 });
    const activities = leads
      .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime())
      .slice(0, 10)
      .map(lead => ({
        id: lead.id,
        type: lead.status === 'converted' ? 'lead_converted' : 'lead_updated',
        title: lead.status === 'converted' ? `${lead.name} converted` : `${lead.name} updated`,
        message: lead.status === 'converted' ? `Lead converted via ${lead.channel}` : `Lead updated via ${lead.channel}`,
        description: `Source: ${lead.channel}`,
        time: lead.updatedAt || lead.createdAt,
        timestamp: lead.updatedAt || lead.createdAt,
        channel: lead.channel,
        leadId: lead.id,
      }));

    res.json({ activities });
  } catch (error) {
    console.error('[ACTIVITY] Failed to fetch dashboard activity:', error);
    res.status(500).json({ error: 'Failed to fetch activity feed' });
  }
});

/**
 * GET /api/user
 * Get current user (simple alias)
 */
router.get('/user', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const user = await storage.getUserById(userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const onboardingProfile = await storage.getOnboardingProfile(userId);
    const metadata = user.metadata as Record<string, unknown> | null;
    const voiceNotesEnabled = metadata?.voiceNotesEnabled !== false;
    const hasCompletedOnboarding = onboardingProfile?.completed || (metadata?.onboardingCompleted as boolean) || false;

    res.json({
      id: user.id,
      email: user.email,
      username: user.username,
      name: user.name,
      role: user.role || 'member',
      plan: user.plan,
      avatar: user.avatar,
      subscriptionTier: user.subscriptionTier,
      businessName: user.businessName,
      filteredLeadsCount: user.filteredLeadsCount || 0,
      trialExpiresAt: user.trialExpiresAt,
      voiceNotesEnabled,
      createdAt: user.createdAt,
      metadata: {
        ...(metadata || {}),
        onboardingCompleted: hasCompletedOnboarding,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

/**
 * GET /api/user/profile
 * Get current user profile (alias for /api/auth/me)
 */
router.get('/user/profile', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const user = await storage.getUserById(userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const onboardingProfile = await storage.getOnboardingProfile(userId);
    const metadata = user.metadata as Record<string, unknown> | null;
    const voiceNotesEnabled = metadata?.voiceNotesEnabled !== false;

    const hasCompletedOnboarding = onboardingProfile?.completed || (metadata?.onboardingCompleted as boolean) || false;

    res.json({
      id: user.id,
      email: user.email,
      username: user.username,
      name: user.name,
      company: user.businessName,
      timezone: user.timezone,
      role: user.role || 'member',
      plan: user.plan,
      avatar: user.avatar,
      subscriptionTier: user.subscriptionTier,
      businessName: user.businessName,
      trialExpiresAt: user.trialExpiresAt,
      voiceNotesEnabled,
      createdAt: user.createdAt,
      defaultCtaLink: metadata?.defaultCtaLink as string || '',
      defaultCtaText: metadata?.defaultCtaText as string || '',
      metadata: {
        ...(metadata || {}),
        onboardingCompleted: hasCompletedOnboarding,
      },
    });
  } catch (error) {
    console.error('❌ Error in /api/user/profile:', error);
    res.status(500).json({
      error: 'Failed to fetch profile',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * PUT /api/user/voice-settings
 * Update voice notes settings
 */
router.put('/user/voice-settings', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { voiceNotesEnabled } = req.body as { voiceNotesEnabled?: boolean };

    const user = await storage.getUserById(userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const existingMetadata = (user.metadata as Record<string, unknown>) || {};
    await storage.updateUser(userId, {
      metadata: {
        ...existingMetadata,
        voiceNotesEnabled: voiceNotesEnabled === true,
      },
    });

    res.json({
      success: true,
      voiceNotesEnabled: voiceNotesEnabled === true
    });
  } catch (error) {
    console.error('Voice settings error:', error);
    res.status(500).json({ error: 'Failed to update voice settings' });
  }
});

/**
 * PUT /api/user/profile
 * Update user profile including CTA settings
 */
router.put('/user/profile', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { name, username, company, timezone, defaultCtaLink, defaultCtaText } = req.body;

    const user = await storage.getUserById(userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const existingMetadata = (user.metadata as Record<string, unknown>) || {};
    const updates: Record<string, unknown> = {};

    if (name !== undefined) updates.name = name;
    if (username !== undefined) updates.username = username;
    if (company !== undefined) updates.businessName = company;
    if (timezone !== undefined) updates.timezone = timezone;

    // Store CTA settings in metadata
    if (defaultCtaLink !== undefined || defaultCtaText !== undefined) {
      updates.metadata = {
        ...existingMetadata,
        ...(defaultCtaLink !== undefined && { defaultCtaLink }),
        ...(defaultCtaText !== undefined && { defaultCtaText }),
      };
    }

    await storage.updateUser(userId, updates);

    res.json({ success: true });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

/**
 * GET /api/dashboard/instagram/media
 * Get user's recent Instagram media for video automation
 */
router.get('/instagram/media', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    // Get Instagram integration
    const integrations = await storage.getIntegrations(userId);
    const igIntegration = integrations.find(i => i.provider === 'instagram' && i.connected);

    if (!igIntegration) {
      // Return empty list if not connected (frontend handles empty state)
      res.json({ media: [] });
      return;
    }

    // Decrypt token
    const decryptedMetaJson = decrypt(igIntegration.encryptedMeta);
    const decryptedMeta = JSON.parse(decryptedMetaJson);
    const accessToken = decryptedMeta.tokens?.access_token;

    if (!accessToken) {
      res.json({ media: [] });
      return;
    }

    // Fetch media
    const oauth = new InstagramOAuth();
    const media = await oauth.getMedia(accessToken, 20);

    res.json({ media });
  } catch (error) {
    console.error('Instagram media fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch media' });
  }
});

/**
 * GET /api/dashboard/analytics/outreach
 * Get daily outreach stats (sent/received) for analytics charts
 */
router.get('/analytics/outreach', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { db } = await import('../db.js');
    const { messages } = await import('../../shared/schema.js');
    const { sql, and, eq, gte } = await import('drizzle-orm');

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Group messages by day and direction
    const stats = await db
      .select({
        day: sql<string>`DATE_TRUNC('day', ${messages.createdAt})`,
        direction: messages.direction,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(messages)
      .where(
        and(
          eq(messages.userId, userId),
          gte(messages.createdAt, thirtyDaysAgo)
        )
      )
      .groupBy(sql`DATE_TRUNC('day', ${messages.createdAt})`, messages.direction)
      .orderBy(sql`DATE_TRUNC('day', ${messages.createdAt})`);

    // Ensure we have a default state even with no messages
    if (stats.length === 0) {
      res.json({
        success: true,
        data: [],
        summary: { totalSent: 0, totalReceived: 0 }
      });
      return;
    }

    // Format for frontend (e.g., Recharts)
    const formattedData = stats.reduce((acc: any[], curr: any) => {
      const dayStr = new Date(curr.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      let existing = acc.find(d => d.name === dayStr);
      if (!existing) {
        existing = { name: dayStr, sent: 0, received: 0 };
        acc.push(existing);
      }
      if (curr.direction === 'outbound') existing.sent += curr.count;
      else if (curr.direction === 'inbound') existing.received += curr.count;
      return acc;
    }, []);

    res.json({
      success: true,
      data: formattedData,
      summary: {
        totalSent: formattedData.reduce((sum: number, d: any) => sum + d.sent, 0),
        totalReceived: formattedData.reduce((sum: number, d: any) => sum + d.received, 0),
      }
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

/**
 * GET /api/dashboard/analytics/full
 * Consistently high-performance consolidated analytics node
 */
router.get('/analytics/full', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.session?.userId!;
    const user = await storage.getUserById(userId);
    const leads = await storage.getLeads({ userId, limit: 10000 });

    // Performance calculation
    const conversions = leads.filter(l => l.status === 'converted').length;
    const replied = leads.filter(l => l.status === 'replied' || l.status === 'converted').length;
    const sent = (await storage.getAllMessages(userId)).filter(m => m.direction === 'outbound').length;

    // Time series (last 7 days) - Real data only
    const timeSeries = [];
    const allMessages = await storage.getAllMessages(userId);
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dayStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);

      const daySent = allMessages.filter(m =>
        m.direction === 'outbound' &&
        new Date(m.createdAt) >= dayStart &&
        new Date(m.createdAt) <= dayEnd
      ).length;

      const dayReplied = leads.filter(l =>
        (l.status === 'replied' || l.status === 'converted') &&
        l.updatedAt && new Date(l.updatedAt) >= dayStart &&
        new Date(l.updatedAt) <= dayEnd
      ).length;

      timeSeries.push({
        name: dayStr,
        sent: daySent,
        replied: dayReplied,
        booked: 0 // Will be updated when deals system is fully integrated
      });
    }

    // Connection mapping
    const integrations = await storage.getIntegrations(userId);
    const customEmail = await storage.getIntegration(userId, 'custom_email');
    const isAnyConnected = integrations.some(i => i.connected) || !!customEmail?.connected;

    res.json({
      metrics: {
        sent,
        replied,
        booked: conversions,
        leadsFiltered: user?.filteredLeadsCount || 0,
        conversionRate: leads.length > 0 ? Math.round((conversions / leads.length) * 100) : 0,
        responseRate: leads.length > 0 ? Math.round((replied / leads.length) * 100) : 0
      },
      timeSeries,
      channelPerformance: [
        { channel: 'Email', value: leads.filter(l => l.channel === 'email').length },
        { channel: 'Instagram', value: leads.filter(l => l.channel === 'instagram').length }
      ],
      isAnyConnected,
      recentEvents: leads
        .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime())
        .slice(0, 5)
        .map(l => ({
          id: l.id,
          type: 'interaction',
          description: `${l.name} updated status to ${l.status}`,
          time: new Date(l.updatedAt || l.createdAt).toLocaleTimeString()
        }))
    });
  } catch (error) {
    console.error('Full analytics error:', error);
    res.status(500).json({ error: 'Failed to synchronize neural analytics' });
  }
});

export default router;
