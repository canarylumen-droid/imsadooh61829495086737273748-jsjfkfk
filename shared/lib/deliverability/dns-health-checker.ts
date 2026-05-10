import dns from 'dns/promises';

export interface DomainHealth {
  spf: boolean;
  dmarc: boolean;
  dkim?: boolean; // Hard to verify without selector, but we'll try common ones
  riskLevel: 'low' | 'medium' | 'high';
  warnings: string[];
}

export async function checkDomainHealth(domain: string): Promise<DomainHealth> {
  const health: DomainHealth = {
    spf: false,
    dmarc: false,
    riskLevel: 'low',
    warnings: [],
  };

  try {
    // 1. Check SPF (TXT records on root domain)
    const txtRecords = await dns.resolveTxt(domain).catch(() => []);
    const spfRecord = txtRecords.find(record => record.join('').includes('v=spf1'));
    
    if (spfRecord) {
      health.spf = true;
    } else {
      health.warnings.push('Missing SPF record. Your emails are very likely to go to spam.');
      health.riskLevel = 'high';
    }

    // 2. Check DMARC (TXT records on _dmarc.domain)
    const dmarcRecords = await dns.resolveTxt(`_dmarc.${domain}`).catch(() => []);
    const dmarcRecord = dmarcRecords.find(record => record.join('').includes('v=DMARC1'));

    if (dmarcRecord) {
      health.dmarc = true;
    } else {
      health.warnings.push('Missing DMARC record. This lowers your domain reputation.');
      if (health.riskLevel === 'low') health.riskLevel = 'medium';
    }

    // We skip exact DKIM validation because we don't know the selector the user's provider uses
    // But SPF + DMARC absence is enough to trigger the high risk warning.
    
    return health;
  } catch (error) {
    console.error(`[DNS Health] Failed to check domain ${domain}:`, error);
    health.warnings.push('Could not verify DNS records. Please ensure your domain is configured correctly.');
    health.riskLevel = 'high';
    return health;
  }
}
