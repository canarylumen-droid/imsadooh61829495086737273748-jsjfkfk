import { Queue, Worker, QueueEvents, type ConnectionOptions, type DefaultJobOptions } from 'bullmq';
import { Redis } from 'ioredis';

const REDIS_URL = process.env.REDIS_URL;
const IS_PROD = process.env.NODE_ENV === 'production';

// Shared Redis connection for BullMQ
let sharedRedis: Redis | null = null;

export function getSharedRedisConnection(): Redis {
  if (!sharedRedis) {
    if (!REDIS_URL) {
      if (IS_PROD) {
        throw new Error('❌ REDIS_URL is required for BullMQ in production');
      }
      // Fallback to localhost only in development
      sharedRedis = new Redis('redis://localhost:6379', {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      });
    } else {
      sharedRedis = new Redis(REDIS_URL, {
        maxRetriesPerRequest: null, // Required by BullMQ
        enableReadyCheck: false,
      });
    }
  }
  return sharedRedis;
}

const defaultJobOptions: DefaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 5000,
  },
  removeOnComplete: {
    age: 3600, // keep for 1 hour
    count: 1000, // keep last 1000 jobs
  },
  removeOnFail: {
    age: 24 * 3600, // keep for 24 hours
  }
};

export function createQueue<T = any>(name: string) {
  return new Queue<T>(name, {
    connection: getSharedRedisConnection() as any,
    defaultJobOptions,
  });
}

export function createWorker<T = any>(name: string, processor: (job: any) => Promise<any>, options = {}) {
  return new Worker<T>(name, processor, {
    connection: getSharedRedisConnection() as any,
    ...options,
  });
}

export function createQueueEvents(name: string) {
  return new QueueEvents(name, {
    connection: getSharedRedisConnection() as any,
  });
}
