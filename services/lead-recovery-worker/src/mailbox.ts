import { ImapFlow, type FetchMessageObject } from "imapflow";
import type { Integration } from "@audnix/shared";
import { decryptToJSON } from "@shared/lib/crypto/encryption.js";
import { gmailOAuth } from "@services/api-gateway/src/oauth/gmail.js";
import { outlookOAuth } from "@services/api-gateway/src/oauth/outlook.js";

export interface RecoveryEmail {
  uid: string;
  messageId?: string;
  from?: string;
  to: string[];
  subject: string;
  text: string;
  html?: string;
  date?: Date;
}

interface EmailConfig {
  email?: string;
  smtp_host?: string;
  smtp_port?: number;
  imap_host?: string;
  imap_port?: number;
  smtp_user?: string;
  smtp_pass?: string;
  user?: string;
  password?: string;
  access_token?: string;
}

function getEmailAddress(integration: Integration, config: EmailConfig): string {
  return (
    integration.accountType ||
    config.email ||
    config.smtp_user ||
    config.user ||
    ""
  );
}

async function buildClient(integration: Integration): Promise<ImapFlow | null> {
  const config = decryptToJSON<EmailConfig>(integration.encryptedMeta) || {};
  const email = getEmailAddress(integration, config);
  if (!email) return null;

  const IMAP_TIMEOUT = 15000;

  if (integration.provider === "gmail") {
    const accessToken = await gmailOAuth.getValidToken(integration.userId, email);
    if (!accessToken) return null;
    return new ImapFlow({
      host: "imap.gmail.com",
      port: 993,
      secure: true,
      auth: { user: email, accessToken },
      logger: false,
      connectionTimeout: IMAP_TIMEOUT,
      greetingTimeout: IMAP_TIMEOUT,
    });
  }

  if (integration.provider === "outlook") {
    const accessToken = await outlookOAuth.getValidToken(integration.userId);
    if (!accessToken) return null;
    return new ImapFlow({
      host: "outlook.office365.com",
      port: 993,
      secure: true,
      auth: { user: email, accessToken },
      logger: false,
      connectionTimeout: IMAP_TIMEOUT,
      greetingTimeout: IMAP_TIMEOUT,
    });
  }

  const host = config.imap_host || config.smtp_host?.replace(/^smtp\./, "imap.");
  const password = config.smtp_pass || config.password;
  if (!host || !password) return null;

  return new ImapFlow({
    host,
    port: Number(config.imap_port || 993),
    secure: true,
    auth: {
      user: config.smtp_user || config.user || email,
      pass: password,
    },
    logger: false,
    connectionTimeout: IMAP_TIMEOUT,
    greetingTimeout: IMAP_TIMEOUT,
  });
}

async function parseFetchedEmail(message: FetchMessageObject, fallbackTo: string[]): Promise<RecoveryEmail | null> {
  const textBody = message.bodyParts?.get('TEXT')?.toString() || '';
  const headerText = message.bodyParts?.get('HEADER')?.toString() || '';
  const text = textBody.trim() || '';
  if (!text) return null;

  let from = '';
  let to: string[] = [];
  let subject = '';
  let messageId: string | undefined;
  let date: Date | undefined;

  if (message.envelope) {
    from = message.envelope.from?.[0]?.address || '';
    to = (message.envelope.to || []).map(a => a.address || '').filter(Boolean);
    subject = message.envelope.subject || '';
    messageId = message.envelope.messageId;
    date = message.envelope.date;
  }

  if (!from && headerText) {
    const m = headerText.match(/^From:\s*(.+)$/im);
    if (m) from = m[1].trim();
  }
  if (to.length === 0 && headerText) {
    const m = headerText.match(/^To:\s*(.+)$/im);
    if (m) to = m[1].split(',').map(s => s.trim());
  }
  if (!subject && headerText) {
    const m = headerText.match(/^Subject:\s*(.+)$/im);
    if (m) subject = m[1].trim();
  }

  return {
    uid: String(message.uid),
    messageId,
    from: from || undefined,
    to: to.length > 0 ? to : fallbackTo,
    subject,
    text,
    date,
  };
}

export async function fetchRecoveryEmails(
  integration: Integration,
  since: Date,
  maxMessages: number
): Promise<RecoveryEmail[]> {
  const client = await buildClient(integration);
  if (!client) return [];

  const config = decryptToJSON<EmailConfig>(integration.encryptedMeta) || {};
  const fallbackTo = [getEmailAddress(integration, config)].filter(Boolean);

  await client.connect();
  try {
    await client.mailboxOpen("INBOX", { readOnly: true });
    const emails: RecoveryEmail[] = [];
    const searchQuery = { since };

    for await (const message of client.fetch(searchQuery, {
      uid: true,
      envelope: true,
      bodyParts: ['HEADER', 'TEXT'],
    })) {
      const parsed = await parseFetchedEmail(message, fallbackTo);
      if (parsed) emails.push(parsed);
      if (emails.length >= maxMessages) break;
    }

    return emails.sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0));
  } finally {
    await client.logout().catch(() => undefined);
  }
}
