import { Router, type Request, type Response } from 'express';
import { requireAuth, getCurrentUserId } from '../middleware/auth.js';
import { storage } from '@shared/lib/storage/storage.js';
import { generateAIReply } from '@services/brain-worker/src/ai-lib/core/conversation-ai.js';
import { calculateLeadScore } from '@services/brain-worker/src/ai-lib/engines/lead-scoring.js';
import type { ChannelType, ProviderType, LeadStatus } from '@shared/types.js';

const router = Router();

// Add missing import-bulk endpoint for compatibility
router.post('/import-bulk', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { leads: leadsData, channel = 'email', aiPaused = false, integrationId } = req.body as {
      leads: Array<{ name?: string; email?: string; phone?: string; company?: string }>;
      channel?: 'email' | 'instagram';
      aiPaused?: boolean;
      integrationId?: string;
    };

    if (!Array.isArray(leadsData) || leadsData.length === 0) {
      res.status(400).json({ error: "No leads data provided" });
      return;
    }

    const existingLeads = await storage.getLeads({ userId, limit: 10000 });

    // Build lookup maps for O(1) deduplication
    const emailMap = new Map<string, any>();
    const nameMap = new Map<string, any>();

    existingLeads.forEach(l => {
      if (l.email) emailMap.set(l.email.toLowerCase(), l);
      if (l.name) nameMap.set(l.name.toLowerCase().trim(), l);
    });

    const results = {
      leadsImported: 0,
      leadsUpdated: 0,
      leadsFiltered: 0,
      errors: [] as string[],
      leads: [] as any[]
    };

    const BATCH_SIZE = 500;
    const { mapCsvToLeadMetadata } = await import('@shared/lib/imports/lead-importer.js');
    const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');

    for (let i = 0; i < leadsData.length; i += BATCH_SIZE) {
      const chunk = leadsData.slice(i, i + BATCH_SIZE);
      const batchToInsert: any[] = [];
      const batchIdentifiers = new Set<string>();

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
          if (batchIdentifiers.has(batchKey) || (email && emailMap.has(email))) {
            results.leadsFiltered++;
            continue;
          }
          batchIdentifiers.add(batchKey);

          const { SpamTrapDetector } = await import('@shared/lib/deliverability/spam-trap-detector.js');
          
          // Full deterministic + MX check
          const spamCheck = email ? await SpamTrapDetector.verifyFull(email, leadData) : { isTrap: false, score: 0 };
          
          batchToInsert.push({
            userId,
            name: name || 'Unknown',
            email: email || null,
            phone: metadata.phone || leadData.phone || null,
            company: metadata.company || leadData.company || null,
            channel: channel as any,
            integrationId: integrationId || null,
            status: (spamCheck.isTrap || !spamCheck.hasMx) ? 'bouncy' : 'new',
            aiPaused: aiPaused || spamCheck.isTrap || !spamCheck.hasMx,
            metadata: {
              ...leadData,
              ...metadata,
              imported_via: 'bulk_json',
              import_date: new Date().toISOString(),
              spam_check: spamCheck.isTrap ? 'detected' : 'clean',
              spam_reason: spamCheck.reason,
              is_disposable: spamCheck.isDisposable,
              has_mx: spamCheck.hasMx
            },
            tags: spamCheck.isTrap ? ['spam_trap', 'spam_risk'] : []
          });

          if (email) emailMap.set(email, true);
        } catch (err: any) {
          results.errors.push(`Row ${i + j + 1}: ${err.message}`);
        }
      }

      if (batchToInsert.length > 0) {
        const inserted = await storage.createLeadsBatch(batchToInsert, { suppressNotification: true });
        results.leads.push(...inserted);
        results.leadsImported += inserted.length;
        
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
router.post('/update-status', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { leadIds, status } = req.body as { leadIds: string[]; status: LeadStatus };
    const userId = getCurrentUserId(req)!;

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      res.status(400).json({ error: 'leadIds must be a non-empty array' });
      return;
    }

    const validStatuses: LeadStatus[] = ['new', 'open', 'replied', 'converted', 'not_interested', 'cold'];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ error: 'Invalid status' });
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

        await storage.updateLead(leadId, { status });
        results.push({ leadId, success: true });
      } catch (error: unknown) {
        errors.push({ leadId, error: getErrorMessage(error) });
      }
    }

    // Notify client via WebSocket
    const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
    wsSync.notifyLeadsUpdated(userId, { type: 'bulk_status_update', leadIds, status });
    wsSync.notifyStatsUpdated(userId);

    res.json({
      success: errors.length === 0,
      updated: results.length,
      failed: errors.length,
      results,
      errors
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
router.post('/add-tags', requireAuth, async (req: Request, res: Response): Promise<void> => {
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
router.post('/send-message', requireAuth, async (req: Request, res: Response): Promise<void> => {
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
router.post('/score-leads', requireAuth, async (req: Request, res: Response): Promise<void> => {
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
router.post('/archive', requireAuth, async (req: Request, res: Response): Promise<void> => {
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
router.post('/delete', requireAuth, async (req: Request, res: Response): Promise<void> => {
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
router.get('/export', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const leads = await storage.getLeads({ userId, limit: 10000 });

    if (leads.length === 0) {
      res.status(404).json({ error: 'No data to export' });
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

export default router;


