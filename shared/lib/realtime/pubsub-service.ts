import { PubSub, type Subscription, type Message } from '@google-cloud/pubsub';
import { db } from '@shared/lib/db/db.js';
import { integrations } from '@audnix/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';
import { tryDecryptToJSON } from '@shared/lib/crypto/encryption.js';

/**
 * GooglePubSubService
 *
 * Listens on a Google Cloud Pub/Sub subscription for:
 *  - Gmail push-notification messages (emailAddress + historyId)
 *
 * When a Gmail push arrives, it locates the matching integration by
 * decrypting encryptedMeta to find the real email address, then
 * delegates to the existing PushNotificationService.handleGmailPush
 * which already knows how to call the Gmail History API correctly.
 *
 * Authentication: Google SDK reads GOOGLE_APPLICATION_CREDENTIALS
 * env var automatically (path to service account JSON).
 */
class GooglePubSubService {
  private pubsub: PubSub | null = null;
  private subscription: Subscription | null = null;
  private readonly topicName: string | null;
  private readonly subscriptionName: string | null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.topicName = process.env.GOOGLE_PUB_SUB_TOPIC || null;
    // Subscription name follows the convention: `<topic>-sub`
    // You can override via GOOGLE_PUB_SUB_SUBSCRIPTION if needed.
    this.subscriptionName = process.env.GOOGLE_PUB_SUB_SUBSCRIPTION
      || (this.topicName ? `${this.topicName}-sub` : null);

    if (!this.topicName) {
      if (!(global as any).__pubsub_warned) {
        console.warn('[PubSub] GOOGLE_PUB_SUB_TOPIC not set — real-time Gmail push disabled.');
        (global as any).__pubsub_warned = true;
      }
      return;
    }

    try {
      // PubSub() reads GOOGLE_APPLICATION_CREDENTIALS or uses ADC on GKE/Cloud Run.
      this.pubsub = new PubSub();
      this.attachSubscription();
      console.log(`[PubSub] ✅ Initialized. Listening on subscription "${this.subscriptionName}"`);
    } catch (err: any) {
      console.error('[PubSub] Failed to initialise Google PubSub client:', err.message);
    }
  }

  // ─── Subscription Lifecycle ────────────────────────────────────────────────

  private attachSubscription(): void {
    if (!this.pubsub || !this.subscriptionName) return;

    this.subscription = this.pubsub.subscription(this.subscriptionName, {
      flowControl: { maxMessages: 10 },
    });

    this.subscription.on('message', this.onMessage.bind(this));
    this.subscription.on('error', this.onError.bind(this));
  }

  private async onMessage(message: Message): Promise<void> {
    try {
      // Gmail Pub/Sub payloads are base64-encoded JSON on the `data` field.
      const raw = JSON.parse(message.data.toString());

      // Gmail push format: { emailAddress: string; historyId: string }
      if (typeof raw.emailAddress === 'string' && raw.historyId !== undefined) {
        await this.handleGmailPush(raw.emailAddress, String(raw.historyId));
      } else {
        console.warn('[PubSub] Unrecognised message format — ignoring:', raw);
      }

      message.ack();
    } catch (err: any) {
      console.error('[PubSub] Error processing message:', err.message);
      // nack so it can be retried; don't crash the listener
      message.nack();
    }
  }

  private onError(err: Error): void {
    console.error('[PubSub] Subscription error:', err.message);
    // Re-attach after 30 s in case of transient connection issues
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      console.log('[PubSub] Re-attaching subscription after error...');
      this.subscription?.removeAllListeners();
      this.attachSubscription();
    }, 30_000);
  }

  // ─── Gmail Push Handler ────────────────────────────────────────────────────

  /**
   * Locate the matching integration by decrypting encryptedMeta and comparing
   * the stored email address, then delegate to the existing PushNotificationService.
   *
   * We cannot do a direct DB query on email because the address lives inside
   * the AES-encrypted encryptedMeta column — not in a plain-text column.
   */
  private async handleGmailPush(emailAddress: string, historyId: string): Promise<void> {
    console.log(`[PubSub] ⚡ Gmail push for ${emailAddress} (historyId: ${historyId})`);

    // 1. Fetch all connected Gmail integrations and decrypt to find the match.
    const gmailIntegrations = await db
      .select({ id: integrations.id, userId: integrations.userId, encryptedMeta: integrations.encryptedMeta })
      .from(integrations)
      .where(and(eq(integrations.provider, 'gmail'), eq(integrations.connected, true)));

    const matched = gmailIntegrations.find((row) => {
      const meta = tryDecryptToJSON(row.encryptedMeta) as Record<string, any> | null;
      if (!meta) return false;
      const storedEmail: string = meta.email || meta.user || '';
      return storedEmail.toLowerCase() === emailAddress.toLowerCase();
    });

    if (!matched) {
      console.warn(`[PubSub] No connected Gmail integration found for ${emailAddress}`);
      return;
    }

    // 2. Delegate to the existing PushNotificationService that already handles
    //    Gmail History API calls, AI analysis, and WebSocket notifications.
    const { PushNotificationService } = await import('@services/email-service/src/email/push-notification-service.js');
    await PushNotificationService.handleGmailPush({ emailAddress, historyId });

    // 3. Notify UI that a sync was triggered via push (not IMAP polling)
    wsSync.notifySyncStatus(matched.userId, {
      syncing: true,
      integrationId: matched.id,
    });
  }

  // ─── Event Publishing ──────────────────────────────────────────────────────

  /**
   * Publish an internal event to the configured topic.
   * Used for cross-service events (e.g., reputation change broadcasts).
   * Silently no-ops if Pub/Sub is not configured.
   */
  async publishEvent(eventType: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.pubsub || !this.topicName) return;

    try {
      const dataBuffer = Buffer.from(
        JSON.stringify({ eventType, ...payload, timestamp: new Date().toISOString() }),
      );
      await this.pubsub.topic(this.topicName).publishMessage({ data: dataBuffer });
    } catch (err: any) {
      // Non-fatal — log and move on
      console.error(`[PubSub] Failed to publish "${eventType}":`, err.message);
    }
  }

  // ─── Graceful Shutdown ─────────────────────────────────────────────────────

  async stop(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.subscription) {
      this.subscription.removeAllListeners();
      await this.subscription.close().catch(() => { /* already closed */ });
      this.subscription = null;
    }
    console.log('[PubSub] Subscription closed.');
  }
}

export const pubsubService = new GooglePubSubService();






