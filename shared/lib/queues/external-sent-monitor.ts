/**
 * External Sent Monitor — Task 1
 *
 * Queries a mailbox's IMAP Sent folder for emails sent manually by the user
 * (not via Audnix). Returns the count since midnight so the Hourly Distribution
 * engine can subtract external volume from the daily budget.
 *
 * Result is cached in Redis for 5 minutes to avoid hammering IMAP servers.
 */

import { db } from '@shared/lib/db/db.js';
import { integrations } from '@audnix/shared';
import { eq, sql } from 'drizzle-orm';
import { decrypt } from '@shared/lib/crypto/encryption.js';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Return the number of non-Audnix emails in the mailbox's Sent folder since midnight.
 * Cached in Redis with a 5-minute TTL.
 */
export async function getExternalSentCount(integrationId: string): Promise<number> {
  if (!db) return 0;

  const todayKey = new Date().toISOString().slice(0, 10);
  const cacheKey = `external-sent:${integrationId}:${todayKey}`;

  // 1. Try Redis cache
  try {
    const { redisConnection } = await import('./redis-config.js');
    if (redisConnection) {
      const cached = await (redisConnection as any).get(cacheKey);
      if (cached !== null) {
        return Number(cached);
      }
    }
  } catch { /* Redis unavailable — fall through */ }

  // 2. Query IMAP Sent folder (total) minus Audnix-known sends
  const externalCount = await queryExternalSent(integrationId);

  // 3. Cache result
  try {
    const { redisConnection } = await import('./redis-config.js');
    if (redisConnection) {
      await (redisConnection as any).set(cacheKey, String(externalCount), 'PX', CACHE_TTL_MS);
    }
  } catch { /* non-critical */ }

  return externalCount;
}

/**
 * Invalidate the external-sent cache for a mailbox.
 * Called by the IMAP inbound worker when a new manual send is detected.
 */
export async function invalidateExternalSentCache(integrationId: string): Promise<void> {
  try {
    const { redisConnection } = await import('./redis-config.js');
    if (redisConnection) {
      const todayKey = new Date().toISOString().slice(0, 10);
      await (redisConnection as any).del(`external-sent:${integrationId}:${todayKey}`);
    }
  } catch { /* non-critical */ }
}

// ─── Core Logic ─────────────────────────────────────────────────────────────

async function queryExternalSent(integrationId: string): Promise<number> {
  const [integration] = await db!
    .select()
    .from(integrations)
    .where(eq(integrations.id, integrationId))
    .limit(1);

  if (!integration) return 0;
  if (integration.provider === 'instagram') return 0;

  // How many emails has Audnix sent today via this mailbox?
  const audnixResult = await db!.execute(sql`
    SELECT COUNT(*) as count FROM messages
    WHERE direction = 'outbound'
      AND integration_id = ${integrationId}::uuid
      AND created_at >= CURRENT_DATE::timestamp
  `);
  const audnixCount = Number(audnixResult.rows[0].count);

  // How many total emails are in the IMAP Sent folder since midnight?
  const totalSentCount = await queryImapSentCount(integration);

  return Math.max(0, totalSentCount - audnixCount);
}

async function queryImapSentCount(integration: typeof integrations.$inferSelect): Promise<number> {
  let config: Record<string, any> = {};
  try {
    config = JSON.parse(await decrypt(integration.encryptedMeta));
  } catch {
    return 0;
  }

  const imapHost = config.imap_host || config.smtp_host?.replace('smtp', 'imap') || '';
  const imapPort = config.imap_port || 993;
  const imapUser = config.smtp_user || config.user || config.email || '';
  const imapPass = config.smtp_pass || config.password || config.accessToken || '';

  if (!imapHost || !imapUser || !imapPass) {
    // OAuth providers (gmail/outlook) may not have raw password in meta.
    // For MVP we skip them; the hourly engine falls back to Audnix-only counting.
    return 0;
  }

  const Imap = (await import('imap')).default;
  const sinceDate = new Date();
  sinceDate.setHours(0, 0, 0, 0);

  return new Promise((resolve) => {
    const imap = new Imap({
      user: imapUser,
      password: imapPass,
      host: imapHost,
      port: imapPort,
      tls: imapPort === 993,
      family: 4,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 15000,
      authTimeout: 15000,
      keepalive: false,
    } as any);

    const safeEnd = () => {
      try { if (imap.state !== 'disconnected') imap.end(); } catch {}
    };

    const sentNames = ['Sent', 'Sent Items', 'Sent Mail', 'Sent Messages', '[Gmail]/Sent Mail', 'sent-mail'];

    function tryOpenSent(index: number) {
      if (index >= sentNames.length) {
        safeEnd();
        resolve(0);
        return;
      }
      imap.openBox(sentNames[index], true, (err: any) => {
        if (err) {
          tryOpenSent(index + 1);
          return;
        }
        imap.search([['SINCE', sinceDate]], (searchErr: any, results: number[]) => {
          safeEnd();
          if (searchErr || !results) {
            resolve(0);
          } else {
            resolve(results.length);
          }
        });
      });
    }

    imap.once('ready', () => tryOpenSent(0));
    imap.once('error', () => { safeEnd(); resolve(0); });

    try {
      imap.connect();
    } catch {
      resolve(0);
    }
  });
}
