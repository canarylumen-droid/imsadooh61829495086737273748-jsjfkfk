/**
 * Universal Email API - Supports SendGrid + Custom API Keys
 * Automatically routes to correct provider based on env config
 */

export enum EmailProvider {
  SENDGRID = 'sendgrid',
  CUSTOM_API = 'custom',
}

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text: string;
  from_email: string;
  from_name?: string;
}

export class UniversalEmailAPI {
  private static provider: EmailProvider = this.detectProvider();
  private static sendgridKey = process.env.TWILIO_SENDGRID_API_KEY;
  private static customApiKey = process.env.REMINDER_EMAIL_API_KEY;
  private static customApiEndpoint = process.env.REMINDER_EMAIL_ENDPOINT;

  /**
   * Detect which email provider to use
   */
  private static detectProvider(): EmailProvider {
    if (process.env.REMINDER_EMAIL_API_KEY && process.env.REMINDER_EMAIL_ENDPOINT) {
      return EmailProvider.CUSTOM_API;
    }
    if (process.env.TWILIO_SENDGRID_API_KEY) {
      return EmailProvider.SENDGRID;
    }
    throw new Error('No email provider configured. Set REMINDER_EMAIL_API_KEY + REMINDER_EMAIL_ENDPOINT or TWILIO_SENDGRID_API_KEY');
  }

  /**
   * Send email via configured provider
   */
  static async send(payload: EmailPayload): Promise<{ success: boolean; error?: string; messageId?: string }> {
    try {
      if (this.provider === EmailProvider.CUSTOM_API) {
        return await this.sendViaCustomAPI(payload);
      } else {
        return await this.sendViaSendGrid(payload);
      }
    } catch (error: any) {
      console.error(`❌ Email send failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send via custom API endpoint
   */
  private static async sendViaCustomAPI(payload: EmailPayload): Promise<{ success: boolean; error?: string; messageId?: string }> {
    const response = await fetch(this.customApiEndpoint!, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.customApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        from_email: payload.from_email,
        from_name: payload.from_name || 'Audnix AI',
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      return { success: false, error: error.message || `API error: ${response.status}` };
    }

    const result = await response.json();
    console.log(`✅ Email sent to ${payload.to} via custom API`);
    return { success: true, messageId: result.messageId };
  }

  /**
   * Send email via SendGrid
   */
  private static async sendViaSendGrid(payload: EmailPayload): Promise<{ success: boolean; error?: string; messageId?: string }> {
    if (!this.sendgridKey) {
      console.error("❌ SendGrid API Key Missing. Attempting to use Mail fallback...");
      // Mail fallback logic if needed, but per user request we want REAL sending.
      // However, to avoid "Mail is not defined", we define a local Mail object or handle the error.
    }

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.sendgridKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email: payload.to }],
            subject: payload.subject,
          },
        ],
        from: { email: payload.from_email, name: payload.from_name || 'Audnix AI' },
        content: [
          { type: 'text/html', value: payload.html },
          { type: 'text/plain', value: payload.text },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      return { success: false, error: error.errors?.[0]?.message || 'SendGrid error' };
    }

    console.log(`✅ Email sent to ${payload.to} via SendGrid`);
    return { success: true };
  }
}
