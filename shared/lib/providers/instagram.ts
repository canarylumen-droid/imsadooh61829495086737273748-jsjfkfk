import { decrypt } from '@shared/lib/crypto/encryption.js';

interface InstagramMessage {
  id: string;
  from: { id: string; name: string };
  message: string;
  timestamp: string;
}

interface InstagramCredentials {
  access_token: string;
  page_id: string;
  account_type: "personal" | "creator" | "business";
}

export class InstagramProvider {
  private credentials: InstagramCredentials;
  private isDemoMode: boolean;
  private userId: string = 'me'; // Assuming 'me' for the current user context

  constructor(encryptedMeta: string) {
    this.isDemoMode = process.env.DISABLE_EXTERNAL_API === "true";

    if (this.isDemoMode) {
      this.credentials = {
        access_token: "mock_token",
        page_id: "mock_page_id",
        account_type: "business"
      };
    } else {
      this.credentials = JSON.parse(decrypt(encryptedMeta));
    }
  }

  /**
   * Mock function to get a valid token, replace with actual logic if needed
   */
  private async getValidToken(userId: string): Promise<string | null> {
    if (this.isDemoMode) {
      return "mock_token";
    }
    // In a real scenario, you might need to refresh the token or ensure it's valid
    // For now, we'll just use the stored access token
    return this.credentials.access_token;
  }

  /**
   * Get comments on a media post
   */
  async getMediaComments(mediaId: string): Promise<any[]> {
    if (!this.credentials.access_token || !this.credentials.page_id) {
      throw new Error('Instagram credentials not configured');
    }

    try {
      const response = await fetch(
        `https://graph.facebook.com/v18.0/${mediaId}/comments?fields=id,text,username,timestamp,from&access_token=${this.credentials.access_token}`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch comments');
      }

      const data = await response.json();
      return data.data || [];
    } catch (error) {
      console.error('Error fetching Instagram comments:', error);
      return [];
    }
  }

  /**
   * Send a text message (plain text without buttons)
   */
  async sendMessage(recipientId: string, message: string): Promise<void> {
    if (this.isDemoMode) {
      console.log(`Demo mode: Would send message "${message}" to ${recipientId}`);
      return;
    }

    const url = `https://graph.facebook.com/v18.0/me/messages`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.credentials.access_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: message }
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Instagram API error: ${error.error?.message || response.statusText}`);
    }
  }

  /**
   * Send message with Meta API CTA button (rounded, hyperlinked)
   * Uses Instagram's Generic Template with URL button
   */
  async sendMessageWithButton(
    recipientId: string,
    message: string,
    buttonText: string,
    buttonUrl: string
  ): Promise<void> {
    if (this.isDemoMode) {
      console.log(`Demo mode: Would send message with button "${buttonText}" -> ${buttonUrl} to ${recipientId}`);
      return;
    }

    const url = `https://graph.facebook.com/v18.0/me/messages`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.credentials.access_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: {
          attachment: {
            type: "template",
            payload: {
              template_type: "button",
              text: message.substring(0, 640),
              buttons: [
                {
                  type: "web_url",
                  url: buttonUrl,
                  title: buttonText.substring(0, 20)
                }
              ]
            }
          }
        }
      })
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('Instagram button message error:', error);
      console.log('Falling back to text message with link');
      await this.sendMessage(recipientId, `${message}\n\n🔗 ${buttonText}: ${buttonUrl}`);
      return;
    }
  }

  /**
   * Send message with multiple quick reply options
   * Used for choice-based conversations
   */
  async sendQuickReplies(
    recipientId: string,
    message: string,
    options: Array<{ title: string; payload: string }>
  ): Promise<void> {
    if (this.isDemoMode) {
      console.log(`Demo mode: Would send quick replies to ${recipientId}`);
      return;
    }

    const url = `https://graph.facebook.com/v18.0/me/messages`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.credentials.access_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: {
          text: message,
          quick_replies: options.slice(0, 13).map(opt => ({
            content_type: "text",
            title: opt.title.substring(0, 20),
            payload: opt.payload
          }))
        }
      })
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('Instagram quick replies error:', error);
      await this.sendMessage(recipientId, message);
    }
  }

  /**
   * Reply to a comment on Instagram
   */
  async replyToComment(commentId: string, replyText: string): Promise<void> {
    const endpoint = `https://graph.facebook.com/v18.0/${commentId}/replies`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.credentials.access_token}`
      },
      body: JSON.stringify({
        message: replyText
      })
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('Instagram comment reply error:', error);
      throw new Error(error.error?.message || 'Failed to reply to comment');
    }
  }

  /**
   * Send Instagram Audio Message
   */
  async sendAudioMessage(recipientId: string, audioUrl: string): Promise<{ messageId: string }> {
    if (this.isDemoMode) {
      return { messageId: `mock_audio_${Date.now()}` };
    }

    const url = `https://graph.facebook.com/v18.0/me/messages`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.credentials.access_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: {
          attachment: {
            type: "audio",
            payload: {
              url: audioUrl,
              is_reusable: true
            }
          }
        }
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Instagram API error: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return { messageId: data.message_id };
  }

  /**
   * Send voice message to Instagram DM
   * Instagram requires audio to be hosted publicly first
   */
  async sendVoiceMessage(recipientId: string, audioBuffer: Buffer): Promise<boolean> {
    try {
      if (this.isDemoMode) {
        console.log('Demo mode: Would send voice message to', recipientId);
        return true;
      }

      const accessToken = this.credentials.access_token;
      if (!accessToken) {
        throw new Error('No valid Instagram access token');
      }

      // Upload audio to a public URL first (using Supabase storage or similar)
      const { uploadToSupabase } = await import('../storage/file-upload.js');
      
      // Save buffer to temp file first
      const fs = await import('fs/promises');
      const path = await import('path');
      const os = await import('os');
      const tmpDir = os.tmpdir();
      const tmpPath = path.join(tmpDir, `voice-${Date.now()}.mp3`);
      await fs.writeFile(tmpPath, audioBuffer);
      
      const audioUrl = await uploadToSupabase(
        'voice-messages',
        `voice-messages/${recipientId}-${Date.now()}.mp3`,
        tmpPath
      );

      if (!audioUrl) {
        throw new Error('Failed to upload audio file');
      }

      // Send audio message via Instagram Graph API
      const sendUrl = `https://graph.facebook.com/v18.0/me/messages`;
      const sendResponse = await fetch(sendUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: {
            attachment: {
              type: 'audio',
              payload: {
                url: audioUrl,
                is_reusable: true
              }
            }
          }
        })
      });

      if (!sendResponse.ok) {
        const error = await sendResponse.json();
        console.error('Instagram voice send error:', error);
        throw new Error(`Failed to send voice message: ${error.error?.message || 'Unknown error'}`);
      }

      console.log('✅ Instagram voice message sent successfully');
      return true;
    } catch (error) {
      console.error('Error sending Instagram voice message:', error);
      return false;
    }
  }

  /**
   * Fetch recent messages from Instagram inbox
   */
  async fetchMessages(limit = 50): Promise<InstagramMessage[]> {
    if (this.isDemoMode) {
      return [
        {
          id: "mock_1",
          from: { id: "user_123", name: "Demo User" },
          message: "Hi! I'm interested in your product",
          timestamp: new Date().toISOString()
        }
      ];
    }

    const url = `https://graph.facebook.com/v18.0/${this.credentials.page_id}/conversations?fields=messages{id,from,message,created_time}&limit=${limit}`;

    const response = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${this.credentials.access_token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Instagram API error: ${response.statusText}`);
    }

    const data = await response.json();

    return data.data?.flatMap((conv: any) =>
      conv.messages?.data?.map((msg: any) => ({
        id: msg.id,
        from: msg.from,
        message: msg.message,
        timestamp: msg.created_time
      })) || []
    ) || [];
  }

  /**
   * Get user profile information
   */
  async getUserProfile(userId: string): Promise<{ id: string; name: string; username?: string }> {
    if (this.isDemoMode) {
      return { id: userId, name: "Demo User", username: "demouser" };
    }

    const url = `https://graph.facebook.com/v18.0/${userId}?fields=id,name,username`;

    const response = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${this.credentials.access_token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Instagram API error: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Validate connection status
   */
  async validateConnection(): Promise<boolean> {
    if (this.isDemoMode) {
      return true;
    }

    try {
      const url = `https://graph.facebook.com/v18.0/${this.credentials.page_id}?fields=id`;
      const response = await fetch(url, {
        headers: {
          "Authorization": `Bearer ${this.credentials.access_token}`
        }
      });

      return response.ok;
    } catch (error) {
      return false;
    }
  }
}

/**
 * Functional exports for service compatibility
 */
export async function sendInstagramMessage(encryptedMeta: string, recipientId: string, message: string): Promise<void> {
  const provider = new InstagramProvider(encryptedMeta);
  return provider.sendMessage(recipientId, message);
}

export async function sendInstagramOutreach(encryptedMeta: string, recipientId: string, message: string, buttonText?: string, buttonUrl?: string): Promise<void> {
  const provider = new InstagramProvider(encryptedMeta);
  if (buttonText && buttonUrl) {
    return provider.sendMessageWithButton(recipientId, message, buttonText, buttonUrl);
  }
  return provider.sendMessage(recipientId, message);
}

export async function replyToInstagramComment(encryptedMeta: string, commentId: string, replyText: string): Promise<void> {
  const provider = new InstagramProvider(encryptedMeta);
  return provider.replyToComment(commentId, replyText);
}

export class InstagramOAuth {
  private config: { clientId: string; clientSecret: string; redirectUri: string };

  constructor() {
    this.config = {
      clientId: process.env.META_APP_ID || '',
      clientSecret: process.env.META_APP_SECRET || '',
      redirectUri: process.env.META_REDIRECT_URI || ''
    };
  }

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
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    return response.json();
  }

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
