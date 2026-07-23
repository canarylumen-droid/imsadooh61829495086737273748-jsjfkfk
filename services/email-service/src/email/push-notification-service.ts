import { gmailOAuth } from '@services/api-gateway/src/oauth/gmail.js';
import { OutlookOAuth } from '@services/api-gateway/src/oauth/outlook.js';
import { storage } from '@shared/lib/storage/storage.js';
import { processInboundMessageWithAnalysis } from '@services/brain-worker/src/ai-lib/analyzers/inbound-message-analyzer.js';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';
import { socketService } from '@shared/lib/realtime/socket-service.js';
import type { Message } from '@audnix/shared';

export class PushNotificationService {
  private static outlookOAuth = new OutlookOAuth();

  /**
   * Initialize push notifications for all active OAuth accounts
   */
  static async initializeAll(): Promise<void> {
    const googleAccounts = await storage.getOAuthAccountsByProvider('google');
    const outlookAccounts = await storage.getOAuthAccountsByProvider('outlook');

    console.log(`[PushService] Initializing push for ${googleAccounts.length} Google and ${outlookAccounts.length} Outlook accounts`);

    // Initialize Google accounts in parallel
    await Promise.allSettled(googleAccounts.map(async (account) => {
      try {
        await gmailOAuth.watch(account.userId, account.providerAccountId || '');
        socketService.emitToUser(account.userId, 'sync_status', {
            provider: 'google',
            status: 'connected',
            realtime: true,
            method: 'pubsub'
        });
      } catch (err) {
        console.error(`[PushService] Failed to watch Google ${account.providerAccountId}:`, err);
      }
    }));

    // Initialize Outlook accounts in parallel
    await Promise.allSettled(outlookAccounts.map(async (account) => {
      try {
        await this.outlookOAuth.createSubscription(account.userId);
        socketService.emitToUser(account.userId, 'sync_status', {
            provider: 'outlook',
            status: 'connected',
            realtime: true,
            method: 'webhook'
        });
      } catch (err) {
        console.error(`[PushService] Failed to subscribe Outlook ${account.providerAccountId}:`, err);
      }
    }));
  }

  /**
   * Handle incoming Gmail Pub/Sub notification
   */
  static async handleGmailPush(data: { emailAddress: string; historyId: string }): Promise<void> {
    const { emailAddress, historyId } = data;
    console.log(`[PushService] 🔔 Gmail Push received for ${emailAddress} (History: ${historyId})`);

    // Find the user for this email with an optimized query
    const account = await storage.getOAuthAccountByProviderAccountId('google', emailAddress);
    
    if (!account) {
      console.warn(`[PushService] No account found for push email ${emailAddress}`);
      return;
    }

    // Trigger immediate sync/analysis
    // For Gmail, we usually need to fetch the history or just list messages
    const messages = await gmailOAuth.listMessages(account.userId, 5);
    if (messages.length > 0) {
      const latest = await gmailOAuth.getMessageDetails(account.userId, messages[0].id);
      
      // Map to internal message format and process
      const snippet = latest.snippet || "";
      const lead = await storage.getLeadByEmail(emailAddress, account.userId);
      
      if (lead) {
          const analysis = await processInboundMessageWithAnalysis(lead.id, snippet, 'email');
          
          // Notify UI ASAP
          wsSync.notifyMessagesUpdated(account.userId, {
              leadId: lead.id,
              message: {
                  id: latest.id,
                  content: snippet,
                  direction: 'inbound',
                  createdAt: new Date()
              },
              arrival: 'push'
          });
      }
    }
  }

  /**
   * Handle incoming Outlook Webhook notification
   */
  static async handleOutlookPush(userId: string, resourceId: string): Promise<void> {
    console.log(`[PushService] 🔔 Outlook Push received for user ${userId} (Resource: ${resourceId})`);

    const accessToken = await this.outlookOAuth.getValidToken(userId);
    if (!accessToken) return;

    // Fetch the specific message
    const response = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${resourceId}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (response.ok) {
      const message = await response.json();
      const fromEmail = message.from?.emailAddress?.address;
      const body = message.bodyPreview || message.body?.content || "";

      const lead = await storage.getLeadByEmail(fromEmail, userId);
      if (lead) {
        const analysis = await processInboundMessageWithAnalysis(lead.id, body, 'email');
        
        wsSync.notifyMessagesUpdated(userId, {
            leadId: lead.id,
            message: {
                id: resourceId,
                content: body,
                direction: 'inbound',
                createdAt: new Date()
            },
            arrival: 'push'
        });
      }
    }
  }
}








