import dns from 'dns/promises';

const DNS_CACHE_TTL_MS = 5 * 60 * 1000;
const dnsCache = new Map<string, { result: any; expiresAt: number }>();

function getCachedOrFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const cached = dnsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.result as T);
  }
  return fetcher().then(result => {
    dnsCache.set(key, { result, expiresAt: Date.now() + DNS_CACHE_TTL_MS });
    return result;
  });
}

export interface DomainHealth {
  spf: boolean;
  spfRecord?: string;
  spfHardFail?: boolean;
  spfLookupCount?: number;
  dmarc: boolean;
  dmarcPolicy?: 'none' | 'quarantine' | 'reject';
  dkim: boolean;
  dkimSelectors?: string[];
  bimi: boolean;
  bimiRecord?: string;
  mx: boolean;
  blacklist: boolean;
  blacklistedOn?: string[];
  rblChecked: boolean;
  score: number;
  scorePrecise: number;
  status: string;
  riskLevel: 'low' | 'medium' | 'high';
  warnings: string[];
}

const IP_RBL_SERVERS = [
  'zen.spamhaus.org',
  'bl.spamcop.net',
  'dnsbl.sorbs.net',
  'b.barracudacentral.org',
];

const DOMAIN_RBL_SERVERS = [
  'dbl.spamhaus.org',
  'multi.surbl.org',
  'uribl.com',
];

async function queryRBL(domain: string): Promise<string[]> {
  const results: string[] = [];
  const seen = new Set<string>();

  // Resolve domain to IP first for IP-based RBL checks
  let resolvedIp: string | null = null;
  try {
    const ips = await dns.resolve4(domain);
    if (ips.length > 0) resolvedIp = ips[0];
  } catch {}

  // IP-based RBL checks (need reversed IP format)
  if (resolvedIp) {
    const reverseIp = resolvedIp.split('.').reverse().join('.');
    for (const rbl of IP_RBL_SERVERS) {
      try {
        const lookupDomain = `${reverseIp}.${rbl}`;
        const records = await dns.resolve4(lookupDomain);
        if (records && records.length > 0) {
          // RBLs return 127.0.0.x for listed entries
          const isListed = records.some(r => r.startsWith('127.'));
          if (isListed && !seen.has(rbl)) {
            results.push(rbl);
            seen.add(rbl);
          }
        }
      } catch {}
    }
  }

  // Domain-based RBL checks
  for (const rbl of DOMAIN_RBL_SERVERS) {
    try {
      const lookupDomain = `${domain}.${rbl}`;
      const records = await dns.resolve4(lookupDomain);
      if (records && records.length > 0) {
        const isListed = records.some(r => r.startsWith('127.'));
        if (isListed && !seen.has(rbl)) {
          results.push(rbl);
          seen.add(rbl);
        }
      }
    } catch {}
  }

  return results;
}

async function resolveTxt(domain: string): Promise<string[]> {
  try {
    const records = await dns.resolveTxt(domain);
    return records.map(r => r.join(''));
  } catch {
    return [];
  }
}

async function resolveCname(domain: string): Promise<string | null> {
  try {
    const records = await dns.resolveCname(domain);
    return records[0] || null;
  } catch {
    return null;
  }
}

export async function checkDomainHealth(domain: string): Promise<DomainHealth> {
  const health: DomainHealth = {
    spf: false,
    dmarc: false,
    dkim: false,
    bimi: false,
    mx: false,
    blacklist: false,
    rblChecked: false,
    score: 0,
    scorePrecise: 0,
    status: 'unknown',
    riskLevel: 'low',
    warnings: [],
  };

  try {
    const spfRecords = await getCachedOrFetch(`spf:${domain}`, () => resolveTxt(domain));
    const spfRecord = spfRecords.find(r => r.startsWith('v=spf1'));

    if (spfRecord) {
      health.spf = true;
      health.spfRecord = spfRecord;
      const parts = spfRecord.split(/\s+/);
      health.spfHardFail = parts.includes('-all');
      const lookups = parts.filter(p => p.startsWith('include:') || p.startsWith('a') || p.startsWith('mx') || p.startsWith('ptr'));
      health.spfLookupCount = lookups.length;
      if (lookups.length > 10) {
        health.warnings.push(`SPF has ${lookups.length} DNS lookups (max 10). Some checks may fail.`);
      }
    } else {
      health.warnings.push('SPF record is missing. Emails may be flagged as spam.');
    }

    const dmarcRecords = await getCachedOrFetch(`dmarc:${domain}`, () => resolveTxt(`_dmarc.${domain}`));
    const dmarcRecord = dmarcRecords.find(r => r.startsWith('v=DMARC1'));

    if (dmarcRecord) {
      health.dmarc = true;
      const policyMatch = dmarcRecord.match(/p=(\w+)/);
      if (policyMatch) {
        health.dmarcPolicy = policyMatch[1] as 'none' | 'quarantine' | 'reject';
      }
      if (health.dmarcPolicy === 'none') {
        health.warnings.push('DMARC policy is p=none. Consider upgrading to p=quarantine or p=reject.');
      }
    } else {
      health.warnings.push('DMARC record is missing. Domain is vulnerable to spoofing.');
    }

    const dkimSelectors = ['google', 'selector1', 'selector2', 'dkim', 'default', 'mail', 'smtp', 'k1', 'm1', 'mx'];
    const foundDkim: string[] = [];
    for (const sel of dkimSelectors) {
      const dkimRecord = await getCachedOrFetch(`dkim:${sel}.${domain}`, () => resolveTxt(`${sel}._domainkey.${domain}`));
      if (dkimRecord.some(r => r.includes('v=DKIM1') || r.includes('k=rsa') || r.includes('p='))) {
        foundDkim.push(sel);
      }
      if (foundDkim.length >= 3) break;
    }
    if (foundDkim.length > 0) {
      health.dkim = true;
      health.dkimSelectors = foundDkim;
    } else {
      health.warnings.push('No DKIM records found. Email signing is not configured.');
    }

    const bimiRecord = await getCachedOrFetch(`bimi:${domain}`, () => resolveTxt(`default._bimi.${domain}`));
    const hasBimi = bimiRecord.some(r => r.startsWith('v=BIMI1'));
    health.bimi = hasBimi;
    if (hasBimi) {
      const logoMatch = bimiRecord.find(r => r.includes('l='));
      if (logoMatch) health.bimiRecord = logoMatch;
    }

    // MX check
    try {
      const mxRecords = await dns.resolveMx(domain);
      health.mx = mxRecords.length > 0;
    } catch {
      health.mx = false;
    }

    const rblResults = await getCachedOrFetch(`rbl:${domain}`, () => queryRBL(domain));
    health.rblChecked = true;
    if (rblResults.length > 0) {
      health.blacklist = true;
      health.blacklistedOn = rblResults;
      health.warnings.push(`Domain blacklisted on: ${rblResults.join(', ')}`);
    }

    // Percentage-based scoring (0–100) with precise decimal calculation
    // Weights: SPF=20, DKIM=20, DMARC=20, BIMI=10, MX=15 → max 85 from records
    // Not blacklisted bonus: +15 → max total = 100
    let earnedScore = 0;
    if (health.spf) earnedScore += 20;
    if (health.dmarc) earnedScore += 20;
    if (health.dkim) earnedScore += 20;
    if (health.bimi) earnedScore += 10;
    if (health.mx) earnedScore += 15;

    // Precision bonus for SPF hard fail
    if (health.spfHardFail) earnedScore += 2;
    // Precision bonus for DMARC reject/quarantine
    if (health.dmarcPolicy === 'reject') earnedScore += 3;
    else if (health.dmarcPolicy === 'quarantine') earnedScore += 1;
    // Penalty for missing SPF all mechanism
    if (health.spf && health.spfHardFail === false && health.spfRecord?.includes('~all') === false) {
      earnedScore -= 5;
    }

    if (health.blacklist) {
      // Less harsh blacklist penalty: each blacklist reduces 15% of base, max 60%
      const blacklistCount = health.blacklistedOn?.length || 1;
      const penalty = Math.min(0.6, blacklistCount * 0.15);
      earnedScore = earnedScore * (1 - penalty);
      // Blacklisted domains cannot score above 60
      earnedScore = Math.min(60, earnedScore);
    } else {
      earnedScore += 15;
    }

    health.scorePrecise = Math.round(Math.max(0, Math.min(100, earnedScore)) * 100) / 100;
    health.score = Math.round(Math.max(0, Math.min(100, earnedScore)));

    if (health.score >= 80) {
      health.status = 'excellent';
      health.riskLevel = 'low';
    } else if (health.score >= 60) {
      health.status = 'good';
      health.riskLevel = 'low';
    } else if (health.score >= 40) {
      health.status = 'fair';
      health.riskLevel = 'medium';
    } else {
      health.status = 'poor';
      health.riskLevel = 'high';
    }

    return health;
  } catch (error: any) {
    console.error(`[DNS Health] Failed to check domain ${domain}:`, error.message);
    health.warnings.push('Could not verify DNS records. Please ensure your domain is configured correctly.');
    health.riskLevel = 'high';
    health.status = 'unknown';
    return health;
  }
}

export function clearDnsCache(): void {
  dnsCache.clear();
}
