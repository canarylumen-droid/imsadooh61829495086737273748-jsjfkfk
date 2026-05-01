/**
 * Multi-Provider Email Failover System
 * 
 * Automatically tries multiple email providers in order:
 * 1. Mailgun (bulletproof, industry standard)
 * 2. Custom SMTP (user's own server)
 * 3. Gmail API fallback
 * 4. Outlook API fallback
 * 
 * NOTE: Using Twilio SendGrid for OTP emails (auth@audnixai.com)
 */

import FormData from 'form-data';
import nodemailer from 'nodemailer';
import type { SentMessageInfo } from 'nodemailer';
import { storage } from '@shared/lib/storage/storage.js';
import type { ProviderResult } from '@shared/types.js';

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
}

interface FailoverResult {
  success: boolean;
  provider: string;
  error?: string;
}

interface SmtpConfig {
  smtp_host: string;
  smtp_port?: number;
  smtp_user: string;
  smtp_pass: string;
}

interface OAuthCredentials {
  email?: string;
  access_token: string;
  refresh_token?: string;
}

interface MailgunErrorResponse {
  message?: string;
}

interface ApiErrorResponse {
  error?: {
    message?: string;
  };
}

class MultiProviderEmailFailover {
  private mailgunKey: string | null = null;
  private mailgunDomain: string | null = null;

  constructor() {
    if (process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN) {
      this.mailgunKey = process.env.MAILGUN_API_KEY;
      this.mailgunDomain = process.env.MAILGUN_DOMAIN;
    }
  }

  async send(
    email: EmailPayload,
    userId?: string,
    customSmtpConfig?: SmtpConfig
  ): Promise<FailoverResult> {
    const providers: Array<{ name: string; fn: () => Promise<void> }> = [];

    if (this.mailgunKey && this.mailgunDomain) {
      providers.push({
        name: 'Mailgun',
        fn: () => this.sendViaMailgun(email)
      });
    }

    if (customSmtpConfig || userId) {
      providers.push({
        name: 'Custom SMTP',
        fn: () => this.sendViaSMTP(email, customSmtpConfig, userId)
      });
    }

    if (userId) {
      providers.push({
        name: 'Gmail',
        fn: () => this.sendViaGmail(email, userId)
      });
    }

    if (userId) {
      providers.push({
        name: 'Outlook',
        fn: () => this.sendViaOutlook(email, userId)
      });
    }

    for (const provider of providers) {
      try {
        await provider.fn();
        console.log(`✅ Email sent via ${provider.name}: ${email.to}`);
        return { success: true, provider: provider.name };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`⚠️ ${provider.name} failed: ${errorMessage}`);
      }
    }

    const lastError = providers[providers.length - 1];
    return {
      success: false,
      provider: 'none',
      error: `All email providers failed. Last tried: ${lastError?.name || 'unknown'}`
    };
  }

  private async sendViaMailgun(email: EmailPayload): Promise<void> {
    if (!this.mailgunKey || !this.mailgunDomain) {
      throw new Error('Mailgun not configured');
    }

    const form = new FormData();
    form.append('from', email.from || `noreply@${this.mailgunDomain}`);
    form.append('to', email.to);
    form.append('subject', email.subject);
    form.append('html', email.html);
    if (email.replyTo) {
      form.append('h:Reply-To', email.replyTo);
    }

    const authHeader = Buffer.from(`api:${this.mailgunKey}`).toString('base64');

    const response = await fetch(
      `https://api.mailgun.net/v3/${this.mailgunDomain}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${authHeader}`,
          ...form.getHeaders()
        },
        body: form as any
      }
    );

    if (!response.ok) {
      const errorData = await response.json() as MailgunErrorResponse;
      throw new Error(`Mailgun error: ${errorData.message || 'Unknown error'}`);
    }
  }

  private async sendViaSMTP(
    email: EmailPayload,
    config?: SmtpConfig,
    userId?: string
  ): Promise<void> {
    let smtpConfig: SmtpConfig | undefined = config;

    if (!smtpConfig && userId) {
      const integrations = await storage.getIntegrations(userId);
      const emailIntegrations = integrations.filter(i => i.provider === 'custom_email' && i.connected);
      
      // If we have a 'from' address, find the exact matching integration
      // Otherwise, fall back to the first available custom_email integration
      const targetInt = email.from 
        ? emailIntegrations.find(i => i.accountType === email.from)
        : emailIntegrations[0];

      if (targetInt?.encryptedMeta) {
        try {
          const { decryptToJSON } = await import('@shared/lib/crypto/encryption.js');
          smtpConfig = decryptToJSON<SmtpConfig>(targetInt.encryptedMeta);
        } catch (decErr: any) {
          console.error(`[Outreach Engine] Failed to decrypt SMTP config for ${targetInt.accountType}:`, decErr.message);
          // Fall through to throw if no config remains
        }
      }
    }

    if (!smtpConfig) {
      throw new Error('SMTP configuration not found');
    }

    const transporter = nodemailer.createTransport({
      host: smtpConfig.smtp_host,
      port: smtpConfig.smtp_port || 587,
      secure: smtpConfig.smtp_port === 465,
      auth: {
        user: smtpConfig.smtp_user,
        pass: smtpConfig.smtp_pass
      },
      // Force IPv4 to avoid EDNS / EAI_AGAIN DNS failures in cloud environments
      // that have misconfigured or restricted IPv6 DNS resolution.
      family: 4,
      tls: { rejectUnauthorized: false },
      connectionTimeout: 20000,
      greetingTimeout: 20000,
      socketTimeout: 25000
    } as any);

    const result: SentMessageInfo = await transporter.sendMail({
      from: email.from || smtpConfig.smtp_user,
      to: email.to,
      subject: email.subject,
      html: email.html,
      replyTo: email.replyTo
    });

    if (!result.messageId) {
      throw new Error('SMTP send failed - no message ID returned');
    }

    // Append to Sent folder asynchronously
    if (userId) {
      try {
        const { imapIdleManager } = await import('./imap-idle-manager.js');
        const rawMime = this.createMimeMessage(
          email.from || smtpConfig.smtp_user,
          email.to,
          email.subject,
          email.html
        );
        // Fire and forget
        imapIdleManager.appendSentMessage(userId, '', rawMime, {
          smtp_host: smtpConfig.smtp_host,
          smtp_port: smtpConfig.smtp_port,
          smtp_user: smtpConfig.smtp_user,
          smtp_pass: smtpConfig.smtp_pass
        }).catch(err => {
          console.error(`Failed to append to sent folder for user ${userId}:`, err);
        });
      } catch (err) {
        console.error('Error importing imap-idle-manager or creating mime:', err);
      }
    }
  }

  private async sendViaGmail(email: EmailPayload, userId: string): Promise<void> {
    const integrations = await storage.getIntegrations(userId);
    
    // Find the specific Gmail account if 'from' is provided, otherwise fall back to first connected
    const gmailIntegration = email.from 
      ? integrations.find(i => i.provider === 'gmail' && i.connected && i.accountType === email.from)
      : integrations.find(i => i.provider === 'gmail' && i.connected);

    if (!gmailIntegration) {
      throw new Error(`Gmail not configured for ${email.from || 'user'}`);
    }

    const { gmailOAuth } = await import('@services/api-gateway/src/oauth/gmail.js');
    const token = await gmailOAuth.getValidToken(userId, gmailIntegration.accountType || undefined);
    
    if (!token) {
      throw new Error(`Could not get valid Gmail token for ${gmailIntegration.accountType}`);
    }

    const message = this.createMimeMessage(
      gmailIntegration.accountType || '',
      email.to,
      email.subject,
      email.html
    );

    const encodedMessage = Buffer.from(message).toString('base64url');

    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ raw: encodedMessage })
    });

    if (!response.ok) {
      const errorData = await response.json() as ApiErrorResponse;
      throw new Error(errorData.error?.message || 'Gmail API error');
    }
  }

  private async sendViaOutlook(email: EmailPayload, userId: string): Promise<void> {
    const integrations = await storage.getIntegrations(userId);
    const outlookIntegration = integrations.find(i => i.provider === 'outlook' && i.connected);

    if (!outlookIntegration?.encryptedMeta) {
      throw new Error('Outlook not configured');
    }

    const { decrypt } = await import('@shared/lib/crypto/encryption.js');
    const decrypted = await decrypt(outlookIntegration.encryptedMeta);
    const credentials = JSON.parse(decrypted) as OAuthCredentials;

    const response = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${credentials.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: {
          subject: email.subject,
          body: {
            contentType: 'HTML',
            content: email.html
          },
          toRecipients: [{ emailAddress: { address: email.to } }]
        },
        saveToSentItems: true
      })
    });

    if (!response.ok) {
      const errorData = await response.json() as ApiErrorResponse;
      throw new Error(errorData.error?.message || 'Outlook API error');
    }
  }

  public createMimeMessage(from: string, to: string, subject: string, html: string): string {
    const boundary = `----=_Part_${Date.now()}`;

    return `From: ${from}
To: ${to}
Subject: ${subject}
MIME-Version: 1.0
Content-Type: multipart/alternative; boundary="${boundary}"

--${boundary}
Content-Type: text/plain; charset="UTF-8"

${this.stripHtml(html)}

--${boundary}
Content-Type: text/html; charset="UTF-8"

${html}

--${boundary}--`;
  }

  private stripHtml(html: string): string {
    const text = html
      .replace(/<script(?:\s[^>]*)?>[\s\S]*?<\/script>/gi, '')
      .replace(/<style(?:\s[^>]*)?>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&#x2F;/g, '/');

    return text.trim();
  }
}

export const multiProviderEmailFailover = new MultiProviderEmailFailover();





