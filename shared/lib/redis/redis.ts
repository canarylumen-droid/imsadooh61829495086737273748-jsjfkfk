import { createClient, type RedisClientType } from 'redis';
import os from 'os';

let redisClient: RedisClientType | null = null;
let pubClient: RedisClientType | null = null;
let subClient: RedisClientType | null = null;
let isInitializing = false;

// Export aliases for backward compatibility and service expectations
export const hasRedis = !!process.env.REDIS_URL;
export const redisConnection = {
  get client() { return redisClient; },
  get isConnected() { return !!redisClient; }
};
export const redis = redisConnection;

/**
 * Get or initialize the shared Redis Pub client (for emitters)
 */
export async function getPubClient(): Promise<RedisClientType | null> {
  if (pubClient) return pubClient;
  const base = await getRedisClient();
  if (!base) return null;
  pubClient = base.duplicate();
  await pubClient.connect();
  console.log('⚡ Shared Redis PUB Client Connected');
  return pubClient;
}

/**
 * Get or initialize the shared Redis Sub client (for listeners)
 */
export async function getSubClient(): Promise<RedisClientType | null> {
  if (subClient) return subClient;
  const base = await getRedisClient();
  if (!base) return null;
  subClient = base.duplicate();
  await subClient.connect();
  console.log('⚡ Shared Redis SUB Client Connected');
  return subClient;
}

/**
 * Get or initialize the shared Redis client
 */
export async function getRedisClient(): Promise<RedisClientType | null> {
  if (redisClient) return redisClient;
  if (!process.env.REDIS_URL) return null;
  if (isInitializing) {
     // Wait a bit if another call is initializing
     await new Promise(resolve => setTimeout(resolve, 500));
     return redisClient;
  }

  isInitializing = true;
  try {
    let redisUrl = process.env.REDIS_URL.trim();

    // Support replit-style redis-cli connection strings
    if (redisUrl.includes('redis-cli')) {
      redisUrl = redisUrl.replace(/^redis-cli\s+-u\s+/, '');
    }

    // Extract standard redis:// URL if embedded in a larger string
    const match = redisUrl.match(/redis:\/\/[^:]+:[^@]+@[^:]+:\d+/);
    if (match) {
      redisUrl = match[0];
    }

    const client = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: 5000,
        reconnectStrategy: (retries) => Math.min(retries * 50, 2000)
      }
    });

    client.on('error', (err) => console.error('Redis Client Error', err));
    
    await client.connect();
    console.log('✅ Shared Redis Client Connected');
    redisClient = client as RedisClientType;
    return redisClient;
  } catch (err) {
    console.error('❌ Failed to connect to Redis:', err);
    return null;
  } finally {
    isInitializing = false;
  }
}

/**
 * Simple Distributed Lock
 * Tries to acquire a lock for a specific key
 */
export async function acquireLock(key: string, ttlSeconds: number = 30): Promise<boolean> {
  const client = await getRedisClient();
  if (!client) return true; // Fail open (safe for refreshing as DB will still be update target)

  try {
    const result = await client.set(`lock:${key}`, 'locked', {
      NX: true,
      EX: ttlSeconds
    });
    return result === 'OK';
  } catch (err) {
    return true; // Fail open
  }
}

/**
 * Release a Distributed Lock
 */
export async function releaseLock(key: string): Promise<void> {
  const client = await getRedisClient();
  if (!client) return;

  try {
    await client.del(`lock:${key}`);
  } catch (err) {
    // Ignore release errors
  }
}
/**
 * Get a unique identifier for this process/worker
 */
export function getWorkerId(): string {
  return process.env.APP_WORKER_ID || os.hostname() || 'unknown-worker';
}

/**
 * Advanced Distributed Lock with Ownership
 */
export async function acquireDistributedLock(key: string, ttlSeconds: number = 60): Promise<boolean> {
  const client = await getRedisClient();
  if (!client) return true;

  const workerId = getWorkerId();
  try {
    const result = await client.set(`lock:${key}`, workerId, {
      NX: true,
      EX: ttlSeconds
    });
    return result === 'OK';
  } catch (err) {
    return true;
  }
}

/**
 * Check if current worker owns the lock
 */
export async function isLockOwner(key: string): Promise<boolean> {
  const client = await getRedisClient();
  if (!client) return true;

  try {
    const owner = await client.get(`lock:${key}`);
    return owner === getWorkerId();
  } catch (err) {
    return true;
  }
}

/**
 * Extend lock TTL if owned
 */
export async function extendLock(key: string, ttlSeconds: number = 60): Promise<boolean> {
  const client = await getRedisClient();
  if (!client) return true;

  try {
    const workerId = getWorkerId();
    const owner = await client.get(`lock:${key}`);
    if (owner === workerId) {
      await client.expire(`lock:${key}`, ttlSeconds);
      return true;
    }
    return false;
  } catch (err) {
    return false;
  }
}
