import { createQueue, createWorker } from './queue-manager.js';

export interface OutreachJobData {
  userId: string;
  campaignId?: string;
  leadId?: string;
  mailboxId?: string;
  integrationId?: string;
  priority?: number;
  type: 'initial' | 'followup' | 'autonomous_reply' | 'autonomous';
  isAutonomous?: boolean;
}

// The main queue for all outreach activities
export const outreachQueue = createQueue<OutreachJobData>('outreach-engine');

/**
 * Helper to add a high-priority outreach job
 */
export async function enqueueHighPriorityOutreach(data: OutreachJobData) {
  return await outreachQueue.add('high-priority-send', data, {
    priority: 1, // Lower number = higher priority in BullMQ
    jobId: `high-prio-${data.userId}-${data.leadId || 'general'}-${Date.now()}`
  });
}

/**
 * Helper to add a standard scheduled outreach job
 */
export async function enqueueStandardOutreach(data: OutreachJobData, delayMs: number = 0) {
  return await outreachQueue.add('standard-send', data, {
    delay: delayMs,
    priority: 10,
    jobId: `std-${data.userId}-${data.leadId || 'general'}-${Date.now()}`
  });
}

/**
 * Helper to add a conversational reply to the front of the line
 */
export async function enqueuePriorityReply(data: OutreachJobData) {
  return await outreachQueue.add('priority-reply', { ...data, priority: 1 }, {
    priority: 1, // BullMQ: 1 is highest priority
    jobId: `reply-${data.leadId}-${Date.now()}`
  });
}

/**
 * System 11: Schedule the persistent 12-hour Pulse Sweep
 */
export async function schedulePulseSweep() {
  return await outreachQueue.add('pulse-sweep-trigger', { type: 'autonomous' } as any, {
    repeat: {
      every: 12 * 60 * 60 * 1000, // 12 hours
    },
    jobId: 'global-pulse-sweep'
  });
}

/**
 * Dispatch an outreach campaign for a specific user
 */
export async function dispatchOutreachCampaign(userId: string, campaignId: string) {
  const job = await enqueueStandardOutreach({
    userId,
    campaignId,
    type: 'initial'
  });
  
  return {
    jobId: job.id,
    queued: !!job.id
  };
}


/**
 * Start the global outreach engine worker
 */
export async function startOutreachWorker() {
  const { outreachEngine } = await import("@services/outreach-worker/workers/outreach-engine.js");
  
  // Initialize the persistent Pulse Sweep on startup
  await schedulePulseSweep().catch(e => console.error("Failed to schedule pulse sweep:", e));
  
  return outreachEngine.start();
}
