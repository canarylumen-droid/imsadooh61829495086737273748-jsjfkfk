import { createFreshConnection, getSharedRedisConnection, hasRedis } from './queues/redis-config.js';
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

export { createFreshConnection as createBullMQWorkerConnection };
