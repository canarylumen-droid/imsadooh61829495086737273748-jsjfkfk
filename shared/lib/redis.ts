import { getSharedRedisConnection, hasRedis } from './queues/redis-config.js';
import type { Redis } from 'ioredis';

const REDIS_URL = process.env.REDIS_URL;
const IS_PROD = process.env.NODE_ENV === 'production';

if (!REDIS_URL && IS_PROD) {
  throw new Error('❌ REDIS_URL is required in production environment');
}

// Shared Redis client for generic operations (caching, pub/sub)
export const redisClient = hasRedis ? new Proxy({}, {
  get(target, prop) {
    const conn = getSharedRedisConnection();
    const value = Reflect.get(conn, prop);
    return typeof value === 'function' ? value.bind(conn) : value;
  }
}) as any as Redis : undefined;

/**
 * BullMQ Connection Configuration
 * 
 * We derive this from REDIS_URL if REDIS_HOST is not provided.
 */
function getBullMQConnection() {
  const host = process.env.REDIS_HOST;
  const port = process.env.REDIS_PORT;
  const urlStr = REDIS_URL;

  if (host) {
    return {
      host,
      port: parseInt(port || '6379', 10),
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: null,
    };
  }

  if (!urlStr) {
    if (IS_PROD) {
      throw new Error('❌ Missing REDIS_URL or REDIS_HOST for BullMQ connection in production');
    }
    return {
      host: 'localhost',
      port: 6379,
      maxRetriesPerRequest: null,
    };
  }

  try {
    const url = new URL(urlStr);
    const isTls = url.protocol === 'rediss:';

    return {
      host: url.hostname,
      port: parseInt(url.port || '6379', 10),
      password: url.password ? decodeURIComponent(url.password) : undefined,
      username: url.username ? decodeURIComponent(url.username) : undefined,
      maxRetriesPerRequest: null,
      tls: isTls ? { rejectUnauthorized: false } : undefined,
    };
  } catch (err) {
    if (IS_PROD) {
      throw new Error(`❌ Invalid REDIS_URL provided in production: ${urlStr}`);
    }
    return {
      host: 'localhost',
      port: 6379,
      maxRetriesPerRequest: null,
    };
  }
}

export const bullmqRedisConnection = getBullMQConnection();
