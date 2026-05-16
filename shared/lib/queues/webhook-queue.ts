import { Queue, QueueEvents } from 'bullmq';
import { redisConnection } from './redis-config.js';

/**
 * Webhook Queue for asynchronous processing of external events (Calendly, Fathom, etc.)
 * This ensures the API Gateway remains fast and responsive while heavy tasks 
 * (AI analysis, lead status updates) run in the background.
 */
export const webhookQueue = new Queue('webhook-processing', {
  connection: redisConnection as any,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: {
      age: 3600, // Keep completed jobs for 1 hour for monitoring
      count: 1000,
    },
    removeOnFail: {
      age: 24 * 3600, // Keep failed jobs for 24 hours for debugging
    }
  }
});

export const webhookQueueEvents = new QueueEvents('webhook-processing', {
  connection: redisConnection as any
});
