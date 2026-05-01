import { getRedisClient } from '@shared/lib/redis/redis.js';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';

const REDIS_CHANNEL = 'audnix-cluster:events';

class RedisPubSub {
  private isSubscribed: boolean = false;

  constructor() {
    this.init();
  }

  async init() {
    if (this.isSubscribed) return;
    
    try {
      const client = await getRedisClient();
      if (!client) {
        console.warn('[RedisPubSub] Redis not available, skipping cluster sync.');
        return;
      }

      const subClient = client.duplicate();
      await subClient.connect();
      
      await subClient.subscribe(REDIS_CHANNEL, (message) => {
        this.handleEvent(message);
      });

      this.isSubscribed = true;
      console.log(`[RedisPubSub] 📡 Subscribed to cluster channel: ${REDIS_CHANNEL}`);
    } catch (err) {
      console.error('[RedisPubSub] Failed to initialize:', err);
    }
  }

  /**
   * Broadcast an event to the entire cluster
   */
  async broadcast(type: string, userId: string, payload: any = {}) {
    try {
      const pubClient = await getRedisClient();
      if (!pubClient) return;
      const message = JSON.stringify({ type, userId, payload, timestamp: Date.now() });
      await pubClient.publish(REDIS_CHANNEL, message);
    } catch (err) {
      console.error('[RedisPubSub] Broadcast failed:', err);
    }
  }

  private handleEvent(message: string) {
    try {
      const event = JSON.parse(message);
      
      // Relay the event to the local WebSockets for the target user
      if (event.type === 'STATS_UPDATE') {
        wsSync.broadcastToUser(event.userId, { type: 'stats_updated', payload: event.payload });
      } else if (event.type === 'LEADS_UPDATE') {
        wsSync.notifyLeadsUpdated(event.userId, event.payload);
      } else if (event.type === 'MESSAGES_UPDATE') {
        wsSync.notifyMessagesUpdated(event.userId, event.payload);
      }
    } catch (err) {
      console.error('[RedisPubSub] Error handling message:', err);
    }
  }
}

export const clusterSync = new RedisPubSub();


