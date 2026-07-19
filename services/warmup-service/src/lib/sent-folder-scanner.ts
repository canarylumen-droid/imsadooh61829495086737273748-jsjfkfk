/**
 * Sent Folder Scanner
 * Connects via IMAP, reads SENT folder from user's mailbox,
 * extracts subjects + body snippets from 3-4 most recent real sent emails.
 * Stores them in mailbox metadata so warmup threads use realistic-looking subjects.
 */

import { ImapFlow } from 'imapflow';
import { db } from '../db/warmup-db.js';
import { eq } from 'drizzle-orm';
import { warmupMailboxes } from '@audnix/shared';
import { imapStealth } from './imap-stealth.js';
import type { WarmupMailbox } from '../types/warmup-types.js';

const SENT_FOLDER_CANDIDATES = [
  '[Gmail]/Sent Mail',
  '[Gmail]/Sent Messages',
  'Sent Items',
  'Sent Messages',
  'Sent',
];

const MAX_MESSAGES_TO_SCAN = 4;

async function getImapClient(mailbox: WarmupMailbox): Promise<ImapFlow> {
  const client = await (imapStealth as any).getClient(mailbox);
  return client;
}

async function findSentFolder(client: ImapFlow): Promise<string | null> {
  const list = await client.list();
  for (const candidate of SENT_FOLDER_CANDIDATES) {
    const match = list.find(
      (f: any) => f.path === candidate || f.name === candidate || f.path?.toLowerCase() === candidate.toLowerCase()
    );
    if (match) return match.path;
  }
  const sentLike = list.find((f: any) => f.name?.toLowerCase().includes('sent'));
  if (sentLike) return sentLike.path;
  return null;
}

export async function scanSentFolder(mailboxId: string): Promise<void> {
  const [mailbox] = await db
    .select()
    .from(warmupMailboxes)
    .where(eq(warmupMailboxes.id, mailboxId))
    .limit(1);

  if (!mailbox) {
    console.warn(`[Warmup][SentScanner] Mailbox ${mailboxId} not found`);
    return;
  }

  const mb = mailbox;
  let client: ImapFlow | null = null;

  try {
    client = await getImapClient(mb);
    const sentFolder = await findSentFolder(client);
    if (!sentFolder) {
      console.warn(`[Warmup][SentScanner] No sent folder found for ${mb.email}`);
      return;
    }

    const lock = await client.getMailboxLock(sentFolder);
    try {
      const mailboxMeta = await client.mailboxOpen(sentFolder);
      const total = mailboxMeta.exists;
      if (!total || total === 0) {
        console.log(`[Warmup][SentScanner] ${mb.email} sent folder is empty`);
        return;
      }

      const startSeq = Math.max(1, total - MAX_MESSAGES_TO_SCAN);
      const subjects: string[] = [];
      const templates: Array<{ subject: string; body: string }> = [];

      for await (const msg of client.fetch(`${startSeq}:${total}`, {
        bodyParts: [''],
        envelope: true,
      })) {
        try {
          const subject = msg.envelope?.subject?.trim();
          if (!subject) continue;

          const lowerSubject = subject.toLowerCase();
          if (
            lowerSubject.startsWith('auto') ||
            lowerSubject.startsWith('re:') ||
            lowerSubject.startsWith('fwd:') ||
            lowerSubject.startsWith('undelivered') ||
            lowerSubject.includes('mail delivery failed') ||
            lowerSubject.includes('returned mail')
          ) continue;

          const bodyBuf = msg.bodyParts?.get('');
          const bodyStr = bodyBuf ? bodyBuf.toString('utf-8').trim() : '';
          const bodyText = bodyStr.replace(/<[^>]*>/g, '').trim();
          const bodyHtml = bodyStr;

          subjects.push(subject);
          templates.push({
            subject,
            body: bodyText || bodyHtml.replace(/<[^>]*>/g, '').trim() || 'Hey, following up on this.',
          });
        } catch (_) {}
      }

      const existingMeta = mb.metadata as any;
      const updatedMeta = {
        ...existingMeta,
        userSubjects: subjects.length > 0 ? subjects : (existingMeta.userSubjects || []),
        userTemplates: templates.length > 0 ? templates : (existingMeta.userTemplates || []),
        lastSentScanAt: new Date().toISOString(),
      };

      await db
        .update(warmupMailboxes)
        .set({ metadata: updatedMeta } as any)
        .where(eq(warmupMailboxes.id, mb.id));

      console.log(
        `[Warmup][SentScanner] ${mb.email}: scanned ${subjects.length} subjects, ` +
        `${templates.length} templates (folder: ${sentFolder})`
      );
    } finally {
      await lock.release();
    }
  } catch (err: any) {
    console.error(`[Warmup][SentScanner] Failed for ${mb.email}:`, err.message);
  } finally {
    if (client) {
      try { await client.logout(); } catch {}
    }
  }
}

export async function scanAllActiveSentFolders(): Promise<number> {
  const active = await db
    .select()
    .from(warmupMailboxes)
    .where(eq(warmupMailboxes.status, 'active'));

  let scanned = 0;
  for (const mb of active) {
    const meta = mb.metadata as any;
    const lastScan = meta?.lastSentScanAt ? new Date(meta.lastSentScanAt).getTime() : 0;
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    if (lastScan > oneDayAgo) continue;

    await scanSentFolder(mb.id);
    scanned++;
  }
  return scanned;
}
