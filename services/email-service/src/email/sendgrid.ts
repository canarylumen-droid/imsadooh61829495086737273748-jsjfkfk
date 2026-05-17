/**
 * SendGrid Email Service
 * 
 * Sends transactional emails via Twilio SendGrid API.
 * Used for: OTP codes, welcome emails, trial reminders
 */

import { 
  generateWelcomeEmail, 
  generateTrialReminderEmail, 
  generateTrialExpiredEmail 
} from './user-email-templates.js';
import { generateOTPEmail, generateOTPPlaintext } from './otp-templates.js';

interface SendGridConfig {
  apiKey: string;
  fromEmail: string;
  fromName: string;
}

interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

class SendGridEmailService {
  private config: SendGridConfig | null = null;

  constructor() {
    this.initConfig();
  }

  private initConfig(): void {
    const sgKey = process.env.TWILIO_SENDGRID_API_KEY;
    const resendKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.SENDGRID_FROM_EMAIL || 'team@audnixai.com';
    const fromName = process.env.SENDGRID_FROM_NAME || 'Audnix AI Team';

    const hasSendgrid = sgKey && sgKey.trim().length > 0;
    const hasResend = resendKey && resendKey.trim().length > 0;

    if (hasSendgrid || hasResend) {
      this.config = { apiKey: sgKey || '', fromEmail, fromName };
      console.log('✅ SendGrid/Resend failover service configured with:', fromEmail);
    } else {
      console.error('❌ CRITICAL: Both SendGrid and Resend keys missing - TWILIO_SENDGRID_API_KEY and RESEND_API_KEY not set');
      console.error('📋 OTP emails and transactional emails will FAIL');
    }
  }

  isConfigured(): boolean {
    return this.config !== null || (!!process.env.RESEND_API_KEY && process.env.RESEND_API_KEY.trim().length > 0);
  }

  private async sendEmail(options: SendEmailOptions): Promise<EmailResult> {
    try {
      const fromEmail = this.config?.fromEmail || 'team@audnixai.com';
      const fromName = this.config?.fromName || 'Audnix AI Team';

      const { ResendFailover } = await import('@shared/lib/providers/resend-failover.js');
      const result = await ResendFailover.send({
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
        from: fromEmail,
        fromName: fromName
      });

      if (!result.success) {
        return { success: false, error: result.error || 'Failed to send email' };
      }

      return { success: true, messageId: result.messageId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('❌ SendGrid/Resend send failed:', message);
      return { success: false, error: message };
    }
  }

  async sendOTP(email: string, code: string): Promise<EmailResult> {
    const html = generateOTPEmail({
      code,
      companyName: 'Audnix AI',
      userEmail: email,
      expiryMinutes: 10
    });
    const text = generateOTPPlaintext({
      code,
      companyName: 'Audnix AI',
      userEmail: email,
      expiryMinutes: 10
    });

    return this.sendEmail({
      to: email,
      subject: `${code} - Your Audnix AI verification code`,
      html,
      text
    });
  }

  async sendWelcome(email: string, userName: string): Promise<EmailResult> {
    const { html, text } = generateWelcomeEmail({
      userName,
      companyName: 'Audnix AI'
    });

    return this.sendEmail({
      to: email,
      subject: `Welcome to Audnix AI, ${userName}!`,
      html,
      text
    });
  }

  async sendTrialReminder(email: string, userName: string, daysRemaining: number): Promise<EmailResult> {
    const { html, text } = generateTrialReminderEmail({
      userName,
      companyName: 'Audnix AI',
      daysRemaining
    });

    const subject = daysRemaining <= 1 
      ? `${userName}, your Audnix AI trial ends tomorrow`
      : `${userName}, your Audnix AI trial ends in ${daysRemaining} days`;

    return this.sendEmail({
      to: email,
      subject,
      html,
      text
    });
  }

  async sendTrialExpired(email: string, userName: string): Promise<EmailResult> {
    const { html, text } = generateTrialExpiredEmail({
      userName,
      companyName: 'Audnix AI'
    });

    return this.sendEmail({
      to: email,
      subject: `${userName}, your Audnix AI trial has ended`,
      html,
      text
    });
  }
}

export const sendgridService = new SendGridEmailService();
