import { db } from '../db/client.js';
import { reputationSnapshots } from '../db/schema.js';
import { fetchSNDSData } from '../services/sndsClient.js';
import { notifyCore } from '../webhooks/notifyCore.js';
import { config } from '../config.js';
import { v4 as uuid } from 'uuid';

export async function pollSNDS(): Promise<void> {
  console.log('[SNDS] Starting daily poll...');

  if (!config.snds.clientId) {
    console.log('[SNDS] Not configured — skipping');
    return;
  }

  const domains = await getMonitoredDomains();
  if (domains.length === 0) {
    console.log('[SNDS] No monitored domains found');
    return;
  }

  for (const domain of domains) {
    const data = await fetchSNDSData(domain);
    if (!data) continue;

    const id = uuid();
    await db.insert(reputationSnapshots)
      .values({
        id,
        domain: data.domain,
        source: 'snds',
        spamRate: data.spamRate,
        ipReputation: data.ipReputation,
        blacklisted: data.blacklisted,
        checkedAt: data.checkedAt,
      });

    if (data.blacklisted) {
      await notifyCore({
        campaignId: '',
        source: 'snds',
        inboxRate: 0,
        spamRate: 1,
        action: 'pause',
      });
    } else if (data.spamRate !== null && data.spamRate > config.thresholds.postmasterSpamRateWarn) {
      await notifyCore({
        campaignId: '',
        source: 'snds',
        inboxRate: 1 - data.spamRate,
        spamRate: data.spamRate,
        action: 'warn',
      });
    }

    console.log(`[SNDS] ${domain}: spamRate=${data.spamRate}, blacklisted=${data.blacklisted}`);
  }
}

async function getMonitoredDomains(): Promise<string[]> {
  try {
    const accessToken = await getSNDSAccessToken();
    if (!accessToken) return [];

    const res = await fetch('https://sendersupport.olc.protection.outlook.com/snds/api/v1.0/data/listed', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return [];
    const data = await res.json() as any;
    if (Array.isArray(data)) {
      return [...new Set(data.map((d: any) => d.domain || d.Domain).filter(Boolean))];
    }
    return [];
  } catch {
    return [];
  }
}

async function getSNDSAccessToken(): Promise<string | null> {
  if (!config.snds.clientId) return null;
  try {
    const res = await fetch(
      `https://login.microsoftonline.com/${config.snds.tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.snds.clientId,
          client_secret: config.snds.clientSecret,
          scope: 'https://outlook.office365.com/.default',
          grant_type: 'client_credentials',
        }),
        signal: AbortSignal.timeout(10_000),
      }
    );
    if (!res.ok) return null;
    const data = await res.json() as { access_token?: string };
    return data.access_token || null;
  } catch {
    return null;
  }
}
