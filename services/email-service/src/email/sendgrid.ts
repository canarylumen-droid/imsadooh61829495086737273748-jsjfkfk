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
    const apiKey = process.env.TWILIO_SENDGRID_API_KEY;
    const fromEmail = process.env.SENDGRID_FROM_EMAIL || 'team@audnixai.com';
    const fromName = process.env.SENDGRID_FROM_NAME || 'Audnix AI Team';

    if (apiKey && apiKey.trim().length > 0) {
      this.config = { apiKey, fromEmail, fromName };
      console.log('✅ SendGrid configured with:', fromEmail);
    } else {
      console.error('❌ CRITICAL: SendGrid API key missing - TWILIO_SENDGRID_API_KEY not set');
      console.error('📋 OTP emails and transactional emails will FAIL');
      console.error('📍 Set TWILIO_SENDGRID_API_KEY in your environment');
    }
  }

  isConfigured(): boolean {
    return this.config !== null;
  }

  private async sendEmail(options: SendEmailOptions): Promise<EmailResult> {
    if (!this.config) {
      return { success: false, error: 'SendGrid not configured' };
    }

    try {
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: options.to }] }],
          from: { 
            email: this.config.fromEmail, 
            name: this.config.fromName 
          },
          subject: options.subject,
          content: [
            ...(options.text ? [{ type: 'text/plain', value: options.text }] : []),
            { type: 'text/html', value: options.html }
          ]
        })
      });

      if (response.ok || response.status === 202) {
        const messageId = response.headers.get('x-message-id') || 'sent';
        console.log(`✅ SendGrid email sent to ${options.to}`);
        return { success: true, messageId };
      }

      const errorText = await response.text();
      console.error(`❌ SendGrid error [${response.status}]:`, errorText);
      return { success: false, error: `SendGrid API error: ${response.status}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('❌ SendGrid send failed:', message);
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
