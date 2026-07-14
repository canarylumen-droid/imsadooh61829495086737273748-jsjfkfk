import { db } from '@shared/lib/db/db.js';
import { users } from '@audnix/shared';
import { eq } from 'drizzle-orm';
import { isValidURL } from '../utils/validation.js';

/**
 * Service to handle Calendly and general calendar integration metadata
 */
export class CalendlyService {
  /**
   * Fetches the preferred booking link for a user
   */
  async getBookingLink(userId: string, eventTypeName?: string): Promise<string | null> {
    try {
      const user = await db.select({ 
        calendlyLink: users.config,
        calendarLink: users.calendarLink,
        calendlyAccessToken: users.calendlyAccessToken,
        calendlyRefreshToken: users.calendlyRefreshToken,
        calendlyExpiresAt: users.calendlyExpiresAt
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

      if (!user[0]) return null;

      // 1. If we already have a direct calendarLink, return it (it's the fastest)
      if (user[0].calendarLink && isValidURL(user[0].calendarLink)) {
        return user[0].calendarLink;
      }

      // 2. Check config
      const config = (user[0].calendlyLink as any) || {};
      if (config.calendlyLink && isValidURL(config.calendlyLink) && !eventTypeName) {
        return config.calendlyLink;
      }

      // 3. Specific Event Type discovery via OAuth
      if (user[0].calendlyAccessToken || user[0].calendlyRefreshToken) {
        try {
          const { calendlyService: oauthService } = await import('@shared/lib/calendar/calendly-service.js');
          
          if (eventTypeName) {
             const eventTypes = await oauthService.listEventTypes(userId);
             const match = eventTypes.find(et => 
               et.name.toLowerCase().includes(eventTypeName.toLowerCase()) || 
               et.slug.toLowerCase() === eventTypeName.toLowerCase()
             );
             if (match?.scheduling_url) return match.scheduling_url;
          }

          // FALLBACK: If Calendly is connected via OAuth but no link is saved, try to fetch the default
          const token = await oauthService.getValidToken(userId);
          
          if (token) {
            const { calendlyOAuth } = await import('@services/api-gateway/src/oauth/calendly.js');
            const userInfo = await calendlyOAuth.getUserInfo(token);
            
            if (userInfo?.schedulingUrl) {
              console.log(`[CalendlyService] Auto-syncing missing booking link for ${userId}: ${userInfo.schedulingUrl}`);
              await db.update(users)
                .set({ calendarLink: userInfo.schedulingUrl })
                .where(eq(users.id, userId));
              return userInfo.schedulingUrl;
            }
          }
        } catch (oauthErr) {
          console.warn('[CalendlyService] Failed to auto-sync OAuth link:', oauthErr);
        }
      }

      return null;
    } catch (error) {
      console.error('[CalendlyService] Error fetching booking link:', error);
      return null;
    }
  }

  /**
   * Formats a booking link into a natural call-to-action
   */
  formatCta(link: string | null): string {
    if (!link || !isValidURL(link)) return "Please let me know a few times that work best for you, and I'll get us scheduled.";
    return `Feel free to pick a time that works best for you here: ${link}`;
  }

  /**
   * Basic validation to ensure the link is a valid URL and looks like a booking link
   */
  private isLinkValid(link: string): boolean {
    return isValidURL(link);
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



