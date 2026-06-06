import { db } from '@shared/lib/db/db.js';
import { calendarEvents, users, leads, aiActionLogs, leadTimezoneProfiles } from '@audnix/shared';
import { eq, and, or, gt, lt, isNull } from 'drizzle-orm';
import { storage } from '@shared/lib/storage/storage.js';
import { sendEmail } from "@shared/lib/channels/email.js";
import { generateReply } from "@services/brain-worker/src/ai-lib/core/ai-service.js";
import { evaluateNextBestAction } from "@services/brain-worker/src/orchestrator/agents/autonomous-agent.js";
import { workerHealthMonitor } from "@shared/lib/monitoring/worker-health.js";
import { quotaService } from "@shared/lib/monitoring/quota-service.js";

export class MeetingReminderWorker {
  private isRunning: boolean = false;
  private pollingInterval: NodeJS.Timeout | null = null;
  private readonly POLL_INTERVAL_MS = 600000; // Increased to 10m to protect DB quota (Neon)

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('✅ Meeting Reminder Worker started (10m polling)');
    
    this.pollingInterval = setInterval(() => this.checkAndSendReminders(), this.POLL_INTERVAL_MS);
    this.checkAndSendReminders();
  }

  stop(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.isRunning = false;
  }

  private async checkAndSendReminders(): Promise<void> {
    if (quotaService.isRestricted()) {
      console.log('[MeetingReminder] Skipping check: Database quota restricted');
      return;
    }
    
    // Moved autonomous check to per-user inside loop below

    try {
      const now = new Date();
      const oneHourFromNow = new Date(now.getTime() + 65 * 60 * 1000); // 65 min buffer
      
      // Find bookings starting in the next ~hour, or that were recently marked 'no_show', or just ended in the past 2 hours
      const upcomingBookings = await db.select().from(calendarEvents).where(
        or(
          and(
            eq(calendarEvents.status, 'scheduled'),
            gt(calendarEvents.startTime, new Date(now.getTime() - 10 * 60 * 1000)), // up to 10 mins past start
            lt(calendarEvents.startTime, oneHourFromNow)
          ),
          eq(calendarEvents.status, 'no_show'),
          and(
            eq(calendarEvents.status, 'scheduled'),
            lt(calendarEvents.endTime, now),
            gt(calendarEvents.endTime, new Date(now.getTime() - 120 * 60 * 1000))
          )
        )
      );

      for (const booking of upcomingBookings) {
        try {
          // Check if this specific user has autonomous mode enabled
          const [user] = await db.select().from(users).where(eq(users.id, booking.userId)).limit(1);
          if (!user || (user.config as any)?.autonomousMode === false) {
             continue;
          }

          const metadata = booking.metadata as any || {};
          const reminder24h = metadata.reminder24h_sent;
          const reminder45m = metadata.reminder45m_sent;
          const reminder5m = metadata.reminder5m_sent;
          const noShowHandled = metadata.no_show_handled;

          const minutesUntil = Math.round((new Date(booking.startTime).getTime() - now.getTime()) / 60000);
          const minutesSince = Math.round((now.getTime() - new Date(booking.startTime).getTime()) / 60000);

        // 24-Hour Reminder (1380-1500 mins before = 23h-25h)
        if (minutesUntil <= 1500 && minutesUntil >= 1380 && !reminder24h && booking.status === 'scheduled') {
          await this.sendReminder(booking, '24-hour');
          await this.markReminderSent(booking.id, 'reminder24h_sent');
        }

        // 45 Minute Reminder (40-55 mins before)
        if (minutesUntil <= 55 && minutesUntil >= 40 && !reminder45m && booking.status === 'scheduled') {
          await this.sendReminder(booking, '45-minute');
          await this.markReminderSent(booking.id, 'reminder45m_sent');
        }
        
        // 5 Minute Reminder (0-15 mins before)
        if (minutesUntil <= 15 && minutesUntil >= 0 && !reminder5m && booking.status === 'scheduled') {
          await this.sendReminder(booking, '5-minute');
          await this.markReminderSent(booking.id, 'reminder5m_sent');
        }

        // No-Show Reschedule (30 mins after scheduled start time OR marked explicitly as no_show by Fathom)
        if (booking.status === 'no_show' && minutesSince >= 30 && minutesSince <= 120 && !noShowHandled) {
          await this.sendRescheduleEmail(booking);
          await this.markReminderSent(booking.id, 'no_show_handled');
        }

          // Post-Meeting Autonomous Action via Fathom (Checks completed meetings)
          if (booking.status === 'scheduled' && now.getTime() > new Date(booking.endTime).getTime() && !metadata.post_meeting_handled) {
            const handled = await this.processPostMeetingSummary(booking);
            if (handled) {
              await this.markReminderSent(booking.id, 'post_meeting_handled');
            }
          }
        } catch (bookingError: any) {
          console.error(`[MeetingReminder] Error processing booking ${booking.id}:`, bookingError);
        }
      }

      workerHealthMonitor.recordSuccess('meeting-reminder-worker');
    } catch (error: any) {
      console.error('[MeetingReminder] Error:', error);
      quotaService.reportDbError(error);
      workerHealthMonitor.recordError('meeting-reminder-worker', error?.message || 'Unknown error');
    }
  }

  private async sendReminder(booking: any, type: string): Promise<void> {
    const user = await storage.getUserById(booking.userId);
    if (!user) return;

    const lead = booking.leadId ? await storage.getLeadById(booking.leadId) : null;
    const recipientName = booking.attendeeName || lead?.name || 'there';
    const recipientEmail = booking.attendeeEmail || lead?.email;

    if (!recipientEmail) return;

    // Get lead's inferred timezone for accurate time display
    let leadTz = user.timezone || 'UTC'; 
    if (lead?.id) {
      const [tzProfile] = await db
        .select({ detectedTimezone: leadTimezoneProfiles.detectedTimezone })
        .from(leadTimezoneProfiles)
        .where(eq(leadTimezoneProfiles.leadId, lead.id))
        .limit(1);
      if (tzProfile?.detectedTimezone) leadTz = tzProfile.detectedTimezone;
    }

    // Format the meeting time in the lead's local timezone
    const localTime = new Intl.DateTimeFormat('en-US', {
      timeZone: leadTz,
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(booking.startTime));

    console.log(`[MeetingReminder] Sending ${type} reminder to ${recipientEmail} — call at ${localTime}`);

    const history = lead?.id ? await storage.getMessagesByLeadId(lead.id) : [];
    const historyStr = history.slice(-3).map(m => `${m.direction === 'inbound' ? 'Lead' : 'AI'}: ${m.body}`).join('\n');

    const is24h = type === '24-hour';

    const systemPrompt = `You are a high-performing AI sales assistant writing concise, professional meeting reminders.
Rules:
- Maximum 2 sentences
- No emojis, no fluff
- Confident, friendly, human tone
- Always include the meeting time formatted in the lead's local time
- Do NOT mention timezones by name — just write the time naturally
- Output only the final message. No explanations.`;

    const prompt = is24h
      ? `Write a friendly 24-hour meeting reminder.

Details:
- Meeting: ${booking.title}
- Their local time: ${localTime}
- Meeting link: ${booking.meetingUrl || 'Not provided'}
- Lead name: ${recipientName}
- Your business: ${user.company || user.businessName || 'Our Team'}

Instruction:
- Remind them about tomorrow's call
- Check they're still available
- Sound like a real, warm person — not a reminder bot
- Example tone: "Just checking in — we have a call tomorrow at [time]. Looking forward to it."
- Keep it 1-2 sentences max`
      : `Write a ${type} meeting reminder.

Details:
- Meeting: ${booking.title}
- Their local time: ${localTime}
- Meeting link: ${booking.meetingUrl || 'Not provided'}
- Lead name: ${recipientName}
- Your business: ${user.company || user.businessName || 'Our Team'}

Previous context:
${historyStr || 'None'}

Instruction:
- Keep it clear, direct, natural
- For 45-minute: light excitement, e.g. "We're 45 minutes out — see you shortly."
- For 5-minute: short and punchy, e.g. "We're up in 5 — I'll be on the line."
- 1-2 sentences max`;

    const { text } = await generateReply(systemPrompt, prompt);

    await sendEmail(
      booking.userId,
      recipientEmail,
      text,
      `Reminder: ${booking.title}${is24h ? ' — Tomorrow' : ` in ${type}`}`,
      { isHtml: true, leadId: booking.leadId }
    );
  }

  private async sendRescheduleEmail(booking: any): Promise<void> {
    const user = await storage.getUserById(booking.userId);
    if (!user) return;

    const lead = booking.leadId ? await storage.getLeadById(booking.leadId) : null;
    const recipientName = booking.attendeeName || lead?.name || 'there';
    const recipientEmail = booking.attendeeEmail || lead?.email;

    if (!recipientEmail) return;

    console.log(`[MeetingReminder] Sending no-show reschedule email to ${recipientEmail} for "${booking.title}"`);

    const calendarLink = (user as any).calendlyLink || (user as any).calendarLink;
    const bookingCta = calendarLink ? `Link: ${calendarLink}` : `Please reply to let us know when works best.`;
    const systemPrompt = `
You are a high-performing AI sales assistant specialized in writing concise, professional meeting reminders.

Your goals:
- Maximize clarity, professionalism, and response rates
- Keep messages brief, natural, and human-like
- Personalize when relevant, without sounding forced
- Use soft, action-oriented phrasing (e.g., "Feel free to pick a time that works best for you") to increase reply rates

Strict rules:
- Output must be 1–2 sentences maximum
- No emojis, no fluff, no filler phrases
- Maintain a confident, polite, and professional tone
- Do NOT invent details that are not provided
- Only use context if it is clearly relevant and adds value
- Always include the meeting time and link (if available)

Output only the final message. No explanations.
`;

    const prompt = `
Write a polite, frictionless missed-meeting follow-up email.

Context:
- Meeting title: ${booking.title}
- Recipient name: ${recipientName}
- Sender business: ${user.company || user.businessName || 'Our Team'}
- Reschedule link / CTA: ${bookingCta}

Instructions:
- Assume the recipient was busy; do not assign blame or mention "missing" the meeting negatively
- Keep tone calm, understanding, and professional
- Keep it 2 sentences maximum (3 only if absolutely necessary)
- Make rescheduling feel easy and low-pressure
- Include the CTA naturally in the message
- Do NOT sound pushy, salesy, or passive-aggressive
- Do NOT invent details

Output requirements:
- Output only the final email message
- No subject line, no placeholders, no extra commentary
- Single short paragraph
`;

    const { text } = await generateReply(systemPrompt, prompt);

    await sendEmail(
      booking.userId,
      recipientEmail,
      text,
      `Missed you for ${booking.title} - Reschedule?`,
      { isHtml: true, leadId: booking.leadId }
    );
  }

  private async processPostMeetingSummary(booking: any): Promise<boolean> {
    const fathomApiKey = process.env.FATHOM_API_KEY;
    const externalEventId = booking.externalEventId || booking.externalId;
    if (!fathomApiKey || !externalEventId) return false;

    const user = await storage.getUserById(booking.userId);
    const lead = booking.leadId ? await storage.getLeadById(booking.leadId) : null;
    
    if (!user || !lead || !lead.email) return false;

    try {
      console.log(`[MeetingReminder] Querying Fathom API for completed meeting ${externalEventId}`);
      // Query Fathom for the transcript/summary of the completed call
      const fathomRes = await fetch(`https://api.fathom.video/v1/calls?event_id=${externalEventId}`, {
        headers: { 'Authorization': `Bearer ${fathomApiKey}` }
      });

      if (!fathomRes.ok) {
        console.warn(`[MeetingReminder] Fathom API wait: Call summary not ready or 404 for ${externalEventId}`);
        // Let it retry next tick if it's just delayed
        return false;
      }

      const callData = await fathomRes.json();
      
      // Handle actual Fathom no-show status detection
      if (callData.data && callData.data[0]?.status === 'no_show') {
         await db.update(calendarEvents).set({ status: 'no_show' }).where(eq(calendarEvents.id, booking.id));
         return true; // The no-show handler will pick it up
      }

      const summary = callData.data?.[0]?.summary || callData.data?.[0]?.transcript;
      
      // If Fathom doesn't have the summary or transcript yet, abort and try again later
      if (!summary) {
         console.warn(`[MeetingReminder] Fathom summary/transcript not available yet for ${externalEventId}`);
         return false;
      }

      // Phase 7: Use Unified Autonomous Agent for Expert NBA
      console.log(`[MeetingReminder] Triggering Expert SDR Manager for ${lead.email}`);
      await evaluateNextBestAction(lead.id, summary);
      
      // Mark booking as completed
      await db.update(calendarEvents).set({ status: 'completed' }).where(eq(calendarEvents.id, booking.id));
      return true;

    } catch (err) {
      console.error(`[MeetingReminder] Error processing Fathom post-meeting summary:`, err);
      return false;
    }
  }

  private async markReminderSent(id: string, field: string): Promise<void> {
    const booking = await db.select().from(calendarEvents).where(eq(calendarEvents.id, id)).limit(1);
    if (booking.length === 0) return;

    const metadata = (booking[0] as any).metadata || {};
    await db.update(calendarEvents)
      .set({ 
        metadata: { ...metadata, [field]: true, last_reminder_at: new Date().toISOString() } 
      } as any)
      .where(eq(calendarEvents.id, id));
  }
}

export const meetingReminderWorker = new MeetingReminderWorker();






