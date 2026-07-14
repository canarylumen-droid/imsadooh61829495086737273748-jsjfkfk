import { Queue } from 'bullmq';
import { redisConnection } from './redis-config.js';
import { createLogger } from '@services/api-gateway/src/core/logger.js';

const log = createLogger('CENTRAL-BUS');

/**
 * ─── CENTRAL DISPATCHER ──────────────────────────────────────────────────────
 * 
 * Unified bus for all microservice communication.
 * Prevents "magic strings" and ensures type safety.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const QUEUES = {
    EMAIL_SYNC: 'audnix-email-sync',
    ORCHESTRATOR: 'audnix-orchestrator',
    KNOWLEDGE: 'audnix-knowledge',
    OUTREACH: 'audnix-outreach',
    SOCIAL: 'audnix-social',
    BILLING: 'audnix-billing',
    AUDIT: 'audnix-audit'
} as const;

type QueueName = typeof QUEUES[keyof typeof QUEUES];

const queueCache = new Map<QueueName, Queue>();

function getQueue(name: QueueName): Queue {
    if (!queueCache.has(name)) {
        queueCache.set(name, new Queue(name, { connection: redisConnection as any }));
    }
    return queueCache.get(name)!;
}

export const bus = {
    /** Dispatch a task to the Orchestrator (The Brain) */
    async dispatchBrain(type: string, userId: string, data: any) {
        log.debug('Dispatching to BRAIN', { type, userId });
        return getQueue(QUEUES.ORCHESTRATOR).add(type, { type, userId, data });
    },

    /** Dispatch a Knowledge/RAG task */
    async dispatchKnowledge(type: string, data: any) {
        log.debug('Dispatching to KNOWLEDGE', { type });
        return getQueue(QUEUES.KNOWLEDGE).add(type, { type, data });
    },

    /** Dispatch an Email/Outreach task */
    async dispatchOutreach(type: string, userId: string, data: any) {
        log.debug('Dispatching to OUTREACH', { type, userId });
        return getQueue(QUEUES.OUTREACH).add(type, { type, userId, data });
    },

    /** Log a success episode for agent learning */
    async learn(userId: string, action: string, context: string, outcome: string, metadata: any = {}) {
        return this.dispatchKnowledge('learn-from-feedback', {
            userId,
            action,
            context,
            outcome,
            metadata
        });
    }
};
