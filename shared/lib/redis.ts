import Redis from 'ioredis';
import { logger } from './logger';

// Shared Redis client for generic operations (caching, pub/sub)
// Using a function/proxy to ensure it uses the latest process.env.REDIS_URL
export const redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redisClient.on('error', (err) => {
  logger.error('Redis Client Error', err);
});

redisClient.on('ready', () => {
  logger.info('Redis Client Connected');
});

/**
 * BullMQ Connection Configuration
 * 
 * We derive this from REDIS_URL if REDIS_HOST is not provided.
 */
function getBullMQConnection() {
  const host = process.env.REDIS_HOST;
  const port = process.env.REDIS_PORT;
  const urlStr = process.env.REDIS_URL || 'redis://localhost:6379';

  if (host) {
    return {
      host,
      port: parseInt(port || '6379', 10),
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: null,
    };
  }

  try {
    const url = new URL(urlStr);
    return {
      host: url.hostname,
      port: parseInt(url.port || '6379', 10),
      password: url.password ? decodeURIComponent(url.password) : undefined,
      username: url.username ? decodeURIComponent(url.username) : undefined,
      maxRetriesPerRequest: null,
    };
  } catch (err) {
    return {
      host: 'localhost',
      port: 6379,
      maxRetriesPerRequest: null,
    };
  }
}

export const bullmqRedisConnection = getBullMQConnection();
