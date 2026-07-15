import { Router, Request, Response } from 'express';
import { requireAuthOrApiKey, getCurrentUserId } from '../middleware/auth.js';
import { storage } from '@shared/lib/storage/storage.js';
import { encrypt } from '@shared/lib/crypto/encryption.js';
import { db } from '@shared/lib/db/db.js';
import { users, calendarSettings } from '@audnix/shared';
import { eq } from 'drizzle-orm';

const router = Router();

/**
 * GET /api/integrations
 * Returns all integrations for the current user (safe, no secrets).
 */
router.get('/', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    let integrations = await storage.getIntegrations(userId);

    const { provider, connected, page, limit, search } = req.query as {
      provider?: string; connected?: string;
      page?: string; limit?: string; search?: string;
    };

    if (provider) {
      const providers = provider.split(',').map(p => p.trim());
      integrations = integrations.filter(i => providers.includes(i.provider));
    }
    if (connected !== undefined) {
      const wantConnected = connected !== 'false';
      integrations = integrations.filter(i => i.connected === wantConnected);
    }
    if (search) {
      const q = search.toLowerCase();
      integrations = integrations.filter(i =>
        (i.accountType && i.accountType.toLowerCase().includes(q)) ||
        i.provider.toLowerCase().includes(q) ||
        i.id.toLowerCase().includes(q)
      );
    }

    const total = integrations.length;

    const pageNum = page ? Math.max(1, parseInt(page)) : 1;
    const limitNum = limit ? Math.max(1, Math.min(100, parseInt(limit))) : total;
    const start = (pageNum - 1) * limitNum;
    const paged = integrations.slice(start, start + limitNum);

    const safeIntegrations = paged.map(integration => ({
      id: integration.id,
      provider: integration.provider,
      connected: integration.connected,
      accountType: integration.accountType,
      lastSync: integration.lastSync,
      createdAt: integration.createdAt,
      dailyLimit: (integration as any).dailyLimit ?? 50,
      gracefulDailyLimit: (integration as any).gracefulDailyLimit ?? null,
      reputationScore: (integration as any).reputationScore ?? null,
      healthLevel: (integration as any).healthLevel ?? null,
      warmupStatus: (integration as any).warmupStatus ?? null,
    }));

    res.json({ integrations: safeIntegrations, total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) });
  } catch (error) {
    console.error('Error fetching integrations:', error);
    res.status(500).json({ error: 'Failed to fetch integrations' });
  }
});

/**
 * POST /api/integrations/:provider/connect
 * Generic integration connect (for non-OAuth providers).
 */
router.post('/:provider/connect', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { provider } = req.params;
    const credentials = req.body;

    // Enforce mailbox limits for outreach providers
    if (['custom_email', 'gmail', 'outlook', 'instagram'].includes(provider)) {
      const limitCheck = await storage.checkMailboxLimit(userId);
      if (!limitCheck.allowed) {
        res.status(403).json({
          error: 'Limit reached',
          message: `Your current plan (${limitCheck.plan}) allows up to ${limitCheck.limit} mailboxes.`,
          count: limitCheck.current,
          limit: limitCheck.limit,
          plan: limitCheck.plan
        });
        return;
      }
    }

    if (provider === 'custom_email') {
      let transporter: any;
      try {
        const nodemailer = await import('nodemailer');
        const dns = await import('dns');
        transporter = nodemailer.createTransport({
          host: credentials.smtp_host,
          port: parseInt(String(credentials.smtp_port)) || 587,
          secure: parseInt(String(credentials.smtp_port)) === 465,
          auth: {
            user: credentials.smtp_user,
            pass: credentials.smtp_pass,
          },
          family: 4,
          lookup: (hostname: string, options: any, callback: any) => {
            return dns.lookup(hostname, { family: 4 }, callback);
          },
          tls: { rejectUnauthorized: false }
        } as any);

        await transporter.verify();
        transporter.close();
        console.log(`[Integrations] SMTP Handshake successful for ${credentials.smtp_user}`);
      } catch (smtpError: any) {
        try { transporter?.close(); } catch {};
        console.error('[Integrations] SMTP Handshake failed:', smtpError.message);
        res.status(400).json({ error: 'SMTP Verification Failed', message: smtpError.message });
        return;
      }
    }

    const encryptedMeta = encrypt(JSON.stringify(credentials));

    const integration = await storage.createIntegration({
      userId,
      provider: provider as any,
      encryptedMeta,
      connected: true,
    });

    // For all email providers, trigger immediate discovery/sync so it feels like a real email app
    if (['custom_email', 'gmail', 'outlook'].includes(provider)) {
      try {
        const { imapIdleManager } = await import("@services/email-service/src/email/imap-idle-manager.js");
        await imapIdleManager.syncConnections();
      } catch (syncErr) {
        console.warn('[Integrations] Failed to trigger immediate sync:', syncErr);
      }
    }

    res.json({
      id: integration.id,
      provider: integration.provider,
      connected: integration.connected,
      message: `${provider} connected successfully`
    });
  } catch (error) {
    console.error('Error connecting integration:', error);
    res.status(500).json({ error: 'Failed to connect integration' });
  }
});

/**
 * POST /api/integrations/:provider/disconnect
 * Disconnect and revoke an integration. Handles both OAuth (Gmail/Outlook)
 * and custom email providers. Accepts `integrationId` as a query param
 * to target a specific mailbox when the user has multiple.
 *
 * Cleanup order:
 * 1. Revoke the OAuth token with the provider (best-effort)
 * 2. Delete from oauth_accounts table (for Gmail/Outlook)
 * 3. Delete from integrations table
 */
router.post('/:provider/disconnect', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { provider } = req.params;
    // Support integrationId from both query string and request body for flexibility
    const integrationId = (req.query.integrationId || req.body?.integrationId) as string | undefined;

    console.log(`[Integrations] Disconnect request: provider=${provider}, integrationId=${integrationId || 'none'}, userId=${userId}`);

    // --- Step 1: Find the integration record and verify ownership ---
    let integration = null;
    if (integrationId) {
      integration = await storage.getIntegrationById(integrationId);
      if (integration && integration.userId !== userId) {
        console.warn(`[Integrations] 🚨 Unauthorized disconnect attempt by user ${userId} for integration owned by ${integration.userId}`);
        res.status(403).json({ error: 'Unauthorized: You do not own this integration' });
        return;
      }
    } else {
      // Fallback: find the first connected integration for this provider
      const allInts = await storage.getIntegrations(userId);
      integration = allInts.find(i => i.provider === provider && i.connected) || null;
    }

    if (!integration && integrationId) {
       console.warn(`[Integrations] No integration found with ID: ${integrationId}`);
       res.status(404).json({ error: 'Integration not found' });
       return;
    }

    // --- Step 2: Provider-specific OAuth token revocation ---
    // We wrap these in try-catch to ensure we always proceed to database deletion
    if (integration) {
      const emailAddress = integration.accountType || undefined;
      
      try {
        if (provider === 'gmail') {
          const { gmailOAuth } = await import('@services/api-gateway/src/oauth/gmail.ts');
          console.log(`[Integrations] Revoking Gmail OAuth token for: ${emailAddress || 'unknown'}`);
          await gmailOAuth.revokeToken(userId, emailAddress);
        } else if (provider === 'outlook') {
          const { outlookOAuth } = await import('@services/api-gateway/src/oauth/outlook.js');
          console.log(`[Integrations] Revoking Outlook OAuth token for: ${emailAddress || 'unknown'}`);
          await outlookOAuth.revokeToken(userId, emailAddress);
        } else if (provider === 'instagram') {
          const { InstagramOAuth } = await import('@services/api-gateway/src/oauth/instagram.js');
          const instagramOAuth = new InstagramOAuth();
          await instagramOAuth.revokeToken(userId);
        } else if (provider === 'calendly') {
          const { calendlyOAuth } = await import('@services/api-gateway/src/oauth/calendly.js');
          await calendlyOAuth.revokeToken(userId);
        } else if (provider === 'google_calendar') {
          const { googleCalendarOAuth } = await import('@services/api-gateway/src/oauth/google-calendar.js');
          await googleCalendarOAuth.revokeToken(userId);
        }
      } catch (e: any) {
        // Non-fatal: token may have already expired or been revoked on provider side
        console.warn(`[Integrations] ${provider} token revocation failed (non-fatal): ${e.message}`);
      }
    }

    // Get list of all matching integrations before deletion for BullMQ queue tasks
    let integrationsToDisconnect: any[] = [];
    if (['custom_email', 'gmail', 'outlook'].includes(provider)) {
      if (integration) {
        integrationsToDisconnect = [integration];
      } else {
        const allInts = await storage.getIntegrations(userId);
        integrationsToDisconnect = allInts.filter(i => i.provider === provider);
      }
    }

    // --- Step 3: Delete the integration record from the database ---
    if (integration) {
      console.log(`[Integrations] Deleting integration record: ${integration.id} (${provider})`);
      await storage.deleteIntegrationById(integration.id);
    } else {
      console.log(`[Integrations] Performing bulk disconnect for ${provider} for user: ${userId}`);
      await storage.disconnectIntegration(userId, provider);
    }

    // If Calendly is being disconnected, also clear user-level fields so
    // frontend checks like `user.calendlyAccessToken` reflect the correct state.
    if (provider === 'calendly') {
      await db.update(users).set({
        calendlyAccessToken: null as any,
        calendlyRefreshToken: null as any,
        calendlyExpiresAt: null as any,
        calendlyUserUri: null as any,
        calendarLink: null as any,
      }).where(eq(users.id, userId));

      await db.update(calendarSettings).set({
        calendlyEnabled: false,
        calendlyToken: null as any,
        calendlyUsername: null as any,
        calendlyEventTypeUri: null as any,
      }).where(eq(calendarSettings.userId, userId));
    }

    // --- Step 4: Notify frontend and cleanup real-time connections ---
    const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
    wsSync.notifySettingsUpdated(userId);

    if (['custom_email', 'gmail', 'outlook'].includes(provider)) {
      wsSync.notifyLeadsUpdated(userId);
      for (const i of integrationsToDisconnect) {
        if (i?.id) {
          wsSync.notifySyncStatus(userId, { syncing: false, integrationId: i.id, disconnected: true });
        }
      }
    }

    // If it's an email provider, kill the permanent IMAP socket instantly (both locally and on workers via BullMQ)
    if (['custom_email', 'gmail', 'outlook'].includes(provider)) {
      try {
        const { imapIdleManager } = await import('@services/email-service/src/email/imap-idle-manager.js');
        
        // 1. Terminate locally (legacy support)
        for (const i of integrationsToDisconnect) {
          if (i?.id) {
            imapIdleManager.forceDisconnect(i.id, userId);
          }
        }
        await imapIdleManager.syncConnections();
        
        // 2. Broadcast to production workers via BullMQ queue
        try {
          const { Queue } = await import('bullmq');
          const { redisConnection, hasRedis } = await import('@shared/lib/queues/redis-config.js');
          if (hasRedis && redisConnection) {
            const imapTaskQueue = new Queue('imap-idle-tasks', {
              connection: redisConnection as any,
            });
            for (const i of integrationsToDisconnect) {
              if (i?.id) {
                await imapTaskQueue.add('DISCONNECT_MAILBOX', {
                  type: 'DISCONNECT_MAILBOX',
                  integrationId: i.id,
                }, { removeOnComplete: true, removeOnFail: true });
                console.log(`[Integrations] Broadcast DISCONNECT_MAILBOX BullMQ task for: ${i.id}`);
              }
            }
            await imapTaskQueue.close();
          }
        } catch (queueErr: any) {
          console.warn('[Integrations] Non-fatal BullMQ disconnect broadcast error:', queueErr.message);
        }
      } catch (e) {
        console.warn('[Integrations] Failed to cleanup IMAP connections:', e);
      }
    }

    console.log(`[Integrations] ✅ ${provider} disconnected successfully`);
    res.json({ success: true, message: `${provider} disconnected` });
  } catch (error: any) {
    console.error('Error disconnecting integration:', error);
    res.status(500).json({ error: 'Failed to disconnect', details: error.message });
  }
});


/**
 * PATCH /api/integrations/:integrationId/daily-limit
 * Update the daily send limit for a specific mailbox.
 * Users can increase or decrease their per-mailbox limit.
 * The reputation system may still apply gracefulDailyLimit throttles on top.
 */
router.patch('/:integrationId/daily-limit', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req);
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { integrationId } = req.params;
    const { dailyLimit } = req.body;

    if (typeof dailyLimit !== 'number' || dailyLimit < 1 || dailyLimit > 500) {
      res.status(400).json({ error: 'dailyLimit must be a number between 1 and 500' });
      return;
    }

    // Verify ownership
    const integration = await storage.getIntegrationById(integrationId);
    if (!integration || integration.userId !== userId) {
      res.status(404).json({ error: 'Integration not found' });
      return;
    }

    // Only email providers have daily limits
    if (!['custom_email', 'gmail', 'outlook'].includes(integration.provider)) {
      res.status(400).json({ error: 'Daily limits only apply to email providers' });
      return;
    }

    await storage.updateIntegrationById(integrationId, { dailyLimit } as any);

    // Notify frontend of the change
    const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
    wsSync.notifySettingsUpdated(userId);

    console.log(`[Integrations] User ${userId} updated daily limit for ${integrationId} to ${dailyLimit}`);
    res.json({ success: true, integrationId, dailyLimit });
  } catch (error) {
    console.error('Error updating daily limit:', error);
    res.status(500).json({ error: 'Failed to update daily limit' });
  }
});
export default router;

