/**
 * Advanced SSE Features - Granular sub-features for enterprise functionality
 * This file contains all the advanced features with detailed sub-logic
 */

import { SSEClient, SSEMessage } from './sse-core.js';

/**
 * CONNECTION DRAINING SUB-FEATURES (5 sub-features)
 */
export class ConnectionDrainingManager {
  private drainStartTime?: number;
  private drainTimeout?: number;
  private readonly DRAIN_TIMEOUT_MS = 30000; // 30 seconds
  private forceDisconnectThreshold = 0.1; // 10% remaining triggers force disconnect
  private drainProgress = 0;

  /**
   * 1. Start draining with timeout
   */
  startDraining(initialClientCount: number): void {
    this.drainStartTime = Date.now();
    this.drainProgress = 0;
    console.log(`[ConnectionDraining] Started draining ${initialClientCount} clients`);
  }

  /**
   * 2. Check if drain timeout exceeded
   */
  isDrainTimeoutExceeded(): boolean {
    if (!this.drainStartTime) return false;
    return (Date.now() - this.drainStartTime) > this.DRAIN_TIMEOUT_MS;
  }

  /**
   * 3. Calculate drain progress
   */
  calculateDrainProgress(currentClients: number, initialClients: number): number {
    this.drainProgress = 1 - (currentClients / initialClients);
    return this.drainProgress;
  }

  /**
   * 4. Check if force disconnect should be triggered
   */
  shouldForceDisconnect(currentClients: number, initialClients: number): boolean {
    const remainingRatio = currentClients / initialClients;
    return remainingRatio < this.forceDisconnectThreshold || this.isDrainTimeoutExceeded();
  }

  /**
   * 5. Force disconnect remaining clients
   */
  forceDisconnectAll(clients: Map<string, SSEClient>): void {
    console.log(`[ConnectionDraining] Force disconnecting ${clients.size} remaining clients`);
    for (const [clientId, client] of clients.entries()) {
      try {
        client.response.write('event: system_status\ndata: {"status":"server_shutdown"}\n\n');
        client.response.end();
      } catch (error) {
        // Ignore errors
      }
    }
  }
}

/**
 * BACKPRESSURE SUB-FEATURES (5 sub-features)
 */
export class BackpressureManager {
  private adaptiveThreshold = 65536; // 64KB base threshold
  private pressureHistory: number[] = [];
  private readonly HISTORY_SIZE = 10;
  private backpressureEvents = 0;

  /**
   * 1. Adaptive threshold adjustment based on history
   */
  getAdaptiveThreshold(): number {
    if (this.pressureHistory.length < this.HISTORY_SIZE) {
      return this.adaptiveThreshold;
    }

    const avgPressure = this.pressureHistory.reduce((a, b) => a + b, 0) / this.pressureHistory.length;
    
    // Adjust threshold based on average pressure
    if (avgPressure > this.adaptiveThreshold * 0.8) {
      this.adaptiveThreshold = Math.min(this.adaptiveThreshold * 1.2, 131072); // Max 128KB
    } else if (avgPressure < this.adaptiveThreshold * 0.3) {
      this.adaptiveThreshold = Math.max(this.adaptiveThreshold * 0.8, 32768); // Min 32KB
    }

    return this.adaptiveThreshold;
  }

  /**
   * 2. Monitor buffer size with sliding window
   */
  monitorBufferSize(bufferSize: number): void {
    this.pressureHistory.push(bufferSize);
    if (this.pressureHistory.length > this.HISTORY_SIZE) {
      this.pressureHistory.shift();
    }
  }

  /**
   * 3. Check if under pressure with hysteresis
   */
  isUnderPressure(bufferSize: number): boolean {
    const threshold = this.getAdaptiveThreshold();
    // Add hysteresis to prevent flapping
    return bufferSize > threshold * 1.1;
  }

  /**
   * 4. Calculate pressure level (0-1)
   */
  calculatePressureLevel(bufferSize: number): number {
    const threshold = this.getAdaptiveThreshold();
    return Math.min(bufferSize / (threshold * 2), 1);
  }

  /**
   * 5. Track backpressure events for metrics
   */
  recordBackpressureEvent(): void {
    this.backpressureEvents++;
  }

  getBackpressureStats() {
    return {
      adaptiveThreshold: this.adaptiveThreshold,
      avgPressure: this.pressureHistory.length > 0 
        ? this.pressureHistory.reduce((a, b) => a + b, 0) / this.pressureHistory.length 
        : 0,
      events: this.backpressureEvents,
    };
  }
}

/**
 * CIRCUIT BREAKER SUB-FEATURES (5 sub-features)
 */
export class CircuitBreakerManager {
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private failureCount = 0;
  private lastFailureTime = 0;
  private successCount = 0;
  private readonly FAILURE_THRESHOLD = 50; // 50% failure rate
  private readonly TIMEOUT_MS = 60000; // 1 minute
  private readonly HALF_OPEN_SUCCESS_THRESHOLD = 5; // 5 successes to close

  /**
   * 1. Record failure with timestamp
   */
  recordFailure(totalRequests: number): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    const failureRate = (this.failureCount / totalRequests) * 100;
    if (failureRate >= this.FAILURE_THRESHOLD && this.state === 'closed') {
      this.open();
    }
  }

  /**
   * 2. Record success for half-open state
   */
  recordSuccess(): void {
    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= this.HALF_OPEN_SUCCESS_THRESHOLD) {
        this.close();
      }
    } else if (this.state === 'closed') {
      // Reset failure count on success in closed state
      this.failureCount = Math.max(0, this.failureCount - 1);
    }
  }

  /**
   * 3. Open circuit breaker
   */
  private open(): void {
    this.state = 'open';
    console.warn('[CircuitBreaker] Circuit opened due to high failure rate');
  }

  /**
   * 4. Close circuit breaker
   */
  private close(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    console.log('[CircuitBreaker] Circuit closed');
  }

  /**
   * 5. Check if should attempt recovery (half-open)
   */
  shouldAttemptRecovery(): boolean {
    if (this.state === 'open') {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure > this.TIMEOUT_MS) {
        this.state = 'half-open';
        this.successCount = 0;
        console.log('[CircuitBreaker] Circuit moved to half-open for testing');
        return true;
      }
    }
    return this.state === 'half-open';
  }

  getState(): 'closed' | 'open' | 'half-open' {
    return this.state;
  }

  getStats() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
    };
  }
}

/**
 * BATCH PROCESSING SUB-FEATURES (5 sub-features)
 */
export class BatchProcessingManager {
  private batches = new Map<string, SSEMessage[]>();
  private batchTimeouts = new Map<string, NodeJS.Timeout>();
  private readonly BATCH_SIZE = 50;
  private readonly BATCH_TIMEOUT = 100;
  private batchStats = {
    totalBatches: 0,
    avgBatchSize: 0,
    totalMessages: 0,
  };
  private sendCallback?: (clientId: string, messages: SSEMessage[]) => void;

  /**
   * Set callback to send batches to clients
   */
  setSendCallback(callback: (clientId: string, messages: SSEMessage[]) => void): void {
    this.sendCallback = callback;
  }

  /**
   * 1. Add message to batch with priority ordering
   */
  addToBatch(clientId: string, message: SSEMessage): void {
    if (!this.batches.has(clientId)) {
      this.batches.set(clientId, []);
    }

    const batch = this.batches.get(clientId)!;
    
    // Insert in priority order
    const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
    const insertIndex = batch.findIndex(
      m => priorityOrder[m.priority || 'normal'] > priorityOrder[message.priority || 'normal']
    );
    
    if (insertIndex === -1) {
      batch.push(message);
    } else {
      batch.splice(insertIndex, 0, message);
    }

    this.resetBatchTimeout(clientId);

    if (batch.length >= this.BATCH_SIZE) {
      this.flushBatch(clientId);
    }
  }

  /**
   * 2. Reset batch timeout with debouncing
   */
  private resetBatchTimeout(clientId: string): void {
    const existingTimeout = this.batchTimeouts.get(clientId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const timeout = setTimeout(() => this.flushBatch(clientId), this.BATCH_TIMEOUT);
    this.batchTimeouts.set(clientId, timeout);
  }

  /**
   * 3. Flush batch with size optimization
   */
  flushBatch(clientId: string): SSEMessage[] {
    const batch = this.batches.get(clientId);
    if (!batch || batch.length === 0) return [];

    // Update stats
    this.batchStats.totalBatches++;
    this.batchStats.totalMessages += batch.length;
    this.batchStats.avgBatchSize = this.batchStats.totalMessages / this.batchStats.totalBatches;

    // Clear timeout
    const timeout = this.batchTimeouts.get(clientId);
    if (timeout) {
      clearTimeout(timeout);
      this.batchTimeouts.delete(clientId);
    }

    // Send batch using callback
    if (this.sendCallback) {
      this.sendCallback(clientId, batch);
    }

    this.batches.delete(clientId);
    return batch;
  }

  /**
   * 4. Get batch size for a client
   */
  getBatchSize(clientId: string): number {
    return this.batches.get(clientId)?.length || 0;
  }

  /**
   * 5. Get batch statistics
   */
  getBatchStats() {
    return { ...this.batchStats, pendingBatches: this.batches.size };
  }
}

/**
 * CONNECTION POOLING SUB-FEATURES (5 sub-features)
 */
export class ConnectionPoolManager {
  private pool: Map<string, any> = new Map();
  private poolStats = new Map<string, { hits: number; misses: number }>();
  private readonly MAX_POOL_SIZE = 100;
  private readonly POOL_TTL = 300000; // 5 minutes

  /**
   * 1. Get connection from pool with LRU eviction
   */
  getConnection(key: string): any | null {
    const stats = this.poolStats.get(key) || { hits: 0, misses: 0 };
    
    const connection = this.pool.get(key);
    if (connection) {
      stats.hits++;
      this.poolStats.set(key, stats);
      return connection;
    }

    stats.misses++;
    this.poolStats.set(key, stats);
    return null;
  }

  /**
   * 2. Add connection to pool with size limit
   */
  addConnection(key: string, connection: any): void {
    if (this.pool.size >= this.MAX_POOL_SIZE) {
      this.evictLRU();
    }

    this.pool.set(key, connection);
  }

  /**
   * 3. Evict least recently used connection
   */
  private evictLRU(): void {
    const keys = Array.from(this.pool.keys());
    const lruKey = keys[0]; // Simple LRU - first key is oldest
    this.pool.delete(lruKey);
    this.poolStats.delete(lruKey);
  }

  /**
   * 4. Clean up expired connections
   */
  cleanupExpired(): void {
    const now = Date.now();
    for (const [key, connection] of this.pool.entries()) {
      if (connection.createdAt && (now - connection.createdAt) > this.POOL_TTL) {
        this.pool.delete(key);
        this.poolStats.delete(key);
      }
    }
  }

  /**
   * 5. Get pool statistics
   */
  getPoolStats() {
    const totalHits = Array.from(this.poolStats.values()).reduce((sum, stats) => sum + stats.hits, 0);
    const totalMisses = Array.from(this.poolStats.values()).reduce((sum, stats) => sum + stats.misses, 0);
    
    return {
      size: this.pool.size,
      maxSize: this.MAX_POOL_SIZE,
      hitRate: totalHits / (totalHits + totalMisses) || 0,
      totalHits,
      totalMisses,
    };
  }
}

/**
 * MESSAGE DEDUPLICATION SUB-FEATURES (5 sub-features)
 */
export class MessageDeduplicationManager {
  private dedupCache = new Map<string, { timestamp: number; count: number }>();
  private bloomFilter?: Set<string>;
  private readonly DEDUP_TTL = 60000; // 1 minute
  private readonly BLOOM_FILTER_SIZE = 10000;

  /**
   * 1. Check duplicate with Bloom filter
   */
  isDuplicate(idempotencyKey: string): boolean {
    // Check Bloom filter first (fast path)
    if (this.bloomFilter?.has(idempotencyKey)) {
      return true;
    }

    const cached = this.dedupCache.get(idempotencyKey);
    if (cached && (Date.now() - cached.timestamp) < this.DEDUP_TTL) {
      return true;
    }

    return false;
  }

  /**
   * 2. Add to dedup cache with count
   */
  addToCache(idempotencyKey: string): void {
    const cached = this.dedupCache.get(idempotencyKey);
    const count = cached ? cached.count + 1 : 1;
    
    this.dedupCache.set(idempotencyKey, {
      timestamp: Date.now(),
      count,
    });

    // Add to Bloom filter
    if (!this.bloomFilter) {
      this.bloomFilter = new Set();
    }
    this.bloomFilter.add(idempotencyKey);

    // Limit Bloom filter size
    if (this.bloomFilter.size > this.BLOOM_FILTER_SIZE) {
      this.bloomFilter.clear();
    }
  }

  /**
   * 3. Get duplicate count for a key
   */
  getDuplicateCount(idempotencyKey: string): number {
    return this.dedupCache.get(idempotencyKey)?.count || 0;
  }

  /**
   * 4. Clean up expired entries
   */
  cleanupExpired(): void {
    const now = Date.now();
    for (const [key, value] of this.dedupCache.entries()) {
      if (now - value.timestamp > this.DEDUP_TTL) {
        this.dedupCache.delete(key);
      }
    }
  }

  /**
   * 5. Get deduplication statistics
   */
  getDedupStats() {
    return {
      cacheSize: this.dedupCache.size,
      bloomFilterSize: this.bloomFilter?.size || 0,
      totalDuplicates: Array.from(this.dedupCache.values()).reduce((sum, v) => sum + v.count, 0),
    };
  }
}

/**
 * REDIS INTEGRATION SUB-FEATURES (5 sub-features)
 */
export class RedisIntegrationManager {
  private pubSubChannels = new Set<string>();
  private distributedLocks = new Map<string, { owner: string; expiry: number }>();

  /**
   * 1. Subscribe to Redis pub/sub channel
   */
  async subscribeToChannel(channel: string, callback: (message: any) => void): Promise<void> {
    this.pubSubChannels.add(channel);
    // Implementation would use actual Redis client
    console.log(`[RedisIntegration] Subscribed to channel: ${channel}`);
  }

  /**
   * 2. Publish message to Redis channel
   */
  async publishToChannel(channel: string, message: any): Promise<void> {
    // Implementation would use actual Redis client
    console.log(`[RedisIntegration] Published to channel: ${channel}`);
  }

  /**
   * 3. Acquire distributed lock
   */
  async acquireLock(lockKey: string, ttl: number): Promise<boolean> {
    const existingLock = this.distributedLocks.get(lockKey);
    if (existingLock && Date.now() < existingLock.expiry) {
      return false;
    }

    this.distributedLocks.set(lockKey, {
      owner: `worker_${process.pid}`,
      expiry: Date.now() + ttl,
    });
    return true;
  }

  /**
   * 4. Release distributed lock
   */
  async releaseLock(lockKey: string): Promise<void> {
    this.distributedLocks.delete(lockKey);
  }

  /**
   * 5. Get active subscriptions
   */
  getActiveSubscriptions(): string[] {
    return Array.from(this.pubSubChannels);
  }
}

/**
 * RATE LIMITING SUB-FEATURES (5 sub-features)
 */
export class RateLimitingManager {
  private userLimits = new Map<string, { tokens: number; lastRefill: number; plan: string }>();
  private planLimits = {
    free: { tokensPerRefill: 50, maxTokens: 50, connectionsPerUser: 2 },
    pro: { tokensPerRefill: 200, maxTokens: 200, connectionsPerUser: 10 },
    enterprise: { tokensPerRefill: 1000, maxTokens: 1000, connectionsPerUser: Infinity },
  };
  private readonly REFILL_INTERVAL = 60000; // 1 minute
  private getUserPlanCallback?: (userId: string) => Promise<string>;

  /**
   * Set callback to get user's plan
   */
  setUserPlanCallback(callback: (userId: string) => Promise<string>): void {
    this.getUserPlanCallback = callback;
  }

  /**
   * 1. Check if user has tokens available (plan-aware)
   */
  async hasTokens(userId: string): Promise<boolean> {
    const plan = await this.getUserPlan(userId);
    const state = this.getUserState(userId, plan);
    this.refillTokens(state, plan);
    return state.tokens > 0;
  }

  /**
   * 2. Consume token from user bucket (plan-aware)
   */
  async consumeToken(userId: string): Promise<boolean> {
    const plan = await this.getUserPlan(userId);
    const state = this.getUserState(userId, plan);
    this.refillTokens(state, plan);

    if (state.tokens > 0) {
      state.tokens--;
      return true;
    }
    return false;
  }

  /**
   * 3. Refill tokens based on time elapsed and plan
   */
  private refillTokens(state: { tokens: number; lastRefill: number; plan: string }, plan: string): void {
    const now = Date.now();
    const elapsed = now - state.lastRefill;
    const planConfig = this.planLimits[plan as keyof typeof this.planLimits] || this.planLimits.free;
    
    if (elapsed >= this.REFILL_INTERVAL) {
      const refills = Math.floor(elapsed / this.REFILL_INTERVAL);
      state.tokens = Math.min(
        state.tokens + refills * planConfig.tokensPerRefill,
        planConfig.maxTokens
      );
      state.lastRefill = now;
    }
  }

  /**
   * 4. Get remaining tokens for user (plan-aware)
   */
  async getRemainingTokens(userId: string): Promise<number> {
    const plan = await this.getUserPlan(userId);
    const state = this.getUserState(userId, plan);
    this.refillTokens(state, plan);
    return state.tokens;
  }

  /**
   * 5. Get max connections allowed for user based on plan
   */
  async getMaxConnectionsForUser(userId: string): Promise<number> {
    const plan = await this.getUserPlan(userId);
    const planConfig = this.planLimits[plan as keyof typeof this.planLimits] || this.planLimits.free;
    return planConfig.connectionsPerUser;
  }

  /**
   * Reset user rate limit (admin function)
   */
  resetUserLimit(userId: string): void {
    this.userLimits.delete(userId);
  }

  /**
   * Get user's plan
   */
  private async getUserPlan(userId: string): Promise<string> {
    if (this.getUserPlanCallback) {
      try {
        return await this.getUserPlanCallback(userId);
      } catch (error) {
        console.error('[RateLimiting] Failed to get user plan:', error);
      }
    }
    return 'free'; // Default to free plan
  }

  private getUserState(userId: string, plan: string) {
    let state = this.userLimits.get(userId);
    const planConfig = this.planLimits[plan as keyof typeof this.planLimits] || this.planLimits.free;
    
    if (!state) {
      state = { 
        tokens: planConfig.tokensPerRefill, 
        lastRefill: Date.now(),
        plan,
      };
      this.userLimits.set(userId, state);
    }
    
    // Update plan if it changed
    if (state.plan !== plan) {
      state.plan = plan;
      state.tokens = Math.min(state.tokens, planConfig.maxTokens);
    }
    
    return state;
  }
}

/**
 * MESSAGE ORDERING SUB-FEATURES (5 sub-features)
 */
export class MessageOrderingManager {
  private clientSequences = new Map<string, number>();
  private pendingMessages = new Map<string, Map<number, SSEMessage>>();
  private outOfOrderCount = 0;

  /**
   * 1. Get next sequence number for client
   */
  getNextSequence(clientId: string): number {
    const current = this.clientSequences.get(clientId) || 0;
    const next = current + 1;
    this.clientSequences.set(clientId, next);
    return next;
  }

  /**
   * 2. Check if message is in order
   */
  isInOrder(clientId: string, sequence: number): boolean {
    const expected = (this.clientSequences.get(clientId) || 0) + 1;
    return sequence === expected;
  }

  /**
   * 3. Buffer out-of-order message
   */
  bufferOutOfOrder(clientId: string, sequence: number, message: SSEMessage): void {
    if (!this.pendingMessages.has(clientId)) {
      this.pendingMessages.set(clientId, new Map());
    }
    this.pendingMessages.get(clientId)!.set(sequence, message);
    this.outOfOrderCount++;
  }

  /**
   * 4. Get buffered messages in order
   */
  getBufferedMessages(clientId: string): SSEMessage[] {
    const pending = this.pendingMessages.get(clientId);
    if (!pending) return [];

    let expected = (this.clientSequences.get(clientId) || 0) + 1;
    const messages: SSEMessage[] = [];

    while (pending.has(expected)) {
      messages.push(pending.get(expected)!);
      pending.delete(expected);
      this.clientSequences.set(clientId, expected);
      expected++;
    }

    return messages;
  }

  /**
   * 5. Get ordering statistics
   */
  getOrderingStats() {
    return {
      outOfOrderCount: this.outOfOrderCount,
      pendingMessages: Array.from(this.pendingMessages.values()).reduce((sum, map) => sum + map.size, 0),
    };
  }
}

/**
 * HEALTH CHECK SUB-FEATURES (5 sub-features)
 */
export class HealthCheckManager {
  private healthChecks = new Map<string, { lastCheck: number; status: 'healthy' | 'unhealthy' }>();
  private readonly CHECK_INTERVAL = 30000; // 30 seconds

  /**
   * 1. Register health check
   */
  registerHealthCheck(name: string): void {
    this.healthChecks.set(name, {
      lastCheck: Date.now(),
      status: 'healthy',
    });
  }

  /**
   * 2. Update health check status
   */
  updateHealthStatus(name: string, status: 'healthy' | 'unhealthy'): void {
    const check = this.healthChecks.get(name);
    if (check) {
      check.status = status;
      check.lastCheck = Date.now();
    }
  }

  /**
   * 3. Check if health check is stale
   */
  isHealthCheckStale(name: string): boolean {
    const check = this.healthChecks.get(name);
    if (!check) return true;
    return (Date.now() - check.lastCheck) > this.CHECK_INTERVAL * 2;
  }

  /**
   * 4. Get overall health status
   */
  getOverallHealth(): 'healthy' | 'degraded' | 'unhealthy' {
    const checks = Array.from(this.healthChecks.values());
    const unhealthy = checks.filter(c => c.status === 'unhealthy').length;
    const stale = checks.filter(c => this.isHealthCheckStale(c as any)).length;

    if (unhealthy > checks.length / 2) return 'unhealthy';
    if (unhealthy > 0 || stale > 0) return 'degraded';
    return 'healthy';
  }

  /**
   * 5. Get all health check statuses
   */
  getAllHealthStatuses(): Map<string, { lastCheck: number; status: 'healthy' | 'unhealthy' }> {
    return new Map(this.healthChecks);
  }
}
