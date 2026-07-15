import { Queue, Worker, Job } from 'bullmq';
import { redisConnection, hasRedis, createFreshConnection } from './redis-config.js';

interface DeletionJobData {
  type: 'user:delete';
  userId: string;
  requestedAt: string;
}

const QUEUE_NAME = 'audnix-deletion-queue';

let deletionQueue: Queue<DeletionJobData> | null = null;

export function getDeletionQueue(): Queue<DeletionJobData> | null {
  if (!hasRedis) return null;
  if (!deletionQueue) {
    deletionQueue = new Queue<DeletionJobData>(QUEUE_NAME, {
      connection: redisConnection as any,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    });
  }
  return deletionQueue;
}

export async function scheduleUserDeletion(userId: string): Promise<string | null> {
  const queue = getDeletionQueue();
  if (!queue) return null;

  const minDelay = 24 * 60 * 60 * 1000;
  const maxDelay = 48 * 60 * 60 * 1000;
  const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;

  const job = await queue.add(
    'user:delete',
    {
      type: 'user:delete',
      userId,
      requestedAt: new Date().toISOString(),
    },
    {
      delay,
      attempts: 3,
      backoff: { type: 'exponential', delay: 60000 },
    }
  );

  return job.id ?? null;
}

export async function cancelUserDeletion(userId: string): Promise<boolean> {
  const queue = getDeletionQueue();
  if (!queue) return false;

  const jobs = await queue.getJobs(['delayed', 'waiting']);
  const userJobs = jobs.filter(
    (job) => job.data.userId === userId && job.data.type === 'user:delete'
  );

  if (userJobs.length === 0) return false;

  await Promise.all(userJobs.map((job) => job.remove()));
  return true;
}

export async function getPendingDeletion(userId: string): Promise<{
  scheduledFor: string;
  remainingMs: number;
  jobId: string;
} | null> {
  const queue = getDeletionQueue();
  if (!queue) return null;

  const jobs = await queue.getJobs(['delayed', 'waiting']);
  const userJob = jobs.find(
    (job) => job.data.userId === userId && job.data.type === 'user:delete'
  );

  if (!userJob || !userJob.delay) return null;

  const remaining = userJob.delay - (Date.now() - userJob.timestamp);
  if (remaining <= 0) return null;

  return {
    scheduledFor: new Date(userJob.timestamp + userJob.delay).toISOString(),
    remainingMs: remaining,
    jobId: userJob.id!,
  };
}

if (hasRedis) {
  const workerConnection = createFreshConnection();
  const worker = new Worker<DeletionJobData>(
    QUEUE_NAME,
    async (job: Job<DeletionJobData>) => {
      const { userId } = job.data;
      console.log(`[DeletionWorker] Executing permanent deletion for user: ${userId}`);

      const { revocationService } = await import(
        '@services/api-gateway/src/oauth/revocation-service.js'
      );
      await revocationService.revokeAllAndDestroyUser(userId);

      console.log(`[DeletionWorker] User ${userId} permanently deleted.`);
    },
    {
      connection: workerConnection as any,
      concurrency: 1,
    }
  );

  worker.on('completed', (job) => {
    console.log(`[DeletionWorker] Job ${job.id} completed for user ${job.data.userId}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[DeletionWorker] Job ${job?.id} failed for user ${job?.data.userId}:`, err);
  });
}
