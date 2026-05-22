import { createClient, type RedisClientType } from 'redis';
import { instrumentRedisClient, validateRedisEndpoint } from './latency-telemetry.js';

let redisClient: RedisClientType | null = null;
let pubClient: RedisClientType | null = null;
let subClient: RedisClientType | null = null;
let isInitializing = false;

const IS_PROD = process.env.NODE_ENV === 'production';

export const hasRedis = !!process.env.REDIS_URL;
export const redisConnection = {
  get client() { return redisClient; },
  get isConnected() { return !!redisClient; }
};
export const redis = redisConnection;

function readInt(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function createReconnectStrategy(label: string) {
  return (retries: number) => {
    const maxRetries = readInt('REDIS_RECONNECT_MAX_RETRIES', 100);
    if (IS_PROD && retries > maxRetries) {
      console.error(`[RedisClient] ${label} reconnect limit exceeded`, { retries, maxRetries });
      return false;
    }

    const delay = Math.min(retries * 50, 2000);
    if (retries > 0 && retries % 10 === 0) {
      console.warn(`[RedisClient] ${label} reconnecting`, { retries, delayMs: delay });
    }
    return delay;
  };
}

async function duplicateClient(label: string): Promise<RedisClientType | null> {
  const base = await getRedisClient();
  if (!base) return null;

  const duplicate = base.duplicate();
  const instrumented = instrumentRedisClient(duplicate, label) as RedisClientType;
  await instrumented.connect();
  return instrumented;
}

export async function getPubClient(): Promise<RedisClientType | null> {
  if (pubClient) return pubClient;
  pubClient = await duplicateClient('redis-pub');
  if (pubClient) console.log('[RedisClient] Shared Redis PUB client connected');
  return pubClient;
}

export async function getSubClient(): Promise<RedisClientType | null> {
  if (subClient) return subClient;
  subClient = await duplicateClient('redis-sub');
  if (subClient) console.log('[RedisClient] Shared Redis SUB client connected');
  return subClient;
}

export async function getRedisClient(): Promise<RedisClientType | null> {
  if (redisClient) return redisClient;

  const rawRedisUrl = process.env.REDIS_URL;

  if (!rawRedisUrl) {
    if (IS_PROD) {
      throw new Error('[RedisClient] REDIS_URL is required in production');
    }
    return null;
  }

  if (isInitializing) {
    await new Promise(resolve => setTimeout(resolve, 250));
    return redisClient;
  }

  isInitializing = true;

  try {
    const redisUrl = validateRedisEndpoint(rawRedisUrl, 'REDIS_URL');
    const parsed = new URL(redisUrl);
    const tls = parsed.protocol === 'rediss:' || process.env.REDIS_TLS === 'true';

    console.log('[RedisClient] Connecting to Redis', {
      host: parsed.hostname,
      tls,
      privateEndpointRequired: process.env.REDIS_PRIVATE_ENDPOINT_REQUIRED !== 'false',
    });

    const client = createClient({
      url: redisUrl,
      password: parsed.password ? undefined : process.env.REDIS_PASSWORD || undefined,
      socket: {
        connectTimeout: readInt('REDIS_CONNECT_TIMEOUT_MS', 5000),
        reconnectStrategy: createReconnectStrategy('shared'),
        tls,
        rejectUnauthorized: process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== 'false',
      } as any
    });

    client.on('error', (err) => {
      console.error('[RedisClient] Redis client error:', err.message);
      if ((err as any).code === 'ECONNREFUSED') {
        console.error('[RedisClient] Redis refused connection. Verify private endpoint, TLS, and credentials.');
      }
    });

    client.on('connect', () => console.log('[RedisClient] Redis connecting'));
    client.on('ready', () => console.log('[RedisClient] Redis ready'));
    client.on('reconnecting', () => console.warn('[RedisClient] Redis reconnecting'));

    await client.connect();
    redisClient = instrumentRedisClient(client, 'redis-shared') as RedisClientType;
    return redisClient;
  } catch (err: any) {
    console.error('[RedisClient] Failed to initialize Redis:', err.message);
    if (IS_PROD && err.message?.includes('not recognized as a private endpoint')) {
      throw err;
    }
    return null;
  } finally {
    isInitializing = false;
  }
}

export async function acquireLock(key: string, ttlSeconds: number = 30, failOpen: boolean = false): Promise<boolean> {
  const client = await getRedisClient();
  if (!client) return failOpen;

  try {
    const result = await client.set(`lock:${key}`, 'locked', {
      NX: true,
      EX: ttlSeconds
    });
    return result === 'OK';
  } catch (_err) {
    return failOpen;
  }
}

export async function releaseLock(key: string): Promise<void> {
  const client = await getRedisClient();
  if (!client) return;

  try {
    await client.del(`lock:${key}`);
  } catch (_err) {
    // Ignore release errors.
  }
}

export function getWorkerId(): string {
  try {
    const osModule = typeof require !== 'undefined' ? require('os') : null;
    return process.env.APP_WORKER_ID || (osModule ? osModule.hostname() : `worker-${Math.random().toString(36).substring(2, 9)}`);
  } catch (_e) {
    return process.env.APP_WORKER_ID || `worker-${Math.random().toString(36).substring(2, 9)}`;
  }
}

export async function acquireDistributedLock(key: string, ttlSeconds: number = 60, failOpen: boolean = false): Promise<boolean> {
  const client = await getRedisClient();
  if (!client) return failOpen;

  const workerId = getWorkerId();
  try {
    const result = await client.set(`lock:${key}`, workerId, {
      NX: true,
      EX: ttlSeconds
    });
    return result === 'OK';
  } catch (_err) {
    return failOpen;
  }
}

export async function isLockOwner(key: string, failOpen: boolean = false): Promise<boolean> {
  const client = await getRedisClient();
  if (!client) return failOpen;

  try {
    const owner = await client.get(`lock:${key}`);
    return owner === getWorkerId();
  } catch (_err) {
    return failOpen;
  }
}

export async function extendLock(key: string, ttlSeconds: number = 60, failOpen: boolean = false): Promise<boolean> {
  const client = await getRedisClient();
  if (!client) return failOpen;

  try {
    const workerId = getWorkerId();
    const owner = await client.get(`lock:${key}`);
    if (owner === workerId) {
      await client.expire(`lock:${key}`, ttlSeconds);
      return true;
    }
    return false;
  } catch (_err) {
    return false;
  }
}
