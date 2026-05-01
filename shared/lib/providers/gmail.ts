import { decrypt } from '@shared/lib/crypto/encryption.js';

interface GmailCredentials {
  access_token: string;
  refresh_token: string;
  email: string;
}

export class GmailProvider {
  private credentials: GmailCredentials;
  private isDemoMode: boolean;

  constructor(encryptedMeta: string) {
    this.isDemoMode = process.env.DISABLE_EXTERNAL_API === "true";
    
    if (this.isDemoMode) {
      this.credentials = {
        access_token: "mock_token",
        refresh_token: "mock_refresh",
        email: "demo@example.com"
      };
    } else {
      this.credentials = JSON.parse(decrypt(encryptedMeta));
    }
  }

  /**
   * Send email via Gmail API
   */
  async sendEmail(to: string, subject: string, body: string): Promise<{ messageId: string }> {
    if (this.isDemoMode) {
      return { messageId: `mock_email_${Date.now()}` };
    }

    const email = [
      `To: ${to}`,
      `From: ${this.credentials.email}`,
      `Subject: ${subject}`,
      `Content-Type: text/html; charset=UTF-8`,
      "",
      body
    ].join("\r\n");

    const encodedEmail = Buffer.from(email).toString("base64url");

    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.credentials.access_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ raw: encodedEmail })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Gmail API error: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return { messageId: data.id };
  }

  /**
   * Fetch recent emails
   */
  async fetchEmails(limit = 50): Promise<any[]> {
    if (this.isDemoMode) {
      return [
        {
          id: "mock_1",
          threadId: "thread_1",
          from: "demo@example.com",
          subject: "Demo inquiry",
          snippet: "I'm interested in learning more...",
          timestamp: new Date().toISOString()
        }
      ];
    }

    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${limit}&q=is:inbox`, {
      headers: {
        "Authorization": `Bearer ${this.credentials.access_token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Gmail API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.messages || [];
  }

  /**
   * Validate connection status
   */
  async validateConnection(): Promise<boolean> {
    if (this.isDemoMode) {
      return true;
    }

    try {
      const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
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
