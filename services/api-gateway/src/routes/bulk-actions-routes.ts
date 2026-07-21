import { Router, type Request, type Response } from 'express';
import { requireAuthOrApiKey, getCurrentUserId } from '../middleware/auth.js';
import { storage } from '@shared/lib/storage/storage.js';
import { generateAIReply } from '@services/brain-worker/src/ai-lib/core/conversation-ai.js';
import { calculateLeadScore } from '@services/brain-worker/src/ai-lib/engines/lead-scoring.js';
import type { ChannelType, ProviderType, LeadStatus } from '@shared/types.js';
import { db } from '@shared/lib/db/db.js';
import { leads } from '@audnix/shared';
import { inArray, eq } from 'drizzle-orm';
import { getUserLeadsLimit } from '@shared/plan-utils.js';

const router = Router();

// Add missing import-bulk endpoint for compatibility
router.post('/import-bulk', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { leads: leadsData, channel = 'email', aiPaused = false, integrationId, distribute } = req.body as {
      leads: Array<{ name?: string; email?: string; phone?: string; company?: string }>;
      channel?: 'email' | 'instagram';
      aiPaused?: boolean;
      integrationId?: string;
      distribute?: boolean;
    };

    if (!Array.isArray(leadsData) || leadsData.length === 0) {
      res.status(400).json({ error: "No leads data provided" });
      return;
    }

    const user = await storage.getUserById(userId);
    const existingLeadsCount = await storage.getLeadsCount(userId);
    const maxLeads = getUserLeadsLimit(user);

    if (existingLeadsCount >= maxLeads) {
      res.status(400).json({
        error: `You've reached your plan's limit of ${maxLeads} leads. Delete some leads or upgrade your plan to add more.`,
        limitReached: true
      });
      return;
    }

    // Load mailboxes for distribution (smart MX routing)
    let mailboxPool: Array<{ id: string; email: string; provider: string }> = [];
    let mailboxIndex = { current: 0 };
    if (distribute || !integrationId) {
      const integrations = await storage.getIntegrations(userId);
      const { getMailboxPool } = await import('@shared/lib/imports/mailbox-router.js');
      mailboxPool = getMailboxPool(integrations);
    }

    const results = {
      leadsImported: 0,
      leadsUpdated: 0,
      leadsFiltered: 0,
      errors: [] as string[],
      leads: [] as any[]
    };

    const BATCH_SIZE = 500;
    const { mapCsvToLeadMetadata } = await import('@shared/lib/imports/lead-importer.js');
    const { SpamTrapDetector } = await import('@shared/lib/deliverability/spam-trap-detector.js');
    const dns = await import('dns/promises');
    const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');

    // ── Batch MX Resolution ──────────────────────────────────────────────
    // Gather unique domains from ALL leads and resolve MX in parallel via Rust-speed Promise.all.
    // Eliminates the per-lead DNS bottleneck — 50k leads with 5k unique domains
    // resolve in ~200ms instead of 5+ minutes of sequential lookups.
    const uniqueDomains = new Set<string>();
    for (const lead of leadsData) {
      const rawEmail = lead.email?.trim();
      if (rawEmail) {
        const domain = rawEmail.split('@')[1]?.toLowerCase().trim();
        if (domain) uniqueDomains.add(domain);
      }
    }
    const domainMxMap = new Map<string, boolean>();
    if (uniqueDomains.size > 0) {
      const entries = await Promise.allSettled(
        [...uniqueDomains].map(async (domain) => {
          const records = await dns.resolveMx(domain);
          return [domain, records && records.length > 0] as const;
        })
      );
      for (const entry of entries) {
        if (entry.status === 'fulfilled') {
          domainMxMap.set(entry.value[0], entry.value[1]);
        } else {
          console.warn(`[BulkImport] MX lookup failed for domain: ${entry.reason?.message || 'unknown'}`);
        }
      }
    }

    // Process in chunks to avoid memory bloat and keep dedup accurate at any scale
    let totalProcessed = existingLeadsCount;
    for (let i = 0; i < leadsData.length; i += BATCH_SIZE) {
      if (totalProcessed >= maxLeads) break;
      const chunk = leadsData.slice(i, i + BATCH_SIZE);
      const chunkEmails = chunk.map(l => (l.email || '').toLowerCase().trim()).filter(Boolean);
      const existingEmails = chunkEmails.length > 0
        ? await storage.getExistingEmails(userId, chunkEmails)
        : [];
      const existingEmailSet = new Set(existingEmails);
      const batchIdentifiers = new Set<string>();
      const batchToInsert: any[] = [];

      for (let j = 0; j < chunk.length; j++) {
        const leadData = chunk[j];
        try {
          const metadata = mapCsvToLeadMetadata(leadData);
          const rawEmail = metadata.email || leadData.email;
          const rawName = metadata.name || leadData.name;
          const email = rawEmail?.toLowerCase().trim();
          const name = rawName?.trim();
          const nameKey = name?.toLowerCase();

          if (!email && !name) {
            results.errors.push(`Row ${i + j + 1}: Missing name and email`);
            results.leadsFiltered++;
            continue;
          }

          const batchKey = email || `name:${nameKey}`;
          if (batchIdentifiers.has(batchKey) || (email && existingEmailSet.has(email))) {
            results.leadsFiltered++;
            continue;
          }
          batchIdentifiers.add(batchKey);

          // Fast scan: sync deterministic check + cached MX result (no per-lead DNS)
          const scanResult = email ? SpamTrapDetector.scan(email) : { isTrap: false, score: 0, isDisposable: false, reason: undefined };
          const domain = email?.split('@')[1]?.toLowerCase().trim();
          const hasMx = domain ? (domainMxMap.get(domain) ?? true) : true;
          const isTrap = scanResult.isTrap || !hasMx;

          // Smart MX routing: @gmail→gmail, @outlook→outlook, custom domain→custom_email, fallback round-robin
          const assignedIntegrationId = integrationId
            ? integrationId
            : mailboxPool.length > 0
              ? (await import('@shared/lib/imports/mailbox-router.js')).assignMailbox(email, mailboxPool, mailboxIndex)
              : null;
          
          batchToInsert.push({
            userId,
            name: name || email?.split('@')[0]?.replace(/[._-]/g, ' ') || 'Unknown',
            email: email || null,
            phone: metadata.phone || leadData.phone || null,
            company: metadata.company || leadData.company || null,
            website: metadata.website || null,
            businessName: metadata.businessName || metadata.business_name || null,
            city: metadata.city || null,
            country: metadata.country || null,
            niche: metadata.niche || null,
            industry: metadata.industry || null,
            revenue: metadata.revenue || null,
            channel: channel as any,
            integrationId: assignedIntegrationId,
            status: isTrap ? 'bouncy' : 'new',
            aiPaused: aiPaused || isTrap,
            metadata: {
              ...leadData,
              ...metadata,
              imported_via: 'bulk_json',
              import_date: new Date().toISOString(),
              spam_check: isTrap ? 'detected' : 'clean',
              spam_reason: scanResult.reason,
              is_disposable: scanResult.isDisposable,
              has_mx: hasMx
            },
            tags: isTrap ? ['spam_trap', 'spam_risk'] : []
          });

          // Dedup tracked via batchIdentifiers above
        } catch (err: any) {
          results.errors.push(`Row ${i + j + 1}: ${err.message}`);
        }
      }

      if (batchToInsert.length > 0) {
        const inserted = await storage.createLeadsBatch(batchToInsert, { suppressNotification: true });
        results.leads.push(...inserted);
        results.leadsImported += inserted.length;
        totalProcessed += inserted.length;

        // Phase 1.1: Dispatch background timezone enrichment
        const { aiProcessingQueue } = await import('../core/queues.js');
        if (aiProcessingQueue) {
          const enrichmentJobs = inserted.map(lead => ({
            name: 'timezone-enrichment',
            data: {
              type: 'timezone-enrichment',
              userId,
              leadId: lead.id,
              data: { useAI: true }
            }
          }));
          await aiProcessingQueue.addBulk(enrichmentJobs);
        }
        
        // Notify progress for large imports
        if (leadsData.length > BATCH_SIZE) {
          wsSync.notifyLeadsUpdated(userId, { 
            type: 'bulk_import_progress', 
            current: results.leadsImported, 
            total: leadsData.length 
          });
        }
      }
    }

    // Create single aggregate notification if leads were imported
    if (results.leadsImported > 0) {
      try {
        await storage.createNotification({
          userId,
          type: 'lead_import',
          title: '📥 Bulk Leads Imported',
          message: `${results.leadsImported} leads added to your pipeline.${results.leadsFiltered > 0 ? ` ${results.leadsFiltered} duplicates filtered.` : ''}`,
          metadata: { count: results.leadsImported, filtered: results.leadsFiltered, source: 'bulk_json' }
        });

        wsSync.notifyNotification(userId, {
          type: 'lead_import',
          title: '📥 Bulk Leads Imported',
          message: `${results.leadsImported} leads added to your pipeline.`,
          playSound: true
        });
        wsSync.notifyLeadsUpdated(userId, { type: 'bulk_import', count: results.leadsImported });
        const { invalidateStatsCache } = await import('./dashboard-routes.js');
        invalidateStatsCache(userId);
        wsSync.notifyStatsUpdated(userId);
      } catch (notifErr) {
        console.warn('[Bulk Import] Failed to create aggregate notification:', notifErr);
      }
    }

    res.json({
      success: true,
      leadsImported: results.leadsImported,
      leadsUpdated: results.leadsUpdated,
      leadsFiltered: results.leadsFiltered,
      errors: results.errors,
      message: `Imported ${results.leadsImported} leads.`,
      leads: results.leads.slice(0, 100) // Don't send back 10k leads in JSON
    });
  } catch (error: any) {
    console.error('Bulk import error:', error);
    res.status(500).json({ error: error.message });
  }
});

interface BulkResult {
  leadId: string;
  success: boolean;
  messageId?: string;
  tags?: string[];
  score?: number;
  temperature?: string;
}

interface BulkError {
  leadId: string;
  error: string;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function channelToProvider(channel: ChannelType): ProviderType {
  if (channel === 'instagram') return 'instagram';
  return 'email';
}

/**
 * Bulk update lead status
 * POST /api/bulk/update-status
 */
router.post('/update-status', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const { leadIds, status } = req.body as { leadIds: string[]; status: LeadStatus };
    const userId = getCurrentUserId(req)!;

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      res.status(400).json({ error: 'leadIds must be a non-empty array' });
      return;
    }

    const validStatuses: LeadStatus[] = ['new', 'contacted', 'replied', 'converted', 'not_interested', 'cold'];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ error: 'Invalid status' });
      return;
    }

    const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');

    // Batch update - single query instead of N queries
    const chunkSize = 500;
    for (let i = 0; i < leadIds.length; i += chunkSize) {
      const chunk = leadIds.slice(i, i + chunkSize);
      const validUUIDs = chunk.filter(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
      if (validUUIDs.length === 0) continue;

      await db.update(leads)
        .set({ status, updatedAt: new Date() })
        .where(inArray(leads.id, validUUIDs));
    }

    wsSync.notifyLeadsUpdated(userId, { type: 'bulk_status_update', leadIds, status });
    wsSync.notifyStatsUpdated(userId);

    res.json({
      success: true,
      updated: leadIds.length,
    });
  } catch (error: unknown) {
    console.error('Bulk status update error:', error);
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

/**
 * Bulk add tags
 * POST /api/bulk/add-tags
 */
router.post('/add-tags', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const { leadIds, tags } = req.body as { leadIds: string[]; tags: string[] };
    const userId = getCurrentUserId(req)!;

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      res.status(400).json({ error: 'leadIds must be a non-empty array' });
      return;
    }

    if (!Array.isArray(tags) || tags.length === 0) {
      res.status(400).json({ error: 'tags must be a non-empty array' });
      return;
    }

    const results: BulkResult[] = [];
    const errors: BulkError[] = [];

    for (const leadId of leadIds) {
      try {
        const lead = await storage.getLeadById(leadId);
        if (!lead || lead.userId !== userId) {
          errors.push({ leadId, error: 'Lead not found or unauthorized' });
          continue;
        }

        const existingTags = lead.tags || [];
        const newTags = Array.from(new Set([...existingTags, ...tags]));

        await storage.updateLead(leadId, { tags: newTags });
        results.push({ leadId, success: true, tags: newTags });
      } catch (error: unknown) {
        errors.push({ leadId, error: getErrorMessage(error) });
      }
    }

    // Notify client via WebSocket
    const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
    wsSync.notifyLeadsUpdated(userId, { type: 'bulk_tags_updated', leadIds, tags });

    res.json({
      success: errors.length === 0,
      updated: results.length,
      failed: errors.length,
      results,
      errors
    });
  } catch (error: unknown) {
    console.error('Bulk tag update error:', error);
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

/**
 * Bulk send AI message
 * POST /api/bulk/send-message
 */
router.post('/send-message', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const { leadIds, message } = req.body as { leadIds: string[]; message?: string };
    const userId = getCurrentUserId(req)!;

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      res.status(400).json({ error: 'leadIds must be a non-empty array' });
      return;
    }

    const results: BulkResult[] = [];
    const errors: BulkError[] = [];

    for (const leadId of leadIds) {
      try {
        const lead = await storage.getLeadById(leadId);
        if (!lead || lead.userId !== userId) {
          errors.push({ leadId, error: 'Lead not found or unauthorized' });
          continue;
        }

        const channel = lead.channel as ChannelType;
        const messageBody = message || (await generateAIReply(
          lead,
          await storage.getMessagesByLeadId(leadId),
          channel
        )).text;

        const msg = await storage.createMessage({
          leadId,
          userId,
          provider: channelToProvider(channel),
          direction: 'outbound',
          body: messageBody,
          metadata: { bulk_action: true }
        });

        await storage.updateLead(leadId, { lastMessageAt: new Date() });
        results.push({ leadId, success: true, messageId: msg.id });
      } catch (error: unknown) {
        errors.push({ leadId, error: getErrorMessage(error) });
      }
    }

    // Notify client via WebSocket
    const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
    wsSync.notifyMessagesUpdated(userId);
    wsSync.notifyStatsUpdated(userId);

    res.json({
      success: errors.length === 0,
      sent: results.length,
      failed: errors.length,
      results,
      errors
    });
  } catch (error: unknown) {
    console.error('Bulk message send error:', error);
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

/**
 * Bulk score leads
 * POST /api/bulk/score-leads
 */
router.post('/score-leads', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const { leadIds } = req.body as { leadIds: string[] };
    const userId = getCurrentUserId(req)!;

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      res.status(400).json({ error: 'leadIds must be a non-empty array' });
      return;
    }

    const results: BulkResult[] = [];
    const errors: BulkError[] = [];

    for (const leadId of leadIds) {
      try {
        const lead = await storage.getLeadById(leadId);
        if (!lead || lead.userId !== userId) {
          errors.push({ leadId, error: 'Lead not found or unauthorized' });
          continue;
        }

        const scoreData = await calculateLeadScore(leadId);

        await storage.updateLead(leadId, {
          score: scoreData.score,
          warm: scoreData.temperature !== 'cold',
          metadata: {
            ...lead.metadata,
            scoreBreakdown: scoreData.breakdown,
            temperature: scoreData.temperature,
            priority: scoreData.priority
          }
        });

        results.push({
          leadId,
          success: true,
          score: scoreData.score,
          temperature: scoreData.temperature
        });
      } catch (error: unknown) {
        errors.push({ leadId, error: getErrorMessage(error) });
      }
    }

    // Notify client via WebSocket
    const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
    wsSync.notifyLeadsUpdated(userId, { type: 'bulk_scoring_complete', leadIds });
    wsSync.notifyStatsUpdated(userId);

    res.json({
      success: errors.length === 0,
      scored: results.length,
      failed: errors.length,
      results,
      errors
    });
  } catch (error: unknown) {
    console.error('Bulk scoring error:', error);
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

/**
 * Bulk archive leads
 * POST /api/bulk/archive
 */
router.post('/archive', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const { leadIds, archived = true } = req.body as { leadIds: string[]; archived?: boolean };
    const userId = getCurrentUserId(req)!;

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      res.status(400).json({ error: 'leadIds must be a non-empty array' });
      return;
    }

    await storage.archiveMultipleLeads(leadIds, userId, archived);

    // Notify client via WebSocket
    const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
    wsSync.notifyLeadsUpdated(userId, { type: 'bulk_archive', leadIds, archived });
    wsSync.notifyStatsUpdated(userId);

    res.json({
      success: true,
      count: leadIds.length,
      message: `Successfully ${archived ? 'archived' : 'unarchived'} ${leadIds.length} leads`
    });
  } catch (error: unknown) {
    console.error('Bulk archive error:', error);
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

/**
 * Bulk delete leads
 * POST /api/bulk/delete
 */
router.post('/delete', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const { leadIds } = req.body as { leadIds: string[] };
    const userId = getCurrentUserId(req)!;

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      res.status(400).json({ error: 'leadIds must be a non-empty array' });
      return;
    }

    await storage.deleteMultipleLeads(leadIds, userId);

    // Notify client via WebSocket
    const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
    wsSync.notifyLeadsUpdated(userId, { type: 'bulk_delete', leadIds });
    wsSync.notifyStatsUpdated(userId);

    res.json({
      success: true,
      count: leadIds.length,
      message: `Successfully deleted ${leadIds.length} leads`
    });
  } catch (error: unknown) {
    console.error('Bulk delete error:', error);
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

/**
 * Export all leads as CSV
 * GET /api/bulk/export
 */
router.get('/export', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const leads = await storage.getLeads({ userId, limit: 10000 });

    if (leads.length === 0) {
      const emptyHeaders = ['ID', 'Name', 'Email', 'Phone', 'Channel', 'Status', 'Score', 'Warm', 'Created At'];
      const emptyCsv = emptyHeaders.join(',') + '\n';
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=audnix_leads_${new Date().toISOString().split('T')[0]}.csv`);
      res.status(200).send(emptyCsv);
      return;
    }

    const headers = ['ID', 'Name', 'Email', 'Phone', 'Channel', 'Status', 'Score', 'Warm', 'Created At'];
    const rows = leads.map(l => [
      l.id,
      l.name,
      l.email || '',
      l.phone || '',
      l.channel,
      l.status,
      l.score || 0,
      l.warm ? 'Yes' : 'No',
      new Date(l.createdAt).toLocaleString()
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=audnix_leads_${new Date().toISOString().split('T')[0]}.csv`);
    res.status(200).send(csvContent);
  } catch (error: unknown) {
    console.error('Export error:', error);
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

/**
 * Export leads by category
 * GET /api/bulk/export-category?category=replied
 * Categories: replied, booked, no_show, no_reply, ghosted, converted
 */
router.get('/export-category', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { category } = req.query as { category?: string };

    if (!category) {
      res.status(400).json({ error: 'category query parameter is required' });
      return;
    }

    const validCategories = ['replied', 'booked', 'no_show', 'no_reply', 'ghosted', 'converted'];
    if (!validCategories.includes(category)) {
      res.status(400).json({ error: `Invalid category. Must be one of: ${validCategories.join(', ')}` });
      return;
    }

    let leads: any[] = [];

    switch (category) {
      case 'replied':
        leads = await storage.getLeads({ userId, status: 'replied', limit: 50000 });
        break;
      case 'booked':
        leads = await storage.getLeads({ userId, status: 'booked', limit: 50000 });
        break;
      case 'no_show':
        leads = await storage.getLeads({ userId, status: 'no_show', limit: 50000 });
        break;
      case 'no_reply':
        // Leads that haven't replied — new/contacted/cold status
        const statuses = ['new', 'contacted', 'cold'];
        const allLeads = await storage.getLeads({ userId, limit: 50000 });
        leads = allLeads.filter((l: any) => statuses.includes(l.status));
        break;
      case 'ghosted':
        // Leads with positive/neutral sentiment but no reply recently
        const ghostAll = await storage.getLeads({ userId, limit: 50000 });
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        leads = ghostAll.filter((l: any) =>
          (l.sentiment === 'positive' || l.sentiment === 'neutral') &&
          (!l.lastMessageAt || new Date(l.lastMessageAt) < thirtyDaysAgo) &&
          l.status !== 'converted' && l.status !== 'booked' &&
          l.status !== 'replied'
        );
        break;
      case 'converted':
        leads = await storage.getLeads({ userId, status: 'converted', limit: 50000 });
        break;
    }

    if (leads.length === 0) {
      const emptyHeaders = ['Name', 'Email', 'Phone', 'Country Code', 'Company', 'Business Name', 'Website', 'Google Maps URL', 'City', 'Country', 'Niche', 'Review', 'Channel', 'Status', 'Sentiment', 'Score', 'Warm', 'Timezone', 'Tags', 'Last Message At', 'Created At'];
      const emptyCsv = emptyHeaders.join(',') + '\n';
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=audnix_${category}_${new Date().toISOString().split('T')[0]}.csv`);
      res.status(200).send(emptyCsv);
      return;
    }

    const headers = [
      'Name', 'Email', 'Phone', 'Country Code', 'Company', 'Business Name',
      'Website', 'Google Maps URL', 'City', 'Country', 'Niche', 'Review',
      'Channel', 'Status', 'Sentiment', 'Score', 'Warm',
      'Timezone', 'Tags', 'Last Message At', 'Created At'
    ];

    const rows = leads.map((l: any) => {
      const meta = l.metadata || {};
      return [
        l.name || '',
        l.email || '',
        l.phone || '',
        meta.countryCode || meta.country_code || '',
        l.company || '',
        l.businessName || meta.businessName || meta.business_name || '',
        l.website || meta.website || '',
        meta.googleMapsUrl || meta.google_maps_url || '',
        l.city || meta.city || '',
        l.country || meta.country || '',
        l.niche || meta.niche || '',
        meta.review || '',
        l.channel || '',
        l.status || '',
        l.sentiment || '',
        String(l.score || 0),
        l.warm ? 'Yes' : 'No',
        l.timezone || '',
        (l.tags || []).join('; '),
        l.lastMessageAt ? new Date(l.lastMessageAt).toISOString() : '',
        l.createdAt ? new Date(l.createdAt).toISOString() : '',
      ];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=audnix_${category}_${new Date().toISOString().split('T')[0]}.csv`);
    res.status(200).send(csvContent);
  } catch (error: unknown) {
    console.error('Export by category error:', error);
    res.status(500).json({ error: getErrorMessage(error) });
  }
});

export default router;


