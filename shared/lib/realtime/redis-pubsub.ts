import { getRedisClient } from '@shared/lib/redis/redis.js';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';
import { LRUCache } from 'lru-cache';

const REDIS_CHANNEL = 'audnix-cluster:events';

// Events that can be safely debounced — coalesce rapid fire into single delivery
const DEBOUNCEABLE_EVENTS = new Set([
  'STATS_UPDATE', 'LEADS_UPDATE', 'MESSAGES_UPDATE',
  'STATS_CACHE_INVALIDATE', 'DELIVERABILITY_UPDATE',
  'CAMPAIGN_STATS_UPDATE', 'CAMPAIGNS_UPDATE',
]);

const DEBOUNCE_WINDOW_MS = 200;

// In-memory stats cache invalidation set — avoids ESM require() issue
// Keyed by userId, TTL 10s auto-cleanup.
const pendingInvalidations = new LRUCache<string, boolean>({ max: 1000, ttl: 10_000 });

class RedisPubSub {
  private isSubscribed: boolean = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 50;
  private debounceBuffer: Map<string, Set<string>> = new Map();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pubClientRef: any = null;

  constructor() {
    this.init();
  }

  async init() {
    if (this.isSubscribed) return;
    
    try {
      const client = await getRedisClient();
      if (!client) {
        console.warn('[RedisPubSub] Redis not available, retrying in 5s...');
        this.scheduleRetry();
        return;
      }

      const subClient = client.duplicate();
      await subClient.connect();
      
      await subClient.subscribe(REDIS_CHANNEL, async (message) => {
        await this.handleEvent(message);
      });

      subClient.on('error', (err: any) => {
        console.error('[RedisPubSub] Subscriber error:', err.message);
        this.isSubscribed = false;
        this.scheduleRetry();
      });

      subClient.on('close', () => {
        console.warn('[RedisPubSub] Connection closed, retrying...');
        this.isSubscribed = false;
        this.scheduleRetry();
      });

      this.isSubscribed = true;
      this.reconnectAttempts = 0;
      console.log(`[RedisPubSub] Subscribed to cluster channel: ${REDIS_CHANNEL}`);
    } catch (err: any) {
      console.error('[RedisPubSub] Failed to initialize:', err.message);
      this.scheduleRetry();
    }
  }

  private scheduleRetry() {
    if (this.retryTimer) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[RedisPubSub] Max reconnect attempts reached. Real-time disabled.');
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.init();
    }, delay);
  }

  private flushDebouncedEvents() {
    this.debounceTimer = null;
    for (const [userId, eventTypes] of this.debounceBuffer) {
      for (const type of eventTypes) {
        this.relayEvent(type, userId, {});
      }
    }
    this.debounceBuffer.clear();
  }

  private isDebounceNeeded(type: string): boolean {
    return DEBOUNCEABLE_EVENTS.has(type);
  }

  private debounceOrRelay(type: string, userId: string, payload: any) {
    if (!this.isDebounceNeeded(type)) {
      this.relayEvent(type, userId, payload);
      return;
    }
    let types = this.debounceBuffer.get(userId);
    if (!types) {
      types = new Set();
      this.debounceBuffer.set(userId, types);
    }
    types.add(type);
    if (!this.debounceTimer) {
      this.debounceTimer = setTimeout(() => this.flushDebouncedEvents(), DEBOUNCE_WINDOW_MS);
    }
  }

  private relayEvent(type: string, userId: string, payload: any) {
    switch (type) {
      case 'STATS_UPDATE': wsSync.notifyStatsUpdated(userId, payload); break;
      case 'LEADS_UPDATE': wsSync.notifyLeadsUpdated(userId, payload); break;
      case 'MESSAGES_UPDATE': wsSync.notifyMessagesUpdated(userId, payload); break;
      case 'CAMPAIGN_STATS_UPDATE': wsSync.notifyCampaignStatsUpdated(userId, payload?.campaignId || ''); break;
      case 'CAMPAIGNS_UPDATE': wsSync.notifyCampaignsUpdated(userId); break;
      case 'ACTIVITY_UPDATE': wsSync.notifyActivityUpdated(userId, payload); break;
      case 'NEW_MAIL': wsSync.notifyNewMail(userId, payload); break;
      case 'NOTIFICATION': wsSync.notifyNotification(userId, payload); break;
      case 'DESKTOP_NOTIFICATION': wsSync.notifyDesktopNotification(userId, payload); break;
      case 'STATS_CACHE_INVALIDATE':
        // Mark userId for cache invalidation — the stats endpoint checks this
        // instead of using a broken require() in ESM context.
        pendingInvalidations.set(userId, true);
        wsSync.broadcastToUser(userId, { type: 'stats_cache_invalidate', payload: {} });
        break;
      case 'DELIVERABILITY_UPDATE': wsSync.notifyDeliverabilityUpdated(userId, payload); break;
      case 'WARMUP_UPDATE': wsSync.notifyWarmupUpdated(userId, payload); break;
      default:
        wsSync.broadcastToUser(userId, { type: type.toLowerCase(), payload });
    }
  }

  async broadcast(type: string, userId: string, payload: any = {}) {
    let pubClient = null;
    try {
      pubClient = await getRedisClient();
    } catch {
      this.fallbackDirect(type, userId, payload);
      return;
    }

    if (!pubClient) {
      this.fallbackDirect(type, userId, payload);
      return;
    }

    const message = JSON.stringify({ type, userId, payload, timestamp: Date.now() });

    // Retry once with a fresh client if first attempt fails
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (!pubClient) throw new Error('pubClient is null');
        await pubClient.publish(REDIS_CHANNEL, message);
        return; // success
      } catch (err: any) {
        if (attempt === 0) {
          console.warn(`[RedisPubSub] Publish failed (attempt 1), refreshing client: ${err.message}`);
          try {
            pubClient = await getRedisClient();
          } catch { break; }
        } else {
          console.error(`[RedisPubSub] Publish failed (attempt 2), falling back: ${err.message}`);
        }
      }
    }

    // Both attempts failed — try direct wsSync fallback
    this.fallbackDirect(type, userId, payload);
  }

  private fallbackDirect(type: string, userId: string, payload: any) {
    try {
      this.relayEvent(type, userId, payload);
    } catch (_) {}
  }

  // Check if a userId's stats cache needs invalidation (called by stats endpoint)
  static isStatsCacheStale(userId: string): boolean {
    return pendingInvalidations.has(userId);
  }

  static markStatsCacheRefreshed(userId: string) {
    pendingInvalidations.delete(userId);
  }

  async notifyStatsUpdated(userId: string, data?: any) {
    await this.broadcast('STATS_UPDATE', userId, data);
  }

  async notifyLeadsUpdated(userId: string, data?: any) {
    await this.broadcast('LEADS_UPDATE', userId, data);
  }

  async notifyMessagesUpdated(userId: string, data?: any) {
    await this.broadcast('MESSAGES_UPDATE', userId, data);
  }

  async notifyCampaignStatsUpdated(userId: string, campaignId: string) {
    await this.broadcast('CAMPAIGN_STATS_UPDATE', userId, { campaignId });
  }

  async notifyCampaignsUpdated(userId: string) {
    await this.broadcast('CAMPAIGNS_UPDATE', userId, {});
  }

  async notifyActivityUpdated(userId: string, data?: any) {
    await this.broadcast('ACTIVITY_UPDATE', userId, data);
  }

  async notifyNewMail(userId: string, data: any) {
    await this.broadcast('NEW_MAIL', userId, data);
  }

  async notifyNotification(userId: string, data: any) {
    await this.broadcast('NOTIFICATION', userId, data);
  }

  async notifyDesktopNotification(userId: string, data: any) {
    await this.broadcast('DESKTOP_NOTIFICATION', userId, data);
  }

  async notifyStatsCacheInvalidate(userId: string) {
    await this.broadcast('STATS_CACHE_INVALIDATE', userId, {});
  }

  async notifyDeliverabilityUpdated(userId: string, data: any) {
    await this.broadcast('DELIVERABILITY_UPDATE', userId, data);
  }

  async notifyWarmupUpdated(userId: string, data: any) {
    await this.broadcast('WARMUP_UPDATE', userId, data);
  }

  private async handleEvent(message: string) {
    try {
      const event = JSON.parse(message);
      this.debounceOrRelay(event.type, event.userId, event.payload);
    } catch (err: any) {
      console.error('[RedisPubSub] Error handling message:', err.message);
    }
  }
}

export { pendingInvalidations, RedisPubSub };
export const clusterSync = new RedisPubSub();
