import crypto from 'crypto';
// import { supabaseAdmin } from '../supabase-admin.js'; // Removed
import { storage } from '@shared/lib/storage/storage.js';
import { encrypt, decrypt } from '@shared/lib/crypto/encryption.js';
import { getOAuthRedirectUrl } from '@shared/config/config/oauth-redirects.js';

interface InstagramOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface InstagramTokenResponse {
  access_token: string;
  user_id: string;
  permissions?: string[];
  error?: {
    message: string;
    type: string;
    code: number;
  };
}

interface InstagramUserProfile {
  id: string;
  username: string;
  name?: string;
  account_type?: string;
}

export class InstagramOAuth {
  private config: InstagramOAuthConfig;

  constructor() {
    this.config = {
      clientId: process.env.META_APP_ID || '',
      clientSecret: process.env.META_APP_SECRET || '',
      redirectUri: getOAuthRedirectUrl('instagram')
    };
  }

  /**
   * Generate OAuth authorization URL (Facebook Graph Login for Instagram Professional)
   */
  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: 'instagram_basic,instagram_manage_messages,pages_show_list,pages_read_engagement,pages_manage_metadata,public_profile',
      response_type: 'code',
      state
    });

    return `https://www.facebook.com/v18.0/dialog/oauth?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token (Facebook User Token)
   */
  async exchangeCodeForToken(code: string): Promise<any> {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: 'authorization_code',
      redirect_uri: this.config.redirectUri,
      code
    });

    const response = await fetch('https://graph.facebook.com/v18.0/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString()
    });

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message || 'Failed to exchange code for token');
    }

    return data;
  }

  /**
   * Exchange short-lived User token for long-lived User token
   */
  async exchangeForLongLivedToken(accessToken: string): Promise<any> {
    const params = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      fb_exchange_token: accessToken
    });

    const response = await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?${params.toString()}`);
    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message || 'Failed to get long-lived token');
    }

    return data;
  }
  


  /**
   * Get Instagram Business account linked to user's pages
   */
  async getInstagramBusinessAccount(userAccessToken: string): Promise<{ pageToken: string; instagramId: string; username: string } | null> {
    // 1. Get user's pages
    const pagesResponse = await fetch(`https://graph.facebook.com/v18.0/me/accounts?access_token=${userAccessToken}`);
    const pagesData = await pagesResponse.json();

    if (!pagesData.data || pagesData.data.length === 0) {
      throw new Error('No Facebook Pages found. An Instagram Business account must be linked to a Facebook Page.');
    }

    // 2. Find page with linked Instagram Business Account
    for (const page of pagesData.data) {
      const igResponse = await fetch(`https://graph.facebook.com/v18.0/${page.id}?fields=instagram_business_account{id,username}&access_token=${page.access_token}`);
      const igData = await igResponse.json();

      if (igData.instagram_business_account) {
        return {
          pageToken: page.access_token,
          instagramId: igData.instagram_business_account.id,
          username: igData.instagram_business_account.username
        };
      }
    }

    return null;
  }

  /**
   * Refresh a long-lived token before it expires
   */
  async refreshLongLivedToken(existingToken: string): Promise<{ access_token: string; token_type: string; expires_in: number }> {
    const params = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      fb_exchange_token: existingToken
    });

    const response = await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?${params.toString()}`);
    const data = await response.json() as any;

    if (data.error) {
      throw new Error(data.error.message || 'Failed to refresh long-lived token');
    }

    return {
      access_token: data.access_token,
      token_type: data.token_type || 'bearer',
      expires_in: data.expires_in || 5184000 // Default 60 days
    };
  }

  /**
   * Get user profile information (FB User ID)
   */
  async getUserProfile(accessToken: string): Promise<any> {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/me?fields=id,name&access_token=${accessToken}`
    );

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message || 'Failed to get user profile');
    }

    return data;
  }

  /**
   * Save OAuth token to database
   */
  async saveToken(userId: string, tokenData: InstagramTokenResponse, expiresIn: number = 5184000): Promise<void> {
    const encryptedToken = await encrypt(tokenData.access_token);
    const expiresAt = new Date(Date.now() + (expiresIn * 1000));

    // Save to oauth_accounts table via storage
    await storage.saveOAuthAccount({
      userId: userId,
      provider: 'instagram',
      providerAccountId: tokenData.user_id,
      accessToken: encryptedToken,
      expiresAt: expiresAt,
      tokenType: 'bearer', // Instagram uses Bearer?
      scope: 'instagram_basic,instagram_manage_messages,instagram_manage_comments'
    });

    // Update user record with Instagram info
    await storage.updateUser(userId, {
      metadata: {
        instagram_access_token: encryptedToken,
        instagram_token_expires: expiresAt.toISOString(),
        instagram_user_id: tokenData.user_id
      }
    }); // Schema needs to support this metadata structure or columns
  }

  /**
   * Get valid access token (refresh if needed)
   */
  async getValidToken(userId: string): Promise<string | null> {
    const tokenData = await storage.getOAuthAccount(userId, 'instagram');

    if (!tokenData) {
      return null;
    }

    // Check if token is expired
    const expiresAt = tokenData.expiresAt ? new Date(tokenData.expiresAt) : new Date(0);
    const now = new Date();
    const hoursUntilExpiry = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60);

    // Refresh if less than 24 hours until expiry
    if (hoursUntilExpiry < 24 && tokenData.accessToken) {
      try {
        const decryptedToken = await decrypt(tokenData.accessToken);
        const refreshedData = await this.refreshLongLivedToken(decryptedToken);

        // Save new token
        await this.saveToken(userId, {
          access_token: refreshedData.access_token,
          user_id: tokenData.providerAccountId, // Reuse existing user_id if not provided in refresh? Usually refresh just gives token.
          // refreshLongLivedToken result: { access_token, token_type, expires_in }
          // It doesn't return user_id. We must rely on stored user_id.
        }, refreshedData.expires_in);

        return refreshedData.access_token;
      } catch (error) {
        console.error('Failed to refresh token:', error);
        return null;
      }
    }

    if (!tokenData.accessToken) return null;
    return await decrypt(tokenData.accessToken);
  }

  /**
   * Revoke access token (Provider-level disconnect)
   */
  async revokeToken(userId: string): Promise<void> {
    const tokenData = await storage.getOAuthAccount(userId, 'instagram');
    if (!tokenData || !tokenData.accessToken) return;

    try {
      const decryptedToken = await decrypt(tokenData.accessToken);
      const providerAccountId = tokenData.providerAccountId;

      console.log(`[Instagram OAuth] Revoking token for user ${userId} (Provider ID: ${providerAccountId})`);

      // Meta/Facebook Graph API: Revoke app permissions
      // DELETE /{user-id}/permissions removes the app's access to the user's data
      const response = await fetch(`https://graph.facebook.com/v18.0/${providerAccountId}/permissions?access_token=${decryptedToken}`, {
        method: 'DELETE'
      });

      const result = await response.json();
      if (result.success) {
        console.log(`[Instagram OAuth] Successfully revoked Meta permissions for user ${userId}`);
      } else {
        console.warn(`[Instagram OAuth] Meta permission revocation returned non-success:`, result);
      }
    } catch (error) {
      console.error('[Instagram OAuth] Error during remote token revocation:', error);
    }

    // Delete from oauth_accounts table
    await storage.deleteOAuthAccount(userId, 'instagram');

    // Clear from users table
    await storage.updateUser(userId, {
      metadata: {
        instagram_access_token: null,
        instagram_token_expires: null,
        instagram_user_id: null,
        instagram_username: null
      }
    });
  }

  /**
   * Get Instagram conversations (threads) for a user
   */
  async getConversations(accessToken: string): Promise<Array<{
    id: string;
    participants?: Array<{ id: string; username: string }>;
    updated_time?: string;
  }>> {
    try {
      const response = await fetch(
        `https://graph.instagram.com/me/conversations?fields=id,participants,updated_time&access_token=${accessToken}`
      );
      const data = await response.json();
      if (data.error) {
        throw new Error(data.error.message || 'Failed to get conversations');
      }
      return data.data || [];
    } catch (error) {
      console.error('Failed to get Instagram conversations:', error);
      return [];
    }
  }

  /**
   * Get Instagram media (posts/reels) for a user
   */
  async getMedia(accessToken: string, limit: number = 20): Promise<Array<{
    id: string;
    caption?: string;
    media_type: string;
    media_url: string;
    thumbnail_url?: string;
    permalink: string;
    timestamp: string;
    username: string;
    like_count?: number;
    comments_count?: number;
  }>> {
    try {
      const fields = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,username,like_count,comments_count';
      let allMedia: any[] = [];
      let url = `https://graph.instagram.com/me/media?fields=${fields}&limit=${Math.min(limit, 100)}&access_token=${accessToken}`;

      while (url && allMedia.length < limit) {
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.error) {
          throw new Error(data.error.message || 'Failed to get media');
        }

        if (data.data && data.data.length > 0) {
          allMedia = [...allMedia, ...data.data];
        } else {
          break;
        }

        url = data.paging?.next || null;
      }
      
      return allMedia.slice(0, limit);
    } catch (error) {
      console.error('Failed to get Instagram media:', error);
      return [];
    }
  }

  /**
   * Get all messages from a conversation thread
   */
  async getAllMessages(accessToken: string, conversationId: string, limit: number = 100): Promise<Array<{
    id: string;
    message?: string;
    from?: { id: string };
    created_time?: string;
    audio_url?: string;
    attachments?: Array<unknown>;
  }>> {
    try {
      let allMessages: any[] = [];
      let url = `https://graph.instagram.com/${conversationId}/messages?fields=id,message,from,created_time,attachments&limit=${Math.min(limit, 50)}&access_token=${accessToken}`;

      while (url && allMessages.length < limit) {
        const response = await fetch(url);
        const data = await response.json();

        if (data.error) {
          throw new Error(data.error.message || 'Failed to get messages');
        }

        if (data.data && data.data.length > 0) {
          allMessages = [...allMessages, ...data.data];
        } else {
          break;
        }

        url = data.paging?.next || null;
      }

      return allMessages.slice(0, limit);
    } catch (error) {
      console.error('Failed to get Instagram messages:', error);
      return [];
    }
  }
}




