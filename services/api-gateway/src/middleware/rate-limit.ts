import rateLimit, { type Options } from 'express-rate-limit';
import RedisStore, { type SendCommandFn } from 'rate-limit-redis';
import { createClient, type RedisClientType } from 'redis';
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

let redisClient: any = null;

async function initRedis(): Promise<void> {
  const sharedClient = await getRedisClient();
  if (sharedClient) {
    redisClient = sharedClient;
  }
}

initRedis().catch(() => { });

function createRedisStoreConfig(prefix: string): RedisStoreConfig | undefined {
  if (!redisClient) {
    return undefined;
  }
  const client = redisClient;
  const sendCommand: SendCommandFn = (async (...args: string[]) => {
    return client.sendCommand(args);
  }) as SendCommandFn;
  return {
    store: new RedisStore({
      sendCommand,
      prefix
    })
  };
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
      max: 100,
      message: { error: 'Too many requests from this IP, please try again later' },
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
      max: 20, // Increased from 5 to 20 to prevent lockouts
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

