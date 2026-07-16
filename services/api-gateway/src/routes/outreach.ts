/**
 * Outreach API Routes - Trigger & manage humanized lead outreach campaigns
 */

import { Router } from 'express';
import { createOutreachCampaign, validateCampaignSafety, formatCampaignMetrics } from '@services/outreach-worker/src/sales-engine/outreach-engine.js';
import { requireAuthOrApiKey } from '../middleware/auth.js';
import { isValidUUID } from '@shared/lib/utils/validation.js';
import { verifyDomainDns } from '@services/email-service/src/email/dns-verification.js';
import { generateExpertOutreach, generateCampaignTemplateSequence } from '@services/brain-worker/src/ai-lib/core/conversation-ai.js';
import { outreachCampaigns, campaignLeads, messages, campaignEmails, leads as leadsTable, users } from '@audnix/shared';
import { storage } from '@shared/lib/storage/storage.js';
import { db } from '@shared/lib/db/db.js';
import { eq, and, desc, sql, ne, inArray, or } from 'drizzle-orm';
import { getActivePlanId, getCampaignLimits } from '@shared/plan-utils.js';
import { AuditTrailService } from '@shared/lib/monitoring/audit-trail-service.js';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';
import { isNull } from 'drizzle-orm';
import validator from 'validator';
import { exclusionEngine } from '@shared/lib/exclusion/exclusion-engine.js';

// Rate limiter: max 10 campaign creations per user per minute
import { rateLimit } from 'express-rate-limit';
const campaignCreateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.session?.userId || req.ip || 'unknown',
  message: { error: 'Too many campaigns created. Please wait before creating another.' },
  validate: false,
});

const router = Router();

/**
 * POST /api/outreach/preview
 * Generate a high-fidelity outreach preview for a lead
 */
router.post('/preview', requireAuthOrApiKey, async (req, res) => {
  try {
    const userId = req.session?.userId!;
    const { lead } = req.body;

    if (!lead) {
      return res.status(400).json({ error: 'Lead data required for preview' });
    }

    const preview = await generateExpertOutreach(lead, userId);

    return res.json({
      success: true,
      preview
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate AI preview' });
  }
});

/**
 * POST /api/outreach/generate-template
 * Generate a complete AI-driven sequence using Brand PDF context
 */
router.post('/generate-template', requireAuthOrApiKey, async (req, res) => {
  let timeoutId: NodeJS.Timeout;
  try {
    const userId = req.session?.userId!;
    const { focus, count, delayDays } = req.body;

    // Wrap with 14s timeout to beat Railway's 15s gateway cutoff.
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('[TIMEOUT] POST /generate-template timed out after 14s')), 14000);
    });

    const sequence = await Promise.race([
      generateCampaignTemplateSequence(userId, count || 3, focus, delayDays),
      timeoutPromise
    ]);

    clearTimeout(timeoutId!);
    if (res.headersSent || res.writableEnded) return;
    return res.json({ success: true, sequence });
  } catch (error: any) {
    clearTimeout(timeoutId!);
    if (res.headersSent || res.writableEnded) return; // Railway already closed socket — do not double-respond
    res.status(500).json({ error: 'Failed to generate campaign sequence', details: error.message });
  }
});

// Merged with /api/outreach/campaigns

/**
 * GET /api/outreach/campaigns
 * List all campaigns for the user
 */
router.get('/campaigns', requireAuthOrApiKey, async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const campaigns = await db.select()
      .from(outreachCampaigns)
      .where(eq(outreachCampaigns.userId, userId));

    res.json(campaigns);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/campaigns', requireAuthOrApiKey, campaignCreateLimiter, async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { name, config, template, leads, excludeWeekends, aiAutonomousMode } = req.body;

    if (!name || !leads) {
      return res.status(400).json({ error: 'Missing required campaign data' });
    }

    // Validate that the user has provided their own template before saving
    // We do NOT provide a fallback template — users must write their own copy
    const campaignConfig = config || { dailyLimit: 50 };
    const campaignTemplate: any = template || {};

    // Normalise nested initial/body structure
    if (campaignTemplate.initial) {
      campaignTemplate.subject ||= campaignTemplate.initial.subject;
      campaignTemplate.body ||= campaignTemplate.initial.body;
    }
    if (campaignTemplate.autoReply?.body && !campaignTemplate.autoReplyBody) {
      campaignTemplate.autoReplyBody = campaignTemplate.autoReply.body;
    }
    if (Array.isArray(campaignTemplate.followups)) {
      campaignTemplate.followups = campaignTemplate.followups.filter((followup: any) =>
        typeof followup?.body === 'string' && followup.body.trim().length > 0
      );
    }

    // HARD GUARD: Reject campaign creation if the user hasn't written email copy
    // This prevents "phantom" campaigns being saved with no real content
    const hasBody = campaignTemplate?.initial?.body?.trim() || campaignTemplate?.body?.trim();
    if (!hasBody) {
      return res.status(400).json({
        error: 'Campaign has no email body. Please write your initial email copy before saving.'
      });
    }

    if (campaignConfig.dailyLimit) {
      campaignConfig.dailyLimit = Math.min(parseInt(campaignConfig.dailyLimit) || 50, 2500);
    }
    if (campaignConfig.durationDays) {
      campaignConfig.durationDays = Math.max(1, Math.min(parseInt(campaignConfig.durationDays) || 30, 365));
    }

    // ── PLAN-BASED CAMPAIGN LIMITS ──────────────────────────────────────
    const [userRow] = await db.select({
      plan: users.plan,
      subscriptionTier: users.subscriptionTier
    }).from(users).where(eq(users.id, userId)).limit(1);

    const planId = getActivePlanId(userRow);
    const campaignLimits = getCampaignLimits(planId);
    const selectedMailboxIds = (campaignConfig.mailboxIds || []) as string[];

    if (isFinite(campaignLimits.maxMailboxesPerCampaign) && selectedMailboxIds.length > campaignLimits.maxMailboxesPerCampaign) {
      return res.status(403).json({
        error: `Your ${planId} plan allows up to ${campaignLimits.maxMailboxesPerCampaign} mailboxes per campaign. You selected ${selectedMailboxIds.length}.`,
        limit: campaignLimits.maxMailboxesPerCampaign,
        current: selectedMailboxIds.length
      });
    }

    const leadCount = Array.isArray(leads) ? leads.length : 0;
    if (isFinite(campaignLimits.maxLeadsPerCampaign) && leadCount > campaignLimits.maxLeadsPerCampaign) {
      return res.status(403).json({
        error: `Your ${planId} plan allows up to ${campaignLimits.maxLeadsPerCampaign} leads per campaign. You added ${leadCount}.`,
        limit: campaignLimits.maxLeadsPerCampaign,
        current: leadCount
      });
    }

    const [campaign] = await db.insert(outreachCampaigns).values({
      userId,
      name,
      config: campaignConfig,
      template: campaignTemplate,
      excludeWeekends: !!excludeWeekends,
      aiAutonomousMode: !!aiAutonomousMode,
      status: 'draft',
      stats: { total: 0, sent: 0, replied: 0, bounced: 0 } // Initialize total as 0, will update after processing
    }).returning();

    // Log campaign creation
    await AuditTrailService.logCampaignAction(userId, campaign.id, 'campaign_created', {
      name,
      configuredLeads: leads?.length || 0
    });

    // Link leads to campaign (with auto-upsert for non-UUIDs)
    let addedCount = 0;
    if (leads && Array.isArray(leads)) {
      let finalLeadIds: string[] = [];
      const batchSize = 500;

      const thirtyDaysAgoAnalytics = new Date();
      thirtyDaysAgoAnalytics.setDate(thirtyDaysAgoAnalytics.getDate() - 30);
      const analytics = await storage.getAnalyticsSummary(userId, thirtyDaysAgoAnalytics);
      const bestHour = analytics.summary.bestReplyHour;

      // ── BULK LEAD RESOLUTION (replaces N+1 per-lead queries) ─────────────────
      // Pass 1: partition into UUID IDs vs email strings/objects
      const emailItems: Array<{ email: string; name: string }> = [];
      for (const leadItem of leads) {
        if (typeof leadItem === 'string' && isValidUUID(leadItem)) {
          finalLeadIds.push(leadItem);
        } else if (typeof leadItem === 'object' && leadItem !== null && leadItem.id && isValidUUID(leadItem.id)) {
          finalLeadIds.push(leadItem.id);
        } else {
          const email = (typeof leadItem === 'string' ? leadItem : leadItem?.email)?.toLowerCase()?.trim();
          if (email && email.includes('@')) {
            emailItems.push({
              email,
              name: (typeof leadItem === 'object' ? leadItem?.name : undefined) || email.split('@')[0] || 'Unknown'
            });
          }
        }
      }

      // Pass 2: bulk-resolve email items with a single SELECT
      if (emailItems.length > 0) {
        const uniqueEmails = [...new Set(emailItems.map(e => e.email))];
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const existingLeads = await db.select({
          id: leadsTable.id,
          email: leadsTable.email,
          status: leadsTable.status,
          lastMessageAt: leadsTable.lastMessageAt
        })
          .from(leadsTable)
          .where(and(eq(leadsTable.userId, userId), inArray(leadsTable.email, uniqueEmails)));

        const existingMap = new Map(existingLeads.map(l => [l.email!.toLowerCase(), l]));

        const toCreate: Array<{ email: string; name: string }> = [];
        for (const item of emailItems) {
          const ex = existingMap.get(item.email);
          if (ex) {
            const hasReplied = ex.status === 'replied' || ex.status === 'converted';
            if (hasReplied) continue;
            const lastContacted = ex.lastMessageAt ? new Date(ex.lastMessageAt) : null;
            if (lastContacted && lastContacted > thirtyDaysAgo) continue;
            finalLeadIds.push(ex.id);
          } else {
            toCreate.push(item);
          }
        }

        // Pass 3: bulk-insert missing leads in batches of 500
        if (toCreate.length > 0) {
          const importDate = new Date().toISOString();
          for (let i = 0; i < toCreate.length; i += batchSize) {
            const chunk = toCreate.slice(i, i + batchSize);
            const inserted = await db.insert(leadsTable).values(
              chunk.map(item => ({
                userId,
                name: item.name,
                email: item.email,
                channel: 'email' as const,
                status: 'new' as const,
                aiPaused: false,
                archived: false,
                metadata: { auto_created: true, campaign_id: campaign.id, import_date: importDate }
              }))
            ).onConflictDoNothing().returning({ id: leadsTable.id });
            finalLeadIds.push(...inserted.map(r => r.id));
          }
          console.log(`[Campaign] Bulk-created ${toCreate.length} new leads`);
        }
      }

      if (campaignConfig.includeInventoryLeads === true) {
        const inventoryLeads = await db.select({ id: leadsTable.id })
          .from(leadsTable)
          .where(and(
            eq(leadsTable.userId, userId),
            isNull(leadsTable.integrationId),
            eq(leadsTable.archived, false),
            eq(leadsTable.channel, 'email')
          ));

        const finalLeadIdsSet = new Set(finalLeadIds);
        for (const invMatch of inventoryLeads) {
          if (!finalLeadIdsSet.has(invMatch.id)) {
            finalLeadIds.push(invMatch.id);
            finalLeadIdsSet.add(invMatch.id);
          }
        }
      }

      // ── CROSS-CAMPAIGN DUPLICATE GUARD ────────────────────────────────
      // Prevent leads already in active or paused campaigns from being added again.
      if (finalLeadIds.length > 0) {
        const alreadyActive = await db.select({ leadId: campaignLeads.leadId })
          .from(campaignLeads)
          .innerJoin(outreachCampaigns, eq(campaignLeads.campaignId, outreachCampaigns.id))
          .where(and(
            eq(outreachCampaigns.userId, userId),
            inArray(campaignLeads.leadId, finalLeadIds),
            or(eq(outreachCampaigns.status, 'active'), eq(outreachCampaigns.status, 'paused'))
          ));
        if (alreadyActive.length > 0) {
          const blockedSet = new Set(alreadyActive.map(r => r.leadId));
          const before = finalLeadIds.length;
          finalLeadIds = finalLeadIds.filter(id => !blockedSet.has(id));
          console.log(`[Campaign] Cross-campaign guard blocked ${before - finalLeadIds.length} leads already in active/paused campaigns.`);
        }
      }

      // ── LEAD EXCLUSION GUARD ─────────────────────────────────────────
      // Prevent leads with active exclusions (converted, not_interested,
      // ghosted, unsubscribed, etc.) from being added to ANY new campaign.
      if (finalLeadIds.length > 0) {
        const before = finalLeadIds.length;
        finalLeadIds = await exclusionEngine.filterExcluded(finalLeadIds, userId);
        const blocked = before - finalLeadIds.length;
        if (blocked > 0) {
          console.log(`[Campaign] Exclusion guard blocked ${blocked} leads with active exclusions.`);
        }
      }

      // Fetch integrations once to calculate distribution
      const userIntegrations = await storage.getIntegrations(userId);
      const selectedMailboxIds = campaignConfig.mailboxIds || [];
      const activeMailboxes = userIntegrations.filter(i =>
        selectedMailboxIds.includes(i.id) &&
        i.connected &&
        ['custom_email', 'gmail', 'outlook'].includes(i.provider)
      );

      if (activeMailboxes.length === 0 && finalLeadIds.length > 0) {
        throw new Error("No connected mailboxes selected. Please connect an inbox to start the campaign.");
      }

      const leadLinks = finalLeadIds.map((leadId, index) => {
        let nextActionAt: Date | null = new Date(); // Start immediately by default
        if (bestHour !== null) {
          const now = new Date();
          const candidate = new Date();
          candidate.setHours(bestHour, Math.floor(Math.random() * 60), 0, 0);
          if (candidate < now) candidate.setDate(candidate.getDate() + 1);
          nextActionAt = candidate;
        }

        return {
          campaignId: campaign.id,
          leadId,
          status: 'queued' as const,
          integrationId: null,
          nextActionAt,
          metadata: {
            routingPending: true,
            routingQueuedAt: new Date().toISOString()
          }
        };
      });
      addedCount = leadLinks.length;

      for (let i = 0; i < leadLinks.length; i += batchSize) {
        await db.insert(campaignLeads).values(leadLinks.slice(i, i + batchSize)).onConflictDoNothing();
      }

      // --- Smart Peer Mapping (MX/SPF provider family + capacity balancing) ---
      // Campaign workers intentionally ignore these rows until routing assigns a mailbox.
      const routableRows = await db.select({
        campaignLeadId: campaignLeads.id,
        email: leadsTable.email
      })
        .from(campaignLeads)
        .innerJoin(leadsTable, eq(campaignLeads.leadId, leadsTable.id))
        .where(and(
          eq(campaignLeads.campaignId, campaign.id),
          inArray(campaignLeads.leadId, finalLeadIds),
          eq(leadsTable.channel, 'email')
        ));

      if (routableRows.length > 0) {
        const { verificationRoutingManager } = await import('@shared/lib/queues/verification-routing-queue.js');
        await verificationRoutingManager.enqueueLeads(userId, campaign.id, routableRows.map(row => ({
          campaignLeadId: row.campaignLeadId,
          email: row.email || ''
        })).filter(row => row.email.includes('@')));
      }

      // Trigger UI refresh for leads redistribution
      if (finalLeadIds.length > 0) {
        wsSync.notifyLeadsUpdated(userId, { event: 'BULK_UPDATE', leadIds: finalLeadIds });
      }

      // Update total leads count in campaign stats
      await db.update(outreachCampaigns)
        .set({
          stats: sql`jsonb_set(stats, '{total}', ${addedCount}::text::jsonb)`
        })
        .where(eq(outreachCampaigns.id, campaign.id));
    }

    // Calculate metrics/safety for response — skip for large campaigns to avoid OOM
    let safety: any = { safe: true, warnings: [] };
    let campaignMetrics: any = { segments: {}, total: addedCount };
    if (addedCount <= 5000) {
      const metricsResult = await createOutreachCampaign(Array.from({ length: addedCount }, () => ({ id: '', email: '', name: '', company: '', data: {} })), name);
      safety = validateCampaignSafety(metricsResult);
      campaignMetrics = formatCampaignMetrics(metricsResult);
    }

    // Calculate average per day based on daily limit and duration
    const dailyLimit = campaignConfig.dailyLimit || 50;
    const durationDays = campaignConfig.durationDays || 30;
    const totalLeadsForCalc = addedCount || 0;
    const averagePerDay = totalLeadsForCalc > 0 && durationDays > 0
      ? Math.ceil(totalLeadsForCalc / Math.max(1, durationDays))
      : 0;

    // Notify UI of new campaign
    wsSync.notifyCampaignsUpdated(userId);

    res.json({
      ...campaign,
      addedLeads: addedCount,
      safety,
      metrics: campaignMetrics,
      schedule: {
        dailyLimit,
        durationDays,
        totalLeads: totalLeadsForCalc,
        averagePerDay,
        estimatedDaysToComplete: dailyLimit > 0 ? Math.ceil(totalLeadsForCalc / dailyLimit) : 0,
      }
    });
  } catch (error: any) {
    console.error('Campaign creation error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/outreach/campaigns/:id/start
 * Start a draft campaign
 */
router.post('/campaigns/:id/start', requireAuthOrApiKey, async (req, res) => {
  try {
    const userId = req.session?.userId;
    const { id } = req.params;

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const [campaign] = await db.select().from(outreachCampaigns)
      .where(and(eq(outreachCampaigns.id, id), eq(outreachCampaigns.userId, userId)));

    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    if (campaign.status === 'completed' || campaign.status === 'aborted') {
      return res.status(400).json({ error: `Cannot start a ${campaign.status} campaign` });
    }

    // Pre-flight validation
    const leadCount = await db.select({ count: sql<number>`count(*)` })
      .from(campaignLeads)
      .where(eq(campaignLeads.campaignId, id));
    if (!leadCount[0]?.count || leadCount[0].count === 0) {
      return res.status(400).json({ error: 'Campaign has no leads. Add leads before starting.' });
    }

    const mailboxIds = (campaign.config as any)?.mailboxIds;
    if (!mailboxIds || !Array.isArray(mailboxIds) || mailboxIds.length === 0) {
      return res.status(400).json({ error: 'No mailboxes selected. Select at least one mailbox before starting.' });
    }

    // Verify mailboxes are connected
    const integrations = await storage.getIntegrations(userId);
    const connectedMailboxIds = mailboxIds.filter((mbId: string) =>
      integrations.some(i => i.id === mbId && i.connected)
    );
    if (connectedMailboxIds.length === 0) {
      return res.status(400).json({ error: 'Selected mailboxes are not connected. Please reconnect them in Settings.' });
    }

    // ── TEMPLATE VALIDATION ─────────────────────────────────────────────────
    // Prevent campaigns from firing without a configured email body.
    // Without this guard, the engine falls into AI-generated mode silently.
    const tmpl = (campaign.template as any);
    const hasTemplateBody = tmpl?.initial?.body || tmpl?.body;
    if (!hasTemplateBody) {
      return res.status(400).json({
        error: 'Campaign has no email template. Please complete the campaign wizard (set subject + body) before starting.'
      });
    }

    const [updated] = await db.update(outreachCampaigns)
      .set({ status: 'active', updatedAt: new Date() })
      .where(and(eq(outreachCampaigns.id, id), eq(outreachCampaigns.userId, userId)))
      .returning();

    // Register BullMQ per-mailbox repeatable jobs for autonomous processing
    try {
      const { campaignQueueManager } = await import('@shared/lib/queues/campaign-queue.js');
      await campaignQueueManager.startCampaign(updated);
    } catch (queueErr) {
      console.warn('[Outreach] BullMQ campaign start failed (will use setInterval fallback):', queueErr);
    }

    wsSync.notifyCampaignsUpdated(userId);
    res.json({ success: true, campaign: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/outreach/campaigns/:id/pause
 * Pause an active campaign
 */
router.post('/campaigns/:id/pause', requireAuthOrApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const [campaign] = await db.update(outreachCampaigns)
      .set({ status: 'paused', updatedAt: new Date() })
      .where(and(eq(outreachCampaigns.id, id), eq(outreachCampaigns.userId, userId)))
      .returning();

    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    // Remove BullMQ repeatable jobs (keeps delayed follow-ups intact)
    try {
      const { campaignQueueManager } = await import('@shared/lib/queues/campaign-queue.js');
      await campaignQueueManager.pauseCampaign(id);
    } catch (queueErr) {
      console.warn('[Outreach] BullMQ campaign pause failed:', queueErr);
    }

    wsSync.notifyCampaignsUpdated(userId);
    res.json({ success: true, campaign });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/outreach/campaigns/:id/resume
 * Resume a paused campaign
 */
router.post('/campaigns/:id/resume', requireAuthOrApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const [campaign] = await db.update(outreachCampaigns)
      .set({ status: 'active', updatedAt: new Date() })
      .where(and(eq(outreachCampaigns.id, id), eq(outreachCampaigns.userId, userId)))
      .returning();

    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    // Re-register BullMQ per-mailbox repeatable jobs
    try {
      const { campaignQueueManager } = await import('@shared/lib/queues/campaign-queue.js');
      await campaignQueueManager.startCampaign(campaign);
    } catch (queueErr) {
      console.warn('[Outreach] BullMQ campaign resume failed:', queueErr);
    }

    wsSync.notifyCampaignsUpdated(userId);
    res.json({ success: true, campaign });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/outreach/campaigns/:id/abort
 * Abort a campaign
 */
router.post('/campaigns/:id/abort', requireAuthOrApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const [campaign] = await db.update(outreachCampaigns)
      .set({ status: 'aborted', updatedAt: new Date() })
      .where(and(eq(outreachCampaigns.id, id), eq(outreachCampaigns.userId, userId)))
      .returning();

    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    // Stop all active leads instantly and clear their integration assignments
    // Include pending, processing, queued — NOT already sent/completed/aborted
    const activeStatuses = ['pending', 'processing', 'queued'];
    const pendingLeads = await db.select({ leadId: campaignLeads.leadId })
      .from(campaignLeads)
      .where(and(
        eq(campaignLeads.campaignId, id),
        inArray(campaignLeads.status, activeStatuses as any)
      ));

    if (pendingLeads.length > 0) {
      const leadIds = pendingLeads.map((l: { leadId: string | null }) => l.leadId).filter(Boolean) as string[];
      // Only clear integrationId for leads assigned to THIS campaign's mailboxes
      const campaignMailboxIds = ((campaign.config as any)?.mailboxIds || []) as string[];
      await db.update(leadsTable)
        .set({ integrationId: null })
        .where(and(
          inArray(leadsTable.id, leadIds),
          inArray(leadsTable.integrationId, campaignMailboxIds.length > 0 ? campaignMailboxIds : [''])
        ));

      // Mark as aborted in campaign_leads — scoped to this campaign
      await db.update(campaignLeads)
        .set({ status: 'aborted', updatedAt: new Date() })
        .where(and(
          eq(campaignLeads.campaignId, id),
          inArray(campaignLeads.status, activeStatuses as any)
        ));
    }

    // Remove ALL BullMQ jobs (repeatable + delayed follow-ups)
    try {
      const { campaignQueueManager } = await import('@shared/lib/queues/campaign-queue.js');
      await campaignQueueManager.abortCampaign(id);
    } catch (queueErr) {
      console.warn('[Outreach] BullMQ campaign abort failed:', queueErr);
    }

    // Log the audit action
    await AuditTrailService.logCampaignAction(userId, id, 'campaign_aborted', {
      name: campaign.name
    });

    wsSync.notifyCampaignsUpdated(userId);
    res.json({ success: true, campaign });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/outreach/campaigns/:id/force-requeue
 * Manually release stuck 'processing' leads back to 'pending' for immediate re-assignment.
 */
router.post('/campaigns/:id/force-requeue', requireAuthOrApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    if (!db) return res.status(503).json({ error: 'Database unavailable' });

    const result = await db.execute(sql`
      UPDATE campaign_leads
      SET status = 'pending', integration_id = NULL, updated_at = NOW()
      WHERE campaign_id = ${id}
        AND status = 'processing'
      RETURNING id;
    `);

    const releasedCount = result.rows.length;

    // Notify user in real-time
    wsSync.broadcastToUser(userId, { type: 'watchdog_alert', payload: {
      type: 'manual_force_requeue',
      campaignId: id,
      count: releasedCount,
      message: `Force Re-Queue completed. ${releasedCount} leads released.`
    }});

    return res.json({ success: true, released: releasedCount });
  } catch (err: any) {
    console.error('[Outreach] Force Re-Queue failed:', err);
    return res.status(500).json({ error: 'Failed to force re-queue leads' });
  }
});

/**
 * DELETE /api/outreach/campaigns/:id
 * Delete a campaign and all its data
 */
router.delete('/campaigns/:id', requireAuthOrApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Verify ownership and existence
    const [campaign] = await db.select().from(outreachCampaigns)
      .where(and(eq(outreachCampaigns.id, id), eq(outreachCampaigns.userId, userId)));

    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    // Stop and clear queues if running
    try {
      const { campaignQueueManager } = await import('@shared/lib/queues/campaign-queue.js');
      await campaignQueueManager.abortCampaign(id);
    } catch (queueErr) {
      console.warn('[Outreach] BullMQ campaign cleanup during delete failed:', queueErr);
    }

    // Release leads before deleting the campaign
    const camLeads = await db.select({ leadId: campaignLeads.leadId })
      .from(campaignLeads)
      .where(eq(campaignLeads.campaignId, id));
    
    if (camLeads.length > 0) {
      const leadIds = camLeads.map((l: { leadId: string | null }) => l.leadId).filter(Boolean) as string[];
      const campaignMailboxIds = ((campaign.config as any)?.mailboxIds || []) as string[];
      await db.update(leadsTable)
        .set({ integrationId: null })
        .where(and(
          inArray(leadsTable.id, leadIds),
          inArray(leadsTable.integrationId, campaignMailboxIds.length > 0 ? campaignMailboxIds : [''])
        ));
    }

    // Delete the campaign - Cascade will take care of campaignLeads and campaignEmails
    await db.delete(outreachCampaigns)
      .where(and(eq(outreachCampaigns.id, id), eq(outreachCampaigns.userId, userId)));

    // Log the audit action (using AuditTrailService)
    await AuditTrailService.logCampaignAction(userId, id, 'campaign_deleted', {
      name: campaign.name
    });

    wsSync.notifyCampaignsUpdated(userId);
    res.json({ success: true, message: 'Campaign deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/outreach/campaigns/:id
 * Get campaign details with live stats
 */
router.get('/campaigns/:id', requireAuthOrApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session?.userId;

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const [campaign] = await db.select().from(outreachCampaigns)
      .where(and(eq(outreachCampaigns.id, id), eq(outreachCampaigns.userId, userId)));

    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    // Get live stats
    const leadStats = await db.select({
      status: campaignLeads.status,
      count: sql<number>`count(*)`
    })
      .from(campaignLeads)
      .where(eq(campaignLeads.campaignId, id))
      .groupBy(campaignLeads.status);

    const stats = {
      total: 0,
      sent: 0,
      failed: 0,
      pending: 0,
      replied: 0
    };

    leadStats.forEach((s: any) => {
      stats.total += Number(s.count);
      // @ts-ignore
      if (stats[s.status] !== undefined) stats[s.status] += Number(s.count);
    });

    res.json({ ...campaign, liveStats: stats });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/outreach/campaigns/:id/progress
 * Get real-time campaign progress with daily stats and ETA
 */
router.get('/campaigns/:id/progress', requireAuthOrApiKey, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const [campaign] = await db.select().from(outreachCampaigns)
      .where(and(eq(outreachCampaigns.id, id), eq(outreachCampaigns.userId, userId)));
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const leadStats = await db.select({
      status: campaignLeads.status,
      count: sql<number>`count(*)`
    })
      .from(campaignLeads)
      .where(eq(campaignLeads.campaignId, id))
      .groupBy(campaignLeads.status);

    const config = (campaign.config || {}) as any;
    const mailboxLimits: Record<string, number> = config.mailboxLimits || {};
    const baseLimit = config.totalDailyLimit || config.dailyLimit || 50;
    const mailboxCount = Object.keys(mailboxLimits).length || 1;
    const totalDailyLimit = baseLimit * mailboxCount;

    // Count today's total sends for this campaign
    const todayResult = await db.execute(sql`
      SELECT COUNT(*) as count FROM campaign_emails
      WHERE campaign_id = ${id}::uuid
      AND sent_at >= (NOW() AT TIME ZONE 'UTC')::date::timestamptz
      AND status IN ('sent', 'delivered', 'opened', 'clicked', 'replied')
    `);
    const todaySent = Number(todayResult.rows[0].count);

    // Count initial vs follow-up sends today
    const initialTodayResult = await db.execute(sql`
      SELECT COUNT(*) as count FROM campaign_emails
      WHERE campaign_id = ${id}::uuid
      AND sent_at >= (NOW() AT TIME ZONE 'UTC')::date::timestamptz
      AND step_index = 0
      AND status IN ('sent', 'delivered', 'opened', 'clicked', 'replied')
    `);
    const initialToday = Number(initialTodayResult.rows[0].count);
    const followUpToday = todaySent - initialToday;

    const stats: Record<string, number> = { total: 0, sent: 0, failed: 0, pending: 0, replied: 0, queued: 0, bounced: 0 };
    leadStats.forEach((s: any) => {
      stats.total += Number(s.count);
      if (stats[s.status] !== undefined) stats[s.status] += Number(s.count);
    });

    // ETA calculation
    const remaining = Math.max(0, stats.total - stats.sent);
    const daysRunning = campaign.createdAt ? Math.max(0.5, (Date.now() - new Date(campaign.createdAt).getTime()) / 86400000) : 1;
    const avgDailyRate = daysRunning > 0 ? Math.ceil(stats.sent / daysRunning) : 0;
    const etaDays = avgDailyRate > 0 && remaining > 0
      ? Math.ceil(remaining / totalDailyLimit)
      : (remaining > 0 ? Math.ceil(remaining / Math.max(1, totalDailyLimit)) : 0);

    res.json({
      campaignId: id,
      total: stats.total,
      sent: stats.sent,
      replied: stats.replied,
      pending: stats.pending,
      queued: stats.queued,
      failed: stats.failed,
      bounced: stats.bounced,
      todaySent,
      initialToday,
      followUpToday,
      dailyLimit: totalDailyLimit,
      remaining,
      etaDays,
      etaLabel: etaDays > 0 ? `~${etaDays} ${etaDays === 1 ? 'day' : 'days'}` : (remaining === 0 ? 'Done' : 'Unknown'),
      status: campaign.status,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/outreach/strategy
 * Get current outreach strategy info
 */
router.get('/strategy', requireAuthOrApiKey, async (req, res) => {
  try {
    const { OUTREACH_STRATEGY, REVENUE_PROJECTION } = await import('@services/outreach-worker/src/sales-engine/outreach-strategy.js');

    res.json({
      strategy: OUTREACH_STRATEGY,
      projections: REVENUE_PROJECTION,
      description: 'Bulletproof humanized outreach: 5-day rollout, $15k-$61k revenue target',
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/outreach/projections
 * Predict campaign duration and revenue based on selected mailboxes
 */
router.post('/projections', requireAuthOrApiKey, async (req, res) => {
  try {
    const { mailboxIds, leadCount } = req.body;
    const userId = req.session?.userId!;

    if (!mailboxIds || !Array.isArray(mailboxIds) || mailboxIds.length === 0) {
      return res.status(400).json({ error: 'Mailbox selection required' });
    }

    const integrations = await storage.getIntegrations(userId);
    const selectedMailboxes = integrations.filter(i => mailboxIds.includes(i.id));

    // Calculate aggregate daily limit
    let totalDailyLimit = 0;
    for (const mb of selectedMailboxes) {
      // Single source of truth: integrations.dailyLimit DB column
      // (written by Reputation Monitor + Autonomous Scaler)
      const defaultLimit = mb.provider === 'custom_email' ? 250 : 50;
      let limit = (mb as any).dailyLimit && Number((mb as any).dailyLimit) > 0
        ? Number((mb as any).dailyLimit)
        : defaultLimit;
      // Apply graceful throttle from reputation system if set
      const gracefulLimit = (mb as any).gracefulDailyLimit;
      if (gracefulLimit !== null && gracefulLimit !== undefined) {
        limit = Math.min(limit, gracefulLimit);
      }
      // Warmup adjustment (optional, skip if warmup service unavailable)
      try {
        const { warmupService } = await import('@services/outreach-worker/src/outreach-lib/warmup-service.js');
        const warmup = (warmupService as any).getWarmupStatus?.(mb, limit);
        if (warmup?.isWarmingUp) limit = warmup.dailyLimit;
      } catch (err) {
        console.error('[Outreach] Failed to load warmup service for mailbox projection:', err);
      }
      totalDailyLimit += limit;
    }

    const daysToComplete = Math.ceil(leadCount / Math.max(1, totalDailyLimit));
    const projectedRevenue = leadCount * 0.15 * 49.99; // Using STARTER tier averages as baseline

    res.json({
      success: true,
      projection: {
        totalDailyLimit,
        daysToComplete,
        projectedRevenue,
        warmupActive: selectedMailboxes.some(mb => mb.warmupStatus === 'active'),
        accuracy: '95%'
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/outreach/guide
 * Get outreach strategy guide
 */
router.get('/guide', async (req, res) => {
  try {
    // Return guide markdown (could be from file or generated)
    const guide = `
📊 OUTREACH STRATEGY GUIDE

This endpoint returns the humanized outreach strategy.
See: OUTREACH_STRATEGY_GUIDE.md in project root

Key points:
- 5-day rollout across segments
- Randomized timing to avoid spam flags
- Message rotation (5 hook variations)
- Follow-up sequences by tier
- Safety guardrails prevent reputation damage
- Revenue projection: $15k-$61k in 5 days

To launch:
1. Create campaign via POST /api/outreach/campaign/create
2. Review pre-flight safety checks
3. Start campaign
4. Monitor dashboard
5. Optimize based on real-time data
    `;

    res.json({ guide });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/outreach/demo-hvac
 * Run demo HVAC outreach campaign (no auth required for testing)
 * Creates test user if needed and sends 8 emails with 6-hour follow-ups
 */
router.post('/demo-hvac', async (req, res) => {
  try {
    const { storage } = await import('@shared/lib/storage/storage.js');
    const { runDemoOutreach } = await import('@services/outreach-worker/src/outreach-lib/outreach-runner.js');

    console.log('🚀 Starting HVAC demo outreach campaign...');

    // Find or create test user
    let user = await storage.getUserByEmail('canarylumen1@gmail.com');

    if (!user) {
      console.log('📝 Creating test user: canarylumen1@gmail.com');
      user = await storage.createUser({
        email: 'canarylumen1@gmail.com',
        username: 'canarylumen',
        password: '$2a$10$demoasheddpassword', // Placeholder - not for production
        plan: 'enterprise'
      });
    }

    console.log(`✅ Using user ID: ${user.id}`);

    // Run the HVAC demo outreach
    const result = await runDemoOutreach(user.id);

    // Create completion notification
    await storage.createNotification({
      userId: user.id,
      type: 'insight',
      title: '🚀 HVAC Outreach Campaign Complete',
      message: `Sent ${result.summary.sent}/${result.summary.total} emails to HVAC leads. ${result.summary.failed} failed. 6-hour follow-ups scheduled.`,
      metadata: {
        activityType: 'outreach_campaign_complete',
        sent: result.summary.sent,
        failed: result.summary.failed,
        total: result.summary.total,
        followUpHours: 6
      }
    });

    console.log(`✅ Campaign complete: ${result.summary.sent}/${result.summary.total} sent`);

    res.json({
      success: true,
      message: `HVAC outreach campaign completed! ${result.summary.sent} of ${result.summary.total} emails sent.`,
      ...result
    });
  } catch (error: any) {
    console.error('HVAC demo outreach error:', error);
    res.status(500).json({ error: error.message });
  }
});




/**
 * GET /api/outreach/track/:trackingId
 * Tracking pixel endpoint for email opens
 */
router.get('/track/:trackingId', async (req, res) => {
  try {
    const { trackingId } = req.params;
    const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');

    // Fetch existing message to check if it's the first time it was opened
    const existingMessage = await db.query.messages.findFirst({
      where: eq(messages.trackingId, trackingId),
    });

    const isFirstOpen = existingMessage && !existingMessage.openedAt;

    // 1. Update openedAt for the message in unified inbox
    const [message] = await db.update(messages)
      .set({
        openedAt: new Date(),
        isRead: true
      })
      .where(eq(messages.trackingId, trackingId))
      .returning();

    // 2. Update campaign_emails status for detailed campaign tracking
    const [campaignEmail] = await db.update(campaignEmails)
      .set({
        status: 'opened',
        metadata: sql`jsonb_set(metadata, '{openedAt}', ${JSON.stringify(new Date().toISOString())}::jsonb)`
      })
      .where(and(eq(campaignEmails.messageId, trackingId), ne(campaignEmails.status, 'opened')))
      .returning();

    // 3. Roll up stats to campaign level
    if (campaignEmail?.campaignId && isFirstOpen) {
      await db.update(outreachCampaigns)
        .set({
          stats: sql`jsonb_set(stats, '{opened}', (COALESCE((stats->>'opened')::int, 0) + 1)::text::jsonb)`,
          updatedAt: new Date()
        })
        .where(eq(outreachCampaigns.id, campaignEmail.campaignId));

      console.log(`📊 Campaign stat updated: campaignId=${campaignEmail.campaignId}, stat=opened`);
      wsSync.notifyCampaignStatsUpdated(message.userId, campaignEmail.campaignId);
    }

    if (message && isFirstOpen) {
      console.log(`👁️ Email first opened: trackingId=${trackingId}, userId=${message.userId}`);

      // Fetch lead to get their name and update metadata
      const lead = await db.query.leads.findFirst({
        where: eq(leadsTable.id, message.leadId!),
      });

      if (lead) {
        const metadata = (lead.metadata as Record<string, any>) || {};
        await db.update(leadsTable)
          .set({
            metadata: { ...metadata, isOpened: true, lastOpenedAt: new Date().toISOString() }
          })
          .where(eq(leadsTable.id, lead.id));
      }

      const leadName = lead ? lead.name : "a lead";

      // Notify UI in real-time
      wsSync.notifyMessagesUpdated(message.userId, {
        type: 'UPDATE',
        messageId: message.id,
        integrationId: message.integrationId,
        event: 'opened'
      });
      wsSync.notifyActivityUpdated(message.userId, {
        type: 'email_opened',
        messageId: message.id,
        leadId: message.leadId,
        trackingId,
        title: 'Email Opened',
        message: `Email opened by ${leadName}`
      });

      // Create audit log for activity feed
      await storage.createAuditLog({
        userId: message.userId,
        leadId: message.leadId!,
        integrationId: message.integrationId,
        action: 'email_opened',
        details: {
          message: `Email opened by ${leadName}`,
          messageId: message.id,
          trackingId
        }
      });
    }

    // Return a 1x1 transparent GIF
    const pixel = Buffer.from(
      'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      'base64'
    );
    res.set('Content-Type', 'image/gif');
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    return res.end(pixel);
  } catch (error) {
    console.error('Tracking error:', error);
    // Even if tracking fails, return the pixel so the email looks normal
    const pixel = Buffer.from(
      'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      'base64'
    );
    res.set('Content-Type', 'image/gif');
    return res.end(pixel);
  }
});

/**
 * GET /api/outreach/click/:trackingId
 * Tracking redirect for link clicks
 */
router.get('/click/:trackingId', async (req, res) => {
  try {
    const { trackingId } = req.params;
    const { url } = req.query;
    const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');

    if (!url || typeof url !== 'string') {
      return res.status(400).send('Invalid redirect URL');
    }

    // Check if it's the first time clicked
    const existingMessage = await db.query.messages.findFirst({
      where: eq(messages.trackingId, trackingId),
    });

    const isFirstClick = existingMessage && !existingMessage.clickedAt;

    // 1. Update clickedAt for the message
    const [message] = await db.update(messages)
      .set({
        clickedAt: new Date(),
        isRead: true
      })
      .where(eq(messages.trackingId, trackingId))
      .returning();

    // 2. Update campaign_emails status
    const [campaignEmail] = await db.update(campaignEmails)
      .set({
        status: 'clicked',
        metadata: sql`jsonb_set(metadata, '{clickedAt}', ${JSON.stringify(new Date().toISOString())}::jsonb)`
      })
      .where(and(eq(campaignEmails.messageId, trackingId), ne(campaignEmails.status, 'clicked')))
      .returning();

    // 3. Roll up stats
    if (campaignEmail?.campaignId && isFirstClick) {
      await db.update(outreachCampaigns)
        .set({
          stats: sql`jsonb_set(stats, '{clicked}', (COALESCE((stats->>'clicked')::int, 0) + 1)::text::jsonb)`,
          updatedAt: new Date()
        })
        .where(eq(outreachCampaigns.id, campaignEmail.campaignId));

      wsSync.notifyCampaignStatsUpdated(message.userId, campaignEmail.campaignId);
    }

    if (message && isFirstClick) {
      const lead = await db.query.leads.findFirst({
        where: eq(leadsTable.id, message.leadId!),
      });
      const leadName = lead ? lead.name : "a lead";

      // Notify UI
      wsSync.notifyMessagesUpdated(message.userId, {
        type: 'UPDATE',
        messageId: message.id,
        event: 'clicked'
      });

      wsSync.notifyActivityUpdated(message.userId, {
        type: 'email_clicked',
        messageId: message.id,
        leadId: message.leadId,
        trackingId,
        url,
        title: 'Link Clicked',
        message: `Link clicked by ${leadName}`
      });

      await storage.createAuditLog({
        userId: message.userId,
        leadId: message.leadId!,
        integrationId: message.integrationId,
        action: 'email_clicked',
        details: {
          message: `Link clicked by ${leadName}`,
          url,
          trackingId
        }
      });
    }

    // Validate the target URL to prevent Open Redirect vulnerabilities
    const isValidUrl = (targetUrl: string) => {
      return validator.isURL(targetUrl, {
        protocols: ['http', 'https'],
        require_protocol: true,
        require_valid_protocol: true,
        allow_underscores: true,
      }) && !targetUrl.includes('localhost') && !targetUrl.includes('127.0.0.1');
    };

    // Try to look up the target URL from our database first (Secure way)
    const [campaignEmailRecord] = await db.select({ targetUrl: campaignEmails.targetUrl })
      .from(campaignEmails)
      .where(eq(campaignEmails.messageId, trackingId))
      .limit(1);

    let redirectUrl = url;
    let verified = false;

    // Check campaign_emails target_url (comma-separated list of original URLs)
    if (campaignEmailRecord?.targetUrl) {
      const allowedUrls = campaignEmailRecord.targetUrl.split(',');
      verified = allowedUrls.includes(url);
    }

    // Fallback: check messages table
    if (!verified) {
      const messageResult = await storage.getMessageByTrackingId(trackingId);
      if (messageResult?.targetUrl) {
        const allowedUrls = messageResult.targetUrl.split(',');
        if (allowedUrls.includes(url)) {
          verified = true;
        } else {
          console.warn(`⚠️ Blocked unverified redirect for tracking ${trackingId}: ${url}`);
          return res.status(400).send('Invalid or unsafe redirect URL');
        }
      }
    }

    if (!redirectUrl || !isValidUrl(redirectUrl)) {
      console.warn(`⚠️ Blocked potentially malicious redirect to: ${redirectUrl || url}`);
      return res.status(400).send('Invalid or unsafe redirect URL');
    }

    if (!verified) {
      // Legacy email support: Use an interstitial HTML page for URLs that aren't verified by the DB.
      // This mitigates the Server-Side URL Redirect vulnerability.
      const safeUrl = String(redirectUrl).replace(/"/g, '&quot;');
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta http-equiv="refresh" content="1;url=${safeUrl}">
          <title>Redirecting...</title>
          <style>body { font-family: sans-serif; text-align: center; margin-top: 50px; }</style>
        </head>
        <body>
          <p>Redirecting you to <a href="${safeUrl}">${safeUrl}</a>...</p>
        </body>
        </html>
      `);
    }

    // Redirect to the verified target URL
    return res.redirect(redirectUrl);
  } catch (error) {
    console.error('Click tracking error:', error);
    return res.status(500).send('Internal Server Error');
  }
});

export default router;

// ─── Mailbox Health Management Routes ─────────────────────────────────────────

import { mailboxHealthService } from '@services/email-service/src/email/mailbox-health-service.js';
import { redistributionWorker } from '@services/email-service/src/email/redistribution-worker.js';

const healthRouter = Router();

/**
 * GET /api/outreach/mailbox-health
 * Get health status of all connected mailboxes
 */
healthRouter.get('/mailbox-health', requireAuthOrApiKey, async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const mailboxes = await mailboxHealthService.getUserMailboxHealth(userId);
    res.json({ mailboxes });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/outreach/mailbox-health/:id/check
 * Force a health check on a specific mailbox
 */
healthRouter.post('/mailbox-health/:id/check', requireAuthOrApiKey, async (req, res) => {
  try {
    const userId = req.session?.userId;
    const { id } = req.params;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const integration = await storage.getIntegrationById(id);
    if (!integration || integration.userId !== userId) {
      return res.status(404).json({ error: 'Mailbox not found' });
    }

    const result = await mailboxHealthService.checkMailbox(integration);
    res.json({ success: true, result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/outreach/mailbox-health/reassign
 * Manually reassign leads from one mailbox to another
 */
healthRouter.post('/mailbox-health/reassign', requireAuthOrApiKey, async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { fromMailboxId, toMailboxId } = req.body;
    if (!fromMailboxId || !toMailboxId) {
      return res.status(400).json({ error: 'fromMailboxId and toMailboxId are required' });
    }

    const count = await mailboxHealthService.reassignLeads(fromMailboxId, toMailboxId, userId);
    res.json({ success: true, reassigned: count });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/outreach/mailbox-health/redistribute
 * Manually trigger lead redistribution from failed mailboxes
 */
healthRouter.post('/mailbox-health/redistribute', requireAuthOrApiKey, async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    await redistributionWorker.run();
    res.json({ success: true, message: 'Redistribution triggered' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Re-export the health router to be mounted alongside the main outreach router
export { healthRouter };


