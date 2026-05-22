import { getSharedRedisConnection, hasRedis } from './queues/redis-config.js';
import { validateRedisEndpoint } from './redis/latency-telemetry.js';
import type { Redis } from 'ioredis';

const REDIS_URL = process.env.REDIS_URL;
const IS_PROD = process.env.NODE_ENV === 'production';

if (!REDIS_URL && !process.env.REDIS_HOST && IS_PROD) {
  throw new Error('[RedisConfig] REDIS_URL or REDIS_HOST is required in production');
}

export const redisClient = hasRedis ? new Proxy({}, {
  get(_target, prop) {
    const conn = getSharedRedisConnection();
    const value = Reflect.get(conn, prop);
    return typeof value === 'function' ? value.bind(conn) : value;
  }
}) as any as Redis : undefined;

function readInt(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function getBullMQConnection() {
  const host = process.env.REDIS_HOST;
  const port = process.env.REDIS_PORT || '6379';
  const password = process.env.REDIS_PASSWORD;
  const urlStr = REDIS_URL;
  const useTls = (urlStr || '').startsWith('rediss://') || process.env.REDIS_TLS === 'true';

  if (host) {
    const protocol = useTls ? 'rediss' : 'redis';
    validateRedisEndpoint(`${protocol}://default:placeholder@${host}:${port}`, 'REDIS_HOST');
    return {
      host,
      port: parseInt(port, 10),
      password,
      maxRetriesPerRequest: null,
      connectTimeout: readInt('REDIS_CONNECT_TIMEOUT_MS', 5000),
      commandTimeout: readInt('REDIS_COMMAND_TIMEOUT_MS', 10000),
      tls: useTls ? { rejectUnauthorized: process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== 'false' } : undefined,
    };
  }

  if (!urlStr) {
    if (IS_PROD) {
      throw new Error('[RedisConfig] Missing REDIS_URL or REDIS_HOST for BullMQ connection in production');
    }
    return {
      host: '127.0.0.1',
      port: 6379,
      maxRetriesPerRequest: null,
    };
  }

  const redisUrl = validateRedisEndpoint(urlStr, 'REDIS_URL');
  const url = new URL(redisUrl);
  const tls = url.protocol === 'rediss:' || process.env.REDIS_TLS === 'true';

  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
    password: url.password ? decodeURIComponent(url.password) : password,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    maxRetriesPerRequest: null,
    connectTimeout: readInt('REDIS_CONNECT_TIMEOUT_MS', 5000),
    commandTimeout: readInt('REDIS_COMMAND_TIMEOUT_MS', 10000),
    tls: tls ? { rejectUnauthorized: process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== 'false' } : undefined,
  };
}

export const bullmqRedisConnection = getBullMQConnection();
