import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';

/**
 * Phase 8: Real-time Event Broadcaster
 * Centralised Socket.io service for live dashboard updates.
 *
 * Events emitted:
 *  - lead:update         – A lead's status, metadata, or last message changed
 *  - outreach:progress   – A batch send step completed (per-lead result)
 *  - mailbox:warning     – A mailbox exceeded its daily limit or bounced
 *  - calendar:update     – A Calendly booking was created / cancelled / no-show
 *  - notification:new    – A new in-app notification for the user
 */

class SocketService {
  private io: SocketIOServer | null = null;

  /**
   * Attach Socket.io to an existing http.Server instance.
   * Call this ONCE from server/index.ts after express is mounted.
   */
  init(server: HttpServer): void {
    if (this.io) {
      console.warn('[SocketService] Already initialized – skipping re-init.');
      return;
    }

    this.io = new SocketIOServer(server, {
      path: '/ws',
      cors: {
        origin: [
          'https://audnixai.com',
          'https://www.audnixai.com',
          'http://localhost:5000',
          'http://localhost:5173',
        ],
        methods: ['GET', 'POST'],
        credentials: true,
      },
      transports: ['websocket'],
    });

    // Multi-node scaling: Connect to Redis Pub/Sub for cross-server event broadcasting
    (async () => {
      try {
        const { getPubClient, getSubClient } = await import('@shared/lib/redis/redis.js');
        const pub = await getPubClient();
        const sub = await getSubClient();
        
        if (pub && sub) {
          const { createAdapter } = await import('@socket.io/redis-adapter');
          this.io?.adapter(createAdapter(pub, sub));
          console.log('⚡ [SocketService] Redis Adapter initialized');
        }
      } catch (err) {
        console.error('[SocketService] Failed to initialize Redis adapter:', err);
      }
    })();

    this.io.on('connection', (socket: Socket) => {
      const userId = socket.handshake.query.userId as string | undefined;
      if (userId) {
        // Put the socket into a user-specific room so broadcasts are targeted
        socket.join(`user:${userId}`);
        console.log(`[SocketService] ✅ Client connected: ${socket.id} (user ${userId})`);
      } else {
        console.log(`[SocketService] 🔌 Anonymous client connected: ${socket.id}`);
      }

      socket.on('disconnect', () => {
        console.log(`[SocketService] 🔌 Client disconnected: ${socket.id}`);
      });
    });

    console.log('✅ Socket.io real-time broadcaster initialized on /ws');
  }

  // ─── Targeted Emitters ────────────────────────────────────────────────────

  /** Emit to all sockets that belong to a specific user */
  emitToUser(userId: string, event: string, data: unknown): void {
    if (!this.io) return;
    this.io.to(`user:${userId}`).emit(event, data);
  }

  /** Emit to every connected client (admin broadcasts, etc.) */
  broadcast(event: string, data: unknown): void {
    if (!this.io) return;
    this.io.emit(event, data);
  }

  // ─── Typed Helpers ───────────────────────────────────────────────────────

  notifyLeadUpdate(userId: string, payload: { leadId: string; status?: string; [key: string]: unknown }): void {
    this.emitToUser(userId, 'lead:update', payload);
  }

  notifyOutreachProgress(userId: string, payload: {
    leadEmail: string;
    status: 'sent' | 'failed' | 'skipped';
    subject?: string;
    error?: string;
  }): void {
    this.emitToUser(userId, 'outreach:progress', payload);
  }

  notifyMailboxWarning(userId: string, payload: {
    integrationId: string;
    provider: string;
    reason: string;
  }): void {
    this.emitToUser(userId, 'mailbox:warning', payload);
  }

  notifyCalendarUpdate(userId: string, payload: {
    bookingId: string;
    status: 'scheduled' | 'cancelled' | 'no_show' | 'completed';
    attendeeEmail?: string;
    startTime?: string;
  }): void {
    this.emitToUser(userId, 'calendar:update', payload);
  }

  notifyNewNotification(userId: string, payload: {
    type: string;
    title: string;
    message: string;
    metadata?: Record<string, unknown>;
  }): void {
    this.emitToUser(userId, 'notification:new', payload);
  }

  get isReady(): boolean {
    return this.io !== null;
  }

  getIo(): SocketIOServer | null {
    return this.io;
  }
}

// Singleton – import this anywhere in the server
export const socketService = new SocketService();
