/**
 * Audnix AI - Email Sender (Unified Twilio SendGrid)
 * One API key for all emails: OTP, reminders, and billing
 */

export enum EmailSenderType {
  AUTH = 'auth',           // OTP
  REMINDERS = 'reminders', // Day 1-3 nurture sequences
  BILLING = 'billing',     // Payment confirmations & invoices
}

export class AudnixEmailSender {
  /**
   * Get SendGrid API key (unified - same for all email types)
   */
  private static getApiKey(): string {
    return process.env.TWILIO_SENDGRID_API_KEY || '';
  }

  /**
   * Get sender email based on type
   */
  static getSenderEmail(type: EmailSenderType): string {
    switch (type) {
      case EmailSenderType.AUTH:
        return process.env.TWILIO_EMAIL_FROM || 'auth@audnixai.com';
      case EmailSenderType.REMINDERS:
        return process.env.AUDNIX_REMINDER_EMAIL_FROM || 'hello@audnixai.com';
      case EmailSenderType.BILLING:
        return process.env.AUDNIX_BILLING_EMAIL_FROM || 'billing@audnixai.com';
      default:
        return 'noreply@audnixai.com';
    }
  }

  /**
   * Send email via SendGrid with Resend fallback
   */
  static async send(options: {
    to: string;
    subject: string;
    html: string;
    text: string;
    senderType: EmailSenderType;
    senderName?: string;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      const senderEmail = this.getSenderEmail(options.senderType);
      const senderName = options.senderName || 'Audnix AI';

      const { ResendFailover } = await import('@shared/lib/providers/resend-failover.js');

      const result = await ResendFailover.send({
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
        from: senderEmail,
        fromName: senderName
      });

      if (!result.success) {
        console.error(`❌ Email send failed for ${options.senderType}: ${result.error}`);
        return { success: false, error: result.error };
      }

      console.log(`✅ ${options.senderType} email sent to ${options.to} from ${senderEmail}`);
      return { success: true };
    } catch (error: any) {
      console.error(`❌ Email send failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}
