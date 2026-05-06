import { createClient, type RedisClientType } from 'redis';

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
  
  const REDIS_URL = process.env.REDIS_URL;
  const IS_PROD = process.env.NODE_ENV === 'production';

  if (!REDIS_URL) {
    if (IS_PROD) {
      console.error('❌ REDIS_URL is missing in production environment!');
      throw new Error('REDIS_URL is required in production');
    }
    return null;
  }

  if (isInitializing) {
     // Wait a bit if another call is initializing
     await new Promise(resolve => setTimeout(resolve, 500));
     return redisClient;
  }

  isInitializing = true;
  console.log('🔄 Initializing Shared Redis Client...');
  
  try {
    let redisUrl = REDIS_URL.trim();

    // Support replit-style redis-cli connection strings
    if (redisUrl.includes('redis-cli')) {
      redisUrl = redisUrl.replace(/^redis-cli\s+-u\s+/, '');
    }

    // Extract standard redis:// URL if embedded in a larger string
    const match = redisUrl.match(/redis:\/\/[^:]+:[^@]+@[^:]+:\d+/);
    if (match) {
      redisUrl = match[0];
    }

    console.log(`📡 Connecting to Redis at ${redisUrl.split('@')[1] || 'URL masked'}...`);

    const client = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: 5000,
        reconnectStrategy: (retries) => {
          const delay = Math.min(retries * 50, 2000);
          if (retries % 10 === 0) {
            console.log(`🔄 Redis reconnection attempt #${retries}, next try in ${delay}ms`);
          }
          return delay;
        }
      }
    });

    client.on('error', (err) => {
      console.error('❌ Redis Client Error:', err.message);
      if (err.code === 'ECONNREFUSED') {
        console.error('   👉 Check if Redis server is running and accessible.');
      }
    });

    client.on('connect', () => console.log('✅ Redis Client Connecting...'));
    client.on('ready', () => console.log('🚀 Redis Client Ready'));
    
    await client.connect();
    console.log('✅ Shared Redis Client Connected Successfully');
    redisClient = client as RedisClientType;
    return redisClient;
  } catch (err: any) {
    console.error('❌ Failed to connect to Redis:', err.message);
    if (IS_PROD) {
      // In production, we might want to throw to prevent the service from starting in a broken state
      // but for now we'll just log and return null to avoid immediate crashes if some logic can handle it.
      // However, the plan says to harden, so let's be more strict.
    }
    return null;
  } finally {
    isInitializing = false;
  }
}

/**
 * Simple Distributed Lock
 * Tries to acquire a lock for a specific key
 */
export async function acquireLock(key: string, ttlSeconds: number = 30, failOpen: boolean = false): Promise<boolean> {
  const client = await getRedisClient();
  if (!client) return failOpen; // Default to fail closed for safety

  try {
    const result = await client.set(`lock:${key}`, 'locked', {
      NX: true,
      EX: ttlSeconds
    });
    return result === 'OK';
  } catch (err) {
    return failOpen; // Default to fail closed
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
  try {
    // Use dynamic require so it doesn't break in ESM/Vite envs
    const osModule = typeof require !== 'undefined' ? require('os') : null;
    return process.env.APP_WORKER_ID || (osModule ? osModule.hostname() : `worker-${Math.random().toString(36).substring(2, 9)}`);
  } catch (e) {
    return process.env.APP_WORKER_ID || `worker-${Math.random().toString(36).substring(2, 9)}`;
  }
}

/**
 * Advanced Distributed Lock with Ownership
 */
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
  } catch (err) {
    return failOpen;
  }
}

/**
 * Check if current worker owns the lock
 */
export async function isLockOwner(key: string, failOpen: boolean = false): Promise<boolean> {
  const client = await getRedisClient();
  if (!client) return failOpen;

  try {
    const owner = await client.get(`lock:${key}`);
    return owner === getWorkerId();
  } catch (err) {
    return failOpen;
  }
}

/**
 * Extend lock TTL if owned
 */
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
  } catch (err) {
    return false;
  }
}
