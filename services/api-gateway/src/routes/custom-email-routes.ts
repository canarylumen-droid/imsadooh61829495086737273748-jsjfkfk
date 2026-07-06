import { Router, Request, Response } from 'express';
import { requireAuth, getCurrentUserId } from '../middleware/auth.js';
import { storage } from '@shared/lib/storage/storage.js';
import { encrypt } from '@shared/lib/crypto/encryption.js';
import { pagedEmailImport } from '@shared/lib/imports/paged-email-importer.js';
import { smtpAbuseProtection } from '@services/email-service/src/email/smtp-abuse-protection.js';
import { bounceHandler } from '@services/email-service/src/email/bounce-handler.js';
import { EmailDiscoveryService } from '@services/email-service/src/email/email-discovery.js';
import { checkDomainHealth } from '@shared/lib/deliverability/dns-health-checker.js';
import { verifyDomainDns } from '@services/email-service/src/email/dns-verification.js';
import validator from 'validator';
import { db } from '@shared/lib/db/db.js';
import { outreachCampaigns } from '@audnix/shared';
import { eq, and } from 'drizzle-orm';
import { sendError } from '@shared/lib/api/error-response.js';

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
    return sendError(res, 500, 'Discovery failed');
  }
});

/**
 * POST /custom-email/test
 * Test SMTP + IMAP connection without saving
 */
router.post('/test', requireAuth, async (req: Request, res: Response) => {
  try {
    const { smtpHost, smtpPort, imapHost, imapPort, email, password } = req.body;
    if (!smtpHost || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields (smtpHost, email, password)' });
    }

    const parsedSmtpPort = parseInt(smtpPort) || 587;
    const parsedImapPort = parseInt(imapPort) || 993;

    let smtpVerified = false;
    let smtpError: string | null = null;
    let imapVerified = false;
    let imapError: string | null = null;
    let dnsHealth = null;

    // Test SMTP
    let transporter: any;
    try {
      const nodemailer = await import('nodemailer');
      transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parsedSmtpPort,
        secure: parsedSmtpPort === 465,
        auth: { user: email, pass: password },
        family: 4,
        tls: { rejectUnauthorized: false },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
      } as any);
      await transporter.verify();
      transporter.close();
      smtpVerified = true;
    } catch (err: any) {
      try { transporter?.close(); } catch {}
      smtpError = err?.message || 'SMTP connection failed';
    }

    // Test IMAP
    if (imapHost) {
      try {
        const Imap = await import('imap');
        const imap = new Imap.default({
          user: email,
          password,
          host: imapHost,
          port: parsedImapPort || 993,
          tls: true,
          tlsOptions: { rejectUnauthorized: false },
          connTimeout: 10000,
          authTimeout: 10000,
        });
        await new Promise<void>((resolve, reject) => {
          imap.once('ready', () => { imap.end(); resolve(); });
          imap.once('error', (err: any) => reject(err));
          imap.connect();
        });
        imapVerified = true;
      } catch (err: any) {
        imapError = err?.message || 'IMAP connection failed';
      }
    }

    // Check DNS
    try {
      const domain = email.split('@')[1];
      if (domain) {
        dnsHealth = await checkDomainHealth(domain);
      }
    } catch (err: any) {
      console.warn('[Email Test] DNS check failed:', err.message);
    }

    const success = smtpVerified || imapVerified;

    res.json({
      success,
      smtpVerified,
      smtpError,
      imapVerified,
      imapError,
      dnsHealth,
      port: parsedSmtpPort,
      message: success
        ? 'Connection verified successfully'
        : 'Could not connect. Check your credentials and server settings.'
    });
  } catch (error: any) {
    console.error('[Email Test] Error:', error);
    sendError(res, 500, 'Test failed', error.message);
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
  passwordType?: string;
  fromName?: string;
}

interface BulkMailboxImportRow extends Partial<ConnectRequestBody> {
  smtpUser?: string;
  imapUser?: string;
  passwordType?: string;
}

const BULK_MAILBOX_LIMIT = 1000;
const HOST_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9\-\.]+)?[a-zA-Z0-9]$/;

function normalizePort(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isEnterpriseUser(user: any): boolean {
  return user?.plan === 'enterprise' || user?.subscriptionTier === 'enterprise';
}

/**
 * Connect custom email domain
 */
router.post('/connect', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    let { smtpHost, smtpPort, imapHost, imapPort, email, password, passwordType, fromName } = req.body as ConnectRequestBody;

    // Sanitize inputs to prevent trailing copy-paste spaces from failing validation
    smtpHost = smtpHost?.trim();
    imapHost = imapHost?.trim() || '';
    email = email?.trim();
    password = password?.trim();
    fromName = fromName?.trim();

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
    if (!HOST_REGEX.test(smtpHost)) {
      res.status(400).json({ error: `"${smtpHost}" does not look like a valid SMTP hostname.` });
      return;
    }

    // Validate port range
    const parsedSmtpPort = parseInt(smtpPort) || 587;
    if (parsedSmtpPort < 1 || parsedSmtpPort > 65535) {
      res.status(400).json({ error: `SMTP port ${smtpPort} is not valid. Common values: 465, 587, 2525.` });
      return;
    }

    // ── Build IMAP host/port before verification ─────────────────────────────
    const effectiveImapHost = imapHost || smtpHost.replace(/^smtp\./i, 'imap.');
    const parsedImapPort = parseInt(imapPort) || 993;

    // ── Verify SMTP credentials before saving ──────────────────────────────
    let smtpVerified = false;
    let smtpVerifyError: string | null = null;
    let transporter: any;
    try {
      const nodemailer = await import('nodemailer');
      transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parsedSmtpPort,
        secure: parsedSmtpPort === 465,
        auth: { user: email, pass: password },
        family: 4,
        tls: { rejectUnauthorized: false },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000,
      } as any);
      await transporter.verify();
      transporter.close();
      smtpVerified = true;
    } catch (verifyErr: any) {
      try { transporter?.close(); } catch {}
      smtpVerified = false;
      smtpVerifyError = verifyErr?.message || 'SMTP verification failed';
      console.warn(`[Email Connect] SMTP verify failed for ${email}: ${smtpVerifyError}`);
    }

    // ── Verify IMAP connection ────────────────────────────────────────────
    let imapVerified = false;
    let imapVerifyError: string | null = null;
    if (effectiveImapHost) {
      try {
        const Imap = await import('imap');
        const imap = new Imap.default({
          user: email,
          password,
          host: effectiveImapHost,
          port: parsedImapPort || 993,
          tls: true,
          tlsOptions: { rejectUnauthorized: false },
          connTimeout: 10000,
          authTimeout: 10000,
        });
        await new Promise<void>((resolve, reject) => {
          imap.once('ready', () => { imap.end(); resolve(); });
          imap.once('error', (err: any) => reject(err));
          imap.connect();
        });
        imapVerified = true;
      } catch (imapErr: any) {
        imapVerified = false;
        imapVerifyError = imapErr?.message || 'IMAP verification failed';
        console.warn(`[Email Connect] IMAP verify failed for ${email}: ${imapVerifyError}`);
      }
    } else {
      imapVerified = true;
    }

    // ── Both SMTP and IMAP must verify before saving ───────────────────
    const errors: string[] = [];
    if (!smtpVerified) errors.push(smtpVerifyError || 'SMTP connection failed');
    if (!imapVerified) errors.push(imapVerifyError || 'IMAP connection failed');
    if (errors.length > 0) {
      const details = errors.join('; ');
      let tip = 'Check your email password. If 2FA is enabled, use an App Password.';
      if (details.includes('DNS') || details.includes('ENOTFOUND') || details.includes('timed out')) {
        tip = 'Check that your SMTP/IMAP hostnames are correct. Common hosts: smtp.office365.com, smtp.gmail.com, smtp.zoho.com';
      }
      sendError(res, 400, `Could not connect to mailbox (SMTP: ${smtpVerified ? 'OK' : 'FAIL'}, IMAP: ${imapVerified ? 'OK' : 'FAIL'})`, details, tip);
      return;
    }

    // ── Enforce mailbox limits ────────────────────────────────────────────────
    const limitCheck = await storage.checkMailboxLimit(userId);
    if (!limitCheck.allowed) {
      console.warn(`[Email Connect] User ${userId} reached mailbox limit (${limitCheck.current}/${limitCheck.limit}) for plan ${limitCheck.plan}`);
      sendError(res, 403, 'Mailbox limit reached', `Your current plan (${limitCheck.plan}) allows up to ${limitCheck.limit} mailboxes. You already have ${limitCheck.current} connected.`, 'Upgrade to a higher plan to add more mailboxes.');
      return;
    }

    const credentials: EmailConfig & { passwordType?: string } = {
      smtp_host:  smtpHost,
      smtp_port:  parsedSmtpPort,
      imap_host:  effectiveImapHost,
      imap_port:  parsedImapPort,
      smtp_user:  email,
      smtp_pass:  password,
      from_name:  fromName || '',
      provider:   'custom',
      passwordType: passwordType || 'mailbox_password',
    };

    console.log(`[Email Connect] Saving ${email} — SMTP ${smtpHost}:${parsedSmtpPort} / IMAP ${effectiveImapHost}:${parsedImapPort}`);

    let encryptedMeta: string;
    try {
      encryptedMeta = await encrypt(JSON.stringify(credentials));
    } catch (encryptError: unknown) {
      const msg = encryptError instanceof Error ? encryptError.message : 'Encryption failed';
      console.error(`[Email Connect] Encryption error:`, encryptError);
      sendError(res, 500, 'Failed to securely store credentials', msg);
      return;
    }

    // Attempt DNS Health Check
    let dnsHealth = undefined;
    const emailDomain = email.split('@')[1];
    try {
      if (emailDomain) {
        dnsHealth = await checkDomainHealth(emailDomain);
      }
    } catch (e) {
      console.warn('[Email Connect] DNS Health Check failed', e);
    }

    // Store detailed DNS verification result for dashboard display
    try {
      if (emailDomain) {
        const dnsResult = await verifyDomainDns(emailDomain, undefined, false);
        await storage.createDomainVerification(userId, {
          domain: emailDomain,
          verificationResult: dnsResult,
        });
      }
    } catch (e) {
      console.warn('[Email Connect] DNS verification storage failed', e);
    }

    try {
      await storage.createIntegration({
        userId,
        provider: 'custom_email',
        encryptedMeta,
        connected: true,
        accountType: email,
        dailyLimit: 50, // Part 7: Set default so frontend never gets null
      });
    } catch (dbError: unknown) {
      const msg = dbError instanceof Error ? dbError.message : 'Database error';
      console.error(`[Email Connect] Storage error:`, dbError);
      sendError(res, 500, 'Failed to save email configuration', msg);
      return;
    }

    console.log(`[Email Connect] ✅ Email account saved for user ${userId}`);

    // Fetch created integration reference for notifications
    let connectedIntegrationId: string | null = null;

    // ── Trigger background sync (fire-and-forget) ────────────────────────────
    try {
      const { imapIdleManager } = await import('@services/email-service/src/email/imap-idle-manager.js');
      imapIdleManager.syncConnections();

      const { distributeLeadsFromPool } = await import('@services/outreach-worker/src/sales-engine/outreach-engine.js');
      const integrations = await storage.getIntegrations(userId);
      const customEmail = integrations.find((i: any) => i.provider === 'custom_email' && i.accountType === email);
      if (customEmail) {
        connectedIntegrationId = customEmail.id;
        // Bug #9 fix: Only redistribute leads if the user has an active campaign.
        // Firing on every mailbox connect caused massive unnecessary DB writes and
        // a race condition when connecting multiple mailboxes in quick succession.
        const [activeCampaign] = await db
          .select({ id: outreachCampaigns.id })
          .from(outreachCampaigns)
          .where(and(eq(outreachCampaigns.userId, userId), eq(outreachCampaigns.status, 'active')))
          .limit(1);

        if (activeCampaign) {
          distributeLeadsFromPool(userId, customEmail.id).catch((err: any) =>
            console.error('[Email Connect] Lead distribution failed:', err)
          );
        } else {
          console.log(`[Email Connect] Skipping lead redistribution for ${email} — no active campaigns.`);
        }

        const { notifyMailboxConnected } = await import('@shared/lib/queues/verification-routing-queue.js');
        notifyMailboxConnected(userId, customEmail.id).catch((err: any) =>
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
      if (dnsHealth && connectedIntegrationId) {
        wsSync.notifyReputationUpdate(userId, {
          integrationId: connectedIntegrationId,
          score: dnsHealth.score,
          status: dnsHealth.status
        });
      }
    } catch (e) {
      console.warn('[Email Connect] Could not notify frontend via websocket:', e);
    }

    res.json({
      success: true,
      smtpVerified,
      smtpVerifyError,
      message: smtpVerified
        ? `${email} connected and verified successfully.`
        : `${email} saved but SMTP verification failed: ${smtpVerifyError}. Your mailbox is added but sending may not work until credentials are corrected.`,
      leadsImported: 0,
      leadsSkipped: 0,
      backgroundImport: true,
      dnsHealth
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Email Connect] Fatal error:`, error);
    sendError(res, 500, 'Failed to connect custom email', errorMsg);
  }
});

/**
 * Enterprise bulk import for custom SMTP/IMAP mailboxes.
 * The browser parses CSV/XLS-exported text and posts normalized rows here.
 */
router.post('/bulk-import', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const user = await storage.getUserById(userId);

    if (!isEnterpriseUser(user)) {
      sendError(res, 403, 'Enterprise plan required', 'Bulk mailbox import is only available for enterprise accounts.');
      return;
    }

    const mailboxes = Array.isArray(req.body?.mailboxes)
      ? req.body.mailboxes as BulkMailboxImportRow[]
      : [];

    if (mailboxes.length === 0) {
      res.status(400).json({ error: 'No mailboxes provided' });
      return;
    }

    if (mailboxes.length > BULK_MAILBOX_LIMIT) {
      res.status(400).json({
        error: 'Bulk import limit exceeded',
        details: `Upload ${BULK_MAILBOX_LIMIT} mailboxes or fewer per import.`
      });
      return;
    }

    const existingIntegrations = await storage.getIntegrations(userId);
    const existingEmails = new Set(
      existingIntegrations
        .filter((i: any) => ['custom_email', 'gmail', 'outlook'].includes(i.provider))
        .map((i: any) => String(i.accountType || '').trim().toLowerCase())
        .filter(Boolean)
    );

    const seenInUpload = new Set<string>();
    const imported: Array<{ id: string; email: string }> = [];
    const skipped: Array<{ row: number; email?: string; reason: string }> = [];
    const errors: Array<{ row: number; email?: string; error: string }> = [];

    for (let index = 0; index < mailboxes.length; index++) {
      const rowNumber = index + 1;
      const row = mailboxes[index] || {};
      const email = String(row.email || row.smtpUser || row.imapUser || '').trim().toLowerCase();
      const smtpHost = String(row.smtpHost || '').trim().toLowerCase();
      const imapHostRaw = String(row.imapHost || '').trim().toLowerCase();
      const password = String(row.password || '').trim();
      const passwordType = String(row.passwordType || '').trim().toLowerCase() || 'mailbox_password';
      const fromName = String(row.fromName || '').trim();

      if (!email || !smtpHost || !password) {
        errors.push({ row: rowNumber, email, error: 'Missing email, SMTP host, or password.' });
        continue;
      }

      if (!validator.isEmail(email)) {
        errors.push({ row: rowNumber, email, error: 'Invalid email address format.' });
        continue;
      }

      if (!HOST_REGEX.test(smtpHost)) {
        errors.push({ row: rowNumber, email, error: 'Invalid SMTP hostname.' });
        continue;
      }

      const effectiveImapHost = imapHostRaw || smtpHost.replace(/^smtp\./i, 'imap.');
      if (!HOST_REGEX.test(effectiveImapHost)) {
        errors.push({ row: rowNumber, email, error: 'Invalid IMAP hostname.' });
        continue;
      }

      if (seenInUpload.has(email)) {
        skipped.push({ row: rowNumber, email, reason: 'Duplicate mailbox in upload.' });
        continue;
      }
      seenInUpload.add(email);

      if (existingEmails.has(email)) {
        skipped.push({ row: rowNumber, email, reason: 'Mailbox already connected.' });
        continue;
      }

      const smtpPort = normalizePort(row.smtpPort, 587);
      const imapPort = normalizePort(row.imapPort, 993);
      if (smtpPort < 1 || smtpPort > 65535 || imapPort < 1 || imapPort > 65535) {
        errors.push({ row: rowNumber, email, error: 'SMTP or IMAP port is outside the valid range.' });
        continue;
      }

      const credentials: any = {
        smtp_host: smtpHost,
        smtpHost,
        smtp_port: smtpPort,
        smtpPort,
        imap_host: effectiveImapHost,
        imapHost: effectiveImapHost,
        imap_port: imapPort,
        imapPort,
        smtp_user: email,
        smtpUser: email,
        imap_user: String(row.imapUser || email).trim().toLowerCase(),
        imapUser: String(row.imapUser || email).trim().toLowerCase(),
        smtp_pass: password,
        smtpPass: password,
        password,
        passwordType,
        from_name: fromName,
        fromName,
        provider: 'custom',
        enterpriseBulkImport: true,
      };

      // Verify SMTP before saving
      let smtpOk = false;
      let smtpErrMsg: string | null = null;
      let transporter: any;
      try {
        const nodemailer = await import('nodemailer');
        transporter = nodemailer.createTransport({
          host: smtpHost,
          port: smtpPort,
          secure: smtpPort === 465,
          auth: { user: email, pass: password },
          family: 4,
          tls: { rejectUnauthorized: false },
          connectionTimeout: 8000,
          greetingTimeout: 8000,
        } as any);
        await transporter.verify();
        transporter.close();
        smtpOk = true;
      } catch (verifyErr: any) {
        try { transporter?.close(); } catch {}
        smtpOk = false;
        smtpErrMsg = verifyErr?.message || 'SMTP verify failed';
      }

      try {
        const encryptedMeta = await encrypt(JSON.stringify(credentials));
        const integration = await storage.createIntegration({
          userId,
          provider: 'custom_email',
          encryptedMeta,
          connected: true,
          accountType: email,
          dailyLimit: 50,
        });
        existingEmails.add(email);
        const result: any = { id: integration.id, email, smtpVerified: smtpOk };
        if (!smtpOk) result.warning = `SMTP verification failed: ${smtpErrMsg}`;
        imported.push(result);
        if (!smtpOk) {
          errors.push({ row: rowNumber, email, error: `Saved but SMTP verify failed: ${smtpErrMsg}` });
        }
      } catch (err: any) {
        errors.push({ row: rowNumber, email, error: err?.message || 'Failed to save mailbox.' });
      }
    }

    try {
      const { imapIdleManager } = await import('@services/email-service/src/email/imap-idle-manager.js');
      imapIdleManager.syncConnections();

      const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
      wsSync.notifySettingsUpdated(userId);
      wsSync.notifySyncStatus(userId, { syncing: imported.length > 0 });
    } catch (syncErr) {
      console.warn('[Bulk Email Import] Could not trigger immediate sync:', syncErr);
    }

    if (imported.length > 0) {
      (async () => {
        try {
          const { notifyMailboxConnected } = await import('@shared/lib/queues/verification-routing-queue.js');
          for (const mailbox of imported) {
            await notifyMailboxConnected(userId, mailbox.id);
          }
        } catch (queueErr) {
          console.warn('[Bulk Email Import] Smart reroute queue failed:', queueErr);
        }
      })();
    }

    res.json({
      success: true,
      imported: imported.length,
      skipped: skipped.length,
      failed: errors.length,
      importedMailboxes: imported,
      skippedRows: skipped.slice(0, 100),
      errors: errors.slice(0, 100),
      truncated: skipped.length > 100 || errors.length > 100,
    });
  } catch (error: any) {
    console.error('[Bulk Email Import] Fatal error:', error);
    sendError(res, 500, 'Failed to bulk import mailboxes', error?.message || String(error));
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
    sendError(res, 500, 'Failed to import emails');
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
      let transporter: any;
      try {
        transporter = nodemailer.createTransport({
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
        transporter.close();
        successfulPort = port;
        break; // Stop trying if successful
      } catch (err: any) {
        try { transporter?.close(); } catch {}
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
      sendError(res, 400, 'Decryption Failed', 'The server failed to decrypt your credentials. This usually means the ENCRYPTION_KEY has changed or is missing. Please check your .env file.', undefined, 'CRYPTO_ERROR');
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
    sendError(res, 500, 'Failed to disconnect custom email');
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
    const { and, eq, sql, inArray } = await import('drizzle-orm');

    const emailIntegrations = allIntegrations.filter(i => emailProviders.includes(i.provider));
    const integrationIds = emailIntegrations.map(i => i.id);

    // Bulk-fetch bounce counts in a single query instead of N+1
    let bouncyCounts: { integrationId: string; count: number }[] = [];
    let outreachedCounts: { integrationId: string; count: number }[] = [];

    if (integrationIds.length > 0) {
      bouncyCounts = await db.select({
        integrationId: leadsSchema.integrationId,
        count: sql<number>`count(*)`,
      })
        .from(leadsSchema)
        .where(and(
          eq(leadsSchema.userId, userId),
          eq(leadsSchema.status, 'bouncy'),
          inArray(leadsSchema.integrationId, integrationIds)
        ))
        .groupBy(leadsSchema.integrationId) as any;

      outreachedCounts = await db.select({
        integrationId: msgSchema.integrationId,
        count: sql<number>`count(distinct ${msgSchema.leadId})`,
      })
        .from(msgSchema)
        .where(and(
          eq(msgSchema.userId, userId),
          eq(msgSchema.direction, 'outbound'),
          inArray(msgSchema.integrationId, integrationIds)
        ))
        .groupBy(msgSchema.integrationId) as any;
    }

    const bouncyMap = new Map(bouncyCounts.map(r => [r.integrationId, Number(r.count)]));
    const outreachedMap = new Map(outreachedCounts.map(r => [r.integrationId, Number(r.count)]));

    const mailboxes = emailIntegrations.map(i => {
      const bouncy = bouncyMap.get(i.id) || 0;
      const outreached = outreachedMap.get(i.id) || 0;
      const calculatedBounceRate = outreached > 0 ? (bouncy / outreached) : 0;

      return {
        id: i.id,
        email: i.accountType,
        connected: i.connected,
        provider: i.provider,
        healthStatus: (i as any).healthStatus || 'connected',
        lastSync: i.lastSync,
        reputationScore: (i as any).reputationScore ?? null,
        bounceRate: calculatedBounceRate,
        // Part 7: Normalize null → 50 so the frontend always gets a number
        dailyLimit: (i as any).dailyLimit ?? 50,
      };
    });

    res.json({
      success: true,
      integrations: mailboxes,
      // Legacy single-mailbox fields for any existing UI that reads them
      connected: mailboxes.length > 0,
      email: mailboxes[0]?.email || null
    });
  } catch (error: unknown) {
    sendError(res, 500, 'Failed to get email status');
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

    // Timeout wrapper - 14s to stay under infrastructure limits
    const sendPromise = sendEmail(
      userId,
      recipientEmail,
      content || 'This is a test email from Audnix AI to verify your email connection.',
      subject || 'Audnix AI - Test Email',
      { isHtml: false, isRaw: true, integrationId: integrationId || undefined }
    );

    const result = await Promise.race([
      sendPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('[TIMEOUT] Test send timed out after 14s. SMTP connection may be slow or blocked.')), 14000))
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
    sendError(res, 500, errorMsg, error instanceof Error ? error.stack : undefined);
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
    sendError(res, 500, 'Failed to fetch SMTP settings');
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
    sendError(res, 500, 'Failed to fetch folders');
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
    sendError(res, 500, 'Failed to trigger sync');
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
    sendError(res, 500, 'Failed to trigger historical sync');
    return;
  }
});

export default router;

