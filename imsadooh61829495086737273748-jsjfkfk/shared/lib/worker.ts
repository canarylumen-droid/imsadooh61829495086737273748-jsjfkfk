import { Worker, Processor, WorkerOptions } from 'bullmq';
import { createFreshConnection, hasRedis } from './queues/redis-config.js';
import { logger } from './logger';

const defaultWorkerOptions: Omit<WorkerOptions, 'connection'> = {
  concurrency: parseInt(process.env.WORKER_CONCURRENCY || '5', 10),
  lockDuration:    parseInt(process.env.WORKER_LOCK_DURATION_MS  || '120000',  10), // 2min — covers AI+SMTP job duration
  stalledInterval: parseInt(process.env.WORKER_STALLED_INTERVAL_MS || '300000', 10), // 5min — prevents false duplicate retries
  maxStalledCount: parseInt(process.env.WORKER_MAX_STALLED_COUNT   || '3',      10), // tolerate 3 stalls before failing job
};

/**
 * Creates a standard BullMQ worker with centralized error handling and logging.
 *
 * @param queueName The name of the queue to consume
 * @param processor The function that processes the jobs
 * @param options Custom worker options to override defaults
 * @returns A BullMQ Worker instance
 */
export function createWorker<T = any, R = any, N extends string = string>(
  queueName: string,
  processor: Processor<T, R, N>,
  options?: Partial<WorkerOptions>
): Worker<T, R, N> {
  const workerOptions: WorkerOptions = {
    connection: hasRedis ? createFreshConnection() : undefined as any,
    ...defaultWorkerOptions,
    ...options,
  };

  const worker = new Worker<T, R, N>(queueName, processor, workerOptions);

  worker.on('completed', (job) => {
    logger.info(`[${queueName}] Job ${job.id} completed successfully`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`[${queueName}] Job ${job?.id} failed:`, err);
  });

  worker.on('error', (err) => {
    logger.error(`[${queueName}] Worker encountered an error:`, err);
  });

  return worker;
}
