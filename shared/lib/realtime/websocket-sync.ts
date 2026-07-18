import { Server, Socket } from 'socket.io';
import http from 'http';

type MessageType = 'leads_updated' | 'messages_updated' | 'deals_updated' | 'settings_updated' | 'ping' | 'pong' | 'PROSPECTING_LOG' | 'PROSPECT_FOUND' | 'PROSPECT_UPDATED' | 'notification' | 'calendar_updated' | 'TERMINATE_SESSION' | 'insights_updated' | 'activity_updated' | 'stats_updated' | 'campaigns_updated' | 'campaign_stats_updated' | 'desktop_notification' | 'SECURITY_ALERT' | 'sync_status' | 'integration_error' | 'new_mail' | 'mailbox_status' | 'integration_reputation_updated' | 'deliverability_updated' | 'dns_verified';

interface SyncMessage {
  type: MessageType;
  data?: any;
  timestamp: string;
}

class WebSocketSyncServer {
  private io: Server | null = null;
  private userSocketMap: Map<string, Set<string>> = new Map();

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
      path: '/socket.io',
      pingInterval: 15000,
      pingTimeout: 10000,
      connectTimeout: 5000
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

      // Track connected user
      if (!this.userSocketMap.has(userId)) {
        this.userSocketMap.set(userId, new Set());
      }
      this.userSocketMap.get(userId)!.add(socket.id);

      // Replay buffered offline events
      this.replayBufferedEvents(userId, socket);

      socket.on('disconnect', () => {
        const sockets = this.userSocketMap.get(userId);
        if (sockets) {
          sockets.delete(socket.id);
          if (sockets.size === 0) this.userSocketMap.delete(userId);
        }
      });

      socket.on('client:ready', () => {
        socket.emit('server:ready', { timestamp: Date.now() });
      });

      socket.on('client:heartbeat', (payload?: { timestamp?: number }) => {
        socket.emit('server:heartbeat', {
          timestamp: Date.now(),
          clientTimestamp: payload?.timestamp,
        });
      });

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
    // new_mail, mailbox_status, spam_detected must NEVER be throttled — inbox freshness and security depend on it
    const priorityEvents = ['notification', 'TERMINATE_SESSION', 'integration_error', 'SECURITY_ALERT', 'new_mail', 'mailbox_status', 'spam_detected', 'integration_reputation_updated'];

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

  private async getRedis() {
    try {
      const { getPubClient } = await import('@shared/lib/redis/redis.js');
      return await getPubClient();
    } catch { return null; }
  }

  private async bufferOfflineEvent(userId: string, event: MessageType, data: any, now: number) {
    const redis = await this.getRedis();
    if (!redis) return;
    try {
      const key = `ws:buffer:${userId}`;
      const message: SyncMessage = { type: event, data, timestamp: new Date(now).toISOString() };
      await redis.lPush(key, JSON.stringify(message));
      await redis.expire(key, 300);
      const len = await redis.lLen(key);
      if (len > 200) await redis.lTrim(key, 0, 199);
    } catch {}
  }

  private async replayBufferedEvents(userId: string, socket: any) {
    const redis = await this.getRedis();
    if (!redis) return;
    try {
      const key = `ws:buffer:${userId}`;
      const batch: string[] = [];
      let msg = await redis.rPop(key);
      while (msg) { batch.push(msg); msg = await redis.rPop(key); }
      if (batch.length === 0) return;
      batch.reverse();
      for (const raw of batch) {
        try {
          const parsed: SyncMessage = JSON.parse(raw);
          socket.emit('message', parsed);
          socket.emit(parsed.type, parsed.data);
        } catch {}
      }
      console.log(`[WebSocketSync] Replayed ${batch.length} buffered events for user ${userId}`);
    } catch {}
  }

  private executeEmit(userId: string, event: MessageType, data: any, now: number) {
    if (!this.io) return;
    
    const message: SyncMessage = {
      type: event,
      data,
      timestamp: new Date(now).toISOString()
    };

    const room = this.io.sockets.adapter.rooms.get(`user:${userId}`);
    const isConnected = room && room.size > 0;

    if (isConnected) {
      setImmediate(() => {
        if (!this.io) return;
        this.io.to(`user:${userId}`).emit('message', message);
        this.io.to(`user:${userId}`).emit(event, data);
      });
    } else {
      this.bufferOfflineEvent(userId, event, data, now);
    }

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
  /**
   * Real-time new mail push — fires immediately, no throttle.
   * Called by email-sync-queue after process-new-mail job completes.
   */
  notifyNewMail(userId: string, data: {
    integrationId: string;
    messageId?: string;
    subject?: string;
    from?: string;
    snippet?: string;
    date?: string;
    isNew?: boolean;
    refresh?: boolean;
    timestamp?: string;
  }) {
    this.emitToUser(userId, 'new_mail', {
      ...data,
      timestamp: data.timestamp || new Date().toISOString(),
    });
  }

  /**
   * Silent mailbox status update (reconnecting, paused etc).
   * Does NOT show an error toast — only updates the indicator icon.
   */
  notifyMailboxStatus(userId: string, data: {
    integrationId: string;
    status: 'connected' | 'reconnecting' | 'needs_reauth' | 'paused';
    message?: string;
  }) {
    this.emitToUser(userId, 'mailbox_status', {
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

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

  notifyIntegrationReputationUpdated(userId: string, data: {
    integrationId: string;
    score: number;
    sources: Record<string, number>;
    paused: boolean;
  }) {
    this.emitToUser(userId, 'integration_reputation_updated', {
      ...data,
      timestamp: new Date().toISOString()
    });
  }

  notifyDeliverabilityUpdated(userId: string, data: {
    type?: 'seed_placement' | 'reputation' | 'campaign_alert';
    campaignId?: string;
    domain?: string;
    inboxRate?: number;
    spamRate?: number;
    action?: string;
    folder?: string;
    source?: string;
    integrationId?: string;
    placement?: string;
    email?: string;
    spamCount?: number;
  }) {
    this.emitToUser(userId, 'deliverability_updated', {
      ...data,
      timestamp: new Date().toISOString()
    });
  }

  notifyDnsVerified(userId: string, data: { domain: string; score: number; spf: boolean; dkim: boolean; dmarc: boolean; mx: boolean; blacklist: boolean }) {
    this.emitToUser(userId, 'dns_verified', {
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
    return Array.from(this.userSocketMap.keys());
  }
}

export const wsSync = new WebSocketSyncServer();
