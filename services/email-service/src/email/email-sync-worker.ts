import { storage } from '@shared/lib/storage/storage.js';
import { decrypt } from '@shared/lib/crypto/encryption.js';
import { importCustomEmails } from '@shared/lib/channels/email.js';
import { pagedEmailImport } from '@shared/lib/imports/paged-email-importer.js';
import { workerHealthMonitor } from '@shared/lib/monitoring/worker-health.js';
import { quotaService } from '@shared/lib/monitoring/quota-service.js';
import type { Integration, Lead } from '@audnix/shared';
import { Buffer } from 'buffer';
import { mailboxHealthService } from './mailbox-health-service.js';

/**
 * Email Sync Worker
 * 
 * Periodically syncs emails from user's connected mailboxes:
 * - Supports Custom IMAP, Gmail, and Outlook
 * - Imports new emails and creates leads
 * - Detects ghosted leads (no reply in 48+ hours)
 */

interface SyncResult {
  userId: string;
  imported: number;
  skipped: number;
  errors: number;
  ghostedDetected: number;
}

interface EmailData {
  from?: string;
  to?: string;
  subject?: string;
  text?: string;
  html?: string;
  date?: Date;
}

class EmailSyncWorker {
  private isRunning = false;
  private isSyncing = false;
  private syncTimeout: NodeJS.Timeout | null = null;
  private readonly SYNC_INTERVAL_MS = 3600000; // 1 hour - Real-time sync is now handled by IMAP IDLE.
  private readonly GHOSTED_THRESHOLD_HOURS = 48;

  /**
   * Start the email sync worker
   */
  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    console.log('📬 Email sync worker started (1 hour interval)');

    this.scheduleNextSync();
  }

  private scheduleNextSync() {
    if (!this.isRunning) return;

    this.syncTimeout = setTimeout(async () => {
      if (this.isSyncing) return;

      if (quotaService.isRestricted()) {
        console.log('[EmailSync] Skipping sync: Database quota restricted');
        this.scheduleNextSync();
        return;
      }

      this.isSyncing = true;
      try {
        await this.syncAllUserEmails();
      } catch (e) {
        console.error('Error in email sync loop:', e);
      } finally {
        this.isSyncing = false;
        this.scheduleNextSync();
      }
    }, this.SYNC_INTERVAL_MS);
  }

  /**
   * Stop the worker
   */
  stop(): void {
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout);
      this.syncTimeout = null;
    }
    this.isRunning = false;
    console.log('📬 Email sync worker stopped');
  }

  async syncAllUserEmails(): Promise<void> {
    try {
      // 24/7 MODE: Sync logic moved to ImapIdleManager for real-time IDLE sync. 
      // This worker now primarily handles maintenance and secondary sync checks.
      const providers = ['gmail', 'outlook', 'custom_email']; // <--- ADDED 'custom_email'
      let integrations: Integration[] = [];

      // Renew real-time push subscriptions (Google/Outlook)
      try {
        const { PushNotificationService } = await import('./push-notification-service.js');
        await PushNotificationService.initializeAll();
      } catch (e) {
        console.error('[EmailSync] Push renewal failed:', e);
      }

      for (const provider of providers) {
        const found = await storage.getIntegrationsByProvider(provider);
        if (found) integrations = [...integrations, ...found];
      }

      for (const integration of integrations) {
        if (!integration.connected) continue;
        
        // ghosted lead detection (maintenance)
        await this.detectGhostedLeads(integration.userId);
      }
      workerHealthMonitor.recordSuccess('email-sync-worker');
    } catch (error: any) {
      quotaService.reportDbError(error);
      workerHealthMonitor.recordError('email-sync-worker', error?.message || 'Unknown error');
    }
  }

  /**
   * Sync emails for a specific user
   */
  async syncUserEmails(userId: string, integration: Integration, limit: number = 5000): Promise<SyncResult> {
    const result: SyncResult = { userId, imported: 0, skipped: 0, errors: 0, ghostedDetected: 0 };

    try {
      if (integration.provider === 'gmail') {
        const syncRes = await this.syncGmailMessages(userId, integration, limit);
        result.imported += syncRes.imported || 0;
        result.skipped += syncRes.skipped || 0;
        result.errors += syncRes.errors || 0;
      } else if (integration.provider === 'outlook') {
        const syncRes = await this.syncOutlookMessages(userId, integration, limit);
        result.imported += syncRes.imported || 0;
        result.skipped += syncRes.skipped || 0;
        result.errors += syncRes.errors || 0;
      } else if (integration.provider === 'custom_email') {
        const { imapIdleManager } = await import('./imap-idle-manager.js');
        const syncRes = await imapIdleManager.syncHistoricalEmails(userId, integration.id, limit);
        result.imported += syncRes.count || 0;
        if (!syncRes.success) result.errors++;
      }

      if (result.imported > 0) {
        const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
        // Notify of the general update with provider context
        wsSync.notifyMessagesUpdated(userId, { 
          event: 'INSERT', 
          count: result.imported,
          provider: integration.provider,
          integrationId: integration.id,
          timestamp: new Date().toISOString()
        });
        wsSync.notifyActivityUpdated(userId, { 
          type: 'email_sync', 
          count: result.imported,
          integrationId: integration.id,
          provider: integration.provider
        });
      }

      result.ghostedDetected = await this.detectGhostedLeads(userId);
      return result;
    } catch (error: any) {
      const errorMsg = error.message || 'Unknown sync error';
      console.error(`Sync error for user ${userId}:`, errorMsg);
      
      if (mailboxHealthService.isMailboxError(errorMsg)) {
        await mailboxHealthService.handleMailboxFailure(integration, errorMsg);
      }
      
      result.errors++;
      return result;
    }
  }

  /**
   * Removed syncCustomMessages - now handled by ImapIdleManager
   */

  /**
   * Fetch latest emails using Gmail API
   */
  private async syncGmailMessages(userId: string, integration: Integration, limit: number): Promise<Partial<SyncResult>> {
    const res = { imported: 0, skipped: 0, errors: 0 };
    try {
      const { GmailOAuth } = await import('@services/api-gateway/src/oauth/gmail.js');
      const gmailOAuth = new GmailOAuth();
      const emailAddress = integration.accountType || undefined;
      const accessToken = await gmailOAuth.getValidToken(userId, emailAddress);

      if (!accessToken) {
        throw new Error("Failed to get valid access token for Gmail sync");
      }

      const fetchMessages = async (q: string) => {
        const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50&q=${encodeURIComponent(q)}`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            throw new Error(`Gmail API authentication failed: ${response.status} ${response.statusText}`);
          }
          return [];
        }
        const data = await response.json() as any;
        return data.messages || [];
      };

      const [inboxList, sentList] = await Promise.all([
        fetchMessages('label:INBOX is:unread'),
        fetchMessages('label:SENT')
      ]);

      const processMsgList = async (list: any[], direction: 'inbound' | 'outbound') => {
        const fullMessages = await Promise.all(list.map(async (m: any) => {
          const detailRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
          });
          if (!detailRes.ok) return null;
          const detail = await detailRes.json() as any;

          const getHeader = (name: string) => detail.payload.headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value;

          let htmlContent = '';
          const htmlPart = detail.payload.parts?.find((p: any) => p.mimeType === 'text/html');
          if (htmlPart && htmlPart.body && htmlPart.body.data) {
            htmlContent = Buffer.from(htmlPart.body.data, 'base64url').toString('utf8');
          } else if (detail.payload.body?.data) {
            htmlContent = Buffer.from(detail.payload.body.data, 'base64url').toString('utf8');
          }

          return {
            from: getHeader('from'),
            to: getHeader('to'),
            subject: getHeader('subject'),
            text: detail.snippet,
            date: new Date(parseInt(detail.internalDate)),
            html: htmlContent
          };
        }));

        const validMsg = fullMessages.filter(Boolean) as any[];
        return await pagedEmailImport(userId, validMsg, () => { }, direction);
      };

      const inbound = await processMsgList(inboxList, 'inbound');
      const outbound = await processMsgList(sentList, 'outbound');

      res.imported = inbound.imported + outbound.imported;
      res.skipped = inbound.skipped + outbound.skipped;
      res.errors = inbound.errors.length + outbound.errors.length;
    } catch (e) {
      console.error(`Gmail sync error for user ${userId}:`, e);
      res.errors++;
    }
    return res;
  }

  /**
   * Fetch latest emails using Microsoft Graph API
   */
  private async syncOutlookMessages(userId: string, integration: Integration, limit: number): Promise<Partial<SyncResult>> {
    const res = { imported: 0, skipped: 0, errors: 0 };
    try {
      const { OutlookOAuth } = await import('@services/api-gateway/src/oauth/outlook.js');
      const outlookOAuth = new OutlookOAuth();
      const accessToken = await outlookOAuth.getValidToken(userId);

      if (!accessToken) {
        throw new Error("Failed to get valid access token for Outlook sync");
      }

      const fetchFolder = async (folder: string, direction: 'inbound' | 'outbound') => {
        const response = await fetch(`https://graph.microsoft.com/v1.0/me/mailFolders/${folder}/messages?$top=50&$select=subject,from,toRecipients,bodyPreview,body,receivedDateTime`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            throw new Error(`Outlook API authentication failed: ${response.status} ${response.statusText}`);
          }
          return { imported: 0, skipped: 0, errors: [] };
        }
        const data = await response.json() as any;
        return data.value ? await pagedEmailImport(userId, data.value.map((m: any) => ({
          from: m.from?.emailAddress?.address,
          to: m.toRecipients?.[0]?.emailAddress?.address,
          subject: m.subject,
          text: m.bodyPreview,
          html: m.body?.content,
          date: new Date(m.receivedDateTime)
        })), () => { }, direction) : { imported: 0, skipped: 0, errors: [] };
      };

      const [inbound, outbound] = await Promise.all([
        fetchFolder('inbox', 'inbound'),
        fetchFolder('sentitems', 'outbound')
      ]);

      res.imported = inbound.imported + outbound.imported;
      res.skipped = inbound.skipped + outbound.skipped;
      res.errors = inbound.errors.length + outbound.errors.length;
    } catch (e) {
      console.error(`Outlook sync error for user ${userId}:`, e);
      res.errors++;
    }
    return res;
  }

  async detectGhostedLeads(userId: string): Promise<number> {
    try {
      const leads: Lead[] = await storage.getLeads({ userId });
      const now = new Date();
      const threshold = this.GHOSTED_THRESHOLD_HOURS * 60 * 60 * 1000;
      let count = 0;

      for (const lead of leads) {
        if (['cold', 'not_interested', 'converted'].includes(lead.status)) continue;

        // CHECK: Only auto-expire (move to cold) if autonomous mode is ON
        const user = await storage.getUserById(userId);
        if ((user?.config as any)?.autonomousMode === false) continue;

        if (lead.lastMessageAt) {
          if (now.getTime() - new Date(lead.lastMessageAt).getTime() > threshold) {
            await storage.updateLead(lead.id, {
              status: 'cold',
              metadata: { ...(lead.metadata as object), ghostedDetectedAt: now.toISOString() }
            });
            count++;
          }
        }
      }
      return count;
    } catch (e) { return 0; }
  }

  getStatus() {
    return { isRunning: this.isRunning, syncIntervalMs: this.SYNC_INTERVAL_MS };
  }
}

export const emailSyncWorker = new EmailSyncWorker();







