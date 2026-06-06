export interface DomainHealth {
  spf: boolean;
  dmarc: boolean;
  dkim?: boolean;
  blacklist?: boolean;
  score?: number;
  status?: string;
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
    const { verifyDomainDns } = await import('@services/email-service/src/email/dns-verification.js');
    const result = await verifyDomainDns(domain, undefined, true);

    health.spf = result.spf.valid;
    health.dkim = result.dkim.valid;
    health.dmarc = result.dmarc.valid;
    health.blacklist = result.blacklist.isBlacklisted;
    health.score = result.overallScore;
    health.status = result.overallStatus;
    health.warnings = [...result.recommendations];

    if (result.blacklist.isBlacklisted || result.overallStatus === 'poor') {
      health.riskLevel = 'high';
    } else if (result.overallStatus === 'fair' || !result.dkim.valid || !result.dmarc.valid) {
      health.riskLevel = 'medium';
    } else {
      health.riskLevel = 'low';
    }

    if (!result.spf.valid) health.warnings.push('SPF is missing or invalid.');
    if (!result.dkim.valid) health.warnings.push('DKIM is missing or invalid.');
    if (!result.dmarc.valid) health.warnings.push('DMARC is missing or invalid.');

    return health;
  } catch (error) {
    console.error(`[DNS Health] Failed to check domain ${domain}:`, error);
    health.warnings.push('Could not verify DNS records. Please ensure your domain is configured correctly.');
    health.riskLevel = 'high';
    return health;
  }
}
