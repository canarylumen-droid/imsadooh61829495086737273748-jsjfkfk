/**
 * Enterprise-Grade Server-Sent Events (SSE) Streaming Service
 * Integrated with Domain Reputation Monitoring for real-time domain health tracking
 * 
 * CORE MODULES:
 * - sse-core.ts: Basic client management and operations
 * - sse-features.ts: Advanced features with granular sub-logic
 * - domain-reputation.ts: Domain reputation monitoring and prediction
 * 
 * FEATURES:
 * 1. Plan-aware rate limiting (free/pro/enterprise with unlimited enterprise connections)
 * 2. Domain reputation monitoring with background checks
 * 3. Real-time domain health predictions
 * 4. Batch processing for efficient message delivery
 * 5. Circuit breaker pattern for resilience
 * 6. Message deduplication with idempotency
 * 7. Connection draining for graceful shutdown
 * 8. Health monitoring and metrics
 * 9. Redis integration for horizontal scaling
 * 10. Message ordering and sequencing
 */

import { Request, Response } from 'express';
import { EventEmitter } from 'events';
import { createClient, RedisClientType } from 'redis';
import { SSECoreService, SSEClient, SSEMessage } from './sse-core.js';
import {
  CircuitBreakerManager,
  BatchProcessingManager,
  MessageDeduplicationManager,
  RateLimitingManager,
  MessageOrderingManager,
  HealthCheckManager,
} from './sse-features.js';
import { domainReputationMonitor } from './domain-reputation.js';

class AdvancedSSEService extends SSECoreService {
  // Feature managers (essential features only)
  private circuitBreakerManager = new CircuitBreakerManager();
  private batchProcessingManager = new BatchProcessingManager();
  private messageDeduplicationManager = new MessageDeduplicationManager();
  private rateLimitingManager = new RateLimitingManager();
  private messageOrderingManager = new MessageOrderingManager();
  private healthCheckManager = new HealthCheckManager();
  
  // Domain reputation monitoring integration
  private domainRepMonitor = domainReputationMonitor;
  
  // Redis client for horizontal scaling
  private redisClient?: RedisClientType;
  private redisConnected = false;
  
  // Dead letter queue
  private deadLetterQueue: any[] = [];
  
  // Configuration
  private readonly PING_INTERVAL = 30000;
  private readonly HEARTBEAT_INTERVAL = 15000;
  private readonly MAX_QUEUE_SIZE = 1000;
  private readonly COMPRESSION_THRESHOLD = 1024;
  private readonly MESSAGE_TTL = 300000;
  
  // State
  private pingInterval?: NodeJS.Timeout;
  private heartbeatInterval?: NodeJS.Timeout;
  private metricsInterval?: NodeJS.Timeout;
  private cleanupInterval?: NodeJS.Timeout;
  private messageIdCounter = 0;
  private metrics = {
    totalClients: 0,
    messagesSent: 0,
    messagesQueued: 0,
    deadLetterCount: 0,
    averageLatency: 0,
    compressionRatio: 0,
    circuitBreakerState: 'closed' as 'closed' | 'open' | 'half-open',
    memoryUsage: 0,
    cpuUsage: 0,
    redisConnected: false,
    activeConnections: 0,
    messagesPerSecond: 0,
    errorRate: 0,
    throughput: 0,
    p95Latency: 0,
    p99Latency: 0,
  };
  private latencyMeasurements: number[] = [];
  private messagesLastSecond = 0;
  private errorsLastSecond = 0;

  constructor() {
    super();
    this.initializeRedis();
    this.startPingInterval();
    this.startHeartbeatMonitor();
    this.startMetricsCollection();
    this.startCleanup();
    this.registerHealthChecks();
    this.setupDomainRepIntegration();
    
    // Set up batch processing callback
    this.batchProcessingManager.setSendCallback((clientId, messages) => {
      this.sendBatchToClient(clientId, messages);
    });
  }

  /**
   * Set up domain reputation monitoring integration
   */
  private setupDomainRepIntegration(): void {
    // Listen for domain reputation updates and broadcast to relevant users
    this.domainRepMonitor.on('mailbox_domain_updated', (data) => {
      this.broadcast({
        type: 'domain_reputation',
        userId: data.userId,
        domain: data.domain,
        data: data.reputation,
        timestamp: new Date().toISOString(),
      }, { 
        userId: data.userId,
        priority: 'high',
      });
    });
  }

  /**
   * Register a mailbox for domain reputation monitoring (non-blocking)
   * Domain check happens in background, does not affect connection speed
   */
  registerMailboxForMonitoring(mailbox: {
    userId: string;
    integrationId: string;
    domain: string;
    email: string;
    provider: 'gmail' | 'outlook' | 'custom_email';
    plan: 'free' | 'pro' | 'enterprise';
  }): void {
    this.domainRepMonitor.registerMailbox({
      ...mailbox,
      connectedAt: new Date(),
    });
  }

  /**
   * Unregister a mailbox from domain reputation monitoring
   */
  async unregisterMailboxFromMonitoring(integrationId: string): Promise<void> {
    await this.domainRepMonitor.unregisterMailbox(integrationId);
  }

  /**
   * Get domain reputation for a specific domain
   */
  async getDomainReputation(domain: string) {
    return await this.domainRepMonitor.getDomainReputation(domain);
  }

  /**
   * Force immediate domain reputation check
   */
  async forceDomainCheck(domain: string) {
    return await this.domainRepMonitor.forceDomainCheck(domain);
  }

  /**
   * Get domain reputation health check
   */
  async getDomainRepHealth() {
    return await this.domainRepMonitor.healthCheck();
  }

  /**
   * Send batch of messages to a specific client
   */
  private sendBatchToClient(clientId: string, messages: SSEMessage[]): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    try {
      const batchMessage = `data: ${JSON.stringify({ type: 'batch', messages })}\n\n`;
      client.response.write(batchMessage);
      this.metrics.messagesSent += messages.length;
    } catch (error) {
      console.error(`[SSE] Failed to send batch to client ${clientId}:`, error);
      client.clientCircuitBreaker.failureCount++;
      this.disconnectClient(clientId);
    }
  }

  /**
   * Add a new SSE client with advanced features
   */
  async addClient(req: Request, res: Response, options?: {
    compression?: boolean;
    subscriptions?: string[];
  }): Promise<string> {
    // Check circuit breaker
    if (this.circuitBreakerManager.getState() === 'open') {
      throw new Error('Circuit breaker is open, rejecting new connections');
    }

    // Check if server is draining
    if (this.isServerDraining()) {
      throw new Error('Server is draining, rejecting new connections');
    }

    const userId = (req as any).userId || 'anonymous';

    // Check rate limiting (plan-aware)
    if (!(await this.rateLimitingManager.hasTokens(userId))) {
      throw new Error('Rate limit exceeded for user');
    }

    // Consume token
    await this.rateLimitingManager.consumeToken(userId);

    // Check connection limit based on plan (enterprise has unlimited)
    const maxConnections = await this.rateLimitingManager.getMaxConnectionsForUser(userId);
    if (maxConnections !== Infinity) {
      const currentConnections = this.getClientsForUser(userId).length;
      if (currentConnections >= maxConnections) {
        throw new Error(`Connection limit exceeded for user (max: ${maxConnections})`);
      }
    }

    // Call parent addClient
    const clientId = super.addClient(req, res, options);

    // Register health check for this client
    this.healthCheckManager.registerHealthCheck(`client:${clientId}`);

    console.log(`[SSE] Advanced client connected: ${clientId} for user: ${userId}`);
    return clientId;
  }

  /**
   * Broadcast with priority and filtering (enterprise-grade)
   */
  broadcast(message: SSEMessage, options?: {
    userId?: string;
    priority?: 'critical' | 'high' | 'normal' | 'low';
    requireAck?: boolean;
    idempotencyKey?: string;
    ttl?: number;
  }): void {
    // Check circuit breaker
    if (this.circuitBreakerManager.getState() === 'open') {
      console.warn('[SSE] Circuit breaker open, message dropped');
      return;
    }

    // Check deduplication
    if (options?.idempotencyKey && this.messageDeduplicationManager.isDuplicate(options.idempotencyKey)) {
      console.warn('[SSE] Duplicate message dropped');
      return;
    }

    // Add to dedup cache
    if (options?.idempotencyKey) {
      this.messageDeduplicationManager.addToCache(options.idempotencyKey);
    }

    const targetClients = options?.userId 
      ? this.getClientsForUser(options.userId)
      : [...this.clients.values()];

    for (const client of targetClients) {
      // Check client circuit breaker
      if (client.clientCircuitBreaker.state === 'open') {
        console.warn(`[SSE] Client circuit breaker open for ${client.id}, skipping`);
        continue;
      }

      if (this.shouldSendToClient(client, message)) {
        message.priority = options?.priority || message.priority;
        message.requiresAck = options?.requireAck;
        message.messageId = `msg_${this.messageIdCounter++}`;
        
        // Assign sequence number for ordering
        const sequence = this.messageOrderingManager.getNextSequence(client.id);
        (message as any).sequence = sequence;
        
        // Use batch processing
        this.batchProcessingManager.addToBatch(client.id, message);
        
        this.messagesLastSecond++;
      }
    }
  }

  /**
   * Update mailbox health for a user
   */
  updateMailboxHealth(userId: string, integrationId: string, healthData: any): void {
    this.broadcast({
      type: 'mailbox_health',
      userId,
      integrationId,
      data: healthData,
      timestamp: new Date().toISOString(),
    }, { priority: 'high' });
  }

  /**
   * Update DNS verification for a domain
   */
  updateDNSVerification(userId: string, domain: string, dnsData: any): void {
    this.broadcast({
      type: 'dns_verification',
      userId,
      domain,
      data: dnsData,
      timestamp: new Date().toISOString(),
    }, { priority: 'normal' });
  }

  /**
   * Get health metrics
   */
  async getHealthMetrics() {
    const domainRepHealth = await this.domainRepMonitor.healthCheck();
    
    return {
      ...this.metrics,
      ...this.circuitBreakerManager.getStats(),
      ...this.batchProcessingManager.getBatchStats(),
      ...this.messageDeduplicationManager.getDedupStats(),
      ...this.messageOrderingManager.getOrderingStats(),
      ...this.domainRepMonitor.getStats(),
      domainRepHealth,
      overallHealth: this.healthCheckManager.getOverallHealth(),
    };
  }

  /**
   * Get dead letter queue
   */
  getDeadLetterQueue(limit: number = 100) {
    return this.deadLetterQueue.slice(0, limit);
  }

  /**
   * Clear dead letter queue
   */
  clearDeadLetterQueue(): void {
    this.deadLetterQueue = [];
  }

  /**
   * Reset circuit breaker
   */
  resetCircuitBreaker(): void {
    this.circuitBreakerManager = new CircuitBreakerManager();
  }

  /**
   * Start connection draining
   */
  startDraining(): void {
    super.startDraining();
  }

  /**
   * Stop connection draining
   */
  stopDraining(): void {
    super.stopDraining();
  }

  /**
   * Initialize Redis for horizontal scaling
   */
  private async initializeRedis(): Promise<void> {
    try {
      this.redisClient = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        socket: {
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              console.error('[SSE] Redis reconnection failed after 10 retries');
              return new Error('Redis reconnection failed');
            }
            return Math.min(retries * 100, 3000);
          },
        },
      });

      this.redisClient.on('error', (err) => {
        console.error('[SSE] Redis error:', err);
        this.metrics.redisConnected = false;
      });

      this.redisClient.on('connect', () => {
        console.log('[SSE] Redis connected');
        this.metrics.redisConnected = true;
      });

      await this.redisClient.connect();
    } catch (error) {
      console.error('[SSE] Failed to initialize Redis:', error);
      this.metrics.redisConnected = false;
    }
  }

  /**
   * Start the ping interval to keep connections alive
   */
  private startPingInterval(): void {
    this.pingInterval = setInterval(() => {
      const now = Date.now();
      
      for (const [clientId, client] of this.clients.entries()) {
        if (now - client.lastPing > this.PING_INTERVAL * 2) {
          console.warn(`[SSE] Client ${clientId} timeout, disconnecting`);
          this.disconnectClient(clientId);
        } else {
          try {
            client.response.write(': ping\n\n');
            client.lastPing = now;
          } catch (error) {
            this.disconnectClient(clientId);
          }
        }
      }
    }, this.PING_INTERVAL);
  }

  /**
   * Start heartbeat monitor
   */
  private startHeartbeatMonitor(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      
      for (const [clientId, client] of this.clients.entries()) {
        // Check heartbeat
        if (now - client.lastHeartbeat > this.HEARTBEAT_INTERVAL * 2) {
          client.heartbeatMissed++;
          
          if (client.heartbeatMissed >= 3) {
            console.warn(`[SSE] Client ${clientId} missed 3 heartbeats, disconnecting`);
            this.disconnectClient(clientId);
            continue;
          }
        }
        
        // Send heartbeat
        try {
          client.response.write(': heartbeat\n\n');
          client.lastHeartbeat = now;
        } catch (error) {
          this.disconnectClient(clientId);
        }
      }
    }, this.HEARTBEAT_INTERVAL);
  }

  /**
   * Start metrics collection
   */
  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(() => {
      this.metrics.totalClients = this.getTotalClients();
      this.metrics.messagesPerSecond = this.messagesLastSecond;
      this.messagesLastSecond = 0;
      
      this.metrics.errorRate = this.errorsLastSecond / Math.max(this.metrics.messagesPerSecond, 1);
      this.errorsLastSecond = 0;
      
      this.metrics.throughput = this.metrics.messagesPerSecond * 1024;
      
      if (this.latencyMeasurements.length > 0) {
        const sorted = [...this.latencyMeasurements].sort((a, b) => a - b);
        this.metrics.p95Latency = sorted[Math.floor(sorted.length * 0.95)];
        this.metrics.p99Latency = sorted[Math.floor(sorted.length * 0.99)];
        this.metrics.averageLatency = sorted.reduce((a, b) => a + b, 0) / sorted.length;
      }
      
      this.metrics.memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024;
      this.metrics.circuitBreakerState = this.circuitBreakerManager.getState();
      
      // Update health checks
      this.healthCheckManager.updateHealthStatus('redis', this.metrics.redisConnected ? 'healthy' : 'unhealthy');
      this.healthCheckManager.updateHealthStatus('circuit_breaker', this.metrics.circuitBreakerState === 'closed' ? 'healthy' : 'unhealthy');
      
    }, 1000);
  }

  /**
   * Start cleanup tasks
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.messageDeduplicationManager.cleanupExpired();
    }, 60000); // Every minute
  }

  /**
   * Register health checks
   */
  private registerHealthChecks(): void {
    this.healthCheckManager.registerHealthCheck('redis');
    this.healthCheckManager.registerHealthCheck('circuit_breaker');
    this.healthCheckManager.registerHealthCheck('batch_processor');
    this.healthCheckManager.registerHealthCheck('domain_reputation');
  }
}

// Singleton instance
export const sseService = new AdvancedSSEService();
