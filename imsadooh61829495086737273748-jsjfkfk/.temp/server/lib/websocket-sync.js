"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wsSync = void 0;
const socket_io_1 = require("socket.io");
class WebSocketSyncServer {
    io = null;
    initialize(server) {
        if (this.io) {
            console.log('socket.io already initialized');
            return;
        }
        this.io = new socket_io_1.Server(server, {
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
            path: '/socket.io' // Standard path
        });
        this.io.on('connection', (socket) => {
            const userId = socket.handshake.query.userId;
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
    emitToUser(userId, event, data) {
        if (!this.io)
            return;
        const message = {
            type: event,
            data,
            timestamp: new Date().toISOString()
        };
        // Emit 'message' event for generic listeners (legacy support)
        this.io.to(`user:${userId}`).emit('message', message);
        // Emit specific event for precise listeners
        this.io.to(`user:${userId}`).emit(event, data);
    }
    notifyLeadsUpdated(userId, data) {
        this.emitToUser(userId, 'leads_updated', data);
    }
    notifyMessagesUpdated(userId, data) {
        this.emitToUser(userId, 'messages_updated', data);
    }
    notifyDealsUpdated(userId, data) {
        this.emitToUser(userId, 'deals_updated', data);
    }
    notifySettingsUpdated(userId, data) {
        this.emitToUser(userId, 'settings_updated', data);
    }
    notifyCalendarUpdated(userId, data) {
        this.emitToUser(userId, 'calendar_updated', data);
    }
    notifyInsightsUpdated(userId, data) {
        this.emitToUser(userId, 'insights_updated', data);
    }
    notifyActivityUpdated(userId, data) {
        this.emitToUser(userId, 'activity_updated', data);
    }
    notifyNotification(userId, data) {
        this.emitToUser(userId, 'notification', data);
    }
    // Generic broadcast
    broadcastToUser(userId, message) {
        this.emitToUser(userId, message.type, message.payload);
    }
    // Admin/System wrappers
    getConnectedUsers() {
        // This is expensive in Socket.IO v4+, usually need fetchSockets()
        // For now, return empty or implement tracking if needed.
        return [];
    }
}
exports.wsSync = new WebSocketSyncServer();
