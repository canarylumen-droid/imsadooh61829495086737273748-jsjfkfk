import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL;
const REDIS_HOST = process.env.REDIS_HOST;

export const hasRedis = !!REDIS_URL || !!REDIS_HOST;

function getBullMQConnectionOptions() {
  const host = process.env.REDIS_HOST;
  const port = process.env.REDIS_PORT;
  const password = process.env.REDIS_PASSWORD;

  if (host) {
    return {
      host,
      port: parseInt(port || '6379', 10),
      password,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      tls: host.includes('redislabs.com') || host.includes('upstash.io') || process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    };
  }

  return REDIS_URL!;
}

// Shared Redis connection for BullMQ
export const redisConnection = hasRedis ? new Redis(getBullMQConnectionOptions() as any, {
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
