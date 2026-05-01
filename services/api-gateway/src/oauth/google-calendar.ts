import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { getOAuthRedirectUrl } from '@shared/config/config/oauth-redirects.js';

export class GoogleCalendarOAuth {
  private oauth2Client: OAuth2Client;
  private config: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };

  constructor() {
    // Can use same Google OAuth credentials for both auth and calendar
    // Or create separate ones for better security/tracking
    this.config = {
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      redirectUri: getOAuthRedirectUrl('google-calendar')
    };

    if (!this.config.clientId || !this.config.clientSecret) {
      if (process.env.DEBUG_OAUTH) {
        console.warn('⚠️  Google Calendar: OAuth credentials not configured. Users cannot connect calendars.');
      }
    }

    this.oauth2Client = new google.auth.OAuth2(
      this.config.clientId,
      this.config.clientSecret,
      this.config.redirectUri
    );
  }

  /**
   * Generate OAuth URL for user to authorize
   */
  getAuthUrl(state?: string): string {
    const scopes = [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      state: state,
      prompt: 'consent',
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForTokens(code: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt: Date;
    email?: string;
  }> {
    const { tokens } = await this.oauth2Client.getToken(code);

    this.oauth2Client.setCredentials(tokens);

    // Get user info to verify email
    const oauth2 = google.oauth2({ version: 'v2', auth: this.oauth2Client });
    const userInfo = await oauth2.userinfo.get();

    return {
      accessToken: tokens.access_token!,
      refreshToken: tokens.refresh_token || undefined,
      expiresAt: new Date(tokens.expiry_date || Date.now() + 3600 * 1000),
      email: userInfo.data.email || undefined,
    };
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    expiresAt: Date;
  }> {
    this.oauth2Client.setCredentials({
      refresh_token: refreshToken,
    });

    const { credentials } = await this.oauth2Client.refreshAccessToken();

    return {
      accessToken: credentials.access_token!,
      expiresAt: new Date(credentials.expiry_date || Date.now() + 3600 * 1000),
    };
  }

  /**
   * Check if a time slot is available
   */
  async checkAvailability(
    accessToken: string,
    startTime: Date,
    endTime: Date
  ): Promise<boolean> {
    this.oauth2Client.setCredentials({ access_token: accessToken });
    const calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });

    try {
      const response = await calendar.freebusy.query({
        requestBody: {
          timeMin: startTime.toISOString(),
          timeMax: endTime.toISOString(),
          items: [{ id: 'primary' }],
        },
      });

      const busySlots = response.data.calendars?.primary?.busy || [];
      return busySlots.length === 0;
    } catch (error) {
      console.error('Error checking calendar availability:', error);
      throw error;
    }
  }

  /**
   * Find next available slot with intelligent rescheduling
   * Returns a professional alternative time suggestion
   */
  async findNextAvailableSlot(
    accessToken: string,
    requestedStart: Date,
    duration: number = 30,
    leadTimezone: string = 'America/New_York'
  ): Promise<{
    suggestedStart: Date;
    suggestedEnd: Date;
    message: string;
    isOriginalTimeAvailable: boolean;
  }> {
    const requestedEnd = new Date(requestedStart.getTime() + duration * 60000);

    // Check if original time is available
    const isAvailable = await this.checkAvailability(accessToken, requestedStart, requestedEnd);

    if (isAvailable) {
      return {
        suggestedStart: requestedStart,
        suggestedEnd: requestedEnd,
        message: "Perfect! That time works great for me.",
        isOriginalTimeAvailable: true
      };
    }

    // Find next available slot (30 min or 1 hour buffer depending on time of day)
    let bufferMinutes = 30;
    const hour = requestedStart.getHours();

    // Use 1 hour buffer during peak hours (9 AM - 5 PM)
    if (hour >= 9 && hour < 17) {
      bufferMinutes = 60;
    }

    // Try up to 5 alternative slots
    for (let attempt = 1; attempt <= 5; attempt++) {
      const alternativeStart = new Date(requestedStart.getTime() + (bufferMinutes * attempt * 60000));
      const alternativeEnd = new Date(alternativeStart.getTime() + duration * 60000);

      const altAvailable = await this.checkAvailability(accessToken, alternativeStart, alternativeEnd);

      if (altAvailable) {
        // Format time professionally based on timezone
        const timeFormatter = new Intl.DateTimeFormat('en-US', {
          timeZone: leadTimezone,
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          weekday: 'long',
          month: 'short',
          day: 'numeric'
        });

        const formattedTime = timeFormatter.format(alternativeStart);

        return {
          suggestedStart: alternativeStart,
          suggestedEnd: alternativeEnd,
          message: `I have another commitment at that time, but how about ${formattedTime}? That would work perfectly for me and give us quality time to connect.`,
          isOriginalTimeAvailable: false
        };
      }
    }

    // Fallback if no slots found in next few hours
    const fallbackStart = new Date(requestedStart.getTime() + (24 * 60 * 60000)); // Next day same time
    const fallbackEnd = new Date(fallbackStart.getTime() + duration * 60000);

    const fallbackTimeFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: leadTimezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      weekday: 'long',
      month: 'short',
      day: 'numeric'
    });

    return {
      suggestedStart: fallbackStart,
      suggestedEnd: fallbackEnd,
      message: `My schedule is quite full today. How about ${fallbackTimeFormatter.format(fallbackStart)}? I'll make sure to give you my full attention then.`,
      isOriginalTimeAvailable: false
    };
  }

  /**
   * List upcoming calendar events
   */
  async listUpcomingEvents(accessToken: string, maxResults: number = 10): Promise<any[]> {
    this.oauth2Client.setCredentials({ access_token: accessToken });
    const calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date().toISOString(),
      maxResults: maxResults,
      singleEvents: true,
      orderBy: 'startTime',
    });

    return response.data.items || [];
  }

  /**
   * Create a calendar event
   */
  async createEvent(
    accessToken: string,
    event: {
      summary: string;
      description?: string;
      startTime: Date;
      endTime: Date;
      attendeeEmail?: string;
      location?: string;
    }
  ): Promise<any> {
    this.oauth2Client.setCredentials({ access_token: accessToken });
    const calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });

    const eventData: any = {
      summary: event.summary,
      description: event.description,
      start: {
        dateTime: event.startTime.toISOString(),
        timeZone: 'America/New_York',
      },
      end: {
        dateTime: event.endTime.toISOString(),
        timeZone: 'America/New_York',
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 },
          { method: 'popup', minutes: 10 },
        ],
      },
    };

    if (event.attendeeEmail) {
      eventData.attendees = [{ email: event.attendeeEmail }];
    }

    if (event.location) {
      eventData.location = event.location;
    }

    // Add Google Meet conference
    eventData.conferenceData = {
      createRequest: {
        requestId: Math.random().toString(36).substring(7),
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    };

    const response = await calendar.events.insert({
      calendarId: 'primary',
      conferenceDataVersion: 1,
      requestBody: eventData,
    });

    return response.data;
  }

  static generateBookingMessage(
    leadName: string,
    bookingUrl: string,
    platform: 'instagram' | 'email'
  ): string {
    const messages = {
      instagram: `Hey ${leadName}! 📅 Let's schedule a time to chat. Pick a time that works for you: ${bookingUrl}`,
      email: `Hi ${leadName},\n\nThanks for your interest! I'd love to discuss how we can help.\n\nPlease use this link to schedule a time that works best for you:\n${bookingUrl}\n\nLooking forward to connecting!\n\nBest regards`,
    };

    return messages[platform as keyof typeof messages] || messages.email;
  }

  /**
   * Revoke Google Calendar access token
   */
  async revokeToken(userId: string): Promise<void> {
    const { storage } = await import('@shared/lib/storage/storage.js');
    const { decrypt } = await import('@shared/lib/crypto/encryption.js');

    const tokenData = await storage.getOAuthAccount(userId, 'google-calendar');
    if (!tokenData || !tokenData.accessToken) return;

    try {
      const decryptedToken = await decrypt(tokenData.accessToken);
      
      // Google ID token/access token revocation endpoint
      await this.oauth2Client.revokeToken(decryptedToken);
      console.log(`[Google Calendar OAuth] Successfully revoked token for user: ${userId}`);
    } catch (error) {
      console.error('[Google Calendar OAuth] Error during token revocation:', error);
      // Fallback: try refresh token if available
      try {
        if (tokenData.refreshToken) {
          const decryptedRefToken = await decrypt(tokenData.refreshToken);
          await this.oauth2Client.revokeToken(decryptedRefToken);
        }
      } catch (e) {}
    }

    // Storage cleanup
    await storage.deleteOAuthAccount(userId, 'google-calendar');
    
    // Clear user metadata
    const user = await storage.getUser(userId);
    if (user?.metadata) {
      const metadata = { ...(user.metadata as any) };
      delete metadata.google_calendar_connected;
      delete metadata.google_calendar_email;
      await storage.updateUser(userId, { metadata });
    }
  }
}

// Export singleton instance
export const googleCalendarOAuth = new GoogleCalendarOAuth();




