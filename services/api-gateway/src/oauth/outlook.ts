import crypto from 'crypto';
// import { supabaseAdmin } from '../supabase-admin.js'; // Removed
import { encrypt, decrypt } from '@shared/lib/crypto/encryption.js';
import { getOAuthRedirectUrl } from '@shared/config/config/oauth-redirects.js';
import { storage } from '@shared/lib/storage/storage.js';

interface OutlookOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tenantId: string;
}

interface OutlookTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

interface OutlookProfile {
  id: string;
  displayName: string;
  mail: string;
  userPrincipalName: string;
  jobTitle?: string;
  officeLocation?: string;
  mobilePhone?: string;
  businessPhones?: string[];
}

export class OutlookOAuth {
  private config: OutlookOAuthConfig;
  private static refreshLocks = new Map<string, Promise<string | null>>();

  constructor() {
    this.config = {
      clientId: process.env.OUTLOOK_CLIENT_ID || '',
      clientSecret: process.env.OUTLOOK_CLIENT_SECRET || '',
      redirectUri: getOAuthRedirectUrl('outlook'),
      tenantId: process.env.OUTLOOK_TENANT_ID || 'common' // 'common' allows any Microsoft account
    };
  }

  /**
   * Generate OAuth authorization URL
   */
  getAuthorizationUrl(state: string): string {
    const scopes = [
      'offline_access', // Required for refresh token
      'User.Read',
      'Mail.ReadWrite',
      'Mail.Send',
      'Calendar.ReadWrite',
      'Contacts.ReadWrite'
    ];

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      base_uri: 'https://login.microsoftonline.com', // Optional hint
      response_type: 'code',
      redirect_uri: this.config.redirectUri,
      response_mode: 'query',
      scope: scopes.join(' '),
      state: state,
      prompt: 'consent' // Force consent to ensure refresh token
    });

    return `https://login.microsoftonline.com/${this.config.tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForToken(code: string): Promise<OutlookTokenResponse> {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code: code,
      redirect_uri: this.config.redirectUri,
      grant_type: 'authorization_code'
    });

    const response = await fetch(
      `https://login.microsoftonline.com/${this.config.tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      }
    );

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error_description || data.error || 'Failed to exchange code for token');
    }

    return data as OutlookTokenResponse;
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<OutlookTokenResponse> {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: 'offline_access User.Read Mail.ReadWrite Mail.Send Calendar.ReadWrite Contacts.ReadWrite'
    });

    const response = await fetch(
      `https://login.microsoftonline.com/${this.config.tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      }
    );

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error_description || data.error || 'Failed to refresh token');
    }

    return data as OutlookTokenResponse;
  }

  /**
   * Get user profile from Microsoft Graph
   */
  async getUserProfile(accessToken: string): Promise<OutlookProfile> {
    const response = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to get user profile');
    }

    return data as OutlookProfile;
  }

  /**
   * Get user's calendar events
   */
  async getCalendarEvents(accessToken: string, startDateTime?: string, endDateTime?: string): Promise<any[]> {
    let url = 'https://graph.microsoft.com/v1.0/me/calendarview';

    if (startDateTime && endDateTime) {
      const params = new URLSearchParams({
        startDateTime,
        endDateTime
      });
      url += `?${params.toString()}`;
    }

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to get calendar events');
    }

    return data.value || [];
  }

  /**
   * Send email using Microsoft Graph
   */
  async sendEmail(
    accessToken: string,
    to: string[],
    subject: string,
    body: string,
    isHtml: boolean = false
  ): Promise<void> {
    const message = {
      subject: subject,
      body: {
        contentType: isHtml ? 'HTML' : 'Text',
        content: body
      },
      toRecipients: to.map(email => ({
        emailAddress: { address: email }
      }))
    };

    const response = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message, saveToSentItems: true })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to send email');
    }
  }

  /**
   * Save OAuth tokens to database
   */
  async saveToken(userId: string, tokens: OutlookTokenResponse, profile: OutlookProfile): Promise<void> {
    const encryptedAccessToken = await encrypt(tokens.access_token);
    const encryptedRefreshToken = tokens.refresh_token ? await encrypt(tokens.refresh_token) : null;

    const expiresAt = new Date(Date.now() + (tokens.expires_in * 1000));

    const email = profile.mail || profile.userPrincipalName || profile.id;

    // Save to oauth_accounts table via storage
    await storage.saveOAuthAccount({
      userId: userId,
      provider: 'outlook',
      providerAccountId: email,
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      expiresAt: expiresAt,
      scope: tokens.scope,
      tokenType: tokens.token_type,
      idToken: tokens.id_token // if available
    });

    // Update user record
    await storage.updateUser(userId, {
      // outlook_email: profile.mail || profile.userPrincipalName, // User schema might not have this, check schema?
      // Check User schema in shared/schema.ts
      // User schema has optional fields, maybe metadata?
      // Previous code: outlook_email, outlook_connected.
      // Schema Step 6254: I don't see 'outlook_email' column in 'users' table.
      // It might be in 'metadata'.
      // Or I should add it to metadata.
      metadata: {
        outlook_email: profile.mail || profile.userPrincipalName,
        outlook_connected: true
      }
    });
  }

  /**
   * Get valid access token (refresh if needed)
   */
  async getValidToken(userId: string, forceRefreshIfExpiringSoon?: boolean): Promise<string | null> {
    const tokenData = await storage.getOAuthAccount(userId, 'outlook');

    if (!tokenData) {
      return null;
    }

    // Check if token is expired
    // tokenData.expiresAt could be Date or string depending on Drizzle return type logic (usually Date)
    const expiresAt = tokenData.expiresAt ? new Date(tokenData.expiresAt) : new Date(0);
    const now = new Date();

    // Refresh if expired or about to expire.
    // Normal check: 5 min buffer. forceRefreshIfExpiringSoon: 10 min buffer (used by IMAP at connect time).
    const tokenExpiryBufferMs = forceRefreshIfExpiringSoon ? 10 * 60 * 1000 : 5 * 60 * 1000;
    if (expiresAt <= new Date(now.getTime() + tokenExpiryBufferMs)) {
      if (!tokenData.refreshToken) {
        // No refresh token available, user needs to re-authenticate
        return null;
      }

      const lockKey = `oauth:outlook:${userId}`;
      
      // Phase 12: Distributed Lock to prevent refresh race conditions
      const { acquireLock, releaseLock } = await import('@shared/lib/redis/redis.js');
      const hasLock = await acquireLock(lockKey, 30);
      
      if (!hasLock) {
        console.log(`[Outlook OAuth] 🔒 Refresh already in progress for ${lockKey} (on another node), waiting...`);
        // Poll for 5 seconds to see if the other node updated the DB
        for (let i = 0; i < 10; i++) {
          await new Promise(resolve => setTimeout(resolve, 500));
          const updatedToken = await storage.getOAuthAccount(userId, 'outlook');
          if (updatedToken && updatedToken.expiresAt && new Date(updatedToken.expiresAt) > new Date(Date.now() + 2 * 60 * 1000)) {
            console.log(`[Outlook OAuth] ✨ Token was refreshed by another node for ${lockKey}`);
            return updatedToken.accessToken ? await decrypt(updatedToken.accessToken) : null;
          }
        }
        // If we still don't have it, we'll try to steal the lock or fail
        console.warn(`[Outlook OAuth] ⚠️ Wait timeout for ${lockKey}, proceeding to steal lock.`);
      }

      const refreshPromise = (async () => {
        try {
          // Refresh the token
          const decryptedRefreshToken = await decrypt(tokenData.refreshToken!);
          const newTokens = await this.refreshAccessToken(decryptedRefreshToken);

          // Update stored tokens
          const encryptedNewAccessToken = await encrypt(newTokens.access_token);
          const encryptedNewRefreshToken = newTokens.refresh_token ?
            await encrypt(newTokens.refresh_token) :
            tokenData.refreshToken;

          const newExpiresAt = new Date(Date.now() + (newTokens.expires_in * 1000));

          await storage.saveOAuthAccount({
            userId: userId,
            provider: 'outlook',
            providerAccountId: tokenData.providerAccountId,
            accessToken: encryptedNewAccessToken,
            refreshToken: encryptedNewRefreshToken,
            expiresAt: newExpiresAt,
            scope: newTokens.scope,
            tokenType: newTokens.token_type
          });

          // Sync back to integrations table
          const allIntegrations = await storage.getIntegrations(userId);
          const outlookInt = allIntegrations.find(i => i.provider === 'outlook' && (i as any).accountType === tokenData.providerAccountId);
          if (outlookInt) {
            const decryptedMeta = JSON.parse(decrypt(outlookInt.encryptedMeta));
            const updatedMeta = encrypt(JSON.stringify({
              ...decryptedMeta,
              access_token: newTokens.access_token,
              refresh_token: newTokens.refresh_token || decryptedMeta.refresh_token,
              expiry_date: newExpiresAt.getTime(),
            }));
            await storage.updateIntegrationById(outlookInt.id, { encryptedMeta: updatedMeta });
          }

          return newTokens.access_token;
        } catch (error) {
          console.error('Error refreshing Outlook token:', error);
          return null;
        } finally {
          await releaseLock(lockKey);
          OutlookOAuth.refreshLocks.delete(lockKey);
        }
      })();

      OutlookOAuth.refreshLocks.set(lockKey, refreshPromise);
      return refreshPromise;
    }

    // Token is still valid
    if (!tokenData.accessToken) return null;
    const decryptedToken = await decrypt(tokenData.accessToken);
    return decryptedToken;
  }



  /**
   * Create calendar event
   */
  async createCalendarEvent(
    accessToken: string,
    subject: string,
    start: Date,
    end: Date,
    attendees: string[] = [],
    body?: string,
    location?: string
  ): Promise<any> {
    const event = {
      subject: subject,
      body: body ? {
        contentType: 'HTML',
        content: body
      } : undefined,
      start: {
        dateTime: start.toISOString(),
        timeZone: 'UTC'
      },
      end: {
        dateTime: end.toISOString(),
        timeZone: 'UTC'
      },
      location: location ? {
        displayName: location
      } : undefined,
      attendees: attendees.map(email => ({
        emailAddress: { address: email },
        type: 'required'
      }))
    };

    const response = await fetch('https://graph.microsoft.com/v1.0/me/events', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(event)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to create calendar event');
    }

    return data;
  }

  /**
   * Generate secure state parameter
   */
  private generateState(userId: string): string {
    const timestamp = Date.now();
    const random = crypto.randomBytes(16).toString('hex');
    const data = JSON.stringify({ userId, timestamp, random });

    // Create signature
    const signature = crypto
      .createHmac('sha256', this.config.clientSecret)
      .update(data)
      .digest('hex');

    // Encode state
    const state = Buffer.from(JSON.stringify({ data, signature })).toString('base64url');
    return state;
  }

  /**
   * Verify state parameter
   */
  verifyState(state: string): { userId: string } | null {
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64url').toString());
      const { data, signature } = decoded;

      // Verify signature
      const expectedSignature = crypto
        .createHmac('sha256', this.config.clientSecret)
        .update(data)
        .digest('hex');

      if (signature !== expectedSignature) {
        return null;
      }

      const parsedData = JSON.parse(data);

      // Check timestamp (valid for 10 minutes)
      const timestamp = parsedData.timestamp;
      const now = Date.now();
      if (now - timestamp > 10 * 60 * 1000) {
        return null;
      }

      return { userId: parsedData.userId };
    } catch (error) {
      console.error('Error verifying state:', error);
      return null;
    }
  }

  /**
   * Create a Graph API subscription for real-time push notifications
   */
  async createSubscription(userId: string): Promise<any> {
    const accessToken = await this.getValidToken(userId);
    if (!accessToken) throw new Error('No valid Outlook access token');

    const notificationUrl = process.env.OUTLOOK_WEBHOOK_URL || `${process.env.APP_URL}/api/webhooks/outlook/push`;
    const expirationDateTime = new Date(Date.now() + 4230 * 60 * 1000).toISOString(); // Max ~2.9 days

    const subscription = {
      changeType: 'created',
      notificationUrl,
      resource: 'me/messages',
      expirationDateTime,
      clientState: crypto.createHash('sha256').update(userId + (process.env.SESSION_SECRET || 'fallback')).digest('hex')
    };

    const response = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(subscription)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(`[Outlook OAuth] Subscription failed: ${JSON.stringify(data)}`);
      throw new Error(data.error?.message || 'Failed to create subscription');
    }

    // Store subscription details in user metadata
    const user = await storage.getUser(userId);
    await storage.updateUser(userId, {
      metadata: {
        ...(user?.metadata as any || {}),
        outlook_subscription_id: data.id,
        outlook_subscription_expiry: data.expirationDateTime
      }
    });

    return data;
  }

  /**
   * Delete a Graph API subscription
   */
  async deleteSubscription(userId: string, subscriptionId: string): Promise<void> {
    const accessToken = await this.getValidToken(userId);
    if (!accessToken) return;

    const response = await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${subscriptionId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok && response.status !== 404) {
      const error = await response.json();
      console.warn(`[Outlook OAuth] Failed to delete subscription: ${error.error?.message}`);
    }
  }

  /**
   * Revoke Outlook tokens and remove from database
   */
  async revokeToken(userId: string, emailAddress?: string): Promise<void> {
    const tokenData = await storage.getOAuthAccount(userId, 'outlook', emailAddress);
    if (tokenData && tokenData.accessToken) {
      try {
        const decryptedAccessToken = decrypt(tokenData.accessToken);
        // Revoke Microsoft Graph sign-in sessions (invalidates all refresh tokens)
        const response = await fetch('https://graph.microsoft.com/v1.0/me/revokeSignInSessions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${decryptedAccessToken}`,
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          const error = await response.json();
          console.warn(`[Outlook OAuth] Session revocation warning: ${error.error?.message}`);
        } else {
          console.log(`[Outlook OAuth] Revoked sign-in sessions for user ${userId} (${emailAddress || ''})`);
        }
      } catch (err: any) {
        console.warn(`[Outlook OAuth] Failed to revoke session: ${err.message}`);
      }
    }

    await storage.deleteOAuthAccount(userId, 'outlook', emailAddress);

    // If this was the primary outlook email, clear it from metadata
    const user = await storage.getUser(userId);
    const metadata = user?.metadata as any || {};
    if (metadata.outlook_email === emailAddress || (!emailAddress && metadata.outlook_email)) {
      await storage.updateUser(userId, {
        metadata: {
          ...metadata,
          outlook_email: null,
          outlook_connected: false
        }
      });
    }
  }
}

export const outlookOAuth = new OutlookOAuth();





