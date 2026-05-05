import { storage } from '@shared/lib/storage/storage.js';
import { db } from '@shared/lib/db/db.js';
import { integrations } from '@audnix/shared';
import { eq, and } from 'drizzle-orm';
import { imapIdleManager } from './imap-idle-manager.js';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';

export class SpamMonitorService {
  /**
   * Scan spam folders for all connected mailboxes
   */
  async scanAllSpamFolders(): Promise<void> {
    console.log('[SpamMonitor] 🔍 Starting autonomous spam folder sweep...');
    const emailProviders = ['gmail', 'outlook', 'custom_email'];
    
    for (const provider of emailProviders) {
      const activeIntegrations = await storage.getIntegrationsByProvider(provider);
      if (!activeIntegrations) continue;

      for (const integration of activeIntegrations) {
        if (!integration.connected) continue;
        await this.scanIntegrationSpam(integration);
      }
    }
  }

  /**
   * Scan a specific integration's spam folder
   */
  async scanIntegrationSpam(integration: any): Promise<void> {
    try {
      // Find the spam folder name (often [Gmail]/Spam or Junk)
      const folderNames = await imapIdleManager.getAvailableFolders(integration.id);
      const spamFolder = folderNames.find(f => 
        f.toLowerCase().includes('spam') || 
        f.toLowerCase().includes('junk')
      );

      if (!spamFolder) {
        console.warn(`[SpamMonitor] No spam folder found for mailbox ${integration.id}`);
        return;
      }

      // Check for messages in the last 24h
      const messages = await imapIdleManager.getRecentMessages(integration.id, spamFolder, 24);
      
      // Look for our tracking ID or specific patterns in the body/headers
      for (const msg of messages) {
        const trackingId = this.extractTrackingId(msg);
        if (trackingId) {
          const { messages: msgSchema } = await import('@audnix/shared');
          const [dbMsg] = await db.select().from(msgSchema).where(eq(msgSchema.trackingId, trackingId)).limit(1);
          
          if (dbMsg && dbMsg.leadId) {
            console.warn(`[SpamMonitor] ⚠️ Detected outreach in Spam for lead ${dbMsg.leadId} (Integration: ${integration.id})`);
            await this.applySpamThrottle(integration, dbMsg.leadId, dbMsg.userId);
          }
        }
      }
    } catch (err: any) {
      console.error(`[SpamMonitor] Error scanning ${integration.id}:`, err.message);
    }
  }

  /**
   * Extract tracking ID from message
   */
  private extractTrackingId(message: any): string | null {
    const body = (message.body || '').toLowerCase();
    const headers = message.headers || {};
    
    // Check header first
    const headerId = headers['x-audnix-id'];
    if (headerId) return headerId;

    // Check tracking pixel URL pattern: audnix.ai/t/[ID]
    const match = body.match(/audnix\.ai\/t\/([a-z0-9]+)/);
    return match ? match[1] : null;
  }

  /**
   * Detect if a message in the spam folder was sent by us (deprecated, using extractTrackingId)
   */
  private isOurOutreach(message: any): boolean {
    return !!this.extractTrackingId(message);
  }

  /**
   * Apply a protective throttle (not a pause) when spam is detected
   */
  private async applySpamThrottle(integration: any, leadId: string, userId: string): Promise<void> {
    const { calculateReputationScore } = await import('./reputation-monitor.js');
    
    // 1. Record a 'spam' bounce event to let the reputation monitor handle it naturally
    const { bounceHandler } = await import('./bounce-handler.js');
    await bounceHandler.recordBounce({
      userId,
      leadId,
      integrationId: integration.id,
      email: integration.accountType, // sender
      bounceType: 'spam',
      reason: `Autonomous IMAP Detection: Sent message found in Spam folder`
    });

    // 2. Trigger an immediate reputation recalculation
    const newScore = await calculateReputationScore(integration.id);

    // 3. Notify the user of the adaptive adjustment
    wsSync.notifyActivityUpdated(integration.userId, {
      type: 'mailbox_warning',
      integrationId: integration.id,
      message: `Spam signals detected. AI has applied protective throttling. Score: ${newScore}/100.`
    });
  }
}

export const spamMonitorService = new SpamMonitorService();
