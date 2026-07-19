/**
 * Mailbox Monitor Bridge
 *
 * Pushes mailbox configs to the Rust IMAP worker via Redis lists.
 * The Rust mailbox_monitor listens on these lists and opens persistent
 * IDLE connections for user mailboxes.
 *
 * Call these functions when mailboxes are connected/disconnected.
 */

const REDIS_ADD_QUEUE = 'mailbox-monitor:add';
const REDIS_REMOVE_QUEUE = 'mailbox-monitor:remove';

export async function pushMailboxToRustMonitor(config: {
  integration_id: string;
  user_id: string;
  email: string;
  imap_host: string;
  imap_port: number;
  username: string;
  password: string;
  use_tls?: boolean;
}) {
  try {
    const { getRedisClient } = await import('@shared/lib/redis/redis.js');
    const redis = await getRedisClient();
    if (!redis) {
      console.warn('[MailboxBridge] Redis not available, skipping push');
      return;
    }
    await redis.lPush(REDIS_ADD_QUEUE, JSON.stringify(config));
    console.log(`[MailboxBridge] → Pushed ${config.integration_id} to Rust mailbox monitor`);
  } catch (e: any) {
    console.warn('[MailboxBridge] Failed to push mailbox config:', e.message);
  }
}

export async function removeMailboxFromRustMonitor(integrationId: string) {
  try {
    const { getRedisClient } = await import('@shared/lib/redis/redis.js');
    const redis = await getRedisClient();
    if (!redis) return;
    await redis.lPush(REDIS_REMOVE_QUEUE, integrationId);
    console.log(`[MailboxBridge] → Pushed ${integrationId} to Rust mailbox monitor remove queue`);
  } catch (e: any) {
    console.warn('[MailboxBridge] Failed to remove mailbox config:', e.message);
  }
}

/**
 * Build mailbox config from integration data (handles both custom SMTP and OAuth).
 */
export async function buildMailboxConfig(integration: any): Promise<{
  integration_id: string;
  user_id: string;
  email: string;
  imap_host: string;
  imap_port: number;
  username: string;
  password: string;
  use_tls: boolean;
} | null> {
  try {
    const provider = integration.provider || '';
    const userId = integration.userId || integration.user_id;

    if (provider === 'gmail') {
      return {
        integration_id: integration.id,
        user_id: userId,
        email: integration.accountType || integration.email || '',
        imap_host: 'imap.gmail.com',
        imap_port: 993,
        username: integration.accountType || '',
        password: '', // Gmail uses OAuth, not password
        use_tls: true,
      };
    }

    if (provider === 'outlook') {
      return {
        integration_id: integration.id,
        user_id: userId,
        email: integration.accountType || integration.email || '',
        imap_host: 'outlook.office365.com',
        imap_port: 993,
        username: integration.accountType || '',
        password: '',
        use_tls: true,
      };
    }

    // Custom SMTP/IMAP
    if (integration.encryptedMeta) {
      const { decrypt } = await import('@shared/lib/crypto/encryption.js');
      const meta = JSON.parse(await decrypt(integration.encryptedMeta));
      const smtpHost = meta.smtp_host || meta.smtpHost || '';
      const imapHost = meta.imap_host || meta.imapHost || smtpHost.replace(/^smtp\./i, 'imap.');
      const port = Number(meta.imap_port || meta.imapPort || 993);
      const user = meta.smtp_user || meta.smtpUser || meta.user || meta.email || integration.accountType || '';
      const pass = meta.smtp_pass || meta.smtpPass || meta.imap_pass || meta.imapPass || meta.password || '';

      if (!imapHost || !user || !pass) return null;

      return {
        integration_id: integration.id,
        user_id: userId,
        email: user,
        imap_host: imapHost,
        imap_port: port,
        username: user,
        password: pass,
        use_tls: port === 993,
      };
    }

    // OAuth provider without encryptedMeta — use integration-level fields
    const email = integration.email || integration.accountType || '';
    if (!email) return null;

    // For OAuth, we can still connect via IMAP with the accountType as username
    // but we need the OAuth token, not a password. For now, skip OAuth mailboxes
    // from Rust monitor (they'll be handled by Node.js ImapConnectionManager).
    console.log(`[MailboxBridge] Skipping OAuth mailbox ${integration.id} (${provider}) — no IMAP password available`);
    return null;
  } catch (e: any) {
    console.warn(`[MailboxBridge] Failed to build config for ${integration.id}:`, e.message);
    return null;
  }
}
