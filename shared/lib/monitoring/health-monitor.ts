import { db } from '@shared/lib/db/db.js';
import { integrations } from '@audnix/shared';
import { eq, and, sql } from 'drizzle-orm';
import { decrypt } from '@shared/lib/crypto/encryption.js';

export interface HealthState {
  canSendInitial: boolean;
  canSendFollowUp: boolean;
  isHardPaused: boolean;
  status: 'connected' | 'warning' | 'failed';
  pauseUntil: Date | null;
}

/**
 * Mailbox Health Monitor (Production Hardened)
 * 
 * Automatically monitors SMTP/IMAP failure rates and implements
 * Smart Recovery logic to maximize outreach uptime while protecting domains.
 */
export class MailboxHealthMonitor {
  private static readonly FAILURE_THRESHOLD = 5; // failures before action

  /**
   * Record a connection or sending failure for an integration
   */
  static async recordFailure(integrationId: string, error: string): Promise<void> {
    try {
      const [integration] = await db.select().from(integrations).where(eq(integrations.id, integrationId)).limit(1);
      if (!integration) return;

      const currentFailures = (integration.failureCount || 0) + 1;
      const isFatal = this.isFatalError(error);
      
      // Update failure count and last error
      await db.update(integrations)
        .set({
          failureCount: currentFailures,
          lastHealthError: error,
          lastHealthCheckAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(integrations.id, integrationId));

      if (isFatal) {
        // FATAL: Credential or Auth error. Verify immediately.
        console.warn(`[HealthMonitor] ⚠️ Potential fatal error for ${integration.accountType}: ${error}. Verifying...`);
        const stillValid = await this.verifyConnection(integration);
        
        if (!stillValid) {
          await this.pauseMailbox(integration.id, `Fatal Auth Failure: ${error}. Retrying connection later.`, 'failed', 48);
          return;
        } else {
          console.log(`[HealthMonitor] ✨ Verification passed despite error. Treating as transient.`);
        }
      }

      // TRANSIENT (Throttling/Timeout): Soft pause if threshold reached
      if (currentFailures >= this.FAILURE_THRESHOLD) {
        await this.pauseMailbox(integration.id, `Rate limited or temporary timeout. Reducing intensity for 1 hour.`, 'warning', 1);
      }
    } catch (err) {
      console.error('[HealthMonitor] Error recording failure:', err);
    }
  }

  /**
   * Reset failure count on successful connection/send
   */
  static async recordSuccess(integrationId: string): Promise<void> {
    try {
      await db.update(integrations)
        .set({
          failureCount: 0,
          healthStatus: 'connected',
          lastHealthCheckAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(integrations.id, integrationId));
    } catch (err) {
      console.error('[HealthMonitor] Error recording success:', err);
    }
  }

  /**
   * Differentiate between Fatal (Auth/Credentials) and Transient (Network/Rate-limits)
   */
  private static isFatalError(error: string): boolean {
    const fatalKeywords = [
      'invalid_grant', 'credentials', 'forbidden', 'unauthorized', 
      'locked', 'disabled', 'password', 'auth', 'permission', 'refused'
    ];
    const lowerError = error.toLowerCase();
    return fatalKeywords.some(key => lowerError.includes(key));
  }

  /**
   * Perform a lightweight API call to check if the connection is still alive
   */
  private static async verifyConnection(integration: any): Promise<boolean> {
    try {
      if (integration.provider === 'gmail' || integration.provider === 'google') {
        const { gmailOAuth } = await import('@services/api-gateway/src/oauth/gmail.js');
        const token = await gmailOAuth.getValidToken(integration.userId, integration.accountType);
        if (!token) return false;
        await gmailOAuth.getGmailProfile(token);
        return true;
      } else if (integration.provider === 'outlook' || integration.provider === 'microsoft') {
        const { outlookOAuth } = await import('@services/api-gateway/src/oauth/outlook.js');
        const token = await outlookOAuth.getValidToken(integration.userId);
        if (!token) return false;
        // Basic profile call
        const response = await fetch('https://graph.microsoft.com/v1.0/me', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        return response.ok;
      }
      return true; // Default to true for unsupported providers to avoid false positives
    } catch (e) {
      return false;
    }
  }

  /**
   * Pause a mailbox with specific duration and status
   */
  private static async pauseMailbox(integrationId: string, reason: string, status: 'failed' | 'warning', hours: number): Promise<void> {
    const pauseUntil = new Date();
    pauseUntil.setHours(pauseUntil.getHours() + hours);

    console.log(`[HealthMonitor] ⏸️ ${status === 'failed' ? 'HARD' : 'SOFT'} PAUSE for ${integrationId} (${hours}h). Reason: ${reason}`);

    const updateData: any = {
      healthStatus: status,
      mailboxPauseUntil: pauseUntil,
      lastHealthError: reason,
      updatedAt: new Date()
    };
    
    // Keep connected=true so the integration doesn't disappear from UI.
    // User will see a health warning and can manually reconnect.
    updateData.connected = true;

    await db.update(integrations)
      .set(updateData)
      .where(eq(integrations.id, integrationId));
      
    // Notify user via WebSocket
    try {
      const [integration] = await db.select().from(integrations).where(eq(integrations.id, integrationId)).limit(1);
      if (integration) {
        const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
        wsSync.notifyNotification(integration.userId, {
          type: 'integration_error',
          title: status === 'failed' ? '🚨 Action Required' : '⚠️ Outreach Slowdown',
          message: `${integration.accountType}: ${reason}`,
          integrationId: integration.id
        });
      }
    } catch {}
  }

  /**
   * Multi-Tenant Safety: Verify if an integration is healthy AND owned by the user.
   * Returns a granular HealthState to support Soft/Hard throttling.
   */
  static async checkHealthState(integrationId: string, userId: string): Promise<HealthState> {
    const [integration] = await db.select().from(integrations)
      .where(and(eq(integrations.id, integrationId), eq(integrations.userId, userId)))
      .limit(1);
      
    if (!integration || !integration.connected) {
      return { canSendInitial: false, canSendFollowUp: false, isHardPaused: true, status: 'failed', pauseUntil: null };
    }

    const state: HealthState = {
      canSendInitial: true,
      canSendFollowUp: true,
      isHardPaused: false,
      status: (integration.healthStatus as 'connected' | 'warning' | 'failed') || 'connected',
      pauseUntil: integration.mailboxPauseUntil ? new Date(integration.mailboxPauseUntil) : null
    };

    if (state.pauseUntil && new Date() < state.pauseUntil) {
      if (state.status === 'failed') {
        // HARD PAUSE: Halt all outbound entirely
        state.canSendInitial = false;
        state.canSendFollowUp = false;
        state.isHardPaused = true;
      } else if (state.status === 'warning') {
        // SOFT PAUSE: Halt new leads, but keep pushing follow-ups
        state.canSendInitial = false;
        state.canSendFollowUp = true;
      }
    }

    return state;
  }
}
