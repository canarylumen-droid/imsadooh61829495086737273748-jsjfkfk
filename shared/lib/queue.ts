import { Queue } from 'bullmq';
import { getSharedRedisConnection, hasRedis } from './queues/redis-config.js';
import { OutreachJobPayload, RagJobPayload, MailSyncJobPayload } from '../types/jobs.js';

const defaultQueueOptions = {
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: true,                         // Keep Redis memory clean
    removeOnFail: { count: 500, age: 24 * 3600 },  // Retain last 500 failures for up to 24h, then purge
  },
};

function createLazyQueue(name: string, opts?: any): Queue {
  let instance: Queue | null = null;
  return new Proxy({}, {
    get(target, prop) {
      if (prop === '__closeIfInitialized') {
        return async () => {
          if (instance) {
            await instance.close();
          }
        };
      }
      if (!instance) {
        if (!hasRedis) return undefined;
        instance = new Queue(name, {
          connection: getSharedRedisConnection(),
          ...defaultQueueOptions,
          ...opts,
        });
      }
      const value = Reflect.get(instance, prop);
      return typeof value === 'function' ? value.bind(instance) : value;
    }
  }) as any as Queue;
}

// Define and export all queues used in the system
export const outreachQueue = createLazyQueue('outreachQueue');
export const ragQueue = createLazyQueue('ragQueue');
export const mailSyncQueue = createLazyQueue('mailSyncQueue');
export const vectorOpsQueue = createLazyQueue('vectorOpsQueue');

// Centralized helper to cleanly disconnect all queues (useful for graceful shutdown)
export const closeQueues = async () => {
  await Promise.all([
    (outreachQueue as any).__closeIfInitialized(),
    (ragQueue as any).__closeIfInitialized(),
    (mailSyncQueue as any).__closeIfInitialized(),
    (vectorOpsQueue as any).__closeIfInitialized(),
  ]);
};
