import { config } from '../config.js';

export interface SeedAccount {
  id: string;
  email: string;
  provider: 'gmail' | 'outlook';
  imapHost: string;
  imapPort: number;
  imapUser: string;
  imapPass: string;
}

let cache: SeedAccount[] = [];
let cacheTs = 0;

export async function fetchSeedAccounts(): Promise<SeedAccount[]> {
  const now = Date.now();
  if (cache.length > 0 && now - cacheTs < config.seedCheck.cacheTtlMs) {
    return cache;
  }

  try {
    const url = `${config.warmup.url}/api/internal/seed-accounts`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.warmup.apiKey) {
      headers['Authorization'] = `Bearer ${config.warmup.apiKey}`;
    }

    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      console.warn(`[WarmupClient] HTTP ${res.status} — using cached list (${cache.length} seeds)`);
      return cache;
    }

    const data = await res.json() as { seeds: any[] };
    const seeds: SeedAccount[] = (data.seeds || []).map((s: any) => ({
      id: s.id,
      email: s.email,
      provider: s.provider || 'gmail',
      imapHost: s.imapHost || '',
      imapPort: s.imapPort || 993,
      imapUser: s.imapUser || s.email,
      imapPass: s.imapPass || '',
    })).filter((s: SeedAccount) => s.imapHost && s.imapPass);

    if (seeds.length > 0) {
      cache = seeds;
      cacheTs = now;
      console.log(`[WarmupClient] Fetched ${seeds.length} seed accounts`);
    }

    return cache;
  } catch (err: any) {
    console.warn(`[WarmupClient] Failed to fetch seeds: ${err.message} — using cached list (${cache.length} seeds)`);
    return cache;
  }
}

export function invalidateCache() {
  cache = [];
  cacheTs = 0;
}
