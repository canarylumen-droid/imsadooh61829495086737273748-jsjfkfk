import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL;
const REDIS_HOST = process.env.REDIS_HOST;

export const hasRedis = !!REDIS_URL || !!REDIS_HOST || process.env.NODE_ENV !== 'production';

function getBullMQConnectionOptions() {
  const host = process.env.REDIS_HOST;
  const port = process.env.REDIS_PORT;
  const password = process.env.REDIS_PASSWORD;
  const url = process.env.REDIS_URL || '';

  if (host) {
    const useTls = url.startsWith('rediss://') || process.env.REDIS_TLS === 'true';
    return {
      host,
      port: parseInt(port || '6379', 10),
      password,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      tls: useTls ? { rejectUnauthorized: false } : undefined,
    };
  }

  return REDIS_URL!;
}

// Shared Redis connection for BullMQ
let sharedRedis: Redis | null = null;

export function getSharedRedisConnection(): Redis {
  if (!sharedRedis) {
    if (!hasRedis) {
      throw new Error('❌ Redis is not configured');
    }
    const options = getBullMQConnectionOptions();
    if (typeof options === 'string') {
      sharedRedis = new Redis(options, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      });
    } else {
      sharedRedis = new Redis(options as any);
    }

    sharedRedis.on('error', (err) => {
      console.error('❌ Redis Connection Error:', err);
    });

    sharedRedis.on('connect', () => {
      console.log('✅ Connected to Redis');
    });
  }
  return sharedRedis;
}

export const redisConnection = hasRedis ? new Proxy({}, {
  get(target, prop) {
    const conn = getSharedRedisConnection();
    const value = Reflect.get(conn, prop);
    return typeof value === 'function' ? value.bind(conn) : value;
  }
}) as any as Redis : undefined;

