import { getRedisClient } from '@shared/lib/redis/redis.js';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';

const REDIS_CHANNEL = 'audnix-cluster:events';

class RedisPubSub {
  private isSubscribed: boolean = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 50;

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

      // Handle disconnection
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
    console.log(`[RedisPubSub] Retrying in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.init();
    }, delay);
  }

  /**
   * Broadcast an event to the entire cluster via Redis pub/sub.
   */
  async broadcast(type: string, userId: string, payload: any = {}) {
    try {
      const pubClient = await getRedisClient();
      if (!pubClient) {
        // Redis down — try direct wsSync as fallback (works if same process)
        this.fallbackDirect(type, userId, payload);
        return;
      }
      const message = JSON.stringify({ type, userId, payload, timestamp: Date.now() });
      await pubClient.publish(REDIS_CHANNEL, message);
    } catch (err: any) {
      console.error('[RedisPubSub] Broadcast failed:', err.message);
      // Fallback to direct wsSync
      this.fallbackDirect(type, userId, payload);
    }
  }

  /**
   * Fallback: if Redis is down, try direct wsSync (works in api-gateway process only)
   */
  private fallbackDirect(type: string, userId: string, payload: any) {
    try {
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
          try {
            const mod = require('@services/api-gateway/src/routes/dashboard-routes.js');
            if (typeof mod.invalidateStatsCache === 'function') {
              mod.invalidateStatsCache(userId);
            }
          } catch (_) {}
          break;
        case 'DELIVERABILITY_UPDATE': wsSync.notifyDeliverabilityUpdated(userId, payload); break;
      }
    } catch (_) {}
  }

  /**
   * Convenience methods for common event types.
   */
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

  private async handleEvent(message: string) {
    try {
      const event = JSON.parse(message);
      
      // Relay the event to the local WebSockets for the target user.
      switch (event.type) {
        case 'STATS_UPDATE':
          wsSync.notifyStatsUpdated(event.userId, event.payload);
          break;
        case 'LEADS_UPDATE':
          wsSync.notifyLeadsUpdated(event.userId, event.payload);
          break;
        case 'MESSAGES_UPDATE':
          wsSync.notifyMessagesUpdated(event.userId, event.payload);
          break;
        case 'CAMPAIGN_STATS_UPDATE':
          wsSync.notifyCampaignStatsUpdated(event.userId, event.payload?.campaignId || '');
          break;
        case 'CAMPAIGNS_UPDATE':
          wsSync.notifyCampaignsUpdated(event.userId);
          break;
        case 'ACTIVITY_UPDATE':
          wsSync.notifyActivityUpdated(event.userId, event.payload);
          break;
        case 'NEW_MAIL':
          wsSync.notifyNewMail(event.userId, event.payload);
          break;
        case 'NOTIFICATION':
          wsSync.notifyNotification(event.userId, event.payload);
          break;
        case 'DESKTOP_NOTIFICATION':
          wsSync.notifyDesktopNotification(event.userId, event.payload);
          break;
        case 'STATS_CACHE_INVALIDATE':
          try {
            const mod = await import('@services/api-gateway/src/routes/dashboard-routes.js');
            if (typeof mod.invalidateStatsCache === 'function') {
              mod.invalidateStatsCache(event.userId);
            }
          } catch (_) { /* not in api-gateway process, ignore */ }
          break;
        case 'DELIVERABILITY_UPDATE':
          wsSync.notifyDeliverabilityUpdated(event.userId, event.payload);
          break;
        default:
          wsSync.broadcastToUser(event.userId, { type: event.type.toLowerCase(), payload: event.payload });
      }
    } catch (err: any) {
      console.error('[RedisPubSub] Error handling message:', err.message);
    }
  }
}

export const clusterSync = new RedisPubSub();
