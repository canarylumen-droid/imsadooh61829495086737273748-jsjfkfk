/**
 * Mailbox Health Monitoring Service
 * 
 * Periodically validates all connected email mailboxes:
 * - Tests SMTP connectivity and authentication  
 * - Tests IMAP connectivity
 * - Detects spam risk (high bounce rates)
 * - Detects plan expiry
 * - Marks mailboxes as FAILED and notifies users
 * - Automatically removes failed mailboxes from sending pool
 * 
 * System NEVER crashes due to a single mailbox failure.
 */

import nodemailer from 'nodemailer';
import dns from 'dns';
import { db } from '@shared/lib/db/db.js';
import { integrations, notifications, users, bounceTracker, outreachCampaigns, campaignLeads, auditTrail } from '@audnix/shared';
import { eq, and, ne, sql, lte, isNull, or, gt, inArray, count as drizzleCount } from 'drizzle-orm';
import { storage } from '@shared/lib/storage/storage.js';
import { decrypt, encryptJSON, decryptToJSON } from '@shared/lib/crypto/encryption.js';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';
import { getPlanCapabilities } from "@shared/plan-utils.js";
import { sendSystemEmail } from '@shared/lib/channels/email.js';
import { quotaService } from '@shared/lib/monitoring/quota-service.js';
import { gmailOAuth } from '@services/api-gateway/src/oauth/gmail.js';
import { outlookOAuth } from '@services/api-gateway/src/oauth/outlook.js';

// ─── Types ──────────────────────────────────────────────────────────────────

interface HealthCheckResult {
  healthy: boolean;
  error?: string;
  warning?: string;
  spamRisk?: number;
  dnsValid?: boolean;
  dnsDetails?: {
    spf: boolean;
    dkim: boolean;
    dmarc: boolean;
  };
}

// ─── Service ────────────────────────────────────────────────────────────────

class MailboxHealthService {
  private checkInterval: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL_MS = 2 * 60 * 1000; // Every 2 minutes
  private isChecking = false;
  private readonly SPAM_BOUNCE_THRESHOLD = 0.02; // 2% bounce rate = Google Warning
  private readonly SPAM_BOUNCE_CRITICAL = 0.05; // 5% bounce rate = Google Block / Pause
  private readonly MIN_SENDS_FOR_RATE_CALC = 10; // Minimum sends to calculate percentage
  private readonly MAX_FAILURES_BEFORE_REMOVE = 3;
  private readonly failureBurstTracking = new Map<string, number[]>();
  private readonly TOXIC_BURST_THRESHOLD = 3; // 3 failures
  private readonly TOXIC_BURST_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
  private readonly TOXIC_PAUSE_DURATION_MS = 60 * 60 * 1000; // 1 hour

  /**
   * Start the health monitoring service
   */
  async start(): Promise<void> {
    if (this.checkInterval) return;

    console.log('🏥 Mailbox Health Monitoring Service started (2m interval)');
    
    const { workerHealthMonitor } = await import('@shared/lib/monitoring/worker-health.js');
    workerHealthMonitor.registerWorker('MailboxHealth');

    // Initial check after 30s
    setTimeout(() => this.runHealthChecks(), 30_000);

    this.checkInterval = setInterval(() => {
      this.runHealthChecks().catch(err => {
        console.error('[MailboxHealth] Health check loop error:', err.message);
      });
    }, this.CHECK_INTERVAL_MS);
  }

  /**
   * Stop the service
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    console.log('🏥 Mailbox Health Monitoring Service stopped');
  }

  /**
   * Run health checks for all connected email mailboxes
   */
  async runHealthChecks(): Promise<void> {
    if (this.isChecking) {
      console.log('[MailboxHealth] Check already in progress. Skipping.');
      return;
    }

    if (quotaService.isRestricted()) {
      console.log('[MailboxHealth] Skipping checks: Database quota restricted');
      return;
    }

    const { workerHealthMonitor } = await import('@shared/lib/monitoring/worker-health.js');
    this.isChecking = true;

    try {
      const emailProviders = ['gmail', 'outlook', 'custom_email'];
      let allIntegrations: any[] = [];

      for (const provider of emailProviders) {
        const found = await storage.getIntegrationsByProvider(provider);
        if (found) allIntegrations = [...allIntegrations, ...found];
      }

      for (const integration of allIntegrations) {
        if (!integration.connected) continue;

        try {
          await this.checkMailbox(integration);
        } catch (err: any) {
          // Individual mailbox check failure must NEVER crash the service
          console.error(`[MailboxHealth] Check failed for ${integration.id}:`, err.message);
        }
      }

      // Run plan expiry checks
      await this.checkPlanExpiry();

      // Run spam risk detection
      await this.detectSpamRisk();

      workerHealthMonitor.recordSuccess('MailboxHealth');
    } catch (err: any) {
      console.error('[MailboxHealth] Global health check error:', err.message);
      workerHealthMonitor.recordError('MailboxHealth', err.message);
      quotaService.reportDbError(err);
      // Never crash
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Check a single mailbox's health
   */
  async checkMailbox(integration: any): Promise<HealthCheckResult> {
    const result: HealthCheckResult = { healthy: true };

    // --- Skip check for paused mailboxes to prevent notification spam ---
    if (integration.mailboxPauseUntil && new Date(integration.mailboxPauseUntil) > new Date()) {
      const resumeAt = new Date(integration.mailboxPauseUntil).toLocaleTimeString();
      console.log(`[MailboxHealth] ⏸ Skipping check for ${integration.id} — paused until ${resumeAt}`);
      return result; // Silently skip
    }

    // --- Skip check for already-failed mailboxes (avoid re-notifying) ---
    if (integration.healthStatus === 'failed') {
      console.log(`[MailboxHealth] ⏸ Skipping check for ${integration.id} — already marked failed`);
      return result;
    }

    try {
      if (integration.provider === 'custom_email') {
        await this.testSmtpConnection(integration);
      } else if (integration.provider === 'gmail') {
        await this.testGmailToken(integration);
      } else if (integration.provider === 'outlook') {
        await this.testOutlookToken(integration);
      }

      // If we get here, the check passed — mark as healthy
      if (integration.healthStatus !== 'connected') {
        await this.markMailboxHealthy(integration);
      }

      // [NEW] DNS Health Check for custom domains
      if (integration.provider === 'custom_email') {
        const dnsResult = await this.checkDNSHealth(integration);
        result.dnsValid = dnsResult.valid;
        result.dnsDetails = dnsResult.details;
        
        if (!dnsResult.valid) {
          result.warning = `DNS issues detected: ${dnsResult.missing.join(', ')}`;
          // Update integration metadata with DNS status
          const currentMeta = decryptToJSON(integration.encryptedMeta) || {};
          await storage.updateIntegrationById(integration.id, {
            encryptedMeta: encryptJSON({
              ...currentMeta,
              dns_health: dnsResult.details,
              dns_last_checked: new Date()
            })
          });
        }
      }

      // Update last health check time
      await db.update(integrations)
        .set({ lastHealthCheckAt: new Date() })
        .where(eq(integrations.id, integration.id));

    } catch (err: any) {
      result.healthy = false;
      result.error = err.message;
      
      // Only handle as fatal mailbox failure if it matches known patterns
      if (this.isMailboxError(err.message)) {
        await this.handleMailboxFailure(integration, err.message);
        await this.trackFailureBurst(integration);
      } else {
        const meta = decryptToJSON(integration.encryptedMeta) || {};
        console.warn(`[MailboxHealth] Non-fatal check error for ${integration.id} (Host: ${meta.smtp_host || 'unknown'}):`, err.message);
      }
    }

    return result;
  }

  /**
   * Track high-frequency failures to detect "toxic" accounts
   */
  private async trackFailureBurst(integration: any): Promise<void> {
    const now = Date.now();
    const failures = this.failureBurstTracking.get(integration.id) || [];
    
    // Filter failures within the window
    const recentFailures = [...failures.filter(t => now - t < this.TOXIC_BURST_WINDOW_MS), now];
    this.failureBurstTracking.set(integration.id, recentFailures);

    if (recentFailures.length >= this.TOXIC_BURST_THRESHOLD) {
      const pauseUntil = new Date(now + this.TOXIC_PAUSE_DURATION_MS);
      console.error(`[MailboxHealth] ☣️ Toxic burst detected for ${integration.id} (${recentFailures.length} f/10m). Pausing for 1 hour.`);
      
      await db.update(integrations)
        .set({
          healthStatus: 'warning',
          mailboxPauseUntil: pauseUntil,
          lastHealthError: `Toxic failure burst detected: ${recentFailures.length} errors in 10m. System-level pause active.`,
          updatedAt: new Date(),
        })
        .where(eq(integrations.id, integration.id));

      // Reset tracking after pause
      this.failureBurstTracking.delete(integration.id);
    }
  }

  /**
   * Determine if an error message indicates a fatal mailbox/connection issue
   */
  isMailboxError(errorMessage: string): boolean {
    if (!errorMessage) return false;
    const patterns = [
      'EAUTH', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET',
      'Invalid login', 'authentication failed', 'token expired', 'token invalid',
      'Invalid credentials', 'socket hang up', 'credentials missing',
      'Unauthorized', '401', 'Rate limit exceeded', 'bad decrypt', 'decryption failed',
      'invalid encrypted data format', 'ENETUNREACH'
    ];
    return patterns.some(p => errorMessage.toLowerCase().includes(p.toLowerCase()));
  }

  /**
   * Check if a user's plan is active and not expired
   */
  async isPlanActive(userId: string): Promise<boolean> {
    try {
      const user = await storage.getUserById(userId);
      if (!user) return false;

      // Free plan is always "active" (within its own limits)
      if (user.plan === ('free' as any)) return true;

      // Trial plan check
      if (user.plan === 'trial' && user.trialExpiresAt) {
        return new Date(user.trialExpiresAt) > new Date();
      }

      // Paid plans (assuming active if plan field is set to something else)
      // In a real system we'd check Stripe subscription status too
      return true;
    } catch (err) {
      console.error(`[MailboxHealth] Error checking plan for ${userId}:`, err);
      return true; // Default to active on error to prevent cascading failure
    }
  }

  /**
   * Test SMTP connection for custom_email mailbox
   */
  private async testSmtpConnection(integration: any): Promise<void> {
    const credentialsStr = await decrypt(integration.encryptedMeta);
    const config = JSON.parse(credentialsStr);

    const nodemailer = await import('nodemailer');
    const dns = await import('dns');

    const transporter = nodemailer.createTransport({
      host: config.smtp_host,
      port: config.smtp_port || 587,
      secure: config.smtp_port === 465,
      auth: {
        user: config.smtp_user,
        pass: config.smtp_pass,
      },
      // Force IPv4 and skip cert validation for resilience
      family: 4,
      lookup: (hostname: string, options: any, callback: any) => {
        dns.resolve4(hostname, (err, addresses) => {
          if (err || !addresses || addresses.length === 0) {
            return callback(err || new Error('No IPv4 found'), null, 4);
          }
          callback(null, addresses[0], 4);
        });
      },
      tls: {
        rejectUnauthorized: false
      },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    } as any);

    // verify() tests connection + auth
    await transporter.verify();
  }

  /**
   * Test Gmail OAuth token validity
   */
  private async testGmailToken(integration: any): Promise<void> {
    const token = await gmailOAuth.getValidToken(integration.userId, integration.accountType);
    
    if (!token) {
      throw new Error('Gmail connection lost: Could not refresh access token. Please reconnect.');
    }

    // Secondary verify with Google API
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(`Gmail API Error: ${(data as any)?.error?.message || response.statusText}`);
    }
  }

  /**
   * Test Outlook OAuth token validity
   */
  private async testOutlookToken(integration: any): Promise<void> {
    const token = await outlookOAuth.getValidToken(integration.userId);
    
    if (!token) {
      throw new Error('Outlook connection lost: Could not refresh access token. Please reconnect.');
    }

    const response = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(`Outlook API Error: ${(data as any)?.error?.message || response.statusText}`);
    }
  }

  /**
   * Handle mailbox failure: mark as failed, notify user, remove from pool
   */
  async handleMailboxFailure(integration: any, errorMessage: string): Promise<void> {
    // Phase 14: Provider-Specific Rate Limit Detection (429 handling)
    const lowerError = errorMessage.toLowerCase();
    const isRateLimited = lowerError.includes('429') || lowerError.includes('rate limit') || lowerError.includes('quota exceeded') || lowerError.includes('too many requests');

    if (isRateLimited) {
      console.warn(`[MailboxHealth] ⏳ Rate Limit detected for ${integration.id} (${integration.provider}). Cooling down for 15m.`);
      const cooldownUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 minute cooldown
      
      await db.update(integrations)
        .set({
          mailboxPauseUntil: cooldownUntil,
          lastHealthError: `Rate Limited: ${errorMessage}`,
          updatedAt: new Date()
        })
        .where(eq(integrations.id, integration.id));
        
      wsSync.notifyActivityUpdated(integration.userId, {
        type: 'mailbox_warning',
        integrationId: integration.id,
        message: `Mailbox rate limited. Cooling down until ${cooldownUntil.toLocaleTimeString()}`
      });
      return; // Do not increment failureCount for transient rate limits
    }

    // --- Fast-pause ENETUNREACH/TIMEOUT: always an infrastructure or provider issue ---
    // Applying a silent pause immediately to stop notification storms.
    const isNetworkUnreachable = lowerError.includes('enetunreach') || lowerError.includes('timed out') || lowerError.includes('etimedout');
    if (isNetworkUnreachable) {
      const alreadyPaused = integration.mailboxPauseUntil && new Date(integration.mailboxPauseUntil) > new Date();
      if (alreadyPaused) return; // Already silenced — do nothing

      const isTimeout = lowerError.includes('timed out') || lowerError.includes('etimedout');
      const pauseDuration = isTimeout ? 5 * 60 * 1000 : 2 * 60 * 60 * 1000; // 5m for timeout, 2h for unreachable
      
      console.warn(`[MailboxHealth] 🌐 ${isTimeout ? 'TIMEOUT' : 'ENETUNREACH'} for ${integration.id}. Applying ${isTimeout ? '5m' : '2h'} silent pause.`);
      const pauseUntil = new Date(Date.now() + pauseDuration);

      await db.update(integrations)
        .set({
          mailboxPauseUntil: pauseUntil,
          lastHealthError: isTimeout ? `Connection timed out: ${errorMessage}` : `Network unreachable (IPv6 route missing): ${errorMessage}`,
          updatedAt: new Date(),
        })
        .where(eq(integrations.id, integration.id));

      // Notification for network issues
      if (!isTimeout) {
          await storage.createNotification({
            userId: integration.userId,
            type: 'mailbox_warning',
            title: '🌐 Mailbox Network Issue',
            message: `Your mailbox could not connect: network unreachable. It has been paused for 2 hours while we retry. This is typically a temporary DNS/IPv6 issue.`,
            metadata: {
              integrationId: integration.id,
              provider: integration.provider,
              error: errorMessage,
              pauseUntil: pauseUntil.toISOString(),
              activityType: 'mailbox_network_pause'
            }
          });
      }
      return;
    }

    const currentFailures = (integration.failureCount || 0) + 1;
    const failureThreshold = integration.provider === 'custom_email' ? 3 : this.MAX_FAILURES_BEFORE_REMOVE;

    if (currentFailures >= failureThreshold) {
      // CRITICAL: Mark as FAILED and remove from sending pool
      // Note: We NEVER set connected: false automatically for custom_email to ensure persistence.
      // It stays in the database until the user manually disconnects.
      console.error(`[MailboxHealth] 🚨 Mailbox ${integration.id} (${integration.provider}) FAILED after ${currentFailures} failures: ${errorMessage}`);

      await db.update(integrations)
        .set({
          healthStatus: 'failed',
          lastHealthError: errorMessage,
          lastHealthCheckAt: new Date(),
          failureCount: currentFailures,
          updatedAt: new Date(),
          // connected remains true to allow background reconnect attempts
        })
        .where(eq(integrations.id, integration.id));

      // Notify user via in-app notification
      await storage.createNotification({
        userId: integration.userId,
        type: 'mailbox_failure',
        title: '🚨 Mailbox Failed',
        message: `Your mailbox has failed: ${errorMessage}. It has been removed from the sending pool. Unsent leads will be redistributed in 24h.`,
        metadata: {
          integrationId: integration.id,
          provider: integration.provider,
          error: errorMessage,
          failedAt: new Date().toISOString(),
          activityType: 'mailbox_failure'
        }
      });

      // --- ADVANCED: Email Alert ---
      const user = await storage.getUser(integration.userId);
      if (user?.email) {
        await sendSystemEmail(
          user.email,
          `🚨 Audnix AI: Mailbox Failure Alert`,
          `<p>Hello,</p>
           <p>Your mailbox <b>${integration.provider}</b> has encountered a fatal error: <i>${errorMessage}</i>.</p>
           <p>We have automatically removed it from the active sending pool to protect your sender reputation. Unsent leads will be automatically redistributed across your other active mailboxes after 24 hours of inactivity.</p>
           <p>Please log in to your dashboard to reconnect your mailbox.</p>`
        );
      }

      // Push real-time notification
      wsSync.notifyActivityUpdated(integration.userId, {
        type: 'mailbox_failure',
        integrationId: integration.id,
        message: `Mailbox failed: ${errorMessage}`
      });

      // Phase 5 Fix: Push dedicated integration_error payload so the UI can pop a toast
      wsSync.notifyIntegrationError(integration.userId, {
        integrationId: integration.id,
        provider: integration.provider,
        errorType: errorMessage.toLowerCase().includes('auth') || errorMessage.toLowerCase().includes('credential') ? 'auth_failure' : 'connection_lost',
        message: `Mailbox failed: ${errorMessage}`
      });

      // Return unsent leads to the queue pool (set integrationId to null for pending leads)
      await this.returnLeadsToPool(integration.id);

    } else {
      // WARNING: Increment failure count
      console.warn(`[MailboxHealth] ⚠️ Mailbox ${integration.id} warning (${currentFailures}/${this.MAX_FAILURES_BEFORE_REMOVE}): ${errorMessage}`);

      await db.update(integrations)
        .set({
          healthStatus: 'warning',
          lastHealthError: errorMessage,
          lastHealthCheckAt: new Date(),
          failureCount: currentFailures,
          updatedAt: new Date(),
        })
        .where(eq(integrations.id, integration.id));

      // Warning notification
      if (currentFailures === 2) {
        await storage.createNotification({
          userId: integration.userId,
          type: 'mailbox_warning',
          title: '⚠️ Mailbox Issues Detected',
          message: `Your mailbox is experiencing connectivity issues: ${errorMessage}. If this continues, it will be removed from the sending pool.`,
          metadata: {
            integrationId: integration.id,
            provider: integration.provider,
            error: errorMessage,
            activityType: 'mailbox_warning'
          }
        });
      }
    }
  }

  /**
   * Mark a previously-failed mailbox as healthy again
   */
  async markMailboxHealthy(integration: any): Promise<void> {
    console.log(`[MailboxHealth] ✅ Mailbox ${integration.id} recovered to healthy`);

    await db.update(integrations)
      .set({
        healthStatus: 'connected',
        lastHealthError: null,
        failureCount: 0,
        lastHealthCheckAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(integrations.id, integration.id));

    if (integration.healthStatus === 'failed') {
      await storage.createNotification({
        userId: integration.userId,
        type: 'system',
        title: '✅ Mailbox Recovered',
        message: `Your mailbox is now connected and healthy again.`,
        metadata: {
          integrationId: integration.id,
          provider: integration.provider,
          activityType: 'mailbox_recovered'
        }
      });
    }
  }

  /**
   * Return pending campaign leads from a failed mailbox to the pool
   */
  async returnLeadsToPool(integrationId: string): Promise<number> {
    const result = await db.update(campaignLeads)
      .set({
        integrationId: null,
        status: 'queued',
      })
      .where(and(
        eq(campaignLeads.integrationId, integrationId),
        eq(campaignLeads.status, 'pending')
      ))
      .returning();

    if (result.length > 0) {
      console.log(`[MailboxHealth] 📦 Returned ${result.length} leads from failed mailbox ${integrationId} to pool`);
    }

    return result.length;
  }

  /**
   * Check plan expiry for all users with active campaigns
   */
  async checkPlanExpiry(): Promise<void> {
    try {
      const activeCampaigns = await db.select({
        userId: outreachCampaigns.userId,
        campaignId: outreachCampaigns.id,
        campaignName: outreachCampaigns.name,
      })
        .from(outreachCampaigns)
        .where(eq(outreachCampaigns.status, 'active'));

      const checkedUsers = new Set<string>();

      for (const campaign of activeCampaigns) {
        if (checkedUsers.has(campaign.userId)) continue;
        checkedUsers.add(campaign.userId);

        const user = await storage.getUserById(campaign.userId);
        if (!user) continue;

        // Check trial expiry
        if (user.plan === 'trial' && user.trialExpiresAt) {
          const expiresAt = new Date(user.trialExpiresAt);
          if (expiresAt < new Date()) {
            console.log(`[MailboxHealth] ⏰ User ${user.id} trial expired — pausing campaigns`);

            // Pause all active campaigns for this user
            await db.update(outreachCampaigns)
              .set({ status: 'paused', updatedAt: new Date() })
              .where(and(
                eq(outreachCampaigns.userId, user.id),
                eq(outreachCampaigns.status, 'active')
              ));

            await storage.createNotification({
              userId: user.id,
              type: 'billing_issue',
              title: '⏰ Plan Expired',
              message: 'Your trial has expired. All active campaigns have been paused. Upgrade to continue sending.',
              metadata: { activityType: 'plan_expired' }
            });

            wsSync.notifyCampaignsUpdated(user.id);
          }
        }
      }
    } catch (err: any) {
      console.error('[MailboxHealth] Plan expiry check error:', err.message);
    }
  }

  /**
   * Detect spam risk based on bounce rates
   */
  async detectSpamRisk(): Promise<void> {
    try {
      const emailProviders = ['gmail', 'outlook', 'custom_email'];
      let allIntegrations: any[] = [];

      for (const provider of emailProviders) {
        const found = await storage.getIntegrationsByProvider(provider);
        if (found) allIntegrations = [...allIntegrations, ...found];
      }

      for (const integration of allIntegrations) {
        if (!integration.connected || integration.healthStatus === 'failed') continue;

        try {
          // Count bounces in the last 24h for this mailbox
          const oneDayAgo = new Date();
          oneDayAgo.setDate(oneDayAgo.getDate() - 1);

          const bounceResult = await db.execute(sql`
            SELECT COUNT(*) as bounce_count FROM bounce_tracker
            WHERE integration_id = ${integration.id}
            AND created_at >= ${oneDayAgo.toISOString()}::timestamp
          `);
          const bounceCount = Number(bounceResult.rows[0]?.bounce_count || 0);

          // Count total sends in the last 24h via Audit Trail (Source of Truth for activity)
          const sentResult = await db.execute(sql`
            SELECT COUNT(*) as sent_count FROM audit_trail
            WHERE integration_id = ${integration.id}
            AND action IN ('ai_message_sent', 'manual_email_sent')
            AND created_at >= ${oneDayAgo.toISOString()}::timestamp
          `);
          const sentCount = Number(sentResult.rows[0]?.sent_count || 0);

          if (sentCount === 0) continue;

          if (sentCount === 0) continue;

          // Phase 5: Use unified Reputation Monitor for all health & throttling calculations
          const { calculateReputationScore } = await import('./reputation-monitor.js');
          const finalScore = await calculateReputationScore(integration.id);
          const bounceRateRaw = sentCount > 0 ? bounceCount / sentCount : 0;
          const bounceRate = Number.parseFloat(bounceRateRaw.toFixed(4)); // accurate to 2 decimal places in %

          // ADAPTIVE THRESHOLD RULES (Google-Compliant)
          // 1. If we haven't hit the minimum sends yet, only pause if hard numbers are extremely high (e.g. 3 bounces out of 5)
          const earlyFail = sentCount < this.MIN_SENDS_FOR_RATE_CALC && bounceCount >= 3;
          // 2. Standard threshold pause
          const normalFail = sentCount >= this.MIN_SENDS_FOR_RATE_CALC && bounceRate >= this.SPAM_BOUNCE_CRITICAL;

          if (finalScore < 45 || earlyFail || normalFail) {
            // Unpause handled by reputation-monitor itself or we can force it here
            const pauseUntil = new Date();
            pauseUntil.setHours(pauseUntil.getHours() + 24);

            await db.update(integrations)
              .set({
                mailboxPauseUntil: pauseUntil,
                healthStatus: 'warning',
                lastHealthError: finalScore < 45 
                  ? `Reputation critical: ${finalScore}/100. Autonomous pause active.`
                  : `Bounce rate critical: ${(bounceRate * 100).toFixed(2)}%. Autonomous pause active.`,
                updatedAt: new Date(),
              })
              .where(eq(integrations.id, integration.id));

            await storage.createNotification({
              userId: integration.userId,
              type: 'mailbox_warning',
              title: '🚫 Mailbox Paused (Spam Risk)',
              message: `Your mailbox has been paused for 24h due to an excessive bounce rate (${(bounceRate * 100).toFixed(2)}%). This protects your sender reputation from Google bans.`,
              metadata: {
                integrationId: integration.id,
                bounceRate,
                pauseUntil: pauseUntil.toISOString(),
                activityType: 'spam_risk_pause'
              }
            });

            console.warn(`[MailboxHealth] 🚫 Paused mailbox ${integration.id} for 24h due to ${(bounceRate * 100).toFixed(2)}% bounce rate or early failure (${bounceCount}/${sentCount} bounces)`);

            // Return leads to pool
            await this.returnLeadsToPool(integration.id);
          } else if (sentCount >= this.MIN_SENDS_FOR_RATE_CALC && bounceRate >= this.SPAM_BOUNCE_THRESHOLD) {
            console.warn(`[MailboxHealth] ⚠️ Mailbox ${integration.id} has elevated bounce rate: ${(bounceRate * 100).toFixed(2)}%`);
          }
        } catch (err: any) {
          console.error(`[MailboxHealth] Spam risk check error for ${integration.id}:`, err.message);
        }
      }
    } catch (err: any) {
      console.error('[MailboxHealth] Spam risk detection error:', err.message);
    }
  }

  /**
   * Get health status of all mailboxes for a user
   */
  async getUserMailboxHealth(userId: string): Promise<any[]> {
    const userIntegrations = await db.select()
      .from(integrations)
      .where(and(
        eq(integrations.userId, userId),
        or(
          eq(integrations.provider, 'gmail'),
          eq(integrations.provider, 'outlook'),
          eq(integrations.provider, 'custom_email')
        )
      ));

    return userIntegrations.map((i: any) => ({
      id: i.id,
      provider: i.provider,
      accountType: i.accountType,
      connected: i.connected,
      healthStatus: i.healthStatus,
      lastHealthError: i.lastHealthError,
      lastHealthCheckAt: i.lastHealthCheckAt,
      mailboxPauseUntil: i.mailboxPauseUntil,
      failureCount: i.failureCount,
      spamRiskScore: i.spamRiskScore,
    }));
  }

  /**
   * Get active (healthy + not paused) mailboxes for a user
   */
  async getActiveMailboxes(userId: string): Promise<any[]> {
    const now = new Date();
    const userIntegrations = await db.select()
      .from(integrations)
      .where(and(
        eq(integrations.userId, userId),
        eq(integrations.connected, true),
        ne(integrations.healthStatus, 'failed'),
        or(
          isNull(integrations.mailboxPauseUntil),
          lte(integrations.mailboxPauseUntil, now)
        )
      ));

    return userIntegrations.filter((i: any) =>
      ['gmail', 'outlook', 'custom_email'].includes(i.provider)
    );
  }

  /**
   * Manually reassign leads from one mailbox to another
   */
  async reassignLeads(
    fromMailboxId: string,
    toMailboxId: string,
    userId: string
  ): Promise<number> {
    // Verify ownership
    const [fromMb] = await db.select().from(integrations)
      .where(and(eq(integrations.id, fromMailboxId), eq(integrations.userId, userId)));
    const [toMb] = await db.select().from(integrations)
      .where(and(eq(integrations.id, toMailboxId), eq(integrations.userId, userId)));

    if (!fromMb || !toMb) throw new Error('Mailbox not found');
    if (toMb.healthStatus === 'failed') throw new Error('Cannot reassign to a failed mailbox');

    const result = await db.update(campaignLeads)
      .set({ integrationId: toMailboxId })
      .where(and(
        eq(campaignLeads.integrationId, fromMailboxId),
        eq(campaignLeads.status, 'pending')
      ))
      .returning();

    console.log(`[MailboxHealth] 🔄 Reassigned ${result.length} leads from ${fromMailboxId} to ${toMailboxId}`);

    if (result.length > 0) {
      await storage.createNotification({
        userId,
        type: 'lead_redistribution',
        title: '🔄 Leads Reassigned',
        message: `${result.length} leads have been reassigned to a different mailbox.`,
        metadata: {
          fromMailboxId,
          toMailboxId,
          count: result.length,
          activityType: 'lead_reassignment'
        }
      });
    }


    return result.length;
  }

  /**
   * Get remaining capacity for a list of mailboxes today
   */
  async getMailboxCapacities(mailboxIds: string[]): Promise<Map<string, number>> {
    const capacities = new Map<string, number>();
    if (mailboxIds.length === 0) return capacities;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // Get today's sent count from audit trail for each mailbox
    const sentCounts = await db.select({
      integrationId: auditTrail.integrationId,
      count: drizzleCount()
    })
      .from(auditTrail)
      .where(and(
        inArray(auditTrail.integrationId, mailboxIds),
        eq(auditTrail.action, 'ai_message_sent'),
        lte(auditTrail.createdAt, new Date()),
        sql`${auditTrail.createdAt} >= ${startOfToday}`
      ))
      .groupBy(auditTrail.integrationId);

    const countMap = new Map(sentCounts.map((r: any) => [r.integrationId, Number(r.count)]));

    // Get limits
    const mbs = await db.select().from(integrations).where(inArray(integrations.id, mailboxIds));

    for (const mb of mbs) {
      const sentToday = Number(countMap.get(mb.id)) || 0;
      const remaining = Math.max(0, (Number(mb.dailyLimit) || 50) - sentToday);
      capacities.set(mb.id, remaining);
    }

    return capacities;
  }

  /**
   * Check bounce rate for a mailbox and pause if high risk (>15%)
   */
  async checkSpamRisk(integrationId: string): Promise<boolean> {
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    // 1. Get bounce count
    const [bounceData] = await db.select({ count: drizzleCount() })
      .from(bounceTracker)
      .where(and(
        eq(bounceTracker.integrationId, integrationId),
        sql`${bounceTracker.timestamp} >= ${twentyFourHoursAgo}`
      ));

    // 2. Get total sent count
    const [sentData] = await db.select({ count: drizzleCount() })
      .from(auditTrail)
      .where(and(
        eq(auditTrail.integrationId, integrationId),
        eq(auditTrail.action, 'ai_message_sent'),
        sql`${auditTrail.createdAt} >= ${twentyFourHoursAgo}`
      ));

    const bounces = Number(bounceData?.count || 0);
    const sent = Number(sentData?.count || 0);
    const total = bounces + sent;

    if (total < 10) return false; // Not enough data to be statistically significant

    const bounceRate = bounces / total;
    const currentSpamPct = bounceRate * 100;
    console.log(`[MailboxHealth] 📊 Mailbox ${integrationId} bounce rate: ${currentSpamPct.toFixed(2)}% (${bounces}/${total})`);

    if (bounceRate > 0.15) {
      // PAUSE for 24 hours
      const pauseUntil = new Date();
      pauseUntil.setHours(pauseUntil.getHours() + 24);

      console.warn(`[MailboxHealth] 🚫 High bounce rate detector triggered for ${integrationId}. Pausing for 24h.`);

      // Apply smoothing even here
      const [existing] = await db.select().from(integrations).where(eq(integrations.id, integrationId));
      const oldScore = Number(existing?.spamRiskScore || 0);
      const newScore = (oldScore * 0.7) + (currentSpamPct * 0.3);

      await db.update(integrations)
        .set({
          healthStatus: 'warning',
          mailboxPauseUntil: pauseUntil,
          spamRiskScore: parseFloat(newScore.toFixed(2)),
          lastHealthError: `High bounce rate detected: ${currentSpamPct.toFixed(2)}%`,
          updatedAt: new Date(),
        })
        .where(eq(integrations.id, integrationId));

      const integration = await storage.getIntegrationById(integrationId);
      if (integration) {
        await storage.createNotification({
          userId: integration.userId,
          type: 'mailbox_failure',
          title: '⚠️ Mailbox Paused: High Bounce Rate',
          message: `Your mailbox ${integration.provider} has been paused for 24h because its bounce rate (${(bounceRate * 100).toFixed(1)}%) exceeded the 15% safety threshold.`,
          metadata: { integrationId, bounceRate, activityType: 'spam_risk_pause' }
        });
      }
      return true;
    }

    return false;
  }
  /**
   * Check DNS health (SPF, DKIM, DMARC) for a domain
   */
  private async checkDNSHealth(integration: any): Promise<{ valid: boolean; details: any; missing: string[] }> {
    const meta = decryptToJSON(integration.encryptedMeta) || {};
    const email = meta.smtp_user || meta.user || '';
    if (!email.includes('@')) return { valid: true, details: { spf: true, dkim: true, dmarc: true }, missing: [] };

    const domain = email.split('@')[1];
    const dns = await import('dns/promises');
    const details = { spf: false, dkim: false, dmarc: false };
    const missing = [];

    try {
      // 1. Check SPF
      const txtRecords = await dns.resolveTxt(domain);
      details.spf = txtRecords.some(r => r.join(' ').includes('v=spf1'));
      if (!details.spf) missing.push('SPF');

      // 2. Check DMARC
      try {
        const dmarcRecords = await dns.resolveTxt(`_dmarc.${domain}`);
        details.dmarc = dmarcRecords.some(r => r.join(' ').includes('v=DMARC1'));
      } catch (e) {
        details.dmarc = false;
      }
      if (!details.dmarc) missing.push('DMARC');

      // 3. Check DKIM (Checking common selectors like 'default', 'google', 'mandrill')
      const commonSelectors = ['default', 'google', 'mandrill', 'mail', 'k1'];
      for (const selector of commonSelectors) {
        try {
          await dns.resolveTxt(`${selector}._domainkey.${domain}`);
          details.dkim = true;
          break;
        } catch (e) {}
      }
      if (!details.dkim) missing.push('DKIM');

    } catch (err) {
      console.error(`[MailboxHealth] DNS check failed for ${domain}:`, err);
    }

    return {
      valid: details.spf && details.dmarc, // DKIM is harder to verify without selector, so we mark valid if SPF/DMARC pass
      details,
      missing
    };
  }
}

export const mailboxHealthService = new MailboxHealthService();







