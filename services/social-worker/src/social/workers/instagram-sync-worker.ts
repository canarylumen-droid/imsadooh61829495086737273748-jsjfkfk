/**
 * Instagram DM Sync Worker (Phase 4)
 * 
 * Proactively polls the Instagram Graph API for new DMs as a recovery
 * mechanism for missed webhook events. Runs every 5 minutes per connected
 * Instagram integration. Also handles proactive token refresh before expiry.
 *
 * This worker is a safety net — the primary delivery path remains webhooks.
 */

import { db } from '@shared/lib/db/db.js';
import { integrations, users, leads, messages } from '@audnix/shared';
import { eq, and, inArray } from 'drizzle-orm';
import { InstagramOAuth } from "@shared/lib/providers/instagram.js";
import { decrypt, tryDecryptToJSON } from "@shared/lib/crypto/encryption.js";
import { storage } from '@shared/lib/storage/storage.js';
import { wsSync } from "@shared/lib/realtime/websocket-sync.js";
import { quotaService } from "@shared/lib/monitoring/quota-service.js";
import { workerHealthMonitor } from "@shared/lib/monitoring/worker-health.js";

const WORKER_NAME = 'instagram-sync-worker';
const SYNC_INTERVAL_MS = 5 * 60 * 1000;   // 5 minutes
const TOKEN_REFRESH_THRESHOLD_DAYS = 7;    // Refresh token if < 7 days to expiry

class InstagramSyncWorker {
  private interval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isProcessing = false;
  private readonly oauth = new InstagramOAuth();

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[${WORKER_NAME}] 🚀 Started (${SYNC_INTERVAL_MS / 1000}s interval)`);

    // Stagger initial run by 30s to avoid startup congestion
    setTimeout(() => this.process(), 30_000);
    this.interval = setInterval(() => this.process(), SYNC_INTERVAL_MS);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isRunning = false;
    console.log(`[${WORKER_NAME}] 🛑 Stopped`);
  }

  async process(): Promise<void> {
    if (this.isProcessing) return;
    if (process.env.GLOBAL_AI_PAUSE === 'true') return;
    if (process.env.SUSPEND_INSTAGRAM === 'true') {
      console.log(`[${WORKER_NAME}] ⏸ SUSPEND_INSTAGRAM active — skipping`);
      return;
    }
    if (quotaService.isRestricted()) return;

    this.isProcessing = true;
    try {
      // Find all connected Instagram integrations
      const igIntegrations = await db
        .select({
          id: integrations.id,
          userId: integrations.userId,
          encryptedMeta: integrations.encryptedMeta,
        })
        .from(integrations)
        .where(
          and(
            eq(integrations.provider, 'instagram'),
            eq(integrations.connected, true)
          )
        );

      if (igIntegrations.length === 0) return;

      console.log(`[${WORKER_NAME}] Syncing ${igIntegrations.length} Instagram integration(s)...`);

      for (const integration of igIntegrations) {
        try {
          await this.syncIntegration(integration);
        } catch (err: any) {
          console.error(`[${WORKER_NAME}] Failed for integration ${integration.id}:`, err.message);
          // Propagate auth errors to the UI immediately
          if (/invalid.*token|token.*expired|oauth.*error|190/i.test(err.message)) {
            wsSync.notifyIntegrationError(integration.userId, {
              integrationId: integration.id,
              provider: 'instagram',
              errorType: 'auth_failure',
              message: 'Instagram connection expired. Please reconnect your account.',
            });
          }
        }
      }

      workerHealthMonitor.recordSuccess(WORKER_NAME);
    } catch (err: any) {
      console.error(`[${WORKER_NAME}] Fatal loop error:`, err);
      quotaService.reportDbError(err);
      workerHealthMonitor.recordError(WORKER_NAME, err.message);
    } finally {
      this.isProcessing = false;
    }
  }

  private async syncIntegration(integration: {
    id: string;
    userId: string;
    encryptedMeta: string | null;
  }): Promise<void> {
    const meta = tryDecryptToJSON(integration.encryptedMeta) as any || {};
    const oauthAccount = await storage.getOAuthAccount(integration.userId, 'instagram');
    const tokenExpiresAt = oauthAccount?.expiresAt || null;
    
    let accessToken: string | null = null;
    if (meta.accessToken) {
      try {
        accessToken = decrypt(meta.accessToken);
      } catch {
        accessToken = null;
      }
    } else if (oauthAccount?.accessToken) {
      accessToken = oauthAccount.accessToken;
    }
    if (!accessToken) {
      console.warn(`[${WORKER_NAME}] No valid token for integration ${integration.id} — skipping`);
      return;
    }

    // ── Proactive Token Refresh (Phase 4 Error 2 fix) ─────────────────────────
    if (tokenExpiresAt) {
      const daysToExpiry = (new Date(tokenExpiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      if (daysToExpiry < TOKEN_REFRESH_THRESHOLD_DAYS) {
        console.log(`[${WORKER_NAME}] 🔄 Token for ${integration.id} expires in ${daysToExpiry.toFixed(1)} days — refreshing proactively`);
        try {
          const refreshed = await this.oauth.refreshLongLivedToken(accessToken);
          const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
          const newMeta = {
            ...meta,
            accessToken: meta.accessToken, // Re-encrypt happens in saveToken
          };
          if (oauthAccount) {
            await storage.saveOAuthAccount({
              ...oauthAccount,
              accessToken: refreshed.access_token,
              expiresAt: newExpiresAt,
              updatedAt: new Date()
            });
          }

          console.log(`[${WORKER_NAME}] ✅ Token refreshed for ${integration.id}. New expiry: ${newExpiresAt.toISOString()}`);
        } catch (refreshErr: any) {
          console.error(`[${WORKER_NAME}] Token refresh failed for ${integration.id}:`, refreshErr.message);
          // Notify user of impending expiry
          wsSync.notifyIntegrationError(integration.userId, {
            integrationId: integration.id,
            provider: 'instagram',
            errorType: 'token_expiring',
            message: `Instagram token expires soon and could not be refreshed. Please reconnect.`,
          });
        }
      }
    }

    // ── Proactive DM Sync (Phase 4 Error 1 fix) ────────────────────────────────
    const igAccountId = meta.instagramId || meta.instagram_id;
    if (!igAccountId) return;

    let conversations: any[] = [];
    try {
      conversations = await this.oauth.getConversations(accessToken);
    } catch (err: any) {
      throw new Error(`Graph API error fetching conversations: ${err.message}`);
    }

    if (!conversations || conversations.length === 0) return;

    let newMessageCount = 0;
    for (const conversation of conversations.slice(0, 20)) {
      try {
        const convoMessages = await this.oauth.getAllMessages(accessToken, conversation.id, 5);
        for (const msg of convoMessages) {
          if (!msg.message || msg.from?.id === igAccountId) continue; // Skip outbound

          const externalId = msg.id;
          // Idempotent: skip if already stored
          const existing = await db
            .select({ id: messages.id })
            .from(messages)
            .where(eq(messages.externalId, externalId))
            .limit(1);

          if (existing.length > 0) continue;

          // Find or create lead from participant
          const participant = conversation.participants?.find((p: any) => p.id !== igAccountId);
          if (!participant) continue;

          let lead = await storage.getLeadBySocialId(participant.id, 'instagram');
          if (!lead) {
            lead = await storage.createLead({
              userId: integration.userId,
              name: participant.username || participant.id,
              channel: 'instagram',
              externalId: participant.id,
              status: 'new',
              aiPaused: false,
              metadata: {
                instagram_username: participant.username,
                source: 'instagram_dm_sync',
                synced_at: new Date().toISOString(),
              },
            });
          }

          // Store the inbound message
          await storage.createMessage({
            userId: integration.userId,
            leadId: lead.id,
            provider: 'instagram',
            direction: 'inbound',
            body: msg.message,
            externalId,
            integrationId: integration.id,
            metadata: {
              conversationId: conversation.id,
              source: 'instagram_dm_sync',
              instagramMessageId: msg.id,
              createdAt: msg.created_time,
            },
          });

          newMessageCount++;
        }
      } catch (convoErr: any) {
        console.warn(`[${WORKER_NAME}] Skipping conversation ${conversation.id}:`, convoErr.message);
      }
    }

    if (newMessageCount > 0) {
      console.log(`[${WORKER_NAME}] 📥 Synced ${newMessageCount} new DMs for integration ${integration.id}`);
      wsSync.notifyMessagesUpdated(integration.userId, {
        source: 'instagram_sync',
        count: newMessageCount,
      });
    }
  }
}

export const instagramSyncWorker = new InstagramSyncWorker();







