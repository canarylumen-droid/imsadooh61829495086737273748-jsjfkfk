import { formatInTimeZone, toDate } from 'date-fns-tz';

/**
 * Global Timezone Bridge (Phase 6)
 * Centralizes all timezone conversion logic for the outreach platform.
 * Priority: Africa/Lagos (WAT) as the focal point for user availability.
 */
export class TimezoneService {
  private static DEFAULT_USER_TZ = 'UTC';

  /**
   * Format a date for display/AI prompts in the user's local timezone
   */
  static formatForUser(date: Date, timeZone: string = this.DEFAULT_USER_TZ, formatStr: string = 'yyyy-MM-dd HH:mm:ss XXX'): string {
    return formatInTimeZone(date, timeZone, formatStr);
  }

  /**
   * Get the current time in the user's timezone
   */
  static nowInUserTz(timeZone: string = this.DEFAULT_USER_TZ): Date {
    return toDate(new Date(), { timeZone });
  }

  /**
   * Determine if a date is within the "Night Watch" window (10 PM - 6 AM)
   * relative to the provided timezone.
   */
  static isNightWatch(date: Date, timeZone: string = this.DEFAULT_USER_TZ): boolean {
    const hour = parseInt(formatInTimeZone(date, timeZone, 'H'), 10);
    return hour >= 22 || hour < 6;
  }

  /**
   * Calculate the next safe delivery window (06:05 AM) in the user's timezone
   */
  static getNextSafeWindow(from: Date = new Date(), timeZone: string = this.DEFAULT_USER_TZ): Date {
    const zonedDate = toDate(from, { timeZone });
    const nextSafe = new Date(zonedDate);
    
    // If we are currently in night watch, or just want the next day's start
    const currentHour = parseInt(formatInTimeZone(zonedDate, timeZone, 'H'), 10);
    
    if (currentHour >= 22) {
      nextSafe.setDate(nextSafe.getDate() + 1);
    }
    
    // Set to 06:05 AM in the target timezone
    // Note: We need to return a Date object that represents 06:05 AM in that TZ
    // but expressed as a standard JavaScript Date (UTC).
    const nextSafeStr = formatInTimeZone(nextSafe, timeZone, 'yyyy-MM-dd') + ' 06:05:00';
    return toDate(nextSafeStr, { timeZone });
  }

  /**
   * Get a Date object for a specific local hour on a target date/day-offset
   */
  static getScheduledWindow(daysFromNow: number, timeZone: string = this.DEFAULT_USER_TZ, targetHour: number = 10): Date {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysFromNow);
    
    // Format to yyyy-MM-dd in target TZ, then append the target hour
    const dateStr = formatInTimeZone(futureDate, timeZone, 'yyyy-MM-dd');
    const targetStr = `${dateStr} ${targetHour.toString().padStart(2, '0')}:00:00`;
    
    return toDate(targetStr, { timeZone });
  }
}

export const timezoneService = TimezoneService;
