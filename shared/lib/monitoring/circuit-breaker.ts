/**
 * ─── CIRCUIT BREAKER PATTERN ────────────────────────────────────────────────────
 *
 * Protects SMTP providers from cascading failures.
 *
 * If an SMTP provider's error rate exceeds the threshold within the window,
 * the circuit "opens" (pauses the queue for a cooldown period).
 * During the open state, the worker must NOT attempt new connections.
 *
 * States:
 *   CLOSED  → normal operation (errors counted)
 *   OPEN    → no new jobs processed (cooldown)
 *   HALF-OPEN → test with 1 job before closing
 *
 * Redis-backed so it works across multiple worker pods.
 *
 * Usage:
 *   import { CircuitBreaker } from '@shared/lib/monitoring/circuit-breaker.js';
 *   const gmailBreaker = new CircuitBreaker('gmail', { errorThreshold: 0.10, windowMs: 60000, cooldownMs: 300000 });
 *
 *   if (await gmailBreaker.isOpen()) {
 *     throw new Error('Gmail circuit is OPEN — skipping send');
 *   }
 *
 *   try {
 *     await sendEmail(...);
 *     gmailBreaker.recordSuccess();
 *   } catch (err) {
 *     if (isTransientSMTPError(err)) {
 *       gmailBreaker.recordFailure();
 *     }
 *   }
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { getRedisClient } from '@shared/lib/redis/redis.js';

export interface CircuitBreakerConfig {
  /** Error rate threshold (0.0–1.0) to trip the circuit */
  errorThreshold: number;
  /** Time window in ms to calculate error rate */
  windowMs: number;
  /** Cooldown duration in ms while circuit stays open */
  cooldownMs: number;
  /** Max failures before half-open (default 5) */
  minFailures?: number;
}

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime: number;
  openedAt: number | null;
  halfOpenTestAt: number | null;
}

export class CircuitBreaker {
  private readonly key: string;
  private readonly config: CircuitBreakerConfig;
  private readonly redisPrefix = 'circuit:';

  constructor(providerName: string, config: CircuitBreakerConfig) {
    this.key = `${this.redisPrefix}${providerName}`;
    this.config = {
      minFailures: 5,
      ...config,
    };
  }

  private async getRedis() {
    return getRedisClient();
  }

  private async getStats(): Promise<CircuitStats> {
    const redis = await this.getRedis();
    if (!redis) {
      // If Redis is down, assume circuit is CLOSED (fail-open for resilience)
      return { state: 'CLOSED', failures: 0, successes: 0, lastFailureTime: 0, openedAt: null, halfOpenTestAt: null };
    }

    const raw = await redis.hGetAll(`${this.key}:stats`);
    if (!raw || Object.keys(raw).length === 0) {
      return { state: 'CLOSED', failures: 0, successes: 0, lastFailureTime: 0, openedAt: null, halfOpenTestAt: null };
    }

    return {
      state: (raw.state as CircuitState) || 'CLOSED',
      failures: parseInt(raw.failures || '0', 10),
      successes: parseInt(raw.successes || '0', 10),
      lastFailureTime: parseInt(raw.lastFailureTime || '0', 10),
      openedAt: raw.openedAt ? parseInt(raw.openedAt, 10) : null,
      halfOpenTestAt: raw.halfOpenTestAt ? parseInt(raw.halfOpenTestAt, 10) : null,
    };
  }

  private async setStats(stats: CircuitStats): Promise<void> {
    const redis = await this.getRedis();
    if (!redis) return;

    const ttl = Math.ceil((this.config.cooldownMs + this.config.windowMs) / 1000);
    await redis.hSet(`${this.key}:stats`, {
      state: stats.state,
      failures: String(stats.failures),
      successes: String(stats.successes),
      lastFailureTime: String(stats.lastFailureTime),
      openedAt: stats.openedAt !== null ? String(stats.openedAt) : '',
      halfOpenTestAt: stats.halfOpenTestAt !== null ? String(stats.halfOpenTestAt) : '',
    });
    await redis.expire(`${this.key}:stats`, ttl);
  }

  /** Check if the circuit is currently OPEN (blocked) */
  async isOpen(): Promise<boolean> {
    const stats = await this.getStats();
    const now = Date.now();

    if (stats.state === 'OPEN') {
      // Check if cooldown has elapsed → transition to HALF_OPEN
      if (stats.openedAt && now - stats.openedAt >= this.config.cooldownMs) {
        await this.setStats({ ...stats, state: 'HALF_OPEN', halfOpenTestAt: now });
        return true; // Still return true for this call — next call will be half-open
      }
      return true;
    }

    if (stats.state === 'HALF_OPEN') {
      // Allow exactly one test request through every 10s
      if (stats.halfOpenTestAt && now - stats.halfOpenTestAt < 10_000) {
        return true;
      }
      return false; // Allow the test
    }

    return false;
  }

  /** Record a successful operation */
  async recordSuccess(): Promise<void> {
    const stats = await this.getStats();

    if (stats.state === 'HALF_OPEN') {
      // If test succeeds, close the circuit
      await this.setStats({
        state: 'CLOSED',
        failures: 0,
        successes: 0,
        lastFailureTime: 0,
        openedAt: null,
        halfOpenTestAt: null,
      });
      return;
    }

    // Normal tracking
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    // Reset if window has passed with no failures
    if (stats.lastFailureTime < windowStart) {
      await this.setStats({
        ...stats,
        successes: 1,
        failures: 0,
      });
    } else {
      await this.setStats({
        ...stats,
        successes: stats.successes + 1,
      });
    }
  }

  /** Record a failure and potentially open the circuit */
  async recordFailure(): Promise<void> {
    const stats = await this.getStats();
    const now = Date.now();

    if (stats.state === 'HALF_OPEN') {
      // Test failed — go back to OPEN
      await this.setStats({
        ...stats,
        state: 'OPEN',
        openedAt: now,
        halfOpenTestAt: null,
      });
      return;
    }

    const newFailures = stats.failures + 1;
    const total = newFailures + stats.successes;
    const errorRate = total > 0 ? newFailures / total : 0;

    // Trip if: enough failures AND error rate exceeds threshold
    const shouldOpen =
      newFailures >= (this.config.minFailures || 5) &&
      errorRate >= this.config.errorThreshold;

    if (shouldOpen) {
      await this.setStats({
        ...stats,
        state: 'OPEN',
        failures: newFailures,
        lastFailureTime: now,
        openedAt: now,
      });
    } else {
      await this.setStats({
        ...stats,
        state: stats.state,
        failures: newFailures,
        lastFailureTime: now,
      });
    }
  }

  /** Get current circuit state for monitoring dashboards */
  async getState(): Promise<{ state: CircuitState; errorRate: number; failures: number; successes: number }> {
    const stats = await this.getStats();
    const total = stats.failures + stats.successes;
    return {
      state: stats.state,
      errorRate: total > 0 ? stats.failures / total : 0,
      failures: stats.failures,
      successes: stats.successes,
    };
  }

  /** Manually reset the circuit (useful after fixing upstream issues) */
  async reset(): Promise<void> {
    await this.setStats({
      state: 'CLOSED',
      failures: 0,
      successes: 0,
      lastFailureTime: 0,
      openedAt: null,
      halfOpenTestAt: null,
    });
  }
}

/** Global circuit breaker registry */
const breakers = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(provider: string, config?: CircuitBreakerConfig): CircuitBreaker {
  if (!breakers.has(provider)) {
    breakers.set(
      provider,
      new CircuitBreaker(provider, config || { errorThreshold: 0.10, windowMs: 60_000, cooldownMs: 300_000 })
    );
  }
  return breakers.get(provider)!;
}

/** Check if an SMTP error is transient (421/451) and should trigger backoff + circuit breaker */
export function isTransientSMTPError(err: any): boolean {
  if (!err) return false;
  const msg = String(err.message || err.response || err).toLowerCase();
  // SMTP 421 = Service not available (try again later)
  // SMTP 451 = Local error in processing (try again later)
  // Also common transient patterns
  return (
    msg.includes('421') ||
    msg.includes('451') ||
    msg.includes('transient') ||
    msg.includes('temporary failure') ||
    msg.includes('rate limit') ||
    msg.includes('throttle') ||
    msg.includes('too many messages')
  );
}
