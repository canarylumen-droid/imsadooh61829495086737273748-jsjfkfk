import { ImapFlow } from 'imapflow';
import type { SeedAccount } from './warmupServiceClient.js';

export interface CheckResult {
  folder: 'inbox' | 'spam' | 'promotions' | 'not_found';
}

export async function checkSeedPlacement(
  seed: SeedAccount,
  testId: string,
  maxWaitSeconds: number = 30
): Promise<CheckResult> {
  const client = new ImapFlow({
    host: seed.imapHost,
    port: seed.imapPort,
    secure: true,
    auth: {
      user: seed.imapUser,
      pass: seed.imapPass,
    },
    logger: false,
    tls: { rejectUnauthorized: false },
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
  });

  try {
    await client.connect();
  } catch (err: any) {
    console.warn(`[IMAP] Connect failed for ${seed.email}: ${err.message}`);
    return { folder: 'not_found' };
  }

  try {
    const folders = ['INBOX', 'Junk', 'Spam', 'Bulk', 'Promotions', '[Gmail]/Spam', '[Gmail]/All Mail'];

    for (const folderName of folders) {
      try {
        const lock = await client.getMailboxLock(folderName);
        try {
          const searchResult = await client.search(
            { header: { 'X-Seed-Test-ID': testId } },
            { uid: true }
          );

          if (searchResult && searchResult.length > 0) {
            const lowerFolder = folderName.toLowerCase();
            if (lowerFolder.includes('spam') || lowerFolder.includes('junk')) {
              return { folder: 'spam' };
            }
            if (lowerFolder.includes('promot') || lowerFolder.includes('bulk')) {
              return { folder: 'promotions' };
            }
            return { folder: 'inbox' };
          }
        } finally {
          lock.release();
        }
      } catch {
        continue;
      }
    }

    return { folder: 'not_found' };
  } finally {
    await client.logout();
  }
}
