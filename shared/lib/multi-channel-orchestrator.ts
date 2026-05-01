import { storage } from '@shared/lib/storage/storage.js';
import { db } from '@shared/lib/db/db.js';
import { followUpQueue, leads } from '@audnix/shared';
import { eq, and, lt } from 'drizzle-orm';

/**
 * Multi-channel orchestration system for human-like outreach timing
 * 
 * Stagger across channels to avoid looking like a bot:
 * - Email: Day 0, 24h, 48h, Day 5, Day 7
 * - Instagram: Day 5, Day 8 (only if email failed)
 */

export interface FollowUpSchedule {
  leadId: string;
  userId: string;
  channel: 'email' | 'instagram';
  scheduledFor: Date;
  sequenceNumber: number;
  conditions?: {
    requireEmailOpened?: boolean;
    requireEmailClicked?: boolean;
    onlyIfEmailIgnored?: boolean;
  };
}

export class MultiChannelOrchestrator {
  /**
   * Calculate next follow-up timing based on campaign day and channel
   */
  static calculateNextSchedule(leadId: string, campaignDayCreated: Date, lastMessageChannel?: string): FollowUpSchedule[] {
    const now = new Date();
    const daysSinceCampaignStart = Math.floor(
      (now.getTime() - campaignDayCreated.getTime()) / (1000 * 60 * 60 * 24)
    );

    const schedules: FollowUpSchedule[] = [];

    // EMAIL SEQUENCE (High-Impact Gaps)
    const emailSchedules = [
      { day: 0, sequenceNumber: 1, label: 'initial' },    // Day 0: Initial Transformation
      { day: 1, sequenceNumber: 2, label: 'followup_1' }, // Day 1: Disruptive Hook
      { day: 3, sequenceNumber: 3, label: 'followup_2' }, // Day 3: Curiosity Gap
      { day: 7, sequenceNumber: 4, label: 'final' },      // Day 7: Strategic Archive Theory
    ];

    for (const schedule of emailSchedules) {
      if (daysSinceCampaignStart >= schedule.day) {
        const scheduledDate = new Date(campaignDayCreated);
        scheduledDate.setDate(scheduledDate.getDate() + schedule.day);

        // Human-like randomization windows
        const randomHours = schedule.day === 0 ?
          Math.random() * 2 : // Immediate: 0-2 hours
          schedule.day === 1 ?
            18 + Math.random() * 8 : // Day 1: 18-26 hours (Next day peak)
            schedule.day === 3 ?
              65 + Math.random() * 12 : // Day 3: Peak flow
              Math.random() * 24; // Day 7: Strategic timing

        scheduledDate.setHours(scheduledDate.getHours() + randomHours);

        schedules.push({
          leadId,
          userId: '', // Will be set by caller
          channel: 'email',
          scheduledFor: scheduledDate,
          sequenceNumber: schedule.sequenceNumber,
        });
      }
    }

    // INSTAGRAM DM SEQUENCE (only after day 3, if email failed)
    if (daysSinceCampaignStart >= 3) {
      const igSchedules = [
        { day: 3, sequenceNumber: 1, label: 'social_nudge' },   // Day 3: Social nudge
        { day: 6, sequenceNumber: 2, label: 'final_push' },     // Day 6: Final push
      ];

      for (const schedule of igSchedules) {
        if (daysSinceCampaignStart >= schedule.day) {
          const scheduledDate = new Date(campaignDayCreated);
          scheduledDate.setDate(scheduledDate.getDate() + schedule.day);
          scheduledDate.setHours(scheduledDate.getHours() + Math.random() * 4);

          schedules.push({
            leadId,
            userId: '',
            channel: 'instagram',
            scheduledFor: scheduledDate,
            sequenceNumber: schedule.sequenceNumber,
            conditions: {
              onlyIfEmailIgnored: true,
            },
          });
        }
      }
    }

    return schedules;
  }

  /**
   * Get next scheduled follow-up for a lead
   */
  static async getNextFollowUp(leadId: string) {
    try {
      const followUp = await db
        .select()
        .from(followUpQueue)
        .where(
          and(
            eq(followUpQueue.leadId, leadId),
            lt(followUpQueue.scheduledAt, new Date()),
            eq(followUpQueue.status, 'pending')
          )
        )
        .orderBy(followUpQueue.scheduledAt)
        .limit(1);

      return followUp[0] || null;
    } catch (error) {
      console.error('Error getting next follow-up:', error);
      return null;
    }
  }

  /**
   * Check if a lead is ready for next channel (e.g., email didn't work, try Instagram)
   */
  static async shouldEscalateChannel(leadId: string): Promise<'email' | 'instagram' | null> {
    // Check last few email sends
    const recentEmails = await db
      .select()
      .from(followUpQueue)
      .where(
        and(
          eq(followUpQueue.leadId, leadId),
          eq(followUpQueue.channel, 'email')
        )
      )
      .orderBy(followUpQueue.scheduledAt)
      .limit(3);

    // If last 2 emails were ignored (no opens/clicks), escalate to Instagram
    const allIgnored = recentEmails.length >= 2;
    if (allIgnored) {
      return 'instagram';
    }

    return null;
  }

  /**
   * Universal dispatch for all outbound AI communication
   */
  static async dispatchMessage(userId: string, leadId: string, content: string, options: {
    channel: 'email' | 'instagram';
    subject?: string;
    isAutonomous?: boolean;
    metadata?: any;
  }) {
    console.log(`[Orchestrator] Dispatching ${options.channel} to lead ${leadId} (Autonomous: ${!!options.isAutonomous})`);

    const lead = await storage.getLead(leadId);
    if (!lead) throw new Error(`Lead ${leadId} not found`);

    if (options.channel === 'email') {
      const { sendEmail } = await import('@shared/lib/channels/email.js');
      return await sendEmail(userId, lead.email || '', content, options.subject || 'Follow up', {
        leadId,
        isAutonomous: options.isAutonomous,
        ...options.metadata
      });
    } else if (options.channel === 'instagram') {
      const { sendInstagramOutreach } = await import('@shared/lib/channels/instagram.js');
      return await sendInstagramOutreach(userId, leadId, content, {
        isAutonomous: options.isAutonomous,
        metadata: options.metadata
      });
    } else {
      throw new Error(`Unsupported channel: ${options.channel}`);
    }
  }
}

// Export for use in follow-up worker
export default MultiChannelOrchestrator;


