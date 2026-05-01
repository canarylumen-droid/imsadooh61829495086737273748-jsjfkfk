import { db } from '@shared/lib/db/db.js';
import { users } from '@audnix/shared';
import { eq } from 'drizzle-orm';

/**
 * Service to handle Calendly and general calendar integration metadata
 */
export class CalendlyService {
  /**
   * Fetches the preferred booking link for a user
   */
  async getBookingLink(userId: string): Promise<string | null> {
    try {
      const user = await db.select({ 
        calendlyLink: users.config,
        calendarLink: users.calendarLink 
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

      if (!user[0]) return null;

      // Check config first, then legacy field
      const config = (user[0].calendlyLink as any) || {};
      return config.calendlyLink || user[0].calendarLink || null;
    } catch (error) {
      console.error('[CalendlyService] Error fetching booking link:', error);
      return null;
    }
  }

  /**
   * Formats a booking link into a natural call-to-action
   */
  formatCta(link: string | null): string {
    if (!link) return "Please let me know a few times that work best for you, and I'll get us scheduled.";
    return `Feel free to pick a time that works best for you here: ${link}`;
  }
}

export const calendlyService = new CalendlyService();

/**
 * Generates a pre-filled Calendly link with lead data
 */
export function getCalendlyPrefillLink(baseUrl: string, lead: any): string {
  if (!baseUrl) return '';
  try {
    const url = new URL(baseUrl);
    if (lead.name) url.searchParams.set('name', lead.name);
    if (lead.email) url.searchParams.set('email', lead.email);
    return url.toString();
  } catch (e) {
    return baseUrl;
  }
}



