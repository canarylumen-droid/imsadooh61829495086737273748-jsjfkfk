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
 * Start the global outreach engine worker
 */
export async function startOutreachWorker() {
  const { outreachEngine } = await import("@services/outreach-worker/workers/outreach-engine.js");
  return outreachEngine.start();
}

/**
 * Dispatch an entire campaign to the background queue
 */
export async function dispatchOutreachCampaign(userId: string, campaignId: string) {
  const job = await outreachQueue.add('campaign-dispatch', {
    userId,
    campaignId,
    type: 'initial'
  }, {
    jobId: `campaign-${campaignId}-${Date.now()}`
  });
  
  return { jobId: job.id, queued: true };
}
