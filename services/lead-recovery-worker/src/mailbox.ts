import { ImapFlow, type FetchMessageObject } from "imapflow";
import { simpleParser } from "mailparser";
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

  if (integration.provider === "gmail") {
    const accessToken = await gmailOAuth.getValidToken(integration.userId, email);
    if (!accessToken) return null;
    return new ImapFlow({
      host: "imap.gmail.com",
      port: 993,
      secure: true,
      auth: { user: email, accessToken },
      logger: false,
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
  });
}

async function parseFetchedEmail(message: FetchMessageObject, fallbackTo: string[]): Promise<RecoveryEmail | null> {
  if (!message.source) return null;
  const parsed = await simpleParser(message.source);
  const html = typeof parsed.html === "string" ? parsed.html : "";
  const text = parsed.text?.trim() || html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || "";
  if (!text) return null;
  const toValues = Array.isArray(parsed.to) ? parsed.to.flatMap((item) => item.value) : parsed.to?.value || [];

  return {
    uid: String(message.uid),
    messageId: parsed.messageId || undefined,
    from: parsed.from?.value?.[0]?.address,
    to: toValues.map((address) => address.address || "").filter(Boolean) || fallbackTo,
    subject: parsed.subject || "",
    text,
    html: html || undefined,
    date: parsed.date || message.envelope?.date,
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
      source: true,
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
