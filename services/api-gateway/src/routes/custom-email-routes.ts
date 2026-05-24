import { Router, Request, Response } from 'express';
import { requireAuth, getCurrentUserId } from '../middleware/auth.js';
import { storage } from '@shared/lib/storage/storage.js';
import { encrypt } from '@shared/lib/crypto/encryption.js';
import { pagedEmailImport } from '@shared/lib/imports/paged-email-importer.js';
import { smtpAbuseProtection } from '@services/email-service/src/email/smtp-abuse-protection.js';
import { bounceHandler } from '@services/email-service/src/email/bounce-handler.js';
import { EmailDiscoveryService } from '@services/email-service/src/email/email-discovery.js';
import { checkDomainHealth } from '@shared/lib/deliverability/dns-health-checker.js';
import validator from 'validator';

const router = Router();

/**
 * Auto-discover SMTP/IMAP settings
 */
router.post('/discover', requireAuth, async (req: Request, res: Response) => {
  try {
    let { email } = req.body;
    email = email?.trim();
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const result: any = await EmailDiscoveryService.discoverSettings(email);
    if (!result) return res.json({ provider: 'custom', suggestedName: EmailDiscoveryService.suggestNameFromEmail(email) });
    
    const settings = { ...result };
    const domain = email.split('@')[1]?.toLowerCase();
    if (domain) {
      if (domain.includes('gmail.com') || domain.includes('googlemail.com')) {
        settings.appPasswordGuide = {
            provider: 'Google / Gmail',
            instructions: 'Google **strictly requires** an App Password for SMTP/IMAP connections when 2nd-Step Verification is enabled. Your regular login password will NOT work.',
            link: 'https://myaccount.google.com/apppasswords',
            steps: [
              'Log in to your Google Account settings.',
              'Search for "App Passwords" in the search bar.',
              'App name: "Audnix AI" (or similar).',
              'Copy the 16-character code (no spaces) into the Password field below.'
            ]
        };
      } else if (domain.includes('outlook.com') || domain.includes('hotmail.com') || domain.includes('live.com') || domain.includes('msn.com') || domain.includes('office365.com')) {
        settings.appPasswordGuide = {
            provider: 'Microsoft / Outlook',
            instructions: 'Personal Outlook/Hotmail accounts with 2-Step Verification require an App Password.',
            link: 'https://account.live.com/proofs/AppPassword',
            steps: [
              'Log in to your Microsoft Account.',
              'Security > Advanced security options.',
              'Click "Create a new app password".',
              'Copy the unique code into the Password field below.'
            ]
        };
      } else if (domain.includes('zoho.')) {
        settings.appPasswordGuide = {
          provider: 'Zoho Mail',
          instructions: 'Zoho requires an Application-Specific Password for 2FA-enabled accounts.',
          link: 'https://accounts.zoho.com/home#security/app_password',
          steps: [
            'Log in to Zoho Accounts.',
            'Security > App Passwords.',
            'Generate a new password for "Audnix AI".'
          ]
        };
      }
    }

    res.json(settings);
  } catch (error) {
    console.error('[Email Discovery] Error:', error);
    return res.status(500).json({ error: 'Discovery failed' });
  }
});


// Common SMTP hostname typos and their corrections
const HOSTNAME_TYPO_MAP: Record<string, string> = {
  'hostlinger.com': 'hostinger.com',
  'hostlinger.io': 'hostinger.com',
  'hostimer.com': 'hostinger.com',
  'goggle.com': 'google.com',
  'gogle.com': 'google.com',
  'outllook.com': 'outlook.com',
  'outook.com': 'outlook.com',
};

function getSmtpErrorDetails(error: any, host: string): { error: string; details: string; tip: string } {
  const code = error?.code || '';
  const hostDomain = host.replace(/^(smtp|imap|mail)\./, '');
  const suggestedDomain = HOSTNAME_TYPO_MAP[hostDomain];
  const typoHint = suggestedDomain
    ? ` It looks like "${host}" may be a typo — did you mean "${host.replace(hostDomain, suggestedDomain)}"?`
    : '';

  // DNS resolution failures (EDNS = EDNS0 query failure, EAI_AGAIN = DNS temp failure)
  if (code === 'EDNS' || code === 'EAI_AGAIN' || code === 'ENOTFOUND') {
    const isDns = code === 'EDNS' || code === 'EAI_AGAIN';
    return {
      error: `DNS resolution failed for "${host}".${typoHint}`,
      details: isDns
        ? `The server could not resolve the hostname "${host}" due to a DNS error (${code}). This is likely a temporary DNS issue or an IPv6 resolution problem on the server.`
        : `DNS lookup failed for "${host}". The hostname does not exist or is misspelled.`,
      tip: typoHint
        ? `Check for typos in the hostname.${typoHint}`
        : `Verify the SMTP hostname is correct (e.g. mail.privateemail.com). If the hostname looks right, this is usually a temporary DNS issue on our servers — please try again in a few minutes.`
    };
  }

  if (code === 'ETIMEDOUT' || code === 'ESOCKET' || code === 'ECONNREFUSED') {
    const isPort25 = error.port === 25;
    return {
      error: `Connection failed to ${host} on port ${error.port || 'unknown'}.${typoHint}`,
      details: isPort25 
        ? `Port 25 is frequently blocked by hosting providers (like Railway, AWS, DigitalOcean) to prevent spam. Please try using port 587 or 465 instead.`
        : `The server at ${host} did not respond on any port (465, 587, 2525). This usually means outbound SMTP ports are blocked by the hosting provider's firewall.`,
      tip: typoHint
        ? `Check for typos in the hostname.${typoHint}`
        : (isPort25 ? 'Switch to port 587 (STARTTLS) or 465 (SSL/TLS).' : 'Your hosting provider may be blocking outbound SMTP ports. Consider using Mailgun or SendGrid as a relay, or check your provider\'s firewall rules.')
    };
  }

  if (code === 'EHOSTUNREACH') {
    return {
      error: `Cannot reach ${host}.${typoHint}`,
      details: `The server at ${host} is unreachable. It may be down or the hostname may be incorrect.`,
      tip: typoHint
        ? `Check for typos.${typoHint}`
        : 'Verify the SMTP hostname is correct and the server is online.'
    };
  }

  if (code === 'EAUTH' || error?.responseCode === 535) {
    return {
      error: 'Authentication failed. Please check your password.',
      details: error.message,
      tip: 'If you have Two-Factor Authentication (2FA) enabled, you MUST use an **App Password**. Regular account passwords will not work. Check your email provider settings to generate one.'
    };
  }

  // Generic fallback
  return {
    error: 'Connection failed. Please verify your settings.',
    details: error.message || String(error),
    tip: 'Check your SMTP host, port, email, and password. If you have 2FA enabled, use an App Password.'
  };
}

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

interface ImportedEmailData {
  from?: string;
  to?: string;
  subject?: string;
  text?: string;
  html?: string;
  date?: Date;
}

interface EmailForImport {
  from: string;
  subject: string | undefined;
  text: string;
  date: Date | undefined;
  html: string | undefined;
}

interface ConnectRequestBody {
  smtpHost: string;
  smtpPort: string;
  imapHost: string;
  imapPort: string;
  email: string;
  password: string;
  fromName?: string;
}

/**
 * Connect custom email domain
 */
router.post('/connect', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    let { smtpHost, smtpPort, imapHost, imapPort, email, password, fromName } = req.body as ConnectRequestBody;

    // Sanitize inputs to prevent trailing copy-paste spaces from failing validation
    smtpHost = smtpHost?.trim();
    imapHost = imapHost?.trim() || '';
    email = email?.trim();
    password = password?.trim();
    fromName = fromName?.trim();

    // ── Basic format validation only — no network calls ──────────────────────
    // Railway and many cloud providers block all outbound SMTP ports (25/465/587/2525)
    // at the infrastructure level. Doing a live TCP/SMTP check from the server will
    // ALWAYS fail regardless of whether the user's credentials are correct.
    // The real credential test happens on first send (same as Thunderbird / Apple Mail).
    if (!smtpHost || !email || !password) {
      console.warn(`[Email Connect] Missing required fields for user ${userId}`);
      res.status(400).json({ error: 'Missing required fields (SMTP host, email, password)' });
      return;
    }

    // Basic email format check
    if (!validator.isEmail(email)) {
      res.status(400).json({ error: 'Invalid email address format.' });
      return;
    }

    // Basic hostname check — must look like a domain
    const hostRegex = /^[a-zA-Z0-9]([a-zA-Z0-9\-\.]+)?[a-zA-Z0-9]$/;
    if (!hostRegex.test(smtpHost)) {
      res.status(400).json({ error: `"${smtpHost}" does not look like a valid SMTP hostname.` });
      return;
    }

    // Validate port range
    const parsedSmtpPort = parseInt(smtpPort) || 587;
    if (parsedSmtpPort < 1 || parsedSmtpPort > 65535) {
      res.status(400).json({ error: `SMTP port ${smtpPort} is not valid. Common values: 465, 587, 2525.` });
      return;
    }

    // ── Enforce mailbox limits ────────────────────────────────────────────────
    const limitCheck = await storage.checkMailboxLimit(userId);
    if (!limitCheck.allowed) {
      console.warn(`[Email Connect] User ${userId} reached mailbox limit (${limitCheck.current}/${limitCheck.limit}) for plan ${limitCheck.plan}`);
      res.status(403).json({
        error: "Mailbox limit reached",
        details: `Your current plan (${limitCheck.plan}) allows up to ${limitCheck.limit} mailboxes. You already have ${limitCheck.current} connected.`,
        tip: "Upgrade to a higher plan to add more mailboxes."
      });
      return;
    }

    // ── Build and save credentials ────────────────────────────────────────────
    const effectiveImapHost = imapHost || smtpHost.replace(/^smtp\./i, 'imap.');
    const parsedImapPort = parseInt(imapPort) || 993;

    const credentials: EmailConfig = {
      smtp_host:  smtpHost,
      smtp_port:  parsedSmtpPort,
      imap_host:  effectiveImapHost,
      imap_port:  parsedImapPort,
      smtp_user:  email,
      smtp_pass:  password,
      from_name:  fromName || '',
      provider:   'custom'
    };

    console.log(`[Email Connect] Saving ${email} — SMTP ${smtpHost}:${parsedSmtpPort} / IMAP ${effectiveImapHost}:${parsedImapPort}`);

    let encryptedMeta: string;
    try {
      encryptedMeta = await encrypt(JSON.stringify(credentials));
    } catch (encryptError: unknown) {
      const msg = encryptError instanceof Error ? encryptError.message : 'Encryption failed';
      console.error(`[Email Connect] Encryption error:`, encryptError);
      res.status(500).json({ error: 'Failed to securely store credentials', details: msg });
      return;
    }

    // Attempt DNS Health Check
    let dnsHealth = undefined;
    try {
      const emailDomain = email.split('@')[1];
      if (emailDomain) {
        dnsHealth = await checkDomainHealth(emailDomain);
      }
    } catch (e) {
      console.warn('[Email Connect] DNS Health Check failed', e);
    }

    try {
      await storage.createIntegration({
        userId,
        provider: 'custom_email',
        encryptedMeta,
        connected: true,
        accountType: email,
      });
    } catch (dbError: unknown) {
      const msg = dbError instanceof Error ? dbError.message : 'Database error';
      console.error(`[Email Connect] Storage error:`, dbError);
      res.status(500).json({ error: 'Failed to save email configuration', details: msg });
      return;
    }

    console.log(`[Email Connect] ✅ Email account saved for user ${userId}`);

    // ── Trigger background sync (fire-and-forget) ────────────────────────────
    try {
      const { imapIdleManager } = await import('@services/email-service/src/email/imap-idle-manager.js');
      imapIdleManager.syncConnections();

      const { distributeLeadsFromPool } = await import('@services/outreach-worker/src/sales-engine/outreach-engine.js');
      const integrations = await storage.getIntegrations(userId);
      const customEmail = integrations.find((i: any) => i.provider === 'custom_email' && i.accountType === email);
      if (customEmail) {
        distributeLeadsFromPool(userId, customEmail.id).catch(err =>
          console.error('[Email Connect] Lead distribution failed:', err)
        );
        const { notifyMailboxConnected } = await import('@shared/lib/queues/verification-routing-queue.js');
        notifyMailboxConnected(userId, customEmail.id).catch(err =>
          console.error('[Email Connect] Smart reroute failed:', err)
        );
      }
    } catch (idleErr) {
      console.warn('[Email Connect] Could not trigger background sync:', idleErr);
    }

    // ── Real-time frontend update ────────────────────────────
    try {
      const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
      wsSync.notifySettingsUpdated(userId);
      wsSync.notifySyncStatus(userId, { syncing: true });
    } catch (e) {
      console.warn('[Email Connect] Could not notify frontend via websocket:', e);
    }

    res.json({
      success: true,
      smtpVerified: false, // verified at send-time, not connection-time
      message: `${email} connected successfully. Your first outbound email will confirm the credentials are working.`,
      leadsImported: 0,
      leadsSkipped: 0,
      backgroundImport: true,
      dnsHealth
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Email Connect] Fatal error:`, error);
    res.status(500).json({
      error: 'Failed to connect custom email',
      details: errorMsg
    });
  }
});



/**
 * Import emails from custom domain (paged + abuse protection)
 */
router.post('/import', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;

    const abuseCheck = await smtpAbuseProtection.canSendEmail(userId);
    if (!abuseCheck.allowed) {
      res.status(429).json({
        error: abuseCheck.reason,
        retryAfter: abuseCheck.delay
      });
      return;
    }

    const integration = await storage.getIntegration(userId, 'custom_email');

    if (!integration) {
      res.status(400).json({ error: 'Custom email not connected' });
      return;
    }

    const { decrypt } = await import('@shared/lib/crypto/encryption.js');
    const credentialsStr = await decrypt(integration.encryptedMeta!);
    const credentials: EmailConfig = JSON.parse(credentialsStr);

    const { importCustomEmails } = await import('@shared/lib/channels/email.js');
    const emails: ImportedEmailData[] = await importCustomEmails(credentials, 100, 120000);

    const emailsForImport: EmailForImport[] = emails.map((emailData: ImportedEmailData) => ({
      from: emailData.from?.split('<')[1]?.split('>')[0] || emailData.from || '',
      subject: emailData.subject,
      text: emailData.text || emailData.html || '',
      date: emailData.date,
      html: emailData.html
    }));

    const importResults = await pagedEmailImport(userId, emailsForImport, (progress: number) => {
      console.log(`📧 Email import progress: ${progress}%`);
    });

    for (let i = 0; i < importResults.imported; i++) {
      smtpAbuseProtection.recordSend(userId);
    }

    const bounceStats = await bounceHandler.getBounceStats(userId);

    res.json({
      success: true,
      leadsImported: importResults.imported,
      leadsSkipped: importResults.skipped,
      errors: importResults.errors,
      bounceRate: bounceStats.bounceRate,
      message: `Import completed: ${importResults.imported} leads imported, ${importResults.skipped} skipped`
    });

    // Create notification for custom email import
    if (importResults.imported > 0) {
      try {
        await storage.createNotification({
          userId,
          type: 'lead_import',
          title: '\ud83d\udce5 Leads Imported',
          message: `${importResults.imported} leads imported from custom email`,
          metadata: { source: 'custom_email', count: importResults.imported }
        });
      } catch (notifErr) {
        console.warn('[Custom Email Import] Failed to create notification:', notifErr);
      }
    }
  } catch (error: unknown) {
    res.status(500).json({ error: 'Failed to import emails' });
    return;
  }
});

/**
 * Test SMTP connection without saving
 */
router.post('/test', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { smtpHost, smtpPort, email, password } = req.body;

    if (!smtpHost || !email || !password) {
      res.status(400).json({ error: 'Missing required fields (SMTP host, email, password)' });
      return;
    }

    console.log(`[Email Test] Testing SMTP connection to ${smtpHost}:${smtpPort || 587}`);

    const nodemailer = await import('nodemailer');
    const portsToTry = smtpPort ? [parseInt(smtpPort)] : [587, 465, 2525];
    let lastError: any;
    let successfulPort = null;

    for (const port of portsToTry) {
      console.log(`[Email Test] Trying port ${port}...`);
      try {
        const transporter = nodemailer.createTransport({
          host: smtpHost,
          port: port,
          secure: port === 465,
          auth: {
            user: email,
            pass: password,
          },
          family: 4,
          tls: {
            rejectUnauthorized: false
          },
          connectionTimeout: 10000,
          greetingTimeout: 10000,
          socketTimeout: 10000
        } as any);

        await transporter.verify();
        successfulPort = port;
        break; // Stop trying if successful
      } catch (err: any) {
        lastError = err;
        console.warn(`[Email Test] Port ${port} failed:`, err.message || err);
      }
    }

    if (!successfulPort) {
      throw lastError; // Throw the last error if all ports failed
    }

    console.log(`[Email Test] SMTP connection successful for ${email} on port ${successfulPort}`);

    const dnsHealth = await checkDomainHealth(email.split('@')[1]);

    res.json({
      success: true,
      message: 'SMTP connection verified successfully',
      port: successfulPort,
      dnsHealth
    });
  } catch (error: any) {
    console.error(`[Email Test] Connection failed:`, error?.message || error);
    
    // Specifically handle decryption failures which often cause timeout/hangs
    if (error?.message?.includes("Unsupported state") || error?.message?.includes("unable to authenticate data")) {
      res.status(400).json({
        error: "Decryption Failed",
        message: "The server failed to decrypt your credentials. This usually means the ENCRYPTION_KEY has changed or is missing. Please check your .env file.",
        code: "CRYPTO_ERROR"
      });
      return;
    }

    const errorInfo = getSmtpErrorDetails(error, req.body.smtpHost);
    res.status(400).json(errorInfo);
  }
});

/**
 * Disconnect custom email
 */
router.post('/disconnect', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { integrationId } = req.body;

    // Collect targeted integration IDs to disconnect
    const idsToDisconnect: string[] = [];
    if (integrationId) {
      idsToDisconnect.push(integrationId);
    } else {
      const allIntegrations = await storage.getIntegrations(userId);
      const customEmails = allIntegrations.filter(i => i.provider === 'custom_email');
      for (const i of customEmails) {
        idsToDisconnect.push(i.id);
      }
    }

    // 1. Immediately kill the IMAP connection locally BEFORE deleting from DB
    //    so we have the userId available for the forceDisconnect notification
    const { imapIdleManager } = await import('@services/email-service/src/email/imap-idle-manager.js');
    for (const targetId of idsToDisconnect) {
      imapIdleManager.forceDisconnect(targetId, userId);
    }

    // 2. Delete from database
    for (const targetId of idsToDisconnect) {
      await storage.deleteIntegrationById(targetId);
    }

    // 3. Broadcast to production workers via BullMQ queue
    try {
      const { Queue } = await import('bullmq');
      const { redisConnection, hasRedis } = await import('@shared/lib/queues/redis-config.js');
      if (hasRedis && redisConnection) {
        const imapTaskQueue = new Queue('imap-idle-tasks', {
          connection: redisConnection as any,
        });
        for (const targetId of idsToDisconnect) {
          await imapTaskQueue.add('DISCONNECT_MAILBOX', {
            type: 'DISCONNECT_MAILBOX',
            integrationId: targetId,
          }, { removeOnComplete: true, removeOnFail: true });
          console.log(`[CustomEmail] Broadcast DISCONNECT_MAILBOX BullMQ task for: ${targetId}`);
        }
        await imapTaskQueue.close();
      }
    } catch (queueErr: any) {
      console.warn('[CustomEmail] Non-fatal BullMQ disconnect broadcast error:', queueErr.message);
    }

    // 4. Real-time frontend update
    const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
    wsSync.notifySettingsUpdated(userId);
    wsSync.notifyLeadsUpdated(userId);
    wsSync.notifySyncStatus(userId, { syncing: false, integrationId, disconnected: true });

    res.json({
      success: true,
      message: 'Email account disconnected'
    });
  } catch (error: unknown) {
    res.status(500).json({ error: 'Failed to disconnect custom email' });
    return;
  }
});

/**
 * Get custom email status
 */
/**
 * GET /api/custom-email/status
 * Returns ALL connected email mailboxes: SMTP, Gmail, and Outlook.
 * This is the single endpoint the frontend uses to build the unified mailbox list.
 */
router.get('/status', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const allIntegrations = await storage.getIntegrations(userId);

    // Include ALL email-capable providers in the unified mailbox view
    // showing both connected and recently disconnected for cleanup
    const emailProviders = ['custom_email', 'gmail', 'outlook'];
    
    const { db } = await import('@shared/lib/db/db.js');
    const { leads: leadsSchema, messages: msgSchema } = await import('@audnix/shared');
    const { and, eq, sql } = await import('drizzle-orm');

    const mailboxes = await Promise.all(allIntegrations
      .filter(i => emailProviders.includes(i.provider))
      .map(async i => {
        // Fetch bouncy leads count for this integration
        const [bouncyRes] = await db.select({ count: sql<number>`count(*)` })
          .from(leadsSchema)
          .where(and(eq(leadsSchema.userId, userId), eq(leadsSchema.integrationId, i.id), eq(leadsSchema.status, 'bouncy')));
        
        // Fetch outreached leads count for this integration
        const [outreachedRes] = await db.select({ count: sql<number>`count(distinct ${msgSchema.leadId})` })
          .from(msgSchema)
          .where(and(eq(msgSchema.userId, userId), eq(msgSchema.integrationId, i.id), eq(msgSchema.direction, 'outbound')));

        const bouncy = Number(bouncyRes?.count || 0);
        const outreached = Number(outreachedRes?.count || 0);
        const calculatedBounceRate = outreached > 0 ? (bouncy / outreached) : 0;

        return {
          id: i.id,
          email: i.accountType,
          connected: i.connected,
          provider: i.provider, // 'custom_email' | 'gmail' | 'outlook'
          healthStatus: (i as any).healthStatus || 'connected',
          lastSync: i.lastSync,
          reputationScore: (i as any).reputationScore ?? null,
          bounceRate: calculatedBounceRate,
        };
      }));

    res.json({
      success: true,
      integrations: mailboxes,
      // Legacy single-mailbox fields for any existing UI that reads them
      connected: mailboxes.length > 0,
      email: mailboxes[0]?.email || null
    });
  } catch (error: unknown) {
    res.status(500).json({ error: 'Failed to get email status' });
    return;
  }
});


/**
 * Send a test email through connected SMTP
 */
/**
 * POST /api/custom-email/send-test
 * Send a test email through any connected mailbox.
 * Accepts optional `integrationId` to test a specific mailbox.
 */
router.post('/send-test', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { recipientEmail, subject, content, integrationId } = req.body;

    if (!recipientEmail) {
      res.status(400).json({ error: 'Recipient email is required' });
      return;
    }

    // ── Pre-flight check removed for 24/7 autonomous deployment ──────────────

    const { sendEmail } = await import('@shared/lib/channels/email.js');

    // Manual timeout wrapper — set to 14s (1s under Railway's 15s gateway limit)
    // to ensure we always respond before the load balancer cuts the connection.
    const sendPromise = sendEmail(
      userId,
      recipientEmail,
      content || 'This is a test email from Audnix AI to verify your email connection.',
      subject || 'Audnix AI - Test Email',
      { isHtml: false, isRaw: true, integrationId: integrationId || undefined }
    );

    const result = await Promise.race([
      sendPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('[TIMEOUT] POST /send-test timed out after 25s')), 25000))
    ]);

    if (res.headersSent) return;

    res.json({
      success: true,
      message: `Test email sent to ${recipientEmail}`
    });
  } catch (error: any) {
    if (res.headersSent) return;

    const errorMsg = error?.message || 'Send failed';
    console.error('[Email Send Test] Failed:', error);
    res.status(500).json({
      error: errorMsg,
      details: error instanceof Error ? error.stack : undefined
    });
  }
});

/**
 * Get SMTP settings for the current user
 */
router.get('/settings', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const settings = await storage.getSmtpSettings(userId);
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch SMTP settings' });
    return;
  }
});

/**
 * Get discovered folders for the connected account
 */
router.get('/folders', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { integrationId } = req.query;
    const { imapIdleManager } = await import('@services/email-service/src/email/imap-idle-manager.js');

    // If no integrationId, try to find the first one
    let targetId = integrationId as string;
    if (!targetId) {
      const int = await storage.getIntegration(userId, 'custom_email');
      if (int) targetId = int.id;
    }

    if (!targetId) {
      res.status(400).json({ error: 'No email integration found' });
      return;
    }

    const folders = imapIdleManager.getDiscoveredFolders(targetId);

    if (!folders) {
      res.json({
        success: true,
        inbox: ['INBOX'],
        sent: ['Sent'],
        isDiscovering: true
      });
      return;
    }

    res.json({
      success: true,
      inbox: folders.inbox,
      sent: folders.sent,
      isDiscovering: false
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch folders' });
    return;
  }
});

/**
 * Trigger an immediate sync for both Inbox and Sent folders
 */
router.post('/sync-now', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { imapIdleManager } = await import('@services/email-service/src/email/imap-idle-manager.js');

    // Trigger sync in background
    // @ts-ignore
    imapIdleManager.syncConnections();

    res.json({
      success: true,
      message: 'Sync triggered successfully'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to trigger sync' });
    return;
  }
});

/**
 * Trigger historical sync (e.g. last 30 days)
 */
router.post('/sync-history', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { days, integrationId } = req.body;
    const daysToSync = parseInt(days) || 30;

    let integration;
    if (integrationId) {
      integration = await storage.getIntegrationById(integrationId);
      if (integration && integration.userId !== userId) {
        res.status(403).json({ error: 'Unauthorized integration' });
        return;
      }
    } else {
      integration = await storage.getIntegration(userId, 'custom_email');
    }

    if (!integration) {
      res.status(400).json({ error: 'Integration not found' });
      return;
    }

    // Run in background to avoid timeout
    if (integration.provider === 'custom_email') {
      const { imapIdleManager } = await import('@services/email-service/src/email/imap-idle-manager.js');
      imapIdleManager.syncHistoricalEmails(userId, integration.id, daysToSync)
        .then((result: any) => {
          console.log(`[Historical Sync] IMAP background sync finished for ${userId}:`, result);
        })
        .catch((err: any) => {
          console.error(`[Historical Sync] IMAP background sync failed for ${userId}:`, err);
        });
    } else if (['gmail', 'outlook'].includes(integration.provider)) {
      const { emailSyncWorker } = await import('@services/email-service/src/email/email-sync-worker.js');
      emailSyncWorker.syncUserEmails(userId, integration as any, 5000)
        .then((result: any) => {
          console.log(`[Historical Sync] OAuth background sync finished for ${userId}:`, result);
        })
        .catch((err: any) => {
          console.error(`[Historical Sync] OAuth background sync failed for ${userId}:`, err);
        });
    }

    res.json({
      success: true,
      message: `Historical sync started. Check back in a few minutes.`
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to trigger historical sync' });
    return;
  }
});

export default router;

