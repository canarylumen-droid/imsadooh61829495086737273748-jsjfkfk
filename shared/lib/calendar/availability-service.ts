import { storage } from '@shared/lib/storage/storage.js';
import { googleCalendarOAuth } from '@services/api-gateway/src/oauth/google-calendar.js';
import { calendlyOAuth } from '@services/api-gateway/src/oauth/calendly.js';
import { timezoneService } from './timezone-service.js';

/** Max outbounds/proposals allowed between 10PM-6AM per user per night */
export const NIGHT_DELIVERY_CAP = 7;

// In-memory tracker for night sessions: userId -> { count, resetAt }
const nightDeliveryTracker = new Map<string, { count: number; resetAt: number }>();

export interface AvailableSlot {
  start: Date;
  end: Date;
  provider: 'google_calendar' | 'calendly' | 'default';
}

export class AvailabilityService {
  // Internal cache to prevent proposing the same slot to multiple leads in a short window
  private static proposedSlotsCache: Map<string, { userId: string; start: Date; expiresAt: Date }> = new Map();

  /**
   * Get suggested free times for the user to propose to a lead.
   * Intersects Calendly and Google Calendar availability with 15-minute buffers.
   * Implements strict 10pm-6am No-Book rule based on User's timezone.
   */
  async getSuggestedTimes(userId: string, hoursAhead: number = 72): Promise<AvailableSlot[]> {
    try {
      const user = await storage.getUserById(userId);
      const userTimezone = user?.timezone || 'UTC'; 
      const isWithinBusinessHours = (date: Date) => this.isWithinUserBusinessHours(date, userTimezone);

      let candidateSlots: AvailableSlot[] = [];
      const startTime = new Date().toISOString();
      const endTime = new Date(Date.now() + hoursAhead * 60 * 60 * 1000).toISOString();

      // Clean old cache entries
      const nowMs = Date.now();
      for (const [key, entry] of AvailabilityService.proposedSlotsCache.entries()) {
        if (entry.expiresAt.getTime() < nowMs) AvailabilityService.proposedSlotsCache.delete(key);
      }

      // 1. Fetch from Calendly
      try {
        const slots = await calendlyOAuth.getAvailableSlots(userId, startTime, endTime);
        if (slots && slots.length > 0) {
          candidateSlots = slots.map(s => ({
            start: new Date(s.start_time),
            end: new Date(new Date(s.start_time).getTime() + (30 + 15) * 60 * 1000), 
            provider: 'calendly'
          }));
        }
      } catch (err) {
        console.warn(`[Availability] Calendly fetch failed for ${userId}:`, err);
      }

      // 2. Fetch from Google if needed
      if (candidateSlots.length === 0) {
        const googleIntegration = await storage.getOAuthAccount(userId, 'google');
        if (googleIntegration?.accessToken) {
          candidateSlots = await this.searchGoogleSlots(userId, googleIntegration.accessToken, userTimezone);
        }
      }

      // 3. Cross-Check, Filter, and Lock
      const googleIntegration = await storage.getOAuthAccount(userId, 'google');
      const filteredSlots: AvailableSlot[] = [];

      for (const slot of candidateSlots) {
        // Business Hour Guard
        if (!isWithinBusinessHours(slot.start)) continue;

        // Proposal Lock Guard: Check if this slot was proposed to another lead in the last 60 mins
        const cacheKey = `${userId}-${slot.start.getTime()}`;
        if (AvailabilityService.proposedSlotsCache.has(cacheKey)) continue;

        // Phase 4: Cross-check Calendly against Google if both connected
        if (googleIntegration?.accessToken && slot.provider === 'calendly') {
          const isActuallyFreeOnGoogle = await googleCalendarOAuth.checkAvailability(
            googleIntegration.accessToken,
            slot.start,
            slot.end
          );
          if (!isActuallyFreeOnGoogle) continue;
        }

        // Add to result and Lock it for 60 minutes
        filteredSlots.push(slot);
        AvailabilityService.proposedSlotsCache.set(cacheKey, {
          userId,
          start: slot.start,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000)
        });

        if (filteredSlots.length >= 4) break; 
      }

      if (filteredSlots.length > 0) return filteredSlots;

      // 4. Fallback: Default with buffers
      return this.generateDefaultSlots(hoursAhead, userTimezone);
    } catch (error) {
      console.error('Error in AvailabilityService:', error);
      // Last resort fallback to UTC for stability
      return this.generateDefaultSlots(hoursAhead, 'UTC');
    }
  }

  private async searchGoogleSlots(userId: string, accessToken: string, userTimezone: string): Promise<AvailableSlot[]> {
    const nextSlots: AvailableSlot[] = [];
    let searchTime = new Date();
    searchTime.setMinutes(0, 0, 0);
    searchTime.setHours(searchTime.getHours() + 2);

    for (let i = 0; i < 48 && nextSlots.length < 5; i++) {
        if (!this.isWithinUserBusinessHours(searchTime, userTimezone)) {
          searchTime.setHours(searchTime.getHours() + 1);
          continue;
        }
        const endTime = new Date(searchTime.getTime() + 60 * 60000);
        const isAvailable = await googleCalendarOAuth.checkAvailability(accessToken, searchTime, endTime);
        if (isAvailable) {
          nextSlots.push({ start: new Date(searchTime), end: endTime, provider: 'google_calendar' });
        }
        searchTime.setHours(searchTime.getHours() + 1);
    }
    return nextSlots;
  }

  /**
   * Calculate the next available minute we can deliver a message (06:05 AM in user TZ)
   */
  getNextAvailableBusinessHour(timeZone: string): Date {
    return timezoneService.getNextSafeWindow(new Date(), timeZone);
  }

  /**
   * Helper to determine valid booking times in a specific timezone
   * Blocks: 22:00 - 06:00 (strict No-Book rule)
   * Prevents booking on weekends too.
   */
  /**
   * Helper to determine valid booking times.
   * 24/7 MODE: All hours and days are now considered valid for autonomous outreach and booking.
   */
  public isWithinUserBusinessHours(date: Date, timeZone: string): boolean {
    return true; // No limitations
  }

  /**
   * [Strict Protocol] Check if we can deliver a message during the Night Watch (10PM - 6AM).
   * Returns true if it's currently Day OR if it's Night but we are under the cap (7).
   */
  public async canDeliverDuringNightWatch(integrationId: string, timeZone: string): Promise<{ allowed: boolean; isNight: boolean; count: number }> {
    const now = new Date();
    const isNight = timezoneService.isNightWatch(now, timeZone);
    
    if (!isNight) {
      return { allowed: true, isNight: false, count: 0 };
    }

    // It's night - check the cap per mailbox (integrationId)
    let entry = nightDeliveryTracker.get(integrationId);
    const resetTime = this.getNextMidnightMs();

    if (!entry || Date.now() > entry.resetAt) {
      entry = { count: 0, resetAt: resetTime };
      nightDeliveryTracker.set(integrationId, entry);
    }

    return { 
      allowed: entry.count < NIGHT_DELIVERY_CAP,
      isNight: true,
      count: entry.count
    };
  }

  /**
   * Record a night-time delivery to the tracker.
   */
  public incrementNightDelivery(integrationId: string): void {
    let entry = nightDeliveryTracker.get(integrationId);
    if (!entry || Date.now() > entry.resetAt) {
      entry = { count: 1, resetAt: this.getNextMidnightMs() };
    } else {
      entry.count += 1;
    }
    nightDeliveryTracker.set(integrationId, entry);
  }
  
  /**
   * Helper to check if it's currently night time in a specific timezone.
   */
  public isCurrentlyNight(timeZone: string): boolean {
    return timezoneService.isNightWatch(new Date(), timeZone);
  }

  private getNextMidnightMs(): number {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow.getTime();
  }

  private generateDefaultSlots(hoursAhead: number, userTimezone: string): AvailableSlot[] {
    const slots: AvailableSlot[] = [];
    const now = new Date();
    let search = new Date(now);
    search.setHours(search.getHours() + 24); // Start tomorrow
    search.setMinutes(0, 0, 0);

    while (slots.length < 3) {
      if (this.isWithinUserBusinessHours(search, userTimezone)) {
        slots.push({
          start: new Date(search),
          end: new Date(search.getTime() + 60 * 60000),
          provider: 'default'
        });
      }
      search.setHours(search.getHours() + 1);
    }
    return slots;
  }

  formatSlotsForAI(slots: AvailableSlot[], timeZone: string = 'UTC'): string {
    if (slots.length === 0) return "No specific times found. Please use the booking link.";
    
    return slots.map(s => {
      return s.start.toLocaleString('en-US', {
        timeZone,
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    }).join(", ");
  }
}

export const availabilityService = new AvailabilityService();


