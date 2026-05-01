import { generateReply } from '@services/brain-worker/src/ai-lib/core/ai-service.js';
import { MODELS } from '@services/brain-worker/src/ai-lib/utils/model-config.js';
import { availabilityService } from './availability-service.js';
import { db } from '@shared/lib/db/db.js';
import { calendarSettings, integrations, users, notifications, calendarBookings } from '@audnix/shared';
import { eq, and, gte, lte } from 'drizzle-orm';
import { calendlyOAuth } from '@services/api-gateway/src/oauth/calendly.js';
import {
  getLeadProfile,
  inferTimezoneFromCity,
  inferPreferredWindowFromNiche,
  isWithinLeadPreferredWindow,
  formatLocalHour,
  populateLeadProfile,
} from './lead-timezone-intelligence.js';
import { socketService } from '@shared/lib/realtime/socket-service.js';

/** Max bookings allowed between 10PM-6AM per user per night */
// This is now handled centrally by availabilityService.canDeliverDuringNightWatch

function isNightHour(date: Date, timezone: string): boolean {
  try {
    const hour = parseInt(
      new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hourCycle: 'h23' }).format(date),
      10
    );
    return hour >= 22 || hour < 6;
  } catch {
    return false;
  }
}

/** Format a UTC ISO string as a natural human booking suggestion */
function formatBookingCopy(isoSlot: string, leadProfile: any, useCount: number = 0, fallbackTz: string = 'UTC'): string {
  const date = new Date(isoSlot);
  const now = new Date();
  const tz = leadProfile?.detectedTimezone || fallbackTz;

  const dayName = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(date);
  const shortDate = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
  }).format(date);
  
  const hour = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(date),
    10
  );
  const timeStr = formatLocalHour(hour);

  // Smart relative dating
  const dateStr = date.toDateString();
  const nowStr = now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toDateString();

  const timeReference = dateStr === nowStr ? 'today' : dateStr === tomorrowStr ? 'tomorrow' : dayName;

  // Vary the copy so it doesn't sound templated
  const templates = [
    `How does ${timeReference} at ${timeStr} work for you?`,
    `Are you free ${timeReference} (${shortDate}) around ${timeStr}? It only takes about 20 minutes.`,
    `${timeReference} at ${timeStr} — does that work on your end?`,
    `Would ${timeReference} at ${timeStr} be good for a quick call?`,
    `${timeReference} around ${timeStr} — good for you?`,
    `Does ${timeStr} ${timeReference} suit you for a brief chat?`,
  ];
  return templates[useCount % templates.length];
}

/**
 * Generate professional clash/conflict copy.
 * Never says "slot taken" or "time is blocked."
 */
function generateClashCopy(alternativeSlot: string | null, leadProfile: any, fallbackTz: string = 'UTC'): string {
  if (!alternativeSlot) {
    return "I've got a conflict coming up — let me get back to you with a couple more options.";
  }
  const date = new Date(alternativeSlot);
  const tz = leadProfile?.detectedTimezone || fallbackTz;
  const dayName = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(date);
  const hour = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(date),
    10
  );
  const timeStr = formatLocalHour(hour);

  const clashPhrases = [
    `I'll be tied up then — how does ${dayName} at ${timeStr} work instead?`,
    `I've got something on at that time. Would ${dayName} at ${timeStr} work for you?`,
    `That window's spoken for on my end — ${dayName} at ${timeStr} could work though.`,
    `I'm going to be engaged then — can we do ${dayName} at ${timeStr}?`,
  ];
  return clashPhrases[Math.floor(Math.random() * clashPhrases.length)];
}

export class BookingProposer {
  private userId: string;
  /** Class-level in-memory slot lock (30-min reservation) */
  private static proposedSlots = new Map<string, { userId: string; expiry: number }>();

  constructor(userId: string) {
    this.userId = userId;
  }

  private static cleanupCache() {
    const now = Date.now();
    for (const [slot, data] of this.proposedSlots.entries()) {
      if (data.expiry < now) this.proposedSlots.delete(slot);
    }
  }

  private static isSlotProposed(userId: string, slotIso: string): boolean {
    this.cleanupCache();
    const data = this.proposedSlots.get(slotIso);
    return !!(data && data.userId === userId);
  }

  private static markSlotProposed(userId: string, slotIso: string) {
    this.proposedSlots.set(slotIso, { userId, expiry: Date.now() + 30 * 60 * 1000 });
  }

  /**
   * Propose 1-3 meeting times for a lead using niche-aware intelligence.
   *
   * Returns ready-to-send human copy like:
   *   "How does Thursday at 5pm work for you?"
   *
   * Never mentions timezones, never exposes system state.
   */
  async proposeTimes(
    userInput: string,
    lead: { id: string; email: string; name: string; city?: string | null; metadata?: any }
  ): Promise<{
    suggestedSlots: Array<{ iso: string; copy: string }>;
    parsedIntent: string;
    needsClarification: boolean;
  }> {
    try {
      // 1. Load lead timezone profile
      let leadProfile = await getLeadProfile(lead.id);
      if (!leadProfile) {
        // Attempt auto-population from available lead data
        await populateLeadProfile(lead.id, this.userId, {
          city: (lead as any).city,
          niche: lead.metadata?.niche || lead.metadata?.industry,
          industry: lead.metadata?.industry,
        });
        leadProfile = await getLeadProfile(lead.id);
      }

      const leadTz = leadProfile?.detectedTimezone || inferTimezoneFromCity((lead as any).city || '');
      const [user] = await db.select().from(users).where(eq(users.id, this.userId)).limit(1);
      const userTimezone = user?.timezone || 'UTC';

      // 2. Parse lead's stated intent
      const intentPrompt = `Extract meeting preferences from: "${userInput}"
      
Current context:
- Lead's region timezone: ${leadTz}
- Current time (user's perspective): ${new Date().toLocaleString('en-US', { timeZone: userTimezone })}

Analyze:
1. Relative dates ("tomorrow", "next Tuesday", "Thursday")
2. Time-of-day ("afternoon", "evening", "morning", "anytime")
3. Negative constraints ("not Friday", "not morning")
4. Urgency signals ("ASAP", "this week")

Return strictly JSON:
{
  "days": ["YYYY-MM-DD" or "DayOfWeek"],
  "timeRanges": ["morning"|"afternoon"|"evening"|"anytime"],
  "parsedIntent": "Friendly 1-sentence summary",
  "confidence": 0.0-1.0
}`;

      const intentResult = await generateReply(
        'You are an expert calendar coordination agent. Return only valid JSON.',
        intentPrompt,
        { model: MODELS.sales_reasoning, jsonMode: true }
      );
      const extraction = JSON.parse((intentResult.text || '{}').trim());

      if (!extraction.confidence || extraction.confidence < 0.35) {
        return { suggestedSlots: [], parsedIntent: userInput, needsClarification: true };
      }

      // 3. Get candidate slots from AvailabilityService (1-week lookahead)
      const candidateSlots = await availabilityService.getSuggestedTimes(this.userId, 168);

      // 4. Filter slots by lead's niche-preferred window
      const nicheFilteredSlots = candidateSlots.filter(s => {
        // Always respect outright unavailability
        if (!s.start) return false;
        // Apply niche window preference
        if (leadProfile) {
          return isWithinLeadPreferredWindow(s.start, {
            detectedTimezone: leadProfile.detectedTimezone,
            preferredContactStart: leadProfile.preferredContactStart,
            preferredContactEnd: leadProfile.preferredContactEnd,
            preferredDays: leadProfile.preferredDays as string[],
          }, userTimezone);
        }
        return true;
      });

      // Fallback: if niche filter is too restrictive, use all slots
      const slots = nicheFilteredSlots.length >= 2 ? nicheFilteredSlots : candidateSlots;

      // 5. AI slot matching against parsed intent
      const matchPrompt = `Match lead's request: "${userInput}"
Against these available slots (lead in ${leadTz}):
${slots.slice(0, 20).map(s => s.start.toISOString()).join('\n')}

Rules:
- Return up to 3 best ISO strings that satisfy the intent
- Respect time-of-day requested (afternoon = 12pm-5pm lead local time)
- Do NOT return slots the lead explicitly rejected

Return JSON: { "matches": ["ISO_STRING"] }`;

      const matchResult = await generateReply(
        'You are a precision slot matching assistant. Return only valid JSON.',
        matchPrompt,
        { model: MODELS.sales_reasoning, jsonMode: true }
      );
      const matches = JSON.parse((matchResult.text || '{}').trim());
      const rawMatches: string[] = (matches.matches || []).slice(0, 3);

      // 6. Filter out already-proposed slots
      const filtered = rawMatches.filter(s => !BookingProposer.isSlotProposed(this.userId, s));

      // 7. Check night window cap (STRICT PROTOCOL)
      const nightWatch = await availabilityService.canDeliverDuringNightWatch(this.userId, userTimezone);
      const nightCapped: string[] = [];

      for (const slot of filtered) {
        const slotDate = new Date(slot);
        if (isNightHour(slotDate, userTimezone)) {
          if (!nightWatch.allowed) {
            console.log(`[BookingProposer] 🌙 Night cap reached (${nightWatch.count}/7). Yielding slot.`);
            continue;
          }
          // Increment and notify if this is the first one we pick tonight in this loop
          if (nightCapped.length === 0) {
             availabilityService.incrementNightDelivery(this.userId);
             socketService.notifyNewNotification(this.userId, {
               type: 'info',
               title: 'Night Watch Booking Proposal',
               message: `Proposing a slot during off-hours (${nightWatch.count + 1}/7).`
             });
          }
        }
        nightCapped.push(slot);
      }

      // 8. Mark as proposed
      nightCapped.forEach(s => BookingProposer.markSlotProposed(this.userId, s));

      const suggestedSlots = nightCapped.map((iso, idx) => ({
        iso,
        copy: formatBookingCopy(iso, leadProfile, idx, userTimezone),
      }));

      return {
        suggestedSlots,
        parsedIntent: extraction.parsedIntent || 'Looking for a good time.',
        needsClarification: suggestedSlots.length === 0,
      };
    } catch (err) {
      console.error('[BookingProposer] proposeTimes error:', err);
      return { suggestedSlots: [], parsedIntent: 'Error matching schedule', needsClarification: true };
    }
  }

  /**
   * Handles when a previously offered slot is no longer available.
   * Returns professional clash copy + an alternative suggestion.
   */
  async handleSlotClash(
    clashSlotIso: string,
    lead: { id: string; email: string; name: string },
    allMessages: any[]
  ): Promise<string> {
    const leadProfile = await getLeadProfile(lead.id);
    const [user] = await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, this.userId)).limit(1);
    const userTz = user?.timezone || 'UTC';

    const candidateSlots = await availabilityService.getSuggestedTimes(this.userId, 72);
    const alternative = candidateSlots.find(s => s.start.toISOString() !== clashSlotIso) || null;
    return generateClashCopy(alternative?.start?.toISOString() || null, leadProfile, userTz);
  }

  /**
   * Detect if the lead's latest message confirms a previously-proposed time.
   * If confirmed, books via Calendly and marks lead as booked.
   */
  async detectConfirmationAndBook(
    userInput: string,
    conversationHistory: any[],
    lead: { id: string; email: string; name: string }
  ): Promise<{ booked: boolean; bookedTime?: string; copy?: string; error?: string }> {
    try {
      const leadProfile = await getLeadProfile(lead.id);

      const prompt = `Conversation:
${conversationHistory.slice(-10).map(m => `${m.direction}: ${m.body}`).join('\n')}

Current lead message: "${userInput}"

Is the lead confirming a specific meeting time that was suggested earlier?
If yes, what ISO 8601 UTC timestamp does that correspond to?

Return JSON:
{
  "isConfirmation": boolean,
  "confirmedTimeISO": "string | null",
  "reasoning": "string"
}`;

      const result = await generateReply(
        'You are a booking confirmation specialist. Return only valid JSON.',
        prompt,
        { model: MODELS.sales_reasoning, jsonMode: true }
      );

      const detection = JSON.parse((result.text || '{}').trim());

      if (!detection.isConfirmation || !detection.confirmedTimeISO) {
        return { booked: false };
      }

      console.log(`✅ [BookingProposer] Booking confirmed for ${lead.email} at ${detection.confirmedTimeISO}`);

      // Check if this is a night booking — notify user (Strict Protocol)
      if (leadProfile) {
        const [user] = await db.select().from(users).where(eq(users.id, this.userId)).limit(1);
        const userTz = user?.timezone || 'UTC'; 
        const leadTz = leadProfile.detectedTimezone || userTz;
        const slotDate = new Date(detection.confirmedTimeISO);
        
        const nightWatch = await availabilityService.canDeliverDuringNightWatch(this.userId, userTz);
        
        if (nightWatch.isNight) {
          availabilityService.incrementNightDelivery(this.userId);
          const nightHour = new Intl.DateTimeFormat('en-US', {
            timeZone: leadTz, hour: 'numeric', minute: '2-digit', hour12: true
          }).format(slotDate);

          // Push dashboard notification
          await db.insert(notifications).values({
            userId: this.userId,
            type: 'system',
            title: '🌙 Late-Night Confirmation',
            message: `${lead.name} booked a call at ${nightHour} local time (${nightWatch.count + 1}/7 night outbounds used).`,
            metadata: { leadId: lead.id, bookedTime: detection.confirmedTimeISO, isNightBooking: true },
          }).catch(() => {});

          socketService.notifyNewNotification(this.userId, {
            type: 'info',
            title: '🌙 Night Booking Confirmed',
            message: `${lead.name} just booked at ${nightHour} local time`,
          });
        }
      }

      const [settings] = await db
        .select()
        .from(calendarSettings)
        .where(eq(calendarSettings.userId, this.userId))
        .limit(1);

      if (!settings?.calendlyToken) {
        return { booked: false, error: 'No Calendly connected' };
      }

      const bookingResult = await createCalendlyEvent(
        settings.calendlyToken,
        lead.email,
        lead.name,
        new Date(detection.confirmedTimeISO),
        settings.calendlyEventTypeUri || undefined
      );

      if (bookingResult?.success) {
        return { booked: true, bookedTime: detection.confirmedTimeISO };
      }
      return { booked: false, error: bookingResult?.error || 'Booking failed' };
    } catch (err) {
      console.error('[BookingProposer] detectConfirmationAndBook error:', err);
      return { booked: false };
    }
  }
}

// Helper import shim for calendly event creation (avoid duplicate)
async function createCalendlyEvent(
  token: string,
  email: string,
  name: string,
  time: Date,
  eventTypeUri?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { calendlyOAuth } = await import('@services/api-gateway/src/oauth/calendly.js');
    return await (calendlyOAuth as any).createEvent({ token, email, name, time, eventTypeUri });
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}



