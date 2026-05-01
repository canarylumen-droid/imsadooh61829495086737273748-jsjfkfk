import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL;

export const hasRedis = !!REDIS_URL;

// Shared Redis connection for BullMQ
export const redisConnection = hasRedis ? new Redis(REDIS_URL!, {
  maxRetriesPerRequest: null, // Critical for BullMQ
  enableReadyCheck: false,
}) : undefined;

if (hasRedis && redisConnection) {
  redisConnection.on('error', (err) => {
    console.error('❌ Redis Connection Error:', err);
  });

  redisConnection.on('connect', () => {
    console.log('✅ Connected to Redis');
  });
}
