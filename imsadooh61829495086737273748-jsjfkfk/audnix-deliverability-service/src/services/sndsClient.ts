import { config } from '../config.js';

export interface SNDSData {
  domain: string;
  spamRate: number | null;
  ipReputation: string | null;
  blacklisted: boolean | null;
  checkedAt: string;
}

export async function fetchSNDSData(domain: string): Promise<SNDSData | null> {
  if (!config.snds.clientId) {
    return null;
  }

  try {
    const accessToken = await getSNDSAccessToken();
    if (!accessToken) return null;

    const res = await fetch(
      `https://sendersupport.olc.protection.outlook.com/snds/api/v1.0/ips/${encodeURIComponent(domain)}/day`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15_000),
      }
    );

    if (!res.ok) return null;

    const data = await res.json() as any;
    if (!data) return null;

    const latestEntry = Array.isArray(data) ? data[0] : data;

    return {
      domain,
      spamRate: latestEntry?.spamRate ?? latestEntry?.spam_complaint_rate ?? null,
      ipReputation: latestEntry?.reputation ?? null,
      blacklisted: latestEntry?.isBlacklisted ?? latestEntry?.blacklisted ?? null,
      checkedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    console.warn(`[SNDS] Failed for ${domain}: ${err.message}`);
    return null;
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
