import dns from 'dns';
import { promisify } from 'util';

// Hardened: Force use of primary high-reliability DNS resolvers to bypass local/ISP caching
// Using multiple resolvers for redundancy and to prevent single-point failures
dns.setServers(['1.1.1.1', '1.0.0.1', '8.8.8.8', '8.8.4.4', '208.67.222.222', '208.67.220.220']);

const resolveTxt = promisify(dns.resolveTxt);
const resolveMx = promisify(dns.resolveMx);

// Neural DNS Cache Node with Debouncing
const dnsResolutionCache = new Map<string, { result: any; expires: number }>();
const CACHE_TTL = 300000; // 5 minutes node retention
const DNS_DEBOUNCE_MS = 1000; // 1 second debounce for rapid successive queries
const pendingQueries = new Map<string, Promise<any>>();

function getCachedResult<T>(key: string): T | null {
  const cached = dnsResolutionCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.result as T;
  return null;
}

function setCachedResult(key: string, result: any) {
  dnsResolutionCache.set(key, { result, expires: Date.now() + CACHE_TTL });
}

export interface DnsVerificationResult {
  domain: string;
  spf: {
    found: boolean;
    valid: boolean;
    record?: string;
    issues: string[];
    suggestions: string[];
  };
  dkim: {
    found: boolean;
    valid: boolean;
    selector?: string;
    record?: string;
    issues: string[];
    suggestions: string[];
  };
  dmarc: {
    found: boolean;
    valid: boolean;
    policy?: string;
    record?: string;
    issues: string[];
    suggestions: string[];
  };
  mx: {
    found: boolean;
    records: Array<{ priority: number; exchange: string }>;
  };
  blacklist: {
    isBlacklisted: boolean;
    listedOn: string[];
  };
  ptr: {
    found: boolean;
    valid: boolean;
    record?: string;
  };
  overallScore: number;
  overallStatus: 'excellent' | 'good' | 'fair' | 'poor' | 'blacklisted';
  recommendations: string[];
}

async function checkPtr(domain: string): Promise<{ found: boolean; valid: boolean; record?: string }> {
  try {
    const ips = await promisify(dns.resolve4)(domain);
    if (ips.length === 0) return { found: false, valid: false };
    
    const ptrs = await promisify(dns.reverse)(ips[0]);
    if (ptrs.length === 0) return { found: false, valid: false };
    
    // Valid if any PTR record points back to the domain (or parent domain)
    const isValid = ptrs.some(ptr => ptr.toLowerCase().endsWith(domain.toLowerCase()));
    
    return {
      found: true,
      valid: isValid,
      record: ptrs[0]
    };
  } catch (e) {
    return { found: false, valid: false };
  }
}

async function checkSpf(domain: string): Promise<DnsVerificationResult['spf']> {
  const issues: string[] = [];
  const suggestions: string[] = [];

  try {
    const records = await resolveTxt(domain);
    const spfRecords = records.flat().filter(r => r.toLowerCase().startsWith('v=spf1'));

    if (spfRecords.length === 0) {
      return {
        found: false,
        valid: false,
        issues: ['No SPF record found'],
        suggestions: [
          'Add an SPF record to your DNS settings',
          'Example: v=spf1 include:_spf.google.com include:sendgrid.net ~all'
        ],
      };
    }

    if (spfRecords.length > 1) {
      issues.push('Multiple SPF records found (should only have one)');
    }

    const spfRecord = spfRecords[0];

    if (!spfRecord.includes('~all') && !spfRecord.includes('-all') && !spfRecord.includes('?all')) {
      issues.push('SPF record missing "all" mechanism');
      suggestions.push('Add ~all or -all at the end of your SPF record');
    }

    if (spfRecord.includes('+all')) {
      issues.push('SPF record uses +all which allows any server to send email');
      suggestions.push('Change +all to ~all or -all for better security');
    }

    const lookups = (spfRecord.match(/include:|a:|mx:|ptr:|exists:/g) || []).length;
    if (lookups > 10) {
      issues.push(`SPF record has ${lookups} DNS lookups (max recommended is 10)`);
      suggestions.push('Consider flattening your SPF record to reduce lookups');
    }

    return {
      found: true,
      valid: issues.length === 0,
      record: spfRecord,
      issues,
      suggestions,
    };
  } catch (error: any) {
    if (error.code === 'ENOTFOUND' || error.code === 'ENODATA') {
      return {
        found: false,
        valid: false,
        issues: ['No SPF record found'],
        suggestions: ['Add an SPF record to authorize your email servers'],
      };
    }
    throw error;
  }
}

async function checkDkim(domain: string, selector?: string): Promise<DnsVerificationResult['dkim']> {
  const commonSelectors = selector ? [selector] : ['default', 'google', 'selector1', 'selector2', 'k1', 'dkim', 'mail', 'smtp', 's1', 's2'];

  for (const sel of commonSelectors) {
    try {
      const records = await resolveTxt(`${sel}._domainkey.${domain}`);
      const dkimRecord = records.flat().join('');

      if (dkimRecord.includes('v=DKIM1')) {
        const issues: string[] = [];
        const suggestions: string[] = [];

        if (!dkimRecord.includes('p=')) {
          issues.push('DKIM record missing public key');
        }

        return {
          found: true,
          valid: issues.length === 0,
          selector: sel,
          record: dkimRecord,
          issues,
          suggestions,
        };
      }
    } catch (error) {
      continue;
    }
  }

  return {
    found: false,
    valid: false,
    issues: ['No DKIM record found'],
    suggestions: [
      'Set up DKIM signing with your email provider',
      'Add a DKIM TXT record at selector._domainkey.yourdomain.com'
    ],
  };
}

async function checkDmarc(domain: string): Promise<DnsVerificationResult['dmarc']> {
  try {
    const records = await resolveTxt(`_dmarc.${domain}`);
    const dmarcRecords = records.flat().filter(r => r.startsWith('v=DMARC1'));

    if (dmarcRecords.length === 0) {
      return {
        found: false,
        valid: false,
        issues: ['No DMARC record found'],
        suggestions: [
          'Add a DMARC record to improve email deliverability',
          'Start with: v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com'
        ],
      };
    }

    const dmarcRecord = dmarcRecords[0];
    const issues: string[] = [];
    const suggestions: string[] = [];

    const policyMatch = dmarcRecord.match(/p=(none|quarantine|reject)/i);
    const policy = policyMatch ? policyMatch[1].toLowerCase() : undefined;

    if (policy === 'none') {
      suggestions.push('Consider upgrading from p=none to p=quarantine or p=reject for better protection');
    }

    if (!dmarcRecord.includes('rua=')) {
      suggestions.push('Add rua= to receive aggregate DMARC reports');
    }

    return {
      found: true,
      valid: issues.length === 0,
      policy,
      record: dmarcRecord,
      issues,
      suggestions,
    };
  } catch (error: any) {
    if (error.code === 'ENOTFOUND' || error.code === 'ENODATA') {
      return {
        found: false,
        valid: false,
        issues: ['No DMARC record found'],
        suggestions: [
          'Add a DMARC record at _dmarc.yourdomain.com',
          'Example: v=DMARC1; p=quarantine; rua=mailto:dmarc@yourdomain.com'
        ],
      };
    }
    throw error;
  }
}

async function checkMx(domain: string): Promise<DnsVerificationResult['mx']> {
  try {
    const records = await resolveMx(domain);
    return {
      found: records.length > 0,
      records: records.map(r => ({ priority: r.priority, exchange: r.exchange })),
    };
  } catch (error) {
    return {
      found: false,
      records: [],
    };
  }
}

async function checkBlacklist(domain: string): Promise<DnsVerificationResult['blacklist']> {
  const ipProviders = [
    'zen.spamhaus.org',
    'b.barracudacentral.org',
    'bl.spamcop.net',
    'dnsbl.sorbs.net'
  ];
  const domainProviders = [
    'dbl.spamhaus.org',
    'surbl.org',
    'uribl.com'
  ];
  
  const listedOn: string[] = [];
  
  try {
    const ips = await promisify(dns.resolve4)(domain).catch(() => []);
    const ip = ips.length > 0 ? ips[0] : null;
    const reverseIp = ip ? ip.split('.').reverse().join('.') : null;

    const checks = [];

    // IP-based checks
    if (reverseIp) {
      for (const provider of ipProviders) {
        checks.push((async () => {
          try {
            const result = await promisify(dns.resolve4)(`${reverseIp}.${provider}`);
            if (result && result.length > 0) listedOn.push(provider);
          } catch (e) {}
        })());
      }
    }

    // Domain-based checks
    for (const provider of domainProviders) {
      checks.push((async () => {
        try {
          const result = await promisify(dns.resolve4)(`${domain}.${provider}`);
          if (result && result.length > 0) listedOn.push(provider);
        } catch (e) {}
      })());
    }

    await Promise.all(checks);
  } catch (e) {
    console.warn(`[DNSBL] Failed to perform complete check for ${domain}`, e);
  }

  return {
    isBlacklisted: listedOn.length > 0,
    listedOn
  };
}

async function debouncedDnsQuery<T>(key: string, queryFn: () => Promise<T>): Promise<T> {
  // Check if there's already a pending query for this key
  const existing = pendingQueries.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  // Create new query promise
  const promise = queryFn()
    .finally(() => {
      // Remove from pending queries after completion
      setTimeout(() => pendingQueries.delete(key), DNS_DEBOUNCE_MS);
    });

  pendingQueries.set(key, promise);
  return promise;
}

export async function verifyDomainDns(domain: string, dkimSelector?: string, force = false): Promise<DnsVerificationResult> {
  let cleanDomain = domain.toLowerCase().trim();
  try {
    const url = new URL(cleanDomain.startsWith('http') ? cleanDomain : `https://${cleanDomain}`);
    cleanDomain = url.hostname;
  } catch (e) {
    cleanDomain = cleanDomain.split('/')[0];
  }

  // Check Neural Cache First
  const cacheKey = `${cleanDomain}:${dkimSelector || 'default'}`;
  const cached = getCachedResult<DnsVerificationResult>(cacheKey);
  if (cached && !force) return cached;

  // Use debounced queries to prevent DNS flooding
  const [spf, dkim, dmarc, mx, blacklist, ptr] = await Promise.all([
    debouncedDnsQuery(`spf:${cacheKey}`, () => checkSpf(cleanDomain)),
    debouncedDnsQuery(`dkim:${cacheKey}`, () => checkDkim(cleanDomain, dkimSelector)),
    debouncedDnsQuery(`dmarc:${cacheKey}`, () => checkDmarc(cleanDomain)),
    debouncedDnsQuery(`mx:${cacheKey}`, () => checkMx(cleanDomain)),
    debouncedDnsQuery(`blacklist:${cacheKey}`, () => checkBlacklist(cleanDomain)),
    debouncedDnsQuery(`ptr:${cacheKey}`, () => checkPtr(cleanDomain)),
  ]);

  const result: DnsVerificationResult = {
    domain: cleanDomain,
    spf,
    dkim,
    dmarc,
    mx,
    blacklist,
    ptr,
    overallScore: 0,
    overallStatus: 'fair',
    recommendations: []
  };

  let earnedScore = 0;
  const recommendations: string[] = [];

  // ── Percentage-based scoring (0–100) ──────────────────────────────────────
  // Each record contributes its weight. Blacklist applies a penalty multiplier.
  // Weights: SPF=25, DKIM=25, DMARC=25, MX=15, PTR=10 → total 100

  if (spf.found && spf.valid) earnedScore += 25;
  else if (spf.found) earnedScore += 15;
  else recommendations.push('Add SPF record to authorize email senders');

  if (dkim.found && dkim.valid) earnedScore += 25;
  else if (dkim.found) earnedScore += 15;
  else recommendations.push('Set up DKIM signing for email authentication');

  if (dmarc.found && dmarc.valid) {
    if (dmarc.policy === 'reject') earnedScore += 25;
    else if (dmarc.policy === 'quarantine') earnedScore += 22;
    else earnedScore += 18;
  } else if (dmarc.found) {
    earnedScore += 10;
  } else {
    recommendations.push('Add DMARC policy to prevent email spoofing');
  }

  if (mx.found) earnedScore += 15;
  else recommendations.push('No MX records found - email delivery may fail');

  if (ptr.found && ptr.valid) earnedScore += 10;
  else if (ptr.found) recommendations.push('PTR record does not match domain');
  else recommendations.push('Missing PTR record (Reverse DNS)');

  if (blacklist.isBlacklisted) {
    earnedScore = Math.round(earnedScore * 0.7);
    recommendations.push(`CRITICAL: Domain is listed on ${blacklist.listedOn.length} blacklists: ${blacklist.listedOn.join(', ')}`);
  }

  const score = Math.round(Math.max(0, Math.min(100, earnedScore)));

  let overallStatus: DnsVerificationResult['overallStatus'];
  if (blacklist.isBlacklisted) overallStatus = 'blacklisted';
  else if (score >= 90) overallStatus = 'excellent';
  else if (score >= 75) overallStatus = 'good';
  else if (score >= 50) overallStatus = 'fair';
  else overallStatus = 'poor';

  const finalResult: DnsVerificationResult = {
    domain: cleanDomain,
    spf,
    dkim,
    dmarc,
    mx,
    blacklist,
    ptr,
    overallScore: score,
    overallStatus,
    recommendations,
  };

  setCachedResult(cacheKey, finalResult);
  return finalResult;
}
