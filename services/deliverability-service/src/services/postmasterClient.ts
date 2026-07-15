import { config } from '../config.js';

export interface PostmasterData {
  domain: string;
  spamRate: number | null;
  ipReputation: string | null;
  checkedAt: string;
}

export async function fetchPostmasterData(domain: string): Promise<PostmasterData | null> {
  if (!config.postmaster.apiKey && !config.postmaster.clientId) {
    return null;
  }

  try {
    const accessToken = await getAccessToken();
    if (!accessToken) return null;

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 1);

    const formatDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const url = `https://gmailpostmaster.googleapis.com/v1/domains/${encodeURIComponent(domain)}/trafficStats:batchGet?` +
      `names=domains/${encodeURIComponent(domain)}/trafficStats/${formatDate(startDate)}&names=domains/${encodeURIComponent(domain)}/trafficStats/${formatDate(endDate)}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) return null;

    const data = await res.json() as { trafficStats?: any[] };
    const stats = data.trafficStats?.[0];
    if (!stats) return null;

    return {
      domain,
      spamRate: stats.spamRate ?? null,
      ipReputation: stats.ipReputation ?? null,
      checkedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    console.warn(`[Postmaster] Failed for ${domain}: ${err.message}`);
    return null;
  }
}

export async function getAccessToken(): Promise<string | null> {
  if (!config.postmaster.clientId) return null;

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.postmaster.clientId,
        client_secret: config.postmaster.clientSecret,
        refresh_token: config.postmaster.refreshToken,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return null;
    const data = await res.json() as { access_token?: string };
    return data.access_token || null;
  } catch {
    return null;
  }
}
