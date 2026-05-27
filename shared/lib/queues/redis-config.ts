import Redis from 'ioredis';
import { instrumentIoRedis, validateRedisEndpoint } from '@shared/lib/redis/latency-telemetry.js';

const REDIS_URL = process.env.REDIS_URL;
const REDIS_HOST = process.env.REDIS_HOST;
const IS_PROD = process.env.NODE_ENV === 'production';

export const hasRedis = !!REDIS_URL || !!REDIS_HOST || !IS_PROD;

function readInt(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function redisRetryStrategy(retries: number): number | null {
  const maxRetries = readInt('REDIS_RECONNECT_MAX_RETRIES', 100);
  if (IS_PROD && retries > maxRetries) {
    console.error('[RedisConfig] Redis reconnect limit exceeded', { retries, maxRetries });
    return null;
  }
  return Math.min(50 * retries, 2000);
}

function redisReconnectOnError(err: Error): boolean {
  const message = err.message.toLowerCase();
  return message.includes('readonly') || message.includes('connection') || message.includes('socket');
}

function getTlsOptions(enabled: boolean) {
  if (!enabled) return undefined;
  return {
    rejectUnauthorized: process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== 'false',
  };
}

function baseOptions() {
  return {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
    connectTimeout: readInt('REDIS_CONNECT_TIMEOUT_MS', 5000),
    commandTimeout: readInt('REDIS_COMMAND_TIMEOUT_MS', 30000), // 30s for heavy campaign+AI workloads
    keepAlive: readInt('REDIS_KEEPALIVE_MS', 30000),            // prevents idle drops on paid Redis
    retryStrategy: redisRetryStrategy,
    reconnectOnError: redisReconnectOnError,
  };
}

function getBullMQConnectionOptions() {
  const host = process.env.REDIS_HOST;
  const port = process.env.REDIS_PORT || '6379';
  const password = process.env.REDIS_PASSWORD;
  const url = process.env.REDIS_URL || '';
  const useTls = url.startsWith('rediss://') || process.env.REDIS_TLS === 'true';

  if (host) {
    const protocol = useTls ? 'rediss' : 'redis';
    validateRedisEndpoint(`${protocol}://default:placeholder@${host}:${port}`, 'REDIS_HOST');
    return {
      host,
      port: parseInt(port, 10),
      password,
      ...baseOptions(),
      tls: getTlsOptions(useTls),
    };
  }

  if (!REDIS_URL) {
    if (IS_PROD) {
      throw new Error('[RedisConfig] Missing REDIS_URL or REDIS_HOST in production');
    }
    return {
      host: '127.0.0.1',
      port: 6379,
      ...baseOptions(),
    };
  }

  const redisUrl = validateRedisEndpoint(REDIS_URL, 'REDIS_URL');
  const parsed = new URL(redisUrl);
  const tls = parsed.protocol === 'rediss:' || process.env.REDIS_TLS === 'true';

  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : password,
    db: parsed.pathname && parsed.pathname !== '/' ? parseInt(parsed.pathname.slice(1), 10) : undefined,
    ...baseOptions(),
    tls: getTlsOptions(tls),
  };
}

/**
 * Creates a brand-new dedicated ioredis connection.
 * MUST be used for every BullMQ Worker — workers issue blocking BLPOP commands
 * that saturate a shared connection at scale (100+ concurrent jobs).
 * Each call returns a fully independent connection with its own socket.
 */
export function createFreshConnection(): Redis {
  if (!hasRedis) throw new Error('[RedisConfig] Redis is not configured');
  const conn = instrumentIoRedis(new Redis(getBullMQConnectionOptions() as any), 'bullmq-worker');
  conn.on('error', (err) => {
    console.error('[RedisConfig] Worker Redis connection error:', err.message);
  });
  conn.on('reconnecting', () => {
    console.warn('[RedisConfig] Worker Redis reconnecting...');
  });
  return conn;
}

let sharedRedis: Redis | null = null;

export function getSharedRedisConnection(): Redis {
  if (!sharedRedis) {
    if (!hasRedis) {
      throw new Error('[RedisConfig] Redis is not configured');
    }

    sharedRedis = instrumentIoRedis(new Redis(getBullMQConnectionOptions() as any), 'bullmq-shared');

    sharedRedis.on('error', (err) => {
      console.error('[RedisConfig] Redis connection error:', err.message);
    });

    sharedRedis.on('connect', () => {
      console.log('[RedisConfig] Connected to Redis', {
        tls: !!(sharedRedis as any)?.options?.tls,
        host: (sharedRedis as any)?.options?.host,
      });
    });

    sharedRedis.on('reconnecting', () => {
      console.warn('[RedisConfig] Redis reconnecting');
    });
  }

  return sharedRedis;
}

export const redisConnection = hasRedis ? new Proxy({}, {
  get(_target, prop) {
    const conn = getSharedRedisConnection();
    const value = Reflect.get(conn, prop);
    return typeof value === 'function' ? value.bind(conn) : value;
  }
}) as any as Redis : undefined;
