/**
 * CRM Sync Queue - BullMQ-based asynchronous CRM updates
 * Handles DNS state changes, email bounces, spam complaints, and other CRM updates
 * Prevents database locks by offloading heavy CRM writes to background workers
 */

import { Queue, Worker, Job } from 'bullmq';
import { getSharedRedisConnection } from './redis-config.js';

export interface CRMSyncJobData {
  type: 'dns_update' | 'bounce' | 'spam_complaint' | 'domain_reputation' | 'mailbox_health';
  userId: string;
  integrationId?: string;
  domain?: string;
  data: {
    spfValid?: boolean;
    dkimValid?: boolean;
    dmarcValid?: boolean;
    dmarcPolicy?: 'none' | 'quarantine' | 'reject';
    bounceType?: 'hard' | 'soft' | 'spam';
    bounceRate?: number;
    spamRate?: number;
    complaintRate?: number;
    reputationScore?: number;
    healthStatus?: 'connected' | 'warning' | 'failed';
    lastHealthError?: string;
  };
  timestamp: Date;
}

// Queue definition
export const crmSyncQueue = new Queue<CRMSyncJobData>('crm-sync', {
  connection: getSharedRedisConnection() as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: {
      count: 1000,
      age: 3600, // 1 hour
    },
    removeOnFail: {
      count: 5000,
      age: 86400, // 24 hours
    },
  },
});

/**
 * Add DNS update job to queue
 */
export async function queueDNSUpdate(data: {
  userId: string;
  integrationId?: string;
  domain: string;
  spfValid: boolean;
  dkimValid: boolean;
  dmarcValid: boolean;
  dmarcPolicy: 'none' | 'quarantine' | 'reject';
}): Promise<void> {
  await crmSyncQueue.add(
    `dns-update-${data.domain}` as any,
    {
      type: 'dns_update',
      userId: data.userId,
      integrationId: data.integrationId,
      domain: data.domain,
      data: {
        spfValid: data.spfValid,
        dkimValid: data.dkimValid,
        dmarcValid: data.dmarcValid,
        dmarcPolicy: data.dmarcPolicy,
      },
      timestamp: new Date(),
    },
    {
      priority: 1, // High priority for DNS updates
    }
  );
}

/**
 * Add bounce tracking job to queue
 */
export async function queueBounceTracking(data: {
  userId: string;
  integrationId?: string;
  email: string;
  bounceType: 'hard' | 'soft' | 'spam';
}): Promise<void> {
  await crmSyncQueue.add(
    `bounce-${data.email}-${Date.now()}` as any,
    {
      type: 'bounce',
      userId: data.userId,
      integrationId: data.integrationId,
      data: {
        bounceType: data.bounceType,
      },
      timestamp: new Date(),
    },
    {
      priority: 5, // Medium priority for bounces
    }
  );
}

/**
 * Add spam complaint job to queue
 */
export async function queueSpamComplaint(data: {
  userId: string;
  integrationId?: string;
  email: string;
}): Promise<void> {
  await crmSyncQueue.add(
    `spam-complaint-${data.email}-${Date.now()}` as any,
    {
      type: 'spam_complaint',
      userId: data.userId,
      integrationId: data.integrationId,
      data: {},
      timestamp: new Date(),
    },
    {
      priority: 3, // High priority for spam complaints
    }
  );
}

/**
 * Add domain reputation update job to queue
 */
export async function queueDomainReputationUpdate(data: {
  userId: string;
  integrationId?: string;
  domain: string;
  reputationScore: number;
  bounceRate: number;
  spamRate: number;
  complaintRate: number;
}): Promise<void> {
  await crmSyncQueue.add(
    `domain-reputation-${data.domain}` as any,
    {
      type: 'domain_reputation',
      userId: data.userId,
      integrationId: data.integrationId,
      domain: data.domain,
      data: {
        reputationScore: data.reputationScore,
        bounceRate: data.bounceRate,
        spamRate: data.spamRate,
        complaintRate: data.complaintRate,
      },
      timestamp: new Date(),
    },
    {
      priority: 2, // High priority for reputation updates
    }
  );
}

/**
 * Add mailbox health update job to queue
 */
export async function queueMailboxHealthUpdate(data: {
  userId: string;
  integrationId: string;
  healthStatus: 'connected' | 'warning' | 'failed';
  lastHealthError?: string;
}): Promise<void> {
  await crmSyncQueue.add(
    `mailbox-health-${data.integrationId}` as any,
    {
      type: 'mailbox_health',
      userId: data.userId,
      integrationId: data.integrationId,
      data: {
        healthStatus: data.healthStatus,
        lastHealthError: data.lastHealthError,
      },
      timestamp: new Date(),
    },
    {
      priority: 4, // Medium priority for health updates
    }
  );
}

/**
 * Start CRM sync worker
 */
export function startCRMSyncWorker(processJob: (job: Job<CRMSyncJobData>) => Promise<void>): Worker {
  const worker = new Worker<CRMSyncJobData>(
    'crm-sync',
    async (job) => {
      await processJob(job);
    },
    {
      connection: getSharedRedisConnection() as any,
      concurrency: 5,
      limiter: {
        max: 100,
        duration: 60000, // 100 jobs per minute
      },
    }
  );

  worker.on('completed', (job) => {
    console.log(`[CRMSync] Job completed: ${job.name}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[CRMSync] Job failed: ${job?.name}`, err);
  });

  return worker;
}
