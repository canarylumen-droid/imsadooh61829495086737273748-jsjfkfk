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
    if (process.env.TWILIO_SENDGRID_API_KEY || process.env.RESEND_API_KEY) {
      return EmailProvider.SENDGRID;
    }
    throw new Error('No email provider configured. Set REMINDER_EMAIL_API_KEY + REMINDER_EMAIL_ENDPOINT, TWILIO_SENDGRID_API_KEY, or RESEND_API_KEY');
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
    const { ResendFailover } = await import('@shared/lib/providers/resend-failover.js');
    const result = await ResendFailover.send({
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
      from: payload.from_email,
      fromName: payload.from_name || 'Audnix AI'
    });

    if (!result.success) {
      return { success: false, error: result.error || 'Failed to send email' };
    }

    console.log(`✅ Email sent to ${payload.to} via SendGrid/Resend failover`);
    return { success: true, messageId: result.messageId };
  }
}
