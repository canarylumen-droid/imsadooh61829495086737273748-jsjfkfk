import { storage } from '@shared/lib/storage/storage.js';
import { db } from '@shared/lib/db/db.js';
import { integrations } from '@audnix/shared';
import { eq, and, gte, sql } from 'drizzle-orm';
import { imapIdleManager } from './imap-idle-manager.js';
import { clusterSync } from '@shared/lib/realtime/redis-pubsub.js';

export class SpamMonitorService {
  private scanRunning = false;

  /**
   * Scan spam folders for all connected mailboxes
   */
  async scanAllSpamFolders(): Promise<void> {
    if (this.scanRunning) {
      console.log('[SpamMonitor] Scan already running, skipping.');
      return;
    }
    this.scanRunning = true;
    console.log('[SpamMonitor] Starting spam folder sweep...');

    try {
      const emailProviders = ['gmail', 'outlook', 'custom_email'];

      for (const provider of emailProviders) {
        const activeIntegrations = await storage.getIntegrationsByProvider(provider);
        if (!activeIntegrations) continue;

        // Process integrations in parallel (not sequentially)
        await Promise.allSettled(
          activeIntegrations
            .filter((i: any) => i.connected)
            .map((integration: any) => this.scanIntegrationSpam(integration))
        );
      }
    } finally {
      this.scanRunning = false;
    }
  }

  /**
   * Scan a specific integration's spam folder
   */
  async scanIntegrationSpam(integration: any): Promise<void> {
    try {
      // Check if IMAP connection is alive first
      const isConnected = imapIdleManager.isConnectionAlive?.(integration.id);
      if (isConnected === false) {
        // Don't log — too noisy for disconnected mailboxes
        return;
      }

      // Find the spam folder name (often [Gmail]/Spam or Junk E-mail)
      const folderNames = await imapIdleManager.getAvailableFolders(integration.id);
      if (!folderNames || folderNames.length === 0) return;

      const spamFolder = folderNames.find(f =>
        f.toLowerCase().includes('spam') ||
        f.toLowerCase().includes('junk')
      );

      if (!spamFolder) return;

      // Check for messages in the last 24h
      const messages = await imapIdleManager.getRecentMessages(integration.id, spamFolder, 24);
      if (!messages || messages.length === 0) return;

      console.log(`[SpamMonitor] Found ${messages.length} messages in spam folder for ${integration.id}`);

      let spamCount = 0;

      // Look for our tracking ID or specific patterns in the body/headers
      for (const msg of messages) {
        const trackingId = this.extractTrackingId(msg);
        if (trackingId) {
          const { messages: msgSchema } = await import('@audnix/shared');
          const [dbMsg] = await db.select().from(msgSchema).where(eq(msgSchema.trackingId, trackingId)).limit(1);

          if (dbMsg && dbMsg.leadId) {
            spamCount++;
            // Update email_tracking to mark placement as spam
            const { emailTracking: emailTrackingSchema } = await import('@audnix/shared');
            await db.update(emailTrackingSchema)
              .set({ 
                placement: 'spam',
                placementUpdatedAt: new Date()
              })
              .where(eq(emailTrackingSchema.token, trackingId));
            await this.applySpamThrottle(integration, dbMsg.leadId, dbMsg.userId);
          }
        }
      }

      // Also check for emails FROM our domain in spam (delivery feedback)
      const { emailTracking } = await import('@audnix/shared');
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // Check if any of our recently sent emails appear in spam by subject match
      const recentSent = await db.select({
        id: emailTracking.id,
        recipientEmail: emailTracking.recipientEmail,
        subject: emailTracking.subject,
        leadId: emailTracking.leadId,
        userId: emailTracking.userId,
      })
        .from(emailTracking)
        .where(and(
          eq(emailTracking.integrationId, integration.id),
          gte(emailTracking.sentAt, twentyFourHoursAgo)
        ))
        .limit(50);

      if (recentSent.length > 0) {
        for (const sent of recentSent) {
          const inSpam = messages.some((m: any) => {
            const subj = (m.subject || '').toLowerCase();
            return subj && sent.subject && subj === sent.subject.toLowerCase();
          });

          if (inSpam && sent.leadId) {
            spamCount++;
            // Update email_tracking to mark placement as spam
            const { emailTracking: emailTrackingSchema } = await import('@audnix/shared');
            await db.update(emailTrackingSchema)
              .set({ 
                placement: 'spam',
                placementUpdatedAt: new Date()
              })
              .where(eq(emailTrackingSchema.id, sent.id));
            await this.applySpamThrottle(integration, sent.leadId, sent.userId);
          }
        }
      }

      if (spamCount > 0) {
        console.warn(`[SpamMonitor] Detected ${spamCount} emails in spam for mailbox ${integration.id}`);

        // Notify user via Redis → WebSocket
        await clusterSync.notifyActivityUpdated(integration.userId, {
          type: 'spam_detected',
          integrationId: integration.id,
          spamCount,
          message: `${spamCount} email(s) found in spam folder. Sending throttled.`
        }).catch(() => {});

        // Invalidate dashboard stats
        await clusterSync.notifyStatsCacheInvalidate(integration.userId).catch(() => {});
        // Push deliverability update for real-time inbox-placement refresh
        await clusterSync.notifyDeliverabilityUpdated(integration.userId, {
          integrationId: integration.id,
          spamCount,
          source: 'spam_monitor'
        }).catch(() => {});
      }
    } catch (err: any) {
      // Only log unexpected errors, not connection issues
      if (!err.message?.includes('ECONNRESET') && !err.message?.includes('ETIMEOUT')) {
        console.error(`[SpamMonitor] Error scanning ${integration.id}: ${err.message}`);
      }
    }
  }

  /**
   * Extract tracking ID from message — tries multiple sources
   */
  private extractTrackingId(message: any): string | null {
    // 1. Check custom header (most reliable — survives body stripping)
    const headers = message.headers || {};
    const headerId = headers['x-audnix-id'] || headers['X-Audnix-Id'];
    if (headerId) return headerId;

    // 2. Check Message-ID header for our domain pattern
    const messageId = headers['message-id'] || headers['Message-ID'] || '';
    // Extract tracking token from Message-ID (matches any domain, not just audnixai.com)
    const msgIdMatch = messageId.match(/<([^>]+)@[^>]+>/);
    if (msgIdMatch) return msgIdMatch[1];

    // 3. Check body for tracking pixel URL (may be stripped in spam)
    const body = (message.body || message.text || '').toLowerCase();
    if (body) {
      const pixelMatch = body.match(/\/api\/email-tracking\/track\/open\/([a-zA-Z0-9_-]+)/);
      if (pixelMatch) return pixelMatch[1];

      const clickMatch = body.match(/\/api\/email-tracking\/track\/click\/([a-zA-Z0-9_-]+)/);
      if (clickMatch) return clickMatch[1];

      // 4. Check for our unsubscribe link pattern (always present in our emails)
      const unsubMatch = body.match(/\/api\/unsubscribe\/([a-zA-Z0-9_-]+)/);
      if (unsubMatch) return unsubMatch[1];
    }

    // 5. Check subject for our campaign patterns
    const subject = (message.subject || '').toLowerCase();
    if (subject.includes('audnix') || subject.includes('replyflow')) {
      return `subject-match:${subject.substring(0, 50)}`;
    }

    return null;
  }

  /**
   * Apply a protective throttle when spam is detected
   */
  private async applySpamThrottle(integration: any, leadId: string, userId: string): Promise<void> {
    try {
      const { calculateReputationScore } = await import('./reputation-monitor.js');
      const { leads: leadsSchema } = await import('@audnix/shared');

      const [leadRecord] = await db.select().from(leadsSchema).where(eq(leadsSchema.id, leadId)).limit(1);
      const leadEmail = leadRecord?.email || 'unknown';

      // Record spam bounce event
      const { bounceHandler } = await import('./bounce-handler.js');
      await bounceHandler.recordBounce({
        userId,
        leadId,
        integrationId: integration.id,
        email: leadEmail,
        bounceType: 'spam',
        reason: `Spam folder detected: message found in Spam/Junk folder`
      });

      // Trigger immediate reputation recalculation
      const newScore = await calculateReputationScore(integration.id);

      // Notify user
      await storage.createNotification({
        userId,
        type: 'email_bounce',
        title: 'Spam Detection',
        message: `An email to ${leadEmail} was found in spam. Sending throttled. Score: ${newScore}/100.`,
        actionUrl: `/dashboard/warmup`
      });
    } catch (err: any) {
      console.error(`[SpamMonitor] Failed to apply throttle: ${err.message}`);
    }
  }
}

export const spamMonitorService = new SpamMonitorService();
