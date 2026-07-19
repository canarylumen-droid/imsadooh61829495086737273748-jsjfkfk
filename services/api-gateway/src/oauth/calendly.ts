import { getOAuthRedirectUrl } from '@shared/config/config/oauth-redirects.js';
import { storage } from '@shared/lib/storage/storage.js';
import { encrypt, decrypt } from '@shared/lib/crypto/encryption.js';
import { db } from '@shared/lib/db/db.js';
import { integrations } from '@audnix/shared';
import { eq } from 'drizzle-orm';

export class CalendlyOAuth {
  private config: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };

  constructor() {
    this.config = {
      clientId: process.env.CALENDLY_CLIENT_ID || '',
      clientSecret: process.env.CALENDLY_CLIENT_SECRET || '',
      redirectUri: getOAuthRedirectUrl('calendly')
    };

    if (!this.config.clientId || !this.config.clientSecret) {
      console.warn('⚠️ Calendly OAuth: Credentials not configured. Users can still use manual API key.');
    }
  }

  /**
   * Generate OAuth authorization URL
   */
  getAuthUrl(state?: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: 'code',
      redirect_uri: this.config.redirectUri,
      ...(state && { state })
    });

    return `https://auth.calendly.com/oauth/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt: Date;
    user?: { name: string; email: string; timezone?: string; uri?: string; currentOrganization?: string; schedulingUrl?: string };
  }> {
    try {
      const response = await fetch('https://auth.calendly.com/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          code,
          redirect_uri: this.config.redirectUri,
          grant_type: 'authorization_code',
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token exchange failed: ${error}`);
      }

      const data: any = await response.json();

      // Get user info from Calendly
      let userInfo = null;
      if (data.access_token) {
        userInfo = await this.getUserInfo(data.access_token);
      }

      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || undefined,
        expiresAt: new Date(Date.now() + (data.expires_in || 3600) * 1000),
        user: userInfo ? { 
          name: userInfo.name || 'Calendly User', 
          email: userInfo.email,
          timezone: userInfo.timezone,
          uri: userInfo.uri,
          currentOrganization: userInfo.currentOrganization,
          schedulingUrl: userInfo.schedulingUrl
        } : undefined
      };
    } catch (error: any) {
      console.error('Calendly token exchange error:', error);
      throw error;
    }
  }

  /**
   * Refresh access token
   */
  async refreshAccessToken(refreshToken: string): Promise<{
    accessToken: string;
    expiresAt: Date;
  }> {
    try {
      const response = await fetch('https://auth.calendly.com/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token refresh failed: ${error}`);
      }

      const data: any = await response.json();

      return {
        accessToken: data.access_token,
        expiresAt: new Date(Date.now() + (data.expires_in || 3600) * 1000),
      };
    } catch (error: any) {
      console.error('Calendly token refresh error:', error);
      throw error;
    }
  }

  /**
   * Get user info from Calendly
   */
  public async getUserInfo(accessToken: string): Promise<{ name: string; email: string; timezone?: string; uri?: string; currentOrganization?: string; schedulingUrl?: string } | null> {
    try {
      const response = await fetch('https://api.calendly.com/users/me', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
      });

      if (!response.ok) {
        return null;
      }

      const data: any = await response.json();
      return {
        name: data.resource?.name || 'Calendly User',
        email: data.resource?.email || '',
        timezone: data.resource?.timezone,
        uri: data.resource?.uri,
        currentOrganization: data.resource?.current_organization,
        schedulingUrl: data.resource?.scheduling_url
      };
    } catch (error) {
      console.error('Failed to get Calendly user info:', error);
      return null;
    }
  }

  /**
   * Revoke Calendly access token
   */
  async revokeToken(userId: string): Promise<void> {
    const { storage } = await import('@shared/lib/storage/storage.js');
    const { decrypt } = await import('@shared/lib/crypto/encryption.js');

    const integration = await storage.getIntegration(userId, 'calendly');
    if (!integration || !integration.encryptedMeta) return;

    try {
      const meta = JSON.parse(await decrypt(integration.encryptedMeta));
      const token = meta.access_token || meta.token;

      if (token) {
        console.log(`[Calendly OAuth] Revoking token for user: ${userId}`);
        const params = new URLSearchParams({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          token: token,
        });
        const response = await fetch('https://auth.calendly.com/oauth/revoke', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        });

        if (!response.ok) {
          const error = await response.text();
          console.warn(`[Calendly OAuth] Remote revocation failed: ${error}`);
        } else {
          console.log(`[Calendly OAuth] Successfully revoked token for user: ${userId}`);
        }
      }
    } catch (error) {
      console.error('[Calendly OAuth] Error during token revocation:', error);
    }

    // Storage cleanup will be handled by the disconnect route calling deleteIntegration
  }

  /**
   * Helper to get decrypted access token for a user
   */
  private async getAccessToken(userId: string): Promise<string | null> {
    const { storage } = await import('@shared/lib/storage/storage.js');
    const { decrypt } = await import('@shared/lib/crypto/encryption.js');

    const integration = await storage.getIntegration(userId, 'calendly');
    if (!integration || !integration.encryptedMeta) return null;

    try {
      const meta = JSON.parse(await decrypt(integration.encryptedMeta));
      
      // Check expiry
      if (meta.expiresAt && new Date(meta.expiresAt) < new Date()) {
        console.log(`[Calendly] Token expired for ${userId}, refreshing...`);
        const refreshed = await this.refreshAccessToken(meta.refresh_token);
        
        // Update storage
        const updatedMeta = encrypt(JSON.stringify({
          ...meta,
          access_token: refreshed.accessToken,
          expiresAt: refreshed.expiresAt.toISOString()
        }));
        
        await storage.updateIntegration(userId, 'calendly', {
          encryptedMeta: updatedMeta,
          lastSync: new Date()
        });
        
        return refreshed.accessToken;
      }
      
      return meta.access_token || meta.token;
    } catch (error) {
      console.error('[Calendly] Failed to decrypt/refresh token:', error);
      return null;
    }
  }

  /**
   * Create a scheduled event on Calendly
   */
  async createEvent(params: { token: string; email: string; name: string; time: Date; eventTypeUri?: string }): Promise<{ success: boolean; error?: string; eventId?: string; meetingUrl?: string }> {
    try {
      let eventTypeUri = params.eventTypeUri;
      if (!eventTypeUri) {
        const userInfo = await this.getUserInfo(params.token);
        if (!userInfo?.uri) throw new Error('Calendly user profile unavailable');

        const etResponse = await fetch(`https://api.calendly.com/event_types?user=${encodeURIComponent(userInfo.uri)}&active=true`, {
          headers: { Authorization: `Bearer ${params.token}` }
        });
        if (etResponse.ok) {
          const etData: any = await etResponse.json();
          eventTypeUri = etData.collection?.[0]?.uri;
        }
        if (!eventTypeUri) throw new Error('No active event type found for user');
      }

      const response = await fetch('https://api.calendly.com/scheduled_events', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          event_type_uri: eventTypeUri,
          invitee: {
            email: params.email,
            name: params.name,
            timezone: 'America/New_York'
          },
          start_time: params.time.toISOString()
        })
      });

      if (!response.ok) {
        const err = await response.text();
        console.error(`[CalendlyOAuth] createEvent failed: ${err}`);
        return { success: false, error: `Calendly API error: ${response.status}` };
      }

      const eventData: any = await response.json();
      return {
        success: true,
        eventId: eventData.resource?.uri,
        meetingUrl: eventData.resource?.location?.location || eventData.resource?.uri
      };
    } catch (err: any) {
      console.error('[CalendlyOAuth] createEvent error:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Get available slots for a user's event type
   */
  async getAvailableSlots(userId: string, startTime: string, endTime: string): Promise<any[]> {
    const token = await this.getAccessToken(userId);
    if (!token) throw new Error('Calendly not connected or token invalid');

    // First get the user's event types if we don't have a specific URI
    const { db } = await import('@shared/lib/db/db.js');
    const { calendarSettings } = await import('@audnix/shared');
    const { eq } = await import('drizzle-orm');

    const [settings] = await db.select().from(calendarSettings).where(eq(calendarSettings.userId, userId)).limit(1);
    let eventTypeUri = settings?.calendlyEventTypeUri;

    if (!eventTypeUri) {
      const userInfo = await this.getUserInfo(token);
      if (!userInfo?.uri) throw new Error('Calendly user profile unavailable');

      const etResponse = await fetch(`https://api.calendly.com/event_types?user=${encodeURIComponent(userInfo.uri)}&active=true`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (etResponse.ok) {
        const etData: any = await etResponse.json();
        eventTypeUri = etData.collection?.[0]?.uri;
      }
    }

    if (!eventTypeUri) throw new Error('No Calendly event type found for user');

    const url = new URL('https://api.calendly.com/event_type_available_times');
    url.searchParams.set('event_type_uri', eventTypeUri);
    url.searchParams.set('start_time', startTime);
    url.searchParams.set('end_time', endTime);

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch availability: ${error}`);
    }

    const data: any = await response.json();
    return data.collection || [];
  }
}

export const calendlyOAuth = new CalendlyOAuth();

/**
 * Register/update Calendly webhook after OAuth connection
 */
export async function registerCalendlyWebhook(userId: string, accessToken: string): Promise<void> {
  try {
    const userInfo = await calendlyOAuth.getUserInfo(accessToken);
    if (!userInfo || !userInfo.currentOrganization) {
      throw new Error('Could not determine Calendly organization for webhook registration');
    }

    const webhookUrl = process.env.CALENDLY_WEBHOOK_URL || `${process.env.DOMAIN || 'https://audnix-ai.com'}/api/webhook/calendly`;
    
    // 1. List existing webhooks to avoid duplicates
    const listResponse = await fetch(`https://api.calendly.com/webhook_subscriptions?organization=${encodeURIComponent(userInfo.currentOrganization)}&scope=organization`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    
    if (listResponse.ok) {
      const listData: any = await listResponse.json();
      const existing = listData.collection?.find((s: any) => s.callback_url === webhookUrl);
      if (existing) {
        console.log(`✓ Calendly webhook already exists for ${userInfo.email}`);
        return;
      }
    }

    // 2. Create new subscription
    const response = await fetch('https://api.calendly.com/webhook_subscriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: webhookUrl,
        events: ['invitee.created', 'invitee.canceled'],
        organization: userInfo.currentOrganization,
        scope: 'organization'
      }),
    });

    if (response.ok) {
      const subscription: any = await response.json();
      const signingKey = subscription.resource?.signing_key;
      console.log(`✓ Calendly webhook registered - ID: ${subscription.resource?.id || 'unknown'}`);
      
      if (signingKey) {
        // Save signing key to user metadata for later verification
        const user = await storage.getUserById(userId);
        if (user) {
          await storage.updateUser(userId, {
            metadata: {
              ...(user.metadata || {}),
              calendlySigningKey: signingKey
            }
          });
          console.log(`🔐 Calendly signing key saved for user ${userId}`);
        }
      }
    } else {
      const error = await response.text();
      // Check if it's a permission error (requires Standard plan)
      if (error.includes('Permission Denied') || error.includes('upgrade your Calendly account')) {
        console.warn(`⚠️ Calendly webhook registration requires Standard plan or higher. Webhook features will be limited. Error: ${error}`);
      } else {
        console.warn(`⚠️ Failed to register Calendly webhook: ${error}`);
      }
    }
  } catch (error: any) {
    console.warn('⚠️ Calendly webhook registration warning:', error.message);
  }
}







