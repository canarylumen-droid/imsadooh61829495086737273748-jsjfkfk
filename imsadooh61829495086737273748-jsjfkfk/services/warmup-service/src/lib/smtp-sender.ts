/**
 * SMTP Sender
 * Sends warmup emails with X-Audnix-Warmup header.
 * Plain text only. No HTML. No tracking pixels.
 */

import nodemailer from 'nodemailer';
import type { SmtpSendResult } from '../types/warmup-types.js';

interface SmtpSendOptions {
  from: string;
  to: string;
  subject: string;
  body: string;
  messageId: string;
  headers: Record<string, string>;
  credentials: {
    host: string;
    port: number;
    user: string;
    pass: string;
    secure: boolean;
    provider?: string;
    userId?: string;
  };
}

export class SmtpSender {
  async send(opts: SmtpSendOptions): Promise<SmtpSendResult> {
    const isOAuth = ['gmail', 'outlook'].includes(opts.credentials.provider || '');
    let auth: any = {
      user: opts.credentials.user,
      pass: opts.credentials.pass,
    };

    if (isOAuth && opts.credentials.userId) {
      try {
        let accessToken: string | null = null;
        if (opts.credentials.provider === 'gmail') {
          const { GmailOAuth } = await import('@services/api-gateway/src/oauth/gmail.js');
          const gmailOAuth = new GmailOAuth();
          accessToken = await gmailOAuth.getValidToken(opts.credentials.userId, opts.credentials.user);
        } else if (opts.credentials.provider === 'outlook') {
          const { OutlookOAuth } = await import('@services/api-gateway/src/oauth/outlook.js');
          const outlookOAuth = new OutlookOAuth();
          accessToken = await outlookOAuth.getValidToken(opts.credentials.userId);
        }
        if (accessToken) {
          auth = {
            type: 'OAuth2',
            user: opts.credentials.user,
            accessToken,
          };
        }
      } catch (err: any) {
        console.warn(`[Warmup][SMTP] OAuth failed for ${opts.credentials.provider}, falling back to plain auth:`, err.message);
      }
    }

    const transporter = nodemailer.createTransport({
      host: opts.credentials.host,
      port: opts.credentials.port,
      secure: opts.credentials.secure,
      auth,
      tls: {
        rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false',
      },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 15000,
    });

    try {
      const result = await transporter.sendMail({
        from: opts.from,
        to: opts.to,
        subject: opts.subject,
        text: opts.body,
        html: undefined,
        messageId: opts.messageId,
        headers: opts.headers,
      });

      await transporter.close();

      return { success: true, smtpMessageId: result.messageId };
    } catch (err: any) {
      await transporter.close();
      return { success: false, error: err.message };
    }
  }
}

export const smtpSender = new SmtpSender();
