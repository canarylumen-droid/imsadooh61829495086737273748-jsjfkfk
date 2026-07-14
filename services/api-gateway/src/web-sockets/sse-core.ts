/**
 * Core SSE Service - Basic client management and operations
 * This file contains the fundamental SSE functionality
 */

import { Request, Response } from 'express';
import { EventEmitter } from 'events';

export interface SSEClient {
  id: string;
  userId: string;
  response: Response;
  lastPing: number;
  connectedAt: number;
  messageQueue: any[];
  isPaused: boolean;
  rateLimitTokens: number;
  subscriptions: Set<string>;
  compressionEnabled: boolean;
  lastAck?: number;
  // Enterprise fields
  clientCircuitBreaker: {
    state: 'closed' | 'open' | 'half-open';
    failureCount: number;
    lastFailure: number;
  };
  messageSequence: number;
  weakRef?: any;
  isDraining: boolean;
  heartbeatMissed: number;
  lastHeartbeat: number;
  compressionType: 'gzip' | 'brotli' | 'none';
  encryptionKey?: string;
  authToken?: string;
}

export interface SSEMessage {
  type: string;
  userId?: string;
  integrationId?: string;
  domain?: string;
  data: any;
  timestamp: string;
  priority?: 'critical' | 'high' | 'normal' | 'low';
  messageId?: string;
  requiresAck?: boolean;
}

export class SSECoreService extends EventEmitter {
  protected clients: Map<string, SSEClient> = new Map();
  protected messageQueue: Map<string, any[]> = new Map();
  protected clientIdCounter = 0;
  protected isDraining = false;

  /**
   * Add a new SSE client
   */
  async addClient(req: Request, res: Response, options?: {
    compression?: boolean;
    subscriptions?: string[];
  }): Promise<string> {
    if (this.isDraining) {
      throw new Error('Server is draining, rejecting new connections');
    }

    const userId = (req as any).userId || 'anonymous';
    const clientId = `client_${this.clientIdCounter++}`;

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('X-SSE-Client-ID', clientId);

    const client: SSEClient = {
      id: clientId,
      userId,
      response: res,
      lastPing: Date.now(),
      connectedAt: Date.now(),
      messageQueue: [],
      isPaused: false,
      rateLimitTokens: 100,
      subscriptions: new Set(options?.subscriptions || []),
      compressionEnabled: options?.compression ?? true,
      lastAck: Date.now(),
      clientCircuitBreaker: {
        state: 'closed',
        failureCount: 0,
        lastFailure: 0,
      },
      messageSequence: 0,
      weakRef: undefined,
      isDraining: false,
      heartbeatMissed: 0,
      lastHeartbeat: Date.now(),
      compressionType: options?.compression ? 'gzip' : 'none',
      encryptionKey: undefined,
      authToken: (req as any).authToken,
    };

    this.clients.set(clientId, client);
    this.messageQueue.set(clientId, []);

    // Handle client disconnect
    req.on('close', () => {
      this.disconnectClient(clientId);
    });

    console.log(`[SSE Core] Client connected: ${clientId} for user: ${userId}`);
    this.emit('client_connected', { clientId, userId });
    return clientId;
  }

  /**
   * Disconnect a client gracefully
   */
  protected disconnectClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    try {
      client.response.end();
    } catch (error) {
      // Ignore errors during disconnect
    }

    this.clients.delete(clientId);
    this.messageQueue.delete(clientId);
    console.log(`[SSE Core] Client disconnected: ${clientId}`);
    this.emit('client_disconnected', { clientId });
  }

  /**
   * Send a message to a specific client
   */
  protected sendMessage(client: SSEClient, data: any): void {
    try {
      const message = `data: ${JSON.stringify(data)}\n\n`;
      client.response.write(message);
    } catch (e) {
      this.disconnectClient(client.id);
    }
  }

  /**
   * Check if message should be sent to client based on subscriptions
   */
  protected shouldSendToClient(client: SSEClient, message: SSEMessage): boolean {
    if (client.subscriptions.size === 0) return true;
    
    const messageType = message.type;
    return client.subscriptions.has(messageType);
  }

  /**
   * Get total number of clients
   */
  getTotalClients(): number {
    return this.clients.size;
  }

  /**
   * Get client by ID
   */
  getClient(clientId: string): SSEClient | undefined {
    return this.clients.get(clientId);
  }

  /**
   * Get all clients for a user
   */
  getClientsForUser(userId: string): SSEClient[] {
    return [...this.clients.values()].filter(c => c.userId === userId);
  }

  /**
   * Start connection draining
   */
  startDraining(): void {
    this.isDraining = true;
    console.log('[SSE Core] Starting connection drain');
  }

  /**
   * Stop connection draining
   */
  stopDraining(): void {
    this.isDraining = false;
    console.log('[SSE Core] Stopping connection drain');
  }

  /**
   * Check if server is draining
   */
  isServerDraining(): boolean {
    return this.isDraining;
  }
}
