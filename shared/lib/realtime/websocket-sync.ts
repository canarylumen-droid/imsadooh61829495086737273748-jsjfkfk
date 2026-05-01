import { Server, Socket } from 'socket.io';
import http from 'http';

type MessageType = 'leads_updated' | 'messages_updated' | 'deals_updated' | 'settings_updated' | 'ping' | 'pong' | 'PROSPECTING_LOG' | 'PROSPECT_FOUND' | 'PROSPECT_UPDATED' | 'notification' | 'calendar_updated' | 'TERMINATE_SESSION' | 'insights_updated' | 'activity_updated' | 'stats_updated' | 'campaigns_updated' | 'campaign_stats_updated' | 'desktop_notification' | 'SECURITY_ALERT' | 'sync_status' | 'integration_error';

interface SyncMessage {
  type: MessageType;
  data?: any;
  timestamp: string;
}

class WebSocketSyncServer {
  private io: Server | null = null;

  initialize(server: http.Server) {
    if (this.io) {
      console.log('socket.io already initialized');
      return;
    }
    this.io = new Server(server, {
      cors: {
        origin: [
          'http://localhost:5173',
          'http://localhost:5000',
          process.env.NEXT_PUBLIC_APP_URL || '',
          'https://audnixai.com',
          'https://www.audnixai.com'
        ].filter(Boolean),
        methods: ["GET", "POST"],
        credentials: true
      },
      path: '/socket.io'
    });

    // Phase 50 Fix: Multi-node scaling with Redis Adapter
    (async () => {
      try {
        const { getPubClient, getSubClient } = await import('@shared/lib/redis/redis.js');
        const pub = await getPubClient();
        const sub = await getSubClient();
        
        if (pub && sub) {
          const { createAdapter } = await import('@socket.io/redis-adapter');
          this.io?.adapter(createAdapter(pub, sub));
          console.log('⚡ [WebSocketSync] Redis Adapter initialized (Shared Clients)');
        }
      } catch (err) {
        console.error('[WebSocketSync] Failed to initialize Redis adapter:', err);
      }
    })();

    this.io.on('connection', (socket: Socket) => {
      const userId = socket.handshake.query.userId as string;

      if (!userId) {
        console.log('Socket connection rejected: No userId');
        socket.disconnect();
        return;
      }

      // Join a room specific to this user
      socket.join(`user:${userId}`);
      console.log(`Socket connected: User ${userId} (${socket.id})`);

      socket.on('disconnect', () => {
        console.log(`Socket disconnected: User ${userId} (${socket.id})`);
      });

      socket.on('error', (err) => {
        console.error('Socket error:', err);
      });
    });

    console.log('✅ Socket.IO server initialized');
  }

  private lastEmissions = new Map<string, number>();
  private debouncers = new Map<string, NodeJS.Timeout>();

  private emitToUser(userId: string, event: MessageType, data: any) {
    if (!this.io) return;

    const throttleKey = `${userId}:${event}`;
    const now = Date.now();

    // Phase 18: Adaptive Throttling & Debouncing
    const throttleEvents = ['leads_updated', 'messages_updated', 'activity_updated', 'sync_status'];
    const debounceEvents = ['stats_updated', 'insights_updated', 'campaign_stats_updated', 'campaigns_updated'];
    const priorityEvents = ['notification', 'TERMINATE_SESSION', 'integration_error', 'SECURITY_ALERT'];

    // 1. Priority events: Always fire immediately
    if (priorityEvents.includes(event)) {
      this.executeEmit(userId, event, data, now);
      return;
    }

    // 2. Debounce events: High frequency stats that should settle before pushing
    if (debounceEvents.includes(event)) {
      const existing = this.debouncers.get(throttleKey);
      if (existing) clearTimeout(existing);

      const timeout = setTimeout(() => {
        this.executeEmit(userId, event, data, Date.now());
        this.debouncers.delete(throttleKey);
      }, 1000); // 1s settle time

      this.debouncers.set(throttleKey, timeout);
      return;
    }

    // 3. Throttle events: Critical updates that need a cooldown
    if (throttleEvents.includes(event)) {
      const lastTime = this.lastEmissions.get(throttleKey) || 0;
      if (now - lastTime < 1000) return; // 1s cooldown
      
      this.lastEmissions.set(throttleKey, now);
      this.executeEmit(userId, event, data, now);
      return;
    }

    // Default: 500ms throttle
    const lastTime = this.lastEmissions.get(throttleKey) || 0;
    if (now - lastTime < 500) return;
    this.lastEmissions.set(throttleKey, now);
    this.executeEmit(userId, event, data, now);
  }

  private executeEmit(userId: string, event: MessageType, data: any, now: number) {
    if (!this.io) return;
    
    const message: SyncMessage = {
      type: event,
      data,
      timestamp: new Date(now).toISOString()
    };

    setImmediate(() => {
      if (!this.io) return;
      this.io.to(`user:${userId}`).emit('message', message);
      this.io.to(`user:${userId}`).emit(event, data);
    });

    // Cleanup emissions map
    if (this.lastEmissions.size > 1000) {
      const expiry = now - 60000;
      for (const [key, time] of this.lastEmissions.entries()) {
        if (time < expiry) this.lastEmissions.delete(key);
      }
    }
  }

  notifyLeadsUpdated(userId: string, data?: any) {
    this.emitToUser(userId, 'leads_updated', data);
  }

  notifyMessagesUpdated(userId: string, data?: any) {
    this.emitToUser(userId, 'messages_updated', data);
  }

  notifyDealsUpdated(userId: string, data?: any) {
    this.emitToUser(userId, 'deals_updated', data);
  }

  notifySettingsUpdated(userId: string, data?: any) {
    this.emitToUser(userId, 'settings_updated', data);
  }

  notifyCalendarUpdated(userId: string, data?: any) {
    this.emitToUser(userId, 'calendar_updated', data);
  }

  notifyInsightsUpdated(userId: string, data?: any) {
    this.emitToUser(userId, 'insights_updated', data);
  }

  notifyActivityUpdated(userId: string, data?: any) {
    this.emitToUser(userId, 'activity_updated', data);
  }

  notifyCampaignsUpdated(userId: string) {
    this.emitToUser(userId, 'campaigns_updated', { timestamp: new Date().toISOString() });
  }

  notifyCampaignStatsUpdated(userId: string, campaignId: string) {
    this.emitToUser(userId, 'campaign_stats_updated', { campaignId, timestamp: new Date().toISOString() });
  }

  notifyStatsUpdated(userId: string, data?: any) {
    this.emitToUser(userId, 'stats_updated', { ...data, timestamp: new Date().toISOString() });
  }

  notifySyncStatus(userId: string, data: { syncing: boolean; folder?: string; integrationId?: string; disconnected?: boolean }) {
    this.emitToUser(userId, 'sync_status', data);
  }

  notifyEmailSent(userId: string, data: { leadId: string; messageId?: string; subject?: string }) {
    this.emitToUser(userId, 'activity_updated', {
      type: 'email_sent',
      title: 'Email Sent',
      message: `Message sent to lead`,
      ...data
    });
  }

  notifyDesktopNotification(userId: string, data: { title: string; message: string; url?: string; tag?: string }) {
    this.emitToUser(userId, 'desktop_notification', data);
  }

  notifyNotification(userId: string, data: any) {
    this.emitToUser(userId, 'notification', data);
  }

  /**
   * Phase 5 Fix: Real-time integration error propagation.
   * Called by background workers when a mailbox or social connection fails,
   * so the user sees an actionable toast in the dashboard immediately.
   */
  notifyIntegrationError(userId: string, data: {
    integrationId: string;
    provider?: string;
    errorType?: string;
    type?: string;
    title?: string;
    message: string;
    critical?: boolean;
  }) {
    this.emitToUser(userId, 'integration_error', {
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Advanced Real-time: Notify that an entire table or list needs refreshing
   */
  notifyTableUpdate(userId: string, tableName: string, data?: any) {
    this.emitToUser(userId, 'activity_updated', {
      type: 'table_refresh',
      table: tableName,
      ...data,
      timestamp: new Date().toISOString()
    });
  }

  notifyReputationUpdate(userId: string, data: { integrationId: string; score: number; status: string }) {
    this.emitToUser(userId, 'stats_updated', {
      type: 'reputation_change',
      ...data,
      timestamp: new Date().toISOString()
    });
  }

  // Generic broadcast
  broadcastToUser(userId: string, message: { type: string, payload: any }) {
    this.emitToUser(userId, message.type as MessageType, message.payload);
  }

  // Broadcast to all connected users (useful for system-wide security alerts)
  broadcastToAdmins(data: { type: string; data: any }) {
      if (!this.io) return;
      this.io.emit('SECURITY_ALERT', data.data);
  }

  getConnectedUsers(): string[] {
    return [];
  }
}

export const wsSync = new WebSocketSyncServer();
