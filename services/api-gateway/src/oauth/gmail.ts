import { google } from 'googleapis';
import crypto from 'crypto';
import { storage } from '@shared/lib/storage/storage.js';
import { encrypt, decrypt } from '@shared/lib/crypto/encryption.js';
import { getOAuthRedirectUrl } from '@shared/config/config/oauth-redirects.js';

interface GmailOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface GmailTokenResponse {
  access_token: string;
  refresh_token?: string;
  scope: string;
  token_type: string;
  expiry_date?: number;
}

interface GmailProfile {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
}

export class GmailOAuth {
  private config: GmailOAuthConfig;
  private oauth2Client: any;
  private static refreshLocks = new Map<string, Promise<string | null>>();

  constructor() {
    this.config = {
      clientId: process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '',
      redirectUri: getOAuthRedirectUrl('gmail')
    };

    if (!this.config.clientId || !this.config.clientSecret) {
      console.warn('⚠️ Gmail OAuth: Missing Client ID or Secret. OAuth will fail.');
    }

    // Shared global client instance for stateless operations (auth url, code exchange)
    this.oauth2Client = new google.auth.OAuth2(
      this.config.clientId,
      this.config.clientSecret,
      this.config.redirectUri
    );
  }

  /**
   * Helper to create a dedicated OAuth2 client for a single user request.
   * This is critical to prevent credentials from leaking between concurrent users.
   */
  private createClient(credentials?: any): any {
    const client = new google.auth.OAuth2(
      this.config.clientId,
      this.config.clientSecret,
      this.config.redirectUri
    );
    if (credentials) {
      client.setCredentials(credentials);
    }
    return client;
  }

  /**
   * Generate OAuth authorization URL
   */
  getAuthorizationUrl(state: string): string {
    const scopes = [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.labels',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile'
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      state: state,
      prompt: 'consent'
    });
  }

  async exchangeCodeForToken(code: string): Promise<GmailTokenResponse> {
    try {
      console.log(`[Gmail OAuth] Exchanging code for token. Redirect URI: ${this.config.redirectUri}`);
      const { tokens } = await this.oauth2Client.getToken(code);
      return tokens as GmailTokenResponse;
    } catch (error: any) {
      const errorData = error.response?.data || error;
      console.error(`[Gmail OAuth] Exchange failed. Redirect URI was: ${this.config.redirectUri}`);
      console.error(`[Gmail OAuth] Error details:`, JSON.stringify(errorData, null, 2));
      
      const errorMessage = errorData.error_description || errorData.error || error.message || 'Unknown exchange error';
      throw new Error(`Failed to exchange code for token: ${errorMessage}`);
    }
  }

  /**
   * Get Gmail profile information
   */
  async getGmailProfile(accessToken: string): Promise<GmailProfile> {
    const client = this.createClient({ access_token: accessToken });
    const gmail = google.gmail({ version: 'v1', auth: client });

    try {
      const response = await gmail.users.getProfile({ userId: 'me' });
      return {
        emailAddress: response.data.emailAddress || '',
        messagesTotal: response.data.messagesTotal || 0,
        threadsTotal: response.data.threadsTotal || 0,
        historyId: response.data.historyId || ''
      };
    } catch (error: any) {
      throw new Error(`Failed to get Gmail profile: ${error.message}`);
    }
  }

  /**
   * Get user's Google profile
   */
  async getUserProfile(accessToken: string): Promise<any> {
    const client = this.createClient({ access_token: accessToken });
    const oauth2 = google.oauth2({ version: 'v2', auth: client });

    try {
      const response = await oauth2.userinfo.get();
      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to get user profile: ${error.message}`);
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<GmailTokenResponse> {
    const client = this.createClient({ refresh_token: refreshToken });

    try {
      const { credentials } = await client.refreshAccessToken();
      return credentials as GmailTokenResponse;
    } catch (error: any) {
      throw new Error(`Failed to refresh access token: ${error.message}`);
    }
  }

  /**
   * Save OAuth tokens to database
   */
  async saveToken(userId: string, tokens: GmailTokenResponse, profile: any): Promise<void> {
    const encryptedAccessToken = encrypt(tokens.access_token);
    const encryptedRefreshToken = tokens.refresh_token ? encrypt(tokens.refresh_token) : null;

    const expiresAt = tokens.expiry_date
      ? new Date(tokens.expiry_date)
      : new Date(Date.now() + 60 * 60 * 1000); // 1 hour default

    const email = profile.emailAddress || profile.email;

    await storage.saveOAuthAccount({
      userId,
      provider: 'google',
      providerAccountId: email,
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      expiresAt,
      scope: tokens.scope,
      tokenType: tokens.token_type
    });
  }

  /**
   * Get valid access token, refreshing if needed
   */
  async getValidToken(userId: string, emailAddress?: string): Promise<string | null> {
    const tokenData = await storage.getOAuthAccount(userId, 'google', emailAddress);

    if (!tokenData) return null;

    const expiresAt = tokenData.expiresAt ? new Date(tokenData.expiresAt) : new Date(0);
    const now = new Date();

    // Refresh if expired or expiring within 5 minutes
    if (expiresAt <= new Date(now.getTime() + 5 * 60 * 1000)) {
      if (!tokenData.refreshToken) return null;

      const lockKey = `oauth:gmail:${userId}:${emailAddress || 'default'}`;
      
      // Phase 12: Distributed Lock to prevent refresh race conditions
      const { acquireLock, releaseLock } = await import('@shared/lib/redis/redis.js');
      const hasLock = await acquireLock(lockKey, 30);
      
      if (!hasLock) {
        console.log(`[Gmail OAuth] 🔒 Refresh already in progress for ${lockKey} (on another node), waiting...`);
        // Poll for 5 seconds to see if the other node updated the DB
        for (let i = 0; i < 10; i++) {
          await new Promise(resolve => setTimeout(resolve, 500));
          const updatedToken = await storage.getOAuthAccount(userId, 'google', emailAddress);
          if (updatedToken && updatedToken.expiresAt && new Date(updatedToken.expiresAt) > new Date(Date.now() + 2 * 60 * 1000)) {
            console.log(`[Gmail OAuth] ✨ Token was refreshed by another node for ${lockKey}`);
            return updatedToken.accessToken ? decrypt(updatedToken.accessToken) : null;
          }
        }
        // If we still don't have it, we'll try to steal the lock or fail
        console.warn(`[Gmail OAuth] ⚠️ Wait timeout for ${lockKey}, proceeding to steal lock.`);
      }

      const refreshPromise = (async () => {
        try {
          const decryptedRefreshToken = decrypt(tokenData.refreshToken!);
          const newTokens = await this.refreshAccessToken(decryptedRefreshToken);
          const encryptedNewAccessToken = encrypt(newTokens.access_token);
        
          // Use new refresh token if provided by Google, otherwise keep the old one
          const encryptedNewRefreshToken = newTokens.refresh_token 
            ? encrypt(newTokens.refresh_token) 
            : tokenData.refreshToken;

          const newExpiresAt = newTokens.expiry_date
            ? new Date(newTokens.expiry_date)
            : new Date(Date.now() + (newTokens as any).expires_in * 1000 || Date.now() + 3600 * 1000);

          await storage.saveOAuthAccount({
            userId,
            provider: 'google',
            providerAccountId: tokenData.providerAccountId,
            accessToken: encryptedNewAccessToken,
            refreshToken: encryptedNewRefreshToken,
            expiresAt: newExpiresAt,
            scope: newTokens.scope,
            tokenType: newTokens.token_type
          });

          // Sync back to integrations table so health checks and outreach engine have the latest token
          const allIntegrations = await storage.getIntegrations(userId);
          const gmailInt = allIntegrations.find(i => i.provider === 'gmail' && i.accountType === tokenData.providerAccountId);
          if (gmailInt) {
            const decryptedMeta = JSON.parse(decrypt(gmailInt.encryptedMeta));
            const updatedMeta = encrypt(JSON.stringify({
              ...decryptedMeta,
              access_token: newTokens.access_token,
              refresh_token: newTokens.refresh_token || decryptedMeta.refresh_token,
              expiry_date: newTokens.expiry_date || newExpiresAt.getTime(),
            }));
            await storage.updateIntegrationById(gmailInt.id, { encryptedMeta: updatedMeta });
          }

          return newTokens.access_token;
        } catch (error) {
          console.error('Error refreshing Gmail token:', error);
          return null;
        } finally {
          await releaseLock(lockKey);
          GmailOAuth.refreshLocks.delete(lockKey);
        }
      })();

      GmailOAuth.refreshLocks.set(lockKey, refreshPromise);
      return refreshPromise;
    }

    if (!tokenData.accessToken) return null;
    return decrypt(tokenData.accessToken);
  }

  /**
   * Refresh all soon-expiring tokens (called by background worker)
   */
  static async refreshExpiredTokens(): Promise<void> {
    try {
      const expiredAccounts = await storage.getSoonExpiringOAuthAccounts('google', 10);
      if (!expiredAccounts || expiredAccounts.length === 0) return;

      for (const account of expiredAccounts) {
        const oauth = new GmailOAuth();
        await oauth.getValidToken(account.userId);
      }

      console.log(`✅ Refreshed ${expiredAccounts.length} Gmail tokens`);
    } catch (error) {
      console.error('Error refreshing expired tokens:', error);
    }
  }

  /**
   * Revoke OAuth tokens and remove from database
   */
  async revokeToken(userId: string, emailAddress?: string): Promise<void> {
    const tokenData = await storage.getOAuthAccount(userId, 'google', emailAddress);
    
    if (tokenData && tokenData.refreshToken) {
      try {
        const decryptedRefreshToken = decrypt(tokenData.refreshToken);
        await this.oauth2Client.revokeToken(decryptedRefreshToken);
        console.log(`[Gmail OAuth] 🛡️ Fully revoked refresh token for ${emailAddress || userId}`);
      } catch (err: any) {
        console.warn(`[Gmail OAuth] Refresh token revocation failed: ${err.message}. Trying access token...`);
        // Fallback to access token if refresh token revocation fails
        if (tokenData.accessToken) {
          try {
            await this.oauth2Client.revokeToken(decrypt(tokenData.accessToken));
          } catch { /* ignore */ }
        }
      }
    }

    await storage.deleteOAuthAccount(userId, 'google', emailAddress);
  }

  /**
   * Internal helper to gracefully refresh forcing
   */
  private async forceRefresh(userId: string, emailAddress?: string): Promise<string | null> {
    const tokenData = await storage.getOAuthAccount(userId, 'google', emailAddress);
    if (!tokenData || !tokenData.refreshToken) return null;
    
    try {
      const decryptedRefreshToken = decrypt(tokenData.refreshToken);
      const newTokens = await this.refreshAccessToken(decryptedRefreshToken);
      
      const encryptedNewAccessToken = encrypt(newTokens.access_token);
      const encryptedNewRefreshToken = newTokens.refresh_token 
          ? encrypt(newTokens.refresh_token) 
          : tokenData.refreshToken;

      await storage.saveOAuthAccount({
          userId,
          provider: 'google',
          providerAccountId: tokenData.providerAccountId,
          accessToken: encryptedNewAccessToken,
          refreshToken: encryptedNewRefreshToken,
          expiresAt: new Date(newTokens.expiry_date || Date.now() + 3600 * 1000),
          scope: newTokens.scope,
          tokenType: newTokens.token_type
      });

      // Sync back to integrations table
      const allIntegrations = await storage.getIntegrations(userId);
      const gmailInt = allIntegrations.find(i => i.provider === 'gmail' && i.accountType === tokenData.providerAccountId);
      if (gmailInt) {
        const decryptedMeta = JSON.parse(decrypt(gmailInt.encryptedMeta));
        const updatedMeta = encrypt(JSON.stringify({
          ...decryptedMeta,
          access_token: newTokens.access_token,
          refresh_token: newTokens.refresh_token || decryptedMeta.refresh_token,
          expiry_date: newTokens.expiry_date || (newTokens.expiry_date || Date.now() + 3600 * 1000),
        }));
        await storage.updateIntegrationById(gmailInt.id, { encryptedMeta: updatedMeta });
      }

      return newTokens.access_token;
    } catch {
      return null;
    }
  }

  /**
   * Send email using Gmail API
   */
  async sendEmail(userId: string, to: string, subject: string, body: string, isHtml = false, fromEmail?: string): Promise<void> {
    const token = await this.getValidToken(userId, fromEmail);
    if (!token) {
      throw new Error(`Gmail not connected for ${fromEmail || 'user'} or token expired`);
    }

    const client = this.createClient({ access_token: token });
    const gmail = google.gmail({ version: 'v1', auth: client });

    const profile = await this.getGmailProfile(token);
    const fromAddress = profile.emailAddress;

    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
    const messageParts = [
      `From: ${fromAddress}`,
      `To: ${to}`,
      `Subject: ${utf8Subject}`,
      'MIME-Version: 1.0',
      isHtml ? 'Content-Type: text/html; charset=utf-8' : 'Content-Type: text/plain; charset=utf-8',
      '',
      body
    ];
    const messageContent = messageParts.join('\r\n');
    const encodedMessage = Buffer.from(messageContent)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    try {
      await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw: encodedMessage }
      });
    } catch (error: any) {
      if (error.response?.status === 401) {
        console.warn(`[Gmail] 401 Unauthorized for sendEmail. Attempting forced refresh...`);
        const newToken = await this.forceRefresh(userId, fromEmail);
        if (newToken) {
          const newClient = this.createClient({ access_token: newToken });
          const newGmail = google.gmail({ version: 'v1', auth: newClient });
          await newGmail.users.messages.send({ userId: 'me', requestBody: { raw: encodedMessage }});
          return;
        }
      }
      throw new Error(`Failed to send email via Gmail API: ${error.message}`);
    }
  }

  /**
   * List recent messages from Gmail
   */
  async listMessages(userId: string, limit = 20): Promise<any[]> {
    const token = await this.getValidToken(userId);
    if (!token) throw new Error('Gmail not connected or token expired');

    const client = this.createClient({ access_token: token });
    const gmail = google.gmail({ version: 'v1', auth: client });

    try {
      const response = await gmail.users.messages.list({ userId: 'me', maxResults: limit });
      return response.data.messages || [];
    } catch (error: any) {
      if (error.response?.status === 401) {
         console.warn(`[Gmail] 401 Unauthorized for listMessages. Attempting forced refresh...`);
         const newToken = await this.forceRefresh(userId);
         if (newToken) {
           const newClient = this.createClient({ access_token: newToken });
           const newGmail = google.gmail({ version: 'v1', auth: newClient });
           const retryResponse = await newGmail.users.messages.list({ userId: 'me', maxResults: limit });
           return retryResponse.data.messages || [];
         }
      }
      throw new Error(`Failed to list messages: ${error.message}`);
    }
  }

  /**
   * Get full message details from Gmail
   */
  async getMessageDetails(userId: string, messageId: string): Promise<any> {
    const token = await this.getValidToken(userId);
    if (!token) throw new Error('Gmail not connected or token expired');

    const client = this.createClient({ access_token: token });
    const gmail = google.gmail({ version: 'v1', auth: client });

    try {
      const response = await gmail.users.messages.get({ userId: 'me', id: messageId });
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401) {
         console.warn(`[Gmail] 401 Unauthorized for getMessageDetails. Attempting forced refresh...`);
         const newToken = await this.forceRefresh(userId);
         if (newToken) {
           const newClient = this.createClient({ access_token: newToken });
           const newGmail = google.gmail({ version: 'v1', auth: newClient });
           const retryResponse = await newGmail.users.messages.get({ userId: 'me', id: messageId });
           return retryResponse.data;
         }
      }
      throw new Error(`Failed to get message details: ${error.message}`);
    }
  }

  /**
   * Register for push notifications (watch)
   * This sends notifications to a Cloud Pub/Sub topic.
   */
  async watch(userId: string, emailAddress?: string): Promise<any> {
    const accessToken = await this.getValidToken(userId, emailAddress);
    if (!accessToken) throw new Error('No valid access token available');

    const client = this.createClient({ access_token: accessToken });
    const gmail = google.gmail({ version: 'v1', auth: client });

    const topicName = process.env.GOOGLE_PUBSUB_TOPIC || (process.env.GOOGLE_PROJECT_ID ? `projects/${process.env.GOOGLE_PROJECT_ID}/topics/audnix-gmail-push` : undefined);

    if (!topicName || topicName.includes('projects/undefined/')) {
      // Intentionally skipping watch setup without noisy warnings
      return null;
    }

    try {
      console.log(`[Gmail OAuth] 📡 Setting up watch for ${emailAddress || userId} on topic ${topicName}`);
      const response = await gmail.users.watch({
        userId: 'me',
        requestBody: {
          topicName,
          labelIds: ['INBOX'],
          labelFilterAction: 'include'
        }
      });
      
      // Store the expiration and historyId in metadata for better tracking
      const user = await storage.getUser(userId);
      await storage.updateUser(userId, {
        metadata: {
          ...(user?.metadata as any || {}),
          gmail_watch_expiry: response.data.expiration,
          gmail_watch_history_id: response.data.historyId,
        }
      });

      return response.data;
    } catch (error: any) {
      console.error(`[Gmail OAuth] Watch failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Stop push notifications (stop)
   */
  async stop(userId: string, emailAddress?: string): Promise<void> {
    const accessToken = await this.getValidToken(userId, emailAddress);
    if (!accessToken) return;

    const client = this.createClient({ access_token: accessToken });
    const gmail = google.gmail({ version: 'v1', auth: client });

    try {
      if (gmail.users) {
        await gmail.users.stop({ userId: 'me' });
      }
    } catch (error: any) {
      console.error(`[Gmail OAuth] Stop watch failed: ${error.message}`);
    }
  }
}

// Singleton instance — imported by google-redirect.ts and oauth.ts
export const gmailOAuth = new GmailOAuth();






