import rateLimit, { type Options } from 'express-rate-limit';
import RedisStore, { type SendCommandFn } from 'rate-limit-redis';
import type { Request } from 'express';

interface RateLimitSessionData {
  userId?: string;
}

interface RedisStoreConfig {
  store: RedisStore;
}

function getSessionUserId(req: Request): string | undefined {
  const session = req.session as RateLimitSessionData | undefined;
  return session?.userId;
}

import { getRedisClient } from '@shared/lib/redis/redis.js';

function createRedisStoreConfig(prefix: string): RedisStoreConfig | undefined {
  if (!process.env.REDIS_URL && !process.env.REDIS_HOST) {
    console.warn(`⚠️ Rate Limiter [${prefix}] falling back to in-memory storage (Redis not configured)`);
    return undefined;
  }

  const sendCommand: SendCommandFn = (async (...args: string[]) => {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 15; attempt++) {
      try {
        const client = await getRedisClient();
        if (client) {
          return await client.sendCommand(args);
        }
        lastError = new Error('Redis client not initialized');
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt >= 14) {
          console.error(`❌ Redis Command Error in Rate Limiter [${prefix}]:`, lastError.message);
          throw lastError;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw lastError || new Error('Redis client not initialized');
  }) as SendCommandFn;

  try {
    const store = new RedisStore({ sendCommand, prefix });
    console.log(`⚡ Rate Limiter [${prefix}] initialized with Redis storage`);
    return { store };
  } catch (err) {
    console.warn(`⚠️ Rate Limiter [${prefix}] Redis init postponed (will retry on first request):`, (err as Error).message);
    return undefined;
  }
}

function createUserKeyGenerator(keyPrefix: string): (req: Request) => string {
  return (req: Request): string => {
    const userId = getSessionUserId(req);
    if (userId) return `${keyPrefix}:${userId}`;
    return `ip:${req.ip || 'unknown'}`;
  };
}

function createRateLimiterOptions(baseOptions: Partial<Options>, prefix: string): Partial<Options> {
  const redisConfig = createRedisStoreConfig(prefix);
  return {
    ...baseOptions,
    ...(redisConfig || {})
  };
}

export const apiLimiter = rateLimit(
  createRateLimiterOptions(
    {
      windowMs: 15 * 60 * 1000,
      max: 1000, // Increased from 100 to 1000 to prevent lockout
      message: { error: 'Too many requests, please try again later' },
      standardHeaders: true,
      legacyHeaders: false
    },
    'rl:api:'
  )
);

export const authLimiter = rateLimit(
  createRateLimiterOptions(
    {
      windowMs: 15 * 60 * 1000,
      max: 100, // Increased from 20 to 100 to prevent lockout
      message: { error: 'Too many authentication attempts, please try again later' },
      standardHeaders: true,
      legacyHeaders: false,
      skipSuccessfulRequests: true
    },
    'rl:auth:'
  )
);

export const webhookLimiter = rateLimit(
  createRateLimiterOptions(
    {
      windowMs: 60 * 1000,
      max: 1000,
      message: { error: 'Webhook rate limit exceeded' },
      standardHeaders: true,
      legacyHeaders: false
    },
    'rl:webhook:'
  )
);

export const aiLimiter = rateLimit(
  createRateLimiterOptions(
    {
      windowMs: 60 * 1000,
      max: 20,
      message: { error: 'AI generation rate limit exceeded' },
      keyGenerator: createUserKeyGenerator('user'),
      standardHeaders: true,
      legacyHeaders: false,
      validate: false
    },
    'rl:ai:'
  )
);


export const viteLimiter = rateLimit(
  createRateLimiterOptions(
    {
      windowMs: 60 * 1000,
      max: process.env.NODE_ENV === 'development' ? 5000 : 500,
      message: { error: 'Too many requests to development server' },
      standardHeaders: true,
      legacyHeaders: false,
      validate: false
    },
    'rl:vite:'
  )
);

export const smtpRateLimiter = rateLimit(
  createRateLimiterOptions(
    {
      windowMs: 60 * 60 * 1000,
      max: 300,
      message: { error: 'Email sending rate limit exceeded. Please wait before sending more emails.' },
      keyGenerator: createUserKeyGenerator('smtp'),
      standardHeaders: true,
      legacyHeaders: false,
      validate: false
    },
    'rl:smtp:'
  )
);

export const developerLimiter = rateLimit(
  createRateLimiterOptions(
    {
      windowMs: 15 * 60 * 1000,
      max: 30,
      message: { error: 'Too many developer API requests. Max 30 per 15 minutes.' },
      keyGenerator: createUserKeyGenerator('dev'),
      standardHeaders: true,
      legacyHeaders: false,
      validate: false
    },
    'rl:dev:'
  )
);

export const apiKeyRateLimiter = rateLimit(
  createRateLimiterOptions(
    {
      windowMs: 60 * 1000,
      max: 60,
      message: { error: 'API rate limit exceeded. Max 60 requests per minute.' },
      keyGenerator: (req: Request): string => {
        const apiKeyUser = (req as any).userId;
        if (apiKeyUser) return `apikey:${apiKeyUser}`;
        return `ip:${req.ip || 'unknown'}`;
      },
      standardHeaders: true,
      legacyHeaders: false,
      validate: false
    },
    'rl:apikey:'
  )
);

export const emailImportLimiter = rateLimit(
  createRateLimiterOptions(
    {
      windowMs: 24 * 60 * 60 * 1000,
      max: 1000,
      message: { error: 'Daily email import limit exceeded' },
      keyGenerator: (req: Request): string => {
        const userId = getSessionUserId(req);
        if (userId) return `import:${userId}`;
        const ip = req.ip || 'unknown';
        return ip.includes(':') ? `ip:${ip}` : `ip:${ip}`;
      },
      standardHeaders: true,
      legacyHeaders: false,
      validate: false
    },
    'rl:import:'
  )
);

