import { Queue, Worker, Job } from 'bullmq';
import { redisConnection, hasRedis } from './redis-config.js';
import { imapIdleManager } from '@services/email-service/src/email/imap-idle-manager.js';
import { emailSyncWorker } from '@services/email-service/src/email/email-sync-worker.js';

// 1. Define Email Sync Queue
export const emailSyncQueue = hasRedis ? new Queue('email-sync-tasks', {
    connection: redisConnection as any,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 5000,
        },
        removeOnComplete: true,
        removeOnFail: false,
    },
} as any) : null;

// 2. Define Email Sync Worker
export const emailSyncWorkerModule = hasRedis ? new Worker(
    'email-sync-tasks',
    async (job: Job) => {
        const { userId, type, integrationId, limit } = job.data;
        console.log(`[EmailSyncQueue] Processing ${type} job for user ${userId}`);

        if (type === 'historical') {
            await imapIdleManager.syncHistoricalEmails(userId, integrationId, limit || 5000);
        } else if (type === 'poll') {
            const { storage } = await import('@shared/lib/storage/storage.js');
            const integration = await storage.getIntegration(userId, integrationId);
            if (integration) {
                await emailSyncWorker.syncUserEmails(userId, integration);
            }
        } else if (type === 'discovery') {
            await imapIdleManager.syncConnections();
        }
    },
    {
        connection: redisConnection as any,
        concurrency: 5,
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 }
    } as any
) : null;

if (emailSyncWorkerModule) {
    emailSyncWorkerModule.on('completed', (job) => {
        console.log(`[EmailSyncQueue] Job ${job.id} completed`);
    });

    emailSyncWorkerModule.on('failed', (job, err) => {
        console.error(`[EmailSyncQueue] Job ${job?.id} failed:`, err);
    });

    console.log('✅ BullMQ Email Sync Worker initialized');
} else {
    console.warn('⚠️ BullMQ Email Sync Worker disabled (No Redis)');
}




