import { storage } from '@shared/lib/storage/storage.js';
import type { IntentAnalysis } from '../analyzers/intent-analyzer.js';

/**
 * Schedule an automated email reply based on intent
 */
export async function scheduleAutomatedEmailReply(
  userId: string,
  leadId: string,
  recipientEmail: string,
  subject: string,
  lastMessage: string,
  intent?: IntentAnalysis,
  threadId?: string
): Promise<void> {
    try {
        const existingJob = await storage.getPendingFollowUp(leadId);
        if (existingJob) return;

        // 24/7 MODE: Reduced delay to 1-2 minutes for faster autonomous response.
        const delayMs = (1 + Math.random()) * 60 * 1000;
        const scheduledAt = new Date(Date.now() + delayMs);

        console.log(`[EMAIL_AUTO] Scheduling reply for ${leadId} in ${Math.round(delayMs / 60000)}m at ${scheduledAt.toISOString()}`);

        await storage.createFollowUp({
            userId,
            leadId,
            channel: 'email',
            status: 'pending',
            scheduledAt: scheduledAt,
            context: {
                last_message: lastMessage,
                intent,
                thread_id: threadId,
                subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`
            }
        });
    } catch (error) {
        console.error('[EMAIL_AUTO] Error scheduling email reply:', error);
    }
}



