import { getRedisClient } from '../redis/redis.js';

export interface RateLimiterConfig {
  requestsPerMinute: number;
  tokensPerMinute?: number;
  name: string;
}

/**
 * GlobalLeakyBucket
 * 
 * Uses Redis to coordinate AI rate limits across distributed workers.
 * Prevents 429 errors by proactively throttling requests.
 */
export class GlobalLeakyBucket {
  private redisKey: string;
  private capacity: number;
  private leakRate: number; // requests per millisecond

  constructor(config: RateLimiterConfig) {
    this.redisKey = `ratelimit:ai:${config.name}`;
    this.capacity = config.requestsPerMinute;
    this.leakRate = config.requestsPerMinute / (60 * 1000);
  }

  /**
   * Acquire a slot in the bucket. Returns immediately if successful,
   * or waits (sleeps) until a slot is available.
   */
  async acquire(weight: number = 1): Promise<void> {
    const client = await getRedisClient();
    if (!client) return; // Fail open if Redis is down

    while (true) {
      const now = Date.now();
      
      // Use a Lua script to atomically update the bucket level
      // KEYS[1] = bucket_key
      // ARGV[1] = now_timestamp
      // ARGV[2] = leak_rate
      // ARGV[3] = capacity
      // ARGV[4] = weight
      const LUA_LEAKY = `
        local key = KEYS[1]
        local now = tonumber(ARGV[1])
        local leak_rate = tonumber(ARGV[2])
        local capacity = tonumber(ARGV[3])
        local weight = tonumber(ARGV[4])

        local last_update = tonumber(redis.call("HGET", key, "last_update") or now)
        local level = tonumber(redis.call("HGET", key, "level") or 0)

        -- Leak the bucket based on time passed
        local leaked = math.max(0, (now - last_update) * leak_rate)
        level = math.max(0, level - leaked)

        if (level + weight) <= capacity then
          level = level + weight
          redis.call("HSET", key, "level", level, "last_update", now)
          redis.call("EXPIRE", key, 60)
          return 0 -- Success
        else
          -- Return the time (ms) to wait until enough capacity leaks
          local wait_ms = ((level + weight) - capacity) / leak_rate
          return math.ceil(wait_ms)
        end
      `;

      const result = await client.eval(LUA_LEAKY, {
        keys: [this.redisKey],
        arguments: [now.toString(), this.leakRate.toString(), this.capacity.toString(), weight.toString()]
      });

      if (result === 0) {
        return; // Success!
      }

      // Wait until the bucket leaks enough
      const waitTime = result as number;
      if (waitTime > 30000) {
        // Safety: If wait is > 30s, something is wrong or over-saturated
        throw new Error(`AI Rate Limit Exceeded: Global bucket "${this.redisKey}" is saturated. Wait: ${Math.round(waitTime/1000)}s`);
      }

      console.log(`[RateLimiter] ⏳ Bucket "${this.redisKey}" full. Waiting ${waitTime}ms...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

// Global instances for standard providers
export const openAiLimiter = new GlobalLeakyBucket({ name: 'openai', requestsPerMinute: 60 });
export const geminiLimiter = new GlobalLeakyBucket({ name: 'gemini', requestsPerMinute: 60 });
export const zAiLimiter    = new GlobalLeakyBucket({ name: 'zai',    requestsPerMinute: 60 });
