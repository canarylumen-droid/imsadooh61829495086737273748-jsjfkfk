/**
 * Warmup BullMQ Queues
 * Two dedicated queues: outbound (send) and inbound (IMAP sweep).
 */

import { Queue } from 'bullmq';
import { redisConnection as redisConfig } from '@shared/lib/queues/redis-config';
import type { Redis } from 'ioredis';
import { WARMUP_CONFIG } from '../config/warmup-config.js';

export const warmupOutboundQueue = new Queue(WARMUP_CONFIG.OUTBOUND_QUEUE_NAME, {
  connection: redisConfig as any,
  defaultJobOptions: {
    attempts: WARMUP_CONFIG.MAX_SEND_ATTEMPTS,
    backoff: { type: 'exponential', delay: 60000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 100 },
  },
});

export const warmupInboundQueue = new Queue(WARMUP_CONFIG.INBOUND_QUEUE_NAME, {
  connection: redisConfig as any,
  defaultJobOptions: {
    attempts: WARMUP_CONFIG.MAX_IMAP_ATTEMPTS,
    backoff: { type: 'exponential', delay: 30000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 100 },
  },
});
