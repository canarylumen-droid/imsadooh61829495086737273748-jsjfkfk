import { Queue, QueueOptions } from 'bullmq';
import { bullmqRedisConnection } from './redis';
import { OutreachJobPayload, RagJobPayload, MailSyncJobPayload } from '../types/jobs';

const defaultQueueOptions: QueueOptions = {
  connection: bullmqRedisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: true, // Keep Redis memory clean
    removeOnFail: false,    // Keep failed jobs for inspection
  },
};

// Define and export all queues used in the system
export const outreachQueue = new Queue<OutreachJobPayload, any, string>('outreachQueue', defaultQueueOptions);
export const ragQueue = new Queue<RagJobPayload, any, string>('ragQueue', defaultQueueOptions);
export const mailSyncQueue = new Queue<MailSyncJobPayload, any, string>('mailSyncQueue', defaultQueueOptions);
export const vectorOpsQueue = new Queue<any, any, string>('vectorOpsQueue', defaultQueueOptions);

// Centralized helper to cleanly disconnect all queues (useful for graceful shutdown)
export const closeQueues = async () => {
  await Promise.all([
    outreachQueue.close(),
    ragQueue.close(),
    mailSyncQueue.close(),
    vectorOpsQueue.close(),
  ]);
};
