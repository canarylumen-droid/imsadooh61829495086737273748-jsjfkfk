import { generateBrandedEmail, generateMeetingEmail, type BrandColors } from "@services/brain-worker/src/ai-lib/formatters/dm-formatter.js";
import { storage } from '@shared/lib/storage/storage.js';
import * as cheerio from 'cheerio';
import { type Integration } from '@audnix/shared';
import dns from 'dns';

export class MailboxPausedError extends Error {
  constructor(public pauseUntil: Date) {
    super(`Mailbox is temporarily paused until ${pauseUntil.toISOString()} due to network errors.`);
    this.name = 'MailboxPausedError';
  }
}

/**
 * Email messaging functions with branded templates using extracted PDF brand colors
 */

interface EmailConfig {
  smtp_host?: string;
  smtp_port?: number;
  imap_host?: string;
  imap_port?: number;
  smtp_user?: string;
  smtp_pass?: string;
  from_name?: string;
  oauth_token?: string;
  provider?: 'gmail' | 'outlook' | 'smtp' | 'custom';
}

interface EmailCredentials {
  accessToken: string;
  email: string;
}

interface ImportedEmail {
  from: string | undefined;
  to: string | undefined;
  subject: string | undefined;
  text: string | undefined;
  html: string | undefined;
  date: Date | undefined;
}

interface GmailMessage {
  id: string;
  threadId: string;
}

interface OutlookMessage {
  id: string;
  subject: string;
  receivedDateTime: string;
  from?: {
    emailAddress: {
      name: string;
      address: string;
    };
  };
}

interface GmailApiResponse {
  messages?: GmailMessage[];
  error?: {
    message?: string;
  };
}

interface OutlookApiResponse {
  value?: OutlookMessage[];
  error?: {
    message?: string;
  };
}

interface GmailSendResponse {
  id?: string;
  threadId?: string;
  error?: {
    message?: string;
  };
}

interface OutlookSendResponse {
  error?: {
    message?: string;
  };
}

interface ParsedEmailAddress {
  text?: string;
}

interface ParsedEmail {
  from?: ParsedEmailAddress;
  to?: ParsedEmailAddress;
  subject?: string;
  text?: string;
  html?: string;
  date?: Date;
}

/**
 * Auto-discover SMTP/IMAP settings based on email address
 */
export function autoDiscoverSettings(email: string): Partial<EmailConfig> {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return {};

  const providers: Record<string, Partial<EmailConfig>> = {
    'gmail.com': {
      smtp_host: 'smtp.gmail.com',
      smtp_port: 587,
      imap_host: 'imap.gmail.com',
      imap_port: 993,
      provider: 'gmail'
    },
    'outlook.com': {
      smtp_host: 'smtp-mail.outlook.com',
      smtp_port: 587,
      imap_host: 'outlook.office365.com',
      imap_port: 993,
      provider: 'outlook'
    },
    'hotmail.com': {
      smtp_host: 'smtp-mail.outlook.com',
      smtp_port: 587,
      imap_host: 'outlook.office365.com',
      imap_port: 993,
      provider: 'outlook'
    },
    'yahoo.com': {
      smtp_host: 'smtp.mail.yahoo.com',
      smtp_port: 465,
      imap_host: 'imap.mail.yahoo.com',
      imap_port: 993,
      provider: 'smtp'
    },
    'icloud.com': {
      smtp_host: 'smtp.mail.me.com',
      smtp_port: 587,
      imap_host: 'imap.mail.me.com',
      imap_port: 993,
      provider: 'smtp'
    }
  };

  return providers[domain] || {};
}

// DELETED local tracking functions - moving to centralized lib/email/email-tracking.ts

/**
 * Send email via custom SMTP (for custom domain emails)
 */

const smtpPools = new Map<string, any>();

/**
 * Send email via custom SMTP (for custom domain emails)
 * Includes exponential backoff for transient failures
 */
async function sendCustomSMTP(
  userId: string,
  config: EmailConfig,
  to: string,
  subject: string,
  body: string,
  isHtml: boolean = false,
  trackingId?: string,
  integrationId?: string
): Promise<{ messageId: string }> {
  const nodemailer = await import('nodemailer');
  const dns = await import('dns');
  const { imapIdleManager } = await import('@services/email-service/src/email/imap-idle-manager.js');

  const emailBody = body;

  const cacheKey = integrationId || `${config.smtp_host}:${config.smtp_user}`;
  let transporter = smtpPools.get(cacheKey);

  if (!transporter) {
    console.log(`[CustomSMTP] Creating new persistent connection pool for ${cacheKey}`);
    transporter = nodemailer.createTransport({
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      host: config.smtp_host,
      port: config.smtp_port || 587,
      secure: config.smtp_port === 465,
      auth: {
        user: config.smtp_user,
        pass: config.smtp_pass,
      },
      // Forced IPv4 at the library level for extra safety
      family: 4,
      lookup: (hostname: string, options: any, callback: any) => {
        return dns.lookup(hostname, { family: 4 }, callback);
      },
      tls: {
        rejectUnauthorized: false
      },
      connectionTimeout: 30000,
      greetingTimeout: 30000,
      socketTimeout: 60000,
    } as any);
    smtpPools.set(cacheKey, transporter);
  }

  const messageId = `<${import.meta.url ? (await import('crypto')).randomUUID() : Date.now() + Math.random()}@audnixai.com>`;

  const fromAddress = config.from_name
    ? `"${config.from_name}" <${config.smtp_user}>`
    : config.smtp_user;

  const MAX_RETRIES = 3;
  let lastError: any = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        // Exponential backoff: 2s, 4s, 8s
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`[CustomSMTP] Retry attempt ${attempt} for`, to, `after ${delay}ms...`);
        await new Promise(res => setTimeout(res, delay));
      }

      const info = await transporter.sendMail({
        from: fromAddress,
        to,
        subject,
        [isHtml ? 'html' : 'text']: emailBody,
        messageId: messageId.replace(/[<>]/g, ''), // nodemailer adds brackets
      });

      // If we reach here, it worked!
      console.log(`[CustomSMTP] ✅ Successfully sent to ${to} (Attempt ${attempt + 1}) - Message-ID: ${info.messageId}`);

      // Attempt to save to "Sent" folder via background IMAP connection
      // We DO NOT await this because it can be slow and shouldn't block the actual email delivery
      try {
        const rawMessage = createMimeMessage(fromAddress || '', to, subject, emailBody, isHtml, messageId);
        
        const backgroundAppend = async () => {
          try {
            if (integrationId) {
              await imapIdleManager.appendSentMessage(userId, integrationId, rawMessage, config);
            } else {
              const int = await storage.getIntegration(userId, 'custom_email');
              if (int) await imapIdleManager.appendSentMessage(userId, int.id, rawMessage, config);
            }
          } catch (err) {
            console.error(`[CustomSMTP/Background] ❌ Background Sent Folder sync failed:`, err);
          }
        };

        // Fire and forget
        backgroundAppend().catch(e => console.error('[CustomSMTP/Background] Primary failure:', e));
      } catch (error) {
        console.error(`[CustomSMTP] ❌ Failed to prepare background sync:`, error);
      }

      return { messageId: info.messageId }; // Exit function successfully
    } catch (error: any) {
      lastError = error;
      const isTransient = error.code === 'ECONNECTION' || error.code === 'ETIMEDOUT' || error.responseCode >= 400 && error.responseCode < 500;

      if (!isTransient || attempt === MAX_RETRIES) {
        console.error(`[CustomSMTP] ❌ Permanent failure sending to`, to, ':', error.message);
        throw error;
      }
      console.warn(`[CustomSMTP] ⚠️ Transient failure (Attempt ${attempt + 1}):`, error.message);
    }
  }

  throw lastError || new Error('Failed to send email after retries');
}


/**
 * Import emails from custom IMAP server
 */
export async function importCustomEmails(
  config: EmailConfig,
  limit: number = 50,
  timeoutMs: number = 120000,
  mailbox: string = 'INBOX'
): Promise<ImportedEmail[]> {
  const Imap = (await import('imap')).default;
  const { simpleParser } = await import('mailparser');

  const imapHost = config.imap_host || config.smtp_host?.replace('smtp', 'imap') || '';
  const imapPort = config.imap_port || 993;

  if (!imapHost) {
    throw new Error('IMAP host not configured. Please provide explicit IMAP settings.');
  }

  const MAX_RETRIES = 3;
  const BASE_DELAY = 1000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await new Promise((resolve, reject) => {
        let timeoutHandle: NodeJS.Timeout | null = null;
        let completed = false;
        let connectionEnded = false;

        const imap = new Imap({
          user: config.smtp_user!,
          password: config.smtp_pass!,
          host: imapHost,
          port: imapPort,
          tls: imapPort === 993,
          // Force IPv4 to avoid EDNS / EAI_AGAIN DNS failures in cloud environments
          family: 4,
          tlsOptions: { rejectUnauthorized: false },
          connTimeout: 45000, // Increased to 45s
          authTimeout: 45000, // Increased to 45s
          keepalive: false,   // Disable keepalive for one-off fetch
          debug: (msg: string) => {
            if (msg.includes('ENOTFOUND') || msg.includes('EAI_AGAIN')) return;
            // console.log(`[IMAP DEBUG] ${msg}`); // Uncomment for debugging
          }
        } as any);

        const safeEnd = () => {
          try {
            if (imap.state !== 'disconnected') imap.end();
          } catch (err) {
            // Ignore
          }
        };

        const cleanup = () => {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
          }
        };

        const emails: ImportedEmail[] = [];

        const startFetch = (targetBox: any) => {
          if (!targetBox || !targetBox.messages || targetBox.messages.total === 0) {
            safeEnd();
            return;
          }
          const total = targetBox.messages.total;
          const fetchRange = total <= limit ? `1:${total}` : `${total - limit + 1}:${total}`;
          const fetch = imap.seq.fetch(fetchRange, { bodies: '', struct: true });

          fetch.on('message', (msg: any) => {
            msg.on('body', (stream: NodeJS.ReadableStream) => {
              simpleParser(stream as any, (parseErr: Error | null, parsed: any) => {
                if (!parseErr && parsed) {
                  emails.push({
                    from: parsed.from?.text,
                    to: parsed.to?.text,
                    subject: parsed.subject,
                    text: parsed.text,
                    html: parsed.html,
                    date: parsed.date
                  });
                }
              });
            });
          });

          fetch.once('error', (err: Error) => {
            cleanup();
            safeEnd();
            reject(new Error(`Failed to fetch emails: ${err.message}`));
          });

          fetch.once('end', () => {
            safeEnd();
          });
        };

        imap.once('ready', () => {
          // @ts-ignore
          imap.openBox(mailbox, true, async (err: Error | null, box: any) => {
            if (err) {
              // If folder not found, try with INBOX. prefix
              if (!mailbox.startsWith('INBOX.') && err.message.toLowerCase().includes('nonexistent')) {
                const prefixedMailbox = `INBOX.${mailbox}`;
                console.log(`[IMAP] Folder ${mailbox} not found, retrying with ${prefixedMailbox}`);
                imap.openBox(prefixedMailbox, true, (err3, box3) => {
                  if (!err3) {
                    startFetch(box3);
                  } else {
                    handleOpenError(err); // Original error
                  }
                });
                return;
              }
              handleOpenError(err);
            } else {
              startFetch(box);
            }
          });

          async function handleOpenError(handleErr: Error) {
            if (mailbox === 'Sent' || mailbox === 'Sent Items') {
              try {
                const boxes: any = await new Promise((res, rej) => imap.getBoxes((e, b) => e ? rej(e) : res(b)));
                const sentPatterns = ['sent', 'sent items', 'sent mail', 'sent messages', '[gmail]/sent mail', 'sent-mail'];

                const findBox = (obj: any, prefix = ''): string | null => {
                  for (const key in obj) {
                    const fullName = prefix + key;
                    if (sentPatterns.includes(key.toLowerCase())) return fullName;
                    if (obj[key].children) {
                      const found = findBox(obj[key].children, fullName + (obj[key].delimiter || '/'));
                      if (found) return found;
                    }
                  }
                  return null;
                };

                const discoveredSent = findBox(boxes);
                if (discoveredSent) {
                  console.log(`[IMAP] Discovered Sent folder: ${discoveredSent}`);
                  imap.openBox(discoveredSent, true, (err2, box2) => {
                    if (err2) {
                      cleanup(); safeEnd();
                      reject(new Error(`Failed to open discovered box ${discoveredSent}: ${err2.message}`));
                    } else {
                      startFetch(box2);
                    }
                  });
                  return;
                }
              } catch (e) {
                console.warn('[IMAP] Sent discovery failed', e);
              }
            }
            cleanup();
            safeEnd();
            reject(new Error(`Failed to open ${mailbox}: ${handleErr.message}`));
          }
        });

        imap.once('error', (err: Error) => {
          if (!completed) {
            cleanup();
            // Don't safeEnd here necessarily, as error might have closed it
            connectionEnded = true;

            let errorMessage = `IMAP connection error: ${err.message}`;
            if (err.message.toLowerCase().includes('enotfound') || err.message.toLowerCase().includes('not found')) {
              errorMessage = `IMAP Host not found: "${config.imap_host}". Please check the hostname and try again.`;
            } else if (err.message.toLowerCase().includes('etimedout') || err.message.toLowerCase().includes('timeout')) {
              errorMessage = `Connection to IMAP server timed out. Check your firewall settings or port ${imapPort}.`;
            } else if (err.message.toLowerCase().includes('econnrefused')) {
              errorMessage = `IMAP Connection refused by the server. Verify your port ${imapPort} and SSL settings.`;
            }
            reject(new Error(errorMessage));
          }
        });

        imap.once('end', () => {
          if (!completed) {
            cleanup();
            connectionEnded = true;
            resolve(emails);
          }
        });

        imap.connect();
      });
    } catch (error: any) {
      const isLastAttempt = attempt === MAX_RETRIES;
      const isTimeout = error.message.includes('tim') || error.message.includes('TIM'); // catch timeout, ETIMEDOUT, etc.

      if (!isLastAttempt && (isTimeout || error.message.includes('ECONNRESET') || error.message.includes('socket hang up'))) {
        console.warn(`[IMAP] Attempt ${attempt} failed for ${config.smtp_user}: ${error.message}. Retrying in ${BASE_DELAY * attempt}ms...`);
        await new Promise(res => setTimeout(res, BASE_DELAY * attempt));
        continue;
      }

      // If we're out of retries or it's a fatal error, rethrow or return empty based on policy
      if (isLastAttempt) {
        console.error(`[IMAP] All ${MAX_RETRIES} attempts failed for ${config.smtp_user}: ${error.message}`);
        // We resolve empty to avoid crashing the worker, but log the error
        return [];
      }
      throw error; // Propagate other errors
    }
  }
  return [];
}

/**
 * Get brand colors from user's extracted PDF data
 */
async function getUserBrandColors(userId: string): Promise<BrandColors | undefined> {
  try {
    const user = await storage.getUser(userId);
    if (!user) return undefined;

    const metadata = user.metadata as Record<string, unknown> | undefined;
    if (!metadata) return undefined;

    // Check for brand colors from PDF extraction (stored in brand_colors or extracted_brand)
    const brandColors = metadata.brand_colors as Record<string, string> | undefined;
    const extractedBrand = metadata.extracted_brand as { colors?: Record<string, string> } | undefined;

    // Priority: explicit brand_colors > extracted_brand.colors
    const colors = brandColors || extractedBrand?.colors;

    if (colors && (colors.primary || colors.accent || colors.secondary)) {
      return {
        primary: colors.primary || colors.accent || '#3B82F6',
        accent: colors.accent || colors.secondary || colors.primary || '#10B981',
      };
    }

    return undefined;
  } catch (error) {
    console.error('Error fetching brand colors:', error);
    return undefined;
  }
}

// Re-adding missing interface due to previous edit error
export interface EmailOptions {
  isRaw?: boolean; // If true, sends content as-is without branded wrapper
  trackingId?: string;
  brandColors?: BrandColors;
  businessName?: string;
  buttonUrl?: string;
  buttonText?: string;
  isMeetingInvite?: boolean;
  isHtml?: boolean;
  campaignId?: string;
  leadId?: string;
  integrationId?: string;
}

/**
 * Send email using appropriate provider with optional branding
 * Priority: custom_email (user's SMTP) > gmail > outlook
 */
export async function sendEmail(
  userId: string,
  recipientEmail: string,
  content: string,
  subject: string,
  options: EmailOptions = {}
): Promise<{ messageId: string }> {
  // 1. Fetch Integration (Specific or Fallback)
  let integration: Integration | undefined;
  if (options.integrationId) {
    integration = await storage.getIntegrationById(options.integrationId);
  }

  // 1.1. Robust Fallback: If requested integration is disconnected or missing, find ANY working one for this user
  if (!integration || !integration.connected) {
    const integrations = await storage.getIntegrations(userId);
    const fallback = integrations.find(i =>
      ['custom_email', 'gmail', 'outlook'].includes(i.provider) && i.connected
    );
    
    if (fallback) {
      if (integration) console.warn(`[EmailService] Integration ${integration.id} is disconnected. Falling back to ${fallback.id}.`);
      integration = fallback;
    }
  }

  if (!integration) {
    throw new Error('Email not connected. Please connect your business email in Settings.');
  }

  // 1.2. Check for infrastructure-level pause (ENETUNREACH cooldown)
  if (integration.mailboxPauseUntil && new Date(integration.mailboxPauseUntil) > new Date()) {
    throw new MailboxPausedError(new Date(integration.mailboxPauseUntil));
  }

  // 1.5. Check Daily Sending Limits (Gmail: 500, Custom: 2500)
  try {
    const { db } = await import('@shared/lib/db/db.js');
    const { messages } = await import('@audnix/shared');
    const { eq, and, sql } = await import('drizzle-orm');
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const [sentToday] = await db.select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(and(
        eq(messages.userId, userId),
        eq(messages.integrationId, integration.id),
        eq(messages.direction, 'outbound'),
        sql`${messages.createdAt} >= ${today.toISOString()}`
      ));
    
    // Fetch user Tier to enforce dynamic limits
    const user = await storage.getUser(userId);
    const tier = (user?.subscriptionTier || user?.plan || 'starter').toLowerCase();
    
    // Hardcoded limits (Gmail: 500, Custom: 2500). Enterprise is Unlimited (-1)
    let dailyLimit = integration.provider === 'gmail' || integration.provider === 'outlook' ? 500 : 2500;
    
    // Override for Enterprise
    if (tier === 'enterprise') {
      dailyLimit = 100000; // Effectively unlimited for a single mailbox
      console.log(`[EmailService] 🚀 Enterprise tier detected for ${user?.email}. Scaling daily capacity to 100k.`);
    }

    const currentSent = Number(sentToday?.count || 0);
    
    if (currentSent >= dailyLimit) {
      console.warn(`[EmailService] 🛑 Daily limit reached for ${integration.provider} (${currentSent}/${dailyLimit}). Skipping send to ${recipientEmail}.`);
      throw new Error(`Daily sending limit reached (${dailyLimit}).`);
    }
  } catch (limitErr: any) {
    if (limitErr.message.includes('limit reached')) throw limitErr;
    console.error("[EmailService] Limit check failed, continuing anyway:", limitErr);
  }

  // Tracking Setup
  const trackingId = options.trackingId || (await (await import('@services/email-service/src/email/email-tracking.js')).generateTrackingToken());
  const brandColors = options.brandColors || await getUserBrandColors(userId);
  const user = await storage.getUser(userId);
  const businessName = options.businessName || user?.businessName || user?.company || 'Our Team';

  // --- PART 1: Custom SMTP ---
  if (integration.provider === 'custom_email') {
    const { decrypt } = await import('@shared/lib/crypto/encryption.js');
    if (!integration.encryptedMeta) throw new Error('Email credentials missing');
    const credentials = JSON.parse(await decrypt(integration.encryptedMeta)) as EmailConfig;

    let emailBody = content;
    if (!options.isRaw) {
      if (options.buttonUrl && options.buttonText) {
        emailBody = options.isMeetingInvite
          ? generateMeetingEmail(content, options.buttonUrl, brandColors, businessName)
          : generateBrandedEmail(content, { text: options.buttonText, url: options.buttonUrl }, brandColors, businessName);
      } else {
        emailBody = generateBrandedEmail(content, { text: 'View Details', url: 'https://audnixai.com' }, brandColors, businessName);
      }
    }

    const { injectTrackingIntoEmail, createTrackedEmail } = await import('@services/email-service/src/email/email-tracking.js');
    const trackingResult = await injectTrackingIntoEmail(emailBody, trackingId);
    emailBody = trackingResult.html;
    const firstUrl = trackingResult.urls.length > 0 ? trackingResult.urls.join(',') : null;

    await createTrackedEmail({
      userId,
      leadId: options.leadId || undefined,
      integrationId: integration.id,
      recipientEmail,
      subject,
      sentAt: new Date(),
      messageId: trackingId,
      targetUrl: firstUrl || undefined
    });

    const result = await sendCustomSMTP(userId, credentials, recipientEmail, subject, emailBody, true, trackingId, integration.id);

    if (result?.messageId) {
      await storage.createEmailMessage({
        userId,
        leadId: options.leadId || null,
        campaignId: options.campaignId || null,
        messageId: result.messageId,
        subject,
        from: credentials.smtp_user || '',
        to: recipientEmail,
        body: emailBody,
        direction: 'outbound',
        provider: 'custom_email',
        sentAt: new Date(),
        targetUrl: firstUrl,
        metadata: { trackingId, integrationId: integration.id }
      });
    }
    return result;
  }

  // --- PART 2: OAuth (Gmail/Outlook) ---
  const { generateEmailSubject } = await import('./email-subject-generator.js');
  const emailSubject = subject || await generateEmailSubject(userId, content);

  let emailBody = content;

  if (!options.isRaw) {
    if (options.buttonUrl && options.buttonText) {
      if (options.isMeetingInvite) {
        emailBody = generateMeetingEmail(
          content,
          options.buttonUrl,
          brandColors,
          businessName
        );
      } else {
        emailBody = generateBrandedEmail(
          content,
          { text: options.buttonText, url: options.buttonUrl },
          brandColors,
          businessName
        );
      }
      options.isHtml = true;
    } else {
      emailBody = generateBrandedEmail(content, { text: 'View Details', url: 'https://audnixai.com' }, brandColors, businessName);
      options.isHtml = true;
    }
  } else {
    options.isHtml = true;
  }

  // Apply tracking pixel and link wrapping for OAuth providers
  const { injectTrackingIntoEmail, createTrackedEmail } = await import('@services/email-service/src/email/email-tracking.js');
  const trackingResult = await injectTrackingIntoEmail(emailBody, trackingId);
  emailBody = trackingResult.html;
  const firstUrl = trackingResult.urls.length > 0 ? trackingResult.urls.join(',') : null;

  // Create the tracking record
  await createTrackedEmail({
    userId,
    leadId: options.leadId || undefined,
    integrationId: integration.id,
    recipientEmail,
    subject: emailSubject,
    sentAt: new Date(),
    messageId: trackingId,
    targetUrl: firstUrl || undefined
  });

  const { GmailOAuth } = await import('@services/api-gateway/src/oauth/gmail.js');
  const { OutlookOAuth } = await import('@services/api-gateway/src/oauth/outlook.js');

  let accessToken: string | null = null;
  let fromEmail: string | undefined;

  if (integration.provider === 'gmail') {
    const gmailOAuth = new GmailOAuth();
    fromEmail = integration.accountType || undefined;
    accessToken = await gmailOAuth.getValidToken(userId, fromEmail);
  } else if (integration.provider === 'outlook') {
    const outlookOAuth = new OutlookOAuth();
    accessToken = await outlookOAuth.getValidToken(userId);
    fromEmail = integration.accountType || undefined;
  }

  if (!accessToken) {
    throw new Error('Invalid email credentials or token expired');
  }

  const credentials = {
    accessToken,
    email: fromEmail || ''
  };

  if (integration.provider === 'gmail') {
    const result = await sendGmailMessage(
      credentials,
      recipientEmail,
      emailSubject,
      emailBody,
      options.isHtml,
      trackingId
    );
    if (result && result.messageId) {
      await storage.createEmailMessage({
        userId,
        leadId: options.leadId || null,
        campaignId: options.campaignId || null,
        messageId: result.messageId,
        subject: emailSubject,
        from: credentials.email || '',
        to: recipientEmail,
        body: emailBody,
        direction: 'outbound',
        provider: 'gmail',
        sentAt: new Date(),
        targetUrl: firstUrl,
        metadata: { trackingId, integrationId: integration.id }
      });
    }
    return result;
  } else if (integration.provider === 'outlook') {
    const result = await sendOutlookMessage(
      credentials,
      recipientEmail,
      emailSubject,
      emailBody,
      options.isHtml,
      trackingId
    );
    if (result && result.messageId) {
      await storage.createEmailMessage({
        userId,
        leadId: options.leadId || null,
        campaignId: options.campaignId || null,
        messageId: result.messageId || `outlook-${Date.now()}`,
        subject: emailSubject,
        from: credentials.email || '',
        to: recipientEmail,
        body: emailBody,
        direction: 'outbound',
        provider: 'outlook',
        sentAt: new Date(),
        targetUrl: firstUrl,
        metadata: { trackingId, integrationId: integration.id }
      });
    }
    return result;
  } else {
    throw new Error('Unsupported email provider');
  }
}

/**
 * Send email via Gmail API
 */
async function sendGmailMessage(
  credentials: EmailCredentials,
  to: string,
  subject: string,
  body: string,
  isHtml: boolean = false,
  trackingId?: string
): Promise<{ messageId: string }> {
  const emailBody = body;

  const message = createMimeMessage(credentials.email, to, subject, emailBody, isHtml);
  const encodedMessage = Buffer.from(message).toString('base64url');

  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${credentials.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      raw: encodedMessage
    })
  });

  const data = await response.json() as GmailSendResponse;
  if (!response.ok) {
    throw new Error(data.error?.message || 'Failed to send Gmail');
  }

  return { messageId: data.id || '' };
}

/**
 * Send email via Outlook/Microsoft Graph API
 */
async function sendOutlookMessage(
  credentials: EmailCredentials,
  to: string,
  subject: string,
  body: string,
  isHtml: boolean = false,
  trackingId?: string
): Promise<{ messageId: string }> {
  const emailBody = body;

  const response = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${credentials.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        subject: subject,
        body: {
          contentType: isHtml ? 'HTML' : 'Text',
          content: emailBody
        },
        toRecipients: [
          {
            emailAddress: {
              address: to
            }
          }
        ]
      },
      saveToSentItems: true
    })
  });

  if (!response.ok) {
    const data = await response.json() as OutlookSendResponse;
    throw new Error(data.error?.message || 'Failed to send Outlook email');
  }

  // Outlook doesn't return the message ID in the sendMail response (202 Accepted)
  // We return null/empty and rely on IMAP sync for the ID if needed later
  return { messageId: '' };
}

/**
 * Create MIME message for Gmail with HTML support
 */
function createMimeMessage(
  from: string,
  to: string,
  subject: string,
  body: string,
  isHtml: boolean = false,
  messageId?: string
): string {
  const boundary = '----=_Part_' + Date.now();

  const stripHtml = (html: string): string => {
    if (!html) return '';
    try {
      const $ = cheerio.load(html);

      // Remove dangerous tags
      $('script, style, iframe, object, embed, link').remove();

      // Get text content
      let text = $.text();

      return text.replace(/\s+/g, ' ').trim();
    } catch (e) {
      // Fallback for environment issues, though cheerio should work
      return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
  };

  const parts = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    messageId ? `Message-ID: ${messageId}` : `Message-ID: <${Date.now()}@audnixai.com>`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    isHtml ? stripHtml(body) : body,
    ''
  ];

  if (isHtml) {
    parts.push(
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      '',
      body,
      ''
    );
  }

  parts.push(`--${boundary}--`);

  return parts.join('\r\n');
}

/**
 * Get email inbox messages
 */
export async function getEmailInbox(
  userId: string,
  limit: number = 20
): Promise<GmailMessage[] | OutlookMessage[]> {
  const integrations = await storage.getIntegrations(userId);
  const emailIntegration = integrations.find(i =>
    ['gmail', 'outlook'].includes(i.provider) && i.connected
  );

  if (!emailIntegration) {
    throw new Error('Email not connected');
  }

  const { GmailOAuth } = await import('@services/api-gateway/src/oauth/gmail.js');
  const { OutlookOAuth } = await import('@services/api-gateway/src/oauth/outlook.js');

  let accessToken: string | null = null;
  let emailAddress: string | undefined = emailIntegration.accountType || undefined;

  if (emailIntegration.provider === 'gmail') {
    const gmailOAuth = new GmailOAuth();
    accessToken = await gmailOAuth.getValidToken(userId);
  } else if (emailIntegration.provider === 'outlook') {
    const outlookOAuth = new OutlookOAuth();
    accessToken = await outlookOAuth.getValidToken(userId);
  }

  if (!accessToken) {
    throw new Error('Invalid email credentials');
  }

  if (emailIntegration.provider === 'gmail') {
    return await getGmailInbox({ accessToken, email: emailAddress || '' }, limit);
  } else if (emailIntegration.provider === 'outlook') {
    return await getOutlookInbox({ accessToken, email: emailAddress || '' }, limit);
  }

  return [];
}

/**
 * Get Gmail inbox
 */
async function getGmailInbox(credentials: { accessToken: string, email: string }, limit: number): Promise<GmailMessage[]> {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${limit}`, {
    headers: {
      'Authorization': `Bearer ${credentials.accessToken}`
    }
  });

  const data = await response.json() as GmailApiResponse;

  if (!response.ok) {
    throw new Error(data.error?.message || 'Failed to get Gmail inbox');
  }

  return data.messages || [];
}

/**
 * Get Outlook inbox
 */
async function getOutlookInbox(credentials: { accessToken: string, email: string }, limit: number): Promise<OutlookMessage[]> {
  const response = await fetch(`https://graph.microsoft.com/v1.0/me/messages?$top=${limit}&$orderby=receivedDateTime desc`, {
    headers: {
      'Authorization': `Bearer ${credentials.accessToken}`
    }
  });

  const data = await response.json() as OutlookApiResponse;

  if (!response.ok) {
    throw new Error(data.error?.message || 'Failed to get Outlook inbox');
  }

  return data.value || [];
}

/**
 * Send internal system notifications (e.g. mailbox failures)
 * using a dedicated high-deliverability account.
 */
export async function sendSystemEmail(
  to: string,
  subject: string,
  content: string
): Promise<boolean> {
  const host = process.env.SYSTEM_SMTP_HOST;
  const port = parseInt(process.env.SYSTEM_SMTP_PORT || '587');
  const user = process.env.SYSTEM_SMTP_USER;
  const pass = process.env.SYSTEM_SMTP_PASS;

  if (!host || !user || !pass) {
    console.warn('[Email] SYSTEM_SMTP credentials missing - skipping system email alert');
    return false;
  }

  try {
    const { createTransport } = await import('nodemailer');
    const transporter = createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      // Force IPv4 — production environment has no IPv6 route
      family: 4,
      tls: { rejectUnauthorized: false },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
    } as any);

    await transporter.sendMail({
      from: `"Audnix AI Support" <${user}>`,
      to,
      subject,
      html: content
    });

    console.log(`[Email] ✅ System email alert sent to ${to}`);
    return true;
  } catch (err: any) {
    console.error('[Email] ❌ Failed to send system email:', err.message);
    return false;
  }
}



