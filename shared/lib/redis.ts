import Redis from 'ioredis';
import { logger } from './logger';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// Shared Redis client for generic operations (caching, pub/sub)
export const redisClient = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redisClient.on('error', (err) => {
  logger.error('Redis Client Error', err);
});

redisClient.on('ready', () => {
  logger.info('Redis Client Connected');
});

// For BullMQ, it's recommended to have separate connections for producers/consumers/events
// We provide a connection config object that can be passed to BullMQ instances
export const bullmqRedisConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: null,
};
