import { db } from '@shared/lib/db/db.js';
import { calendarEvents, users, leads, aiActionLogs, leadTimezoneProfiles } from '@audnix/shared';
import { eq, and, or, gt, lt, isNull, not, sql } from 'drizzle-orm';
import { storage } from '@shared/lib/storage/storage.js';
import { sendEmail } from "@shared/lib/channels/email.js";
import { generateReply } from "@services/brain-worker/src/ai-lib/core/ai-service.js";
import { evaluateNextBestAction } from "@services/brain-worker/src/orchestrator/agents/autonomous-agent.js";
import { workerHealthMonitor } from "@shared/lib/monitoring/worker-health.js";
import { quotaService } from "@shared/lib/monitoring/quota-service.js";

export class MeetingReminderWorker {
  private isRunning: boolean = false;
  private pollingInterval: NodeJS.Timeout | null = null;
  private readonly POLL_INTERVAL_MS = 300000; // 5 minutes to protect DB quota (Neon)

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

      // Check 3-hour booking reminders
      await this.checkAndSendBookingReminders();

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

    const systemPrompt = `## IDENTITY
You are a high-performing sales assistant who writes meeting reminders people actually read and respond to.

## MISSION
Write a concise, professional meeting reminder that confirms attendance and sounds like a real person — not an automated calendar bot.

## 🔒 ANTI-HALLUCINATION RULES
1. ONLY use the meeting details, lead name, and brand info provided. Do not invent details.
2. Do not add context, instructions, or information not present in the input.
3. The meeting time must match EXACTLY what is provided — never invent or reformat times.

## HARD CONSTRAINTS
1. Maximum 2 sentences. No exceptions.
2. No emojis, no fluff, no filler phrases.
3. Confident, friendly, human tone — like a colleague reminding you.
4. Always include the meeting time formatted in the lead's local time.
5. Do NOT mention timezone names — just write the time naturally: "tomorrow at 2pm".
6. Do NOT add the meeting URL unless it's explicitly provided.
7. Output only the final message. No subject line, no explanations, no labels.`;

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
    const systemPrompt = `## IDENTITY
You are a high-performing sales assistant who handles missed meetings with grace and professionalism.

## MISSION
Write a polite, friction-free reschedule email for a missed meeting. The goal is to make rescheduling feel easy and low-pressure — not guilt-inducing.

## 🔒 ANTI-HALLUCINATION RULES
1. ONLY use the meeting details, lead name, and reschedule link provided. Do not invent context.
2. Never assume why the lead missed the meeting. Do not reference reasons not provided.
3. Do not add emotional language or assumptions about the lead's intent.

## HARD CONSTRAINTS
1. Output must be 1-2 sentences maximum (3 only if absolutely necessary).
2. No emojis, no fluff, no filler phrases.
3. Confident, polite, professional tone — calm and understanding.
4. Do NOT invent details not provided.
5. Assume the recipient was busy — do not assign blame or use negative framing about the missed meeting.
6. Make rescheduling feel easy and low-pressure. Use soft, action-oriented phrasing.
7. Always include the reschedule link or CTA naturally in the message.
8. Do NOT sound pushy, salesy, or passive-aggressive.
9. Output only the final message. No subject line, no placeholders, no extra commentary.`;

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

  private async checkAndSendBookingReminders(): Promise<void> {
    const now = new Date();
    const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);

    try {
      // Two groups:
      //   A – Lead replied with booking intent → timer based on intent time
      //   B – Lead got a booking link but never replied → timer based on link sent time
      const candidates = await db.select().from(leads).where(
        and(
          or(
            // Group A: booking intent detected 3-6 hours ago
            and(
              sql`leads.metadata->>'bookingIntentDetectedAt' IS NOT NULL`,
              sql`(leads.metadata->>'bookingIntentDetectedAt')::timestamp <= ${threeHoursAgo.toISOString()}::timestamp`,
              sql`(leads.metadata->>'bookingIntentDetectedAt')::timestamp >= ${sixHoursAgo.toISOString()}::timestamp`,
            ),
            // Group B: link sent 3-6 hours ago, no intent reply
            and(
              sql`leads.metadata->>'bookingIntentDetectedAt' IS NULL`,
              sql`leads.metadata->>'bookingLinkSentAt' IS NOT NULL`,
              sql`(leads.metadata->>'bookingLinkSentAt')::timestamp <= ${threeHoursAgo.toISOString()}::timestamp`,
              sql`(leads.metadata->>'bookingLinkSentAt')::timestamp >= ${sixHoursAgo.toISOString()}::timestamp`,
            )
          ),
          sql`leads.metadata->>'bookingReminderSentAt' IS NULL`,
          not(eq(leads.status, 'booked'))
        )
      );

      for (const lead of candidates) {
        try {
          // Safety check: verify no meeting exists in calendarEvents (handles 10-min sync gap)
          const existingEvent = await db.select()
            .from(calendarEvents)
            .where(and(
              eq(calendarEvents.leadId, lead.id),
              eq(calendarEvents.userId, lead.userId),
              or(
                eq(calendarEvents.status, 'scheduled'),
                eq(calendarEvents.status, 'completed')
              )
            ))
            .limit(1);

          if (existingEvent.length > 0) {
            const meta = { ...(lead.metadata as Record<string, any> || {}) };
            meta.bookingReminderStatus = 'booked';
            meta.bookingReminderSentAt = new Date().toISOString();
            await db.update(leads)
              .set({ metadata: meta, updatedAt: new Date() })
              .where(eq(leads.id, lead.id));
            continue;
          }

          const user = await storage.getUserById(lead.userId);
          if (!user) continue;
          if ((user.config as any)?.autonomousMode === false) continue;

          const recipientEmail = lead.replyEmail || lead.email;
          if (!recipientEmail) continue;

          const calendarLink = user.calendarLink || lead.calendlyLink || 'our calendar';
          const recipientName = lead.name || 'there';

          const leadMeta = (lead.metadata as Record<string, any>) || {};
          const hasIntent = !!leadMeta.bookingIntentDetectedAt;

          console.log(`[BookingReminder] Sending 3-hour booking reminder to ${recipientEmail} for lead ${lead.id} (intent: ${hasIntent})`);

          // Build conversation context for AI-generated reminder
          const history = await storage.getMessagesByLeadId(lead.id);
          const historyStr = history.slice(-5).map(m =>
            `${m.direction === 'inbound' ? 'Lead' : 'AI'}: ${m.body}`
          ).join('\n');

          const { text } = await generateReply(
            `You are a high-performing AI sales assistant writing a brief, warm check-in email.
Rules:
- 1-2 sentences maximum
- No emojis, no fluff
- Warm, human tone — not robotic
- Include the calendar link naturally
- Do NOT mention timezones or specific times
- Output only the final message. No explanations.`,
            hasIntent
              ? `Write a brief check-in email.

Context:
- Lead name: ${recipientName}
- They recently expressed interest in booking a call but haven't scheduled yet
- Your business: ${user.company || user.businessName || 'Our Team'}
- Calendar link: ${calendarLink}
- Recent conversation:
${historyStr || 'None'}

Instructions:
- Friendly nudge, no pressure
- Reference their interest naturally
- Keep it 1-2 sentences`
              : `Write a brief check-in email.

Context:
- Lead name: ${recipientName}
- I sent them my calendar link earlier but they haven't booked yet
- Your business: ${user.company || user.businessName || 'Our Team'}
- Calendar link: ${calendarLink}
- Recent conversation:
${historyStr || 'None'}

Instructions:
- Friendly check-in, no pressure
- Do NOT pretend they expressed interest — they may have just been busy
- Keep it 1-2 sentences`
          );

          await sendEmail(
            lead.userId,
            recipientEmail,
            text,
            'Quick check-in',
            { isHtml: true, leadId: lead.id }
          );

          const updatedMeta = { ...(lead.metadata as Record<string, any> || {}) };
          updatedMeta.bookingReminderSentAt = new Date().toISOString();
          updatedMeta.bookingReminderStatus = 'sent';
          await db.update(leads)
            .set({ metadata: updatedMeta, updatedAt: new Date() })
            .where(eq(leads.id, lead.id));

          console.log(`[BookingReminder] Reminder sent to ${recipientEmail}`);
        } catch (leadErr) {
          console.error(`[BookingReminder] Error processing lead ${lead.id}:`, leadErr);
        }
      }
    } catch (error) {
      console.error('[BookingReminder] Error checking booking reminders:', error);
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






