import { storage } from '@shared/lib/storage/storage.js';
import { calendlyOAuth } from '@services/api-gateway/src/oauth/calendly.js';

export interface CalendlyMeetingParams {
  email: string;
  name: string;
  startTime: Date;
  endTime: Date;
  location?: string;
  eventTypeName?: string;
}

export class CalendlyService {
  /**
   * Get valid access token for a user, refreshing if necessary
   */
  async getValidToken(userId: string): Promise<string | null> {
    const user = await storage.getUserById(userId);
    if (!user || !user.calendlyAccessToken) return null;

    const expiresAt = user.calendlyExpiresAt ? new Date(user.calendlyExpiresAt) : null;
    const now = new Date();

    // If no expiration or expired, try refresh
    if (!expiresAt || expiresAt <= now) {
      if (!user.calendlyRefreshToken) return null;

      try {
        console.log(`[Calendly] Refreshing token for user ${userId}...`);
        const { accessToken, expiresAt: newExpiresAt } = await calendlyOAuth.refreshAccessToken(user.calendlyRefreshToken);
        
        await storage.updateUser(userId, {
          calendlyAccessToken: accessToken,
          calendlyExpiresAt: newExpiresAt
        });
        
        return accessToken;
      } catch (err) {
        console.error(`[Calendly] Failed to refresh token for ${userId}:`, err);
        console.warn(`[Calendly] Token refresh failed for ${userId} — integration needs reconnection`);
        return null;
      }
    }

    return user.calendlyAccessToken;
  }

  /**
   * Schedule a meeting on Calendly
   * NOTE: This is a simplified "manual" booking via API. 
   * In a production environment, you might need to find the specific event type first.
   */
  async scheduleMeeting(userId: string, params: CalendlyMeetingParams): Promise<any> {
    const token = await this.getValidToken(userId);
    if (!token) throw new Error('Calendly not connected or token expired');

    // 1. Get Event Type (use first active one if none specified)
    const eventType = await this.getPreferredEventType(token, params.eventTypeName);
    if (!eventType) throw new Error('No active Calendly event types found');

    console.log(`[Calendly] Scheduling "${eventType.name}" for ${params.email} at ${params.startTime.toISOString()}`);

    // 2. Actually create the Calendly event via API
    try {
      const result = await calendlyOAuth.createEvent({ token, email: params.email, name: params.name, time: params.startTime, eventTypeUri: eventType.uri });

      if (result.success) {
        console.log(`[Calendly] ✅ Meeting booked for ${params.email} at ${params.startTime.toISOString()}`);
        return {
          success: true,
          meetingUrl: eventType.scheduling_url,
          startTime: params.startTime,
          endTime: params.endTime,
          id: result.eventId || `cal_${Date.now().toString(36)}`
        };
      }

      throw new Error(result.error || 'Failed to create Calendly event');
    } catch (err: any) {
      console.error(`[Calendly] Failed to actually book meeting for ${params.email}:`, err.message);
      throw err;
    }
  }

  /**
   * Register a webhook for the user's Calendly account
   */
  async createWebhook(userId: string): Promise<any> {
    const token = await this.getValidToken(userId);
    if (!token) return null;

    try {
      const userResponse = await fetch('https://api.calendly.com/users/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const userData: any = await userResponse.json();
      const organizationUri = userData.resource?.current_organization;

      const response = await fetch('https://api.calendly.com/webhook_subscriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url: process.env.CALENDLY_WEBHOOK_URL || 'https://audnix-ai.railway.app/api/calendly/webhook',
          events: ['invitee.created', 'invitee.canceled'],
          organization: organizationUri,
          scope: 'organization'
        })
      });

      return await response.json();
    } catch (err) {
      console.error('[Calendly] Failed to create webhook:', err);
      return null;
    }
  }

  /**
   * Fetch active event types for the user
   */
  async listEventTypes(userId: string): Promise<any[]> {
    const token = await this.getValidToken(userId);
    if (!token) return [];

    try {
      const userResponse = await fetch('https://api.calendly.com/users/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const userData: any = await userResponse.json();
      const userUri = userData.resource?.uri;

      const response = await fetch(`https://api.calendly.com/event_types?user=${userUri}&active=true`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) {
        console.error(`[Calendly] listEventTypes failed with status ${response.status} for user ${userId}`);
        return [];
      }

      const data: any = await response.json();
      return data.collection || [];
    } catch (err) {
      console.error('[Calendly] Failed to fetch event types:', err);
      return [];
    }
  }

  /**
   * Fetch scheduled events (for free plan polling/manual sync)
   * This works on free plan - no webhooks required
   */
  async listScheduledEvents(userId: string, minStartTime?: Date, maxStartTime?: Date): Promise<any[]> {
    const token = await this.getValidToken(userId);
    if (!token) return [];

    try {
      const userResponse = await fetch('https://api.calendly.com/users/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const userData: any = await userResponse.json();
      const userUri = userData.resource?.uri;

      let url = `https://api.calendly.com/scheduled_events?user=${userUri}&status=active`;
      if (minStartTime) url += `&min_start_time=${minStartTime.toISOString()}`;
      if (maxStartTime) url += `&max_start_time=${maxStartTime.toISOString()}`;

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) {
        console.error(`[Calendly] listScheduledEvents failed with status ${response.status} for user ${userId}`);
        return [];
      }

      const data: any = await response.json();
      return data.collection || [];
    } catch (err) {
      console.error('[Calendly] Failed to fetch scheduled events:', err);
      return [];
    }
  }

  private async getPreferredEventType(token: string, searchName?: string): Promise<any> {
    try {
      const userResponse = await fetch('https://api.calendly.com/users/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const userData: any = await userResponse.json();
      const userUri = userData.resource?.uri;

      const response = await fetch(`https://api.calendly.com/event_types?user=${userUri}&active=true`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) return null;

      const data: any = await response.json();
      const types = data.collection || [];

      if (searchName) {
        return types.find((t: any) => t.name.toLowerCase().includes(searchName.toLowerCase())) || types[0];
      }

      return types[0];
    } catch (err) {
      console.error('[Calendly] Failed to fetch event types:', err);
      return null;
    }
  }
}

export const calendlyService = new CalendlyService();


