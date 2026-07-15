import { db } from '../db/client.js';
import { reputationSnapshots } from '../db/schema.js';
import { fetchPostmasterData, getAccessToken } from '../services/postmasterClient.js';
import { notifyCore } from '../webhooks/notifyCore.js';
import { config } from '../config.js';
import { v4 as uuid } from 'uuid';
import { eq, and, desc } from 'drizzle-orm';

export async function pollPostmaster(): Promise<void> {
  console.log('[Postmaster] Starting daily poll...');

  if (!config.postmaster.clientId) {
    console.log('[Postmaster] Not configured — skipping');
    return;
  }

  const domains = await getVerifiedDomains();
  if (domains.length === 0) {
    console.log('[Postmaster] No verified domains found');
    return;
  }

  for (const domain of domains) {
    const data = await fetchPostmasterData(domain);
    if (!data) continue;

    const id = uuid();
    await db.insert(reputationSnapshots)
      .values({
        id,
        domain: data.domain,
        source: 'postmaster',
        spamRate: data.spamRate,
        ipReputation: data.ipReputation,
        blacklisted: null,
        checkedAt: data.checkedAt,
      });

    if (data.spamRate !== null && data.spamRate > config.thresholds.postmasterSpamRateWarn) {
      await notifyCore({
        campaignId: '',
        source: 'postmaster',
        inboxRate: 1 - data.spamRate,
        spamRate: data.spamRate,
        action: 'warn',
      });
    }

    console.log(`[Postmaster] ${domain}: spamRate=${data.spamRate}, ipReputation=${data.ipReputation}`);
  }
}

async function getVerifiedDomains(): Promise<string[]> {
  try {
    const accessToken = await getAccessToken();
    if (!accessToken) return [];

    const res = await fetch('https://gmailpostmaster.googleapis.com/v1/domains', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return [];
    const data = await res.json() as { domains?: Array<{ name: string }> };
    return (data.domains || []).map(d => d.name.replace('domains/', ''));
  } catch {
    return [];
  }
}


