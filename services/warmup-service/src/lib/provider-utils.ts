const PROVIDER_DOMAIN_MAP: Record<string, string> = {
  'gmail.com': 'gmail',
  'googlemail.com': 'gmail',
  'outlook.com': 'outlook',
  'hotmail.com': 'outlook',
  'live.com': 'outlook',
  'msn.com': 'outlook',
  'passport.com': 'outlook',
  'yahoo.com': 'yahoo',
  'yahoo.co.uk': 'yahoo',
  'yahoo.co.jp': 'yahoo',
  'yahoo.com.au': 'yahoo',
  'yahoo.in': 'yahoo',
  'ymail.com': 'yahoo',
  'rocketmail.com': 'yahoo',
  'aol.com': 'aol',
  'aol.co.uk': 'aol',
  'protonmail.com': 'proton',
  'proton.me': 'proton',
  'pm.me': 'proton',
  'icloud.com': 'icloud',
  'me.com': 'icloud',
  'mac.com': 'icloud',
  'zoho.com': 'zoho',
  'yandex.com': 'yandex',
  'mail.ru': 'mailru',
  'gmx.com': 'gmx',
  'gmx.net': 'gmx',
};

const CONSUMER_DOMAINS = new Set(Object.keys(PROVIDER_DOMAIN_MAP));

export type ProviderCategory = 'gmail' | 'outlook' | 'yahoo' | 'aol' | 'proton' | 'icloud' | 'zoho' | 'yandex' | 'mailru' | 'gmx' | 'custom_email';

export type ProviderGroup = 'google' | 'microsoft' | 'other';

const PROVIDER_GROUP: Record<string, ProviderGroup> = {
  gmail: 'google',
  outlook: 'microsoft',
  yahoo: 'other',
  aol: 'other',
  proton: 'other',
  icloud: 'other',
  zoho: 'other',
  yandex: 'other',
  mailru: 'other',
  gmx: 'other',
  custom_email: 'other',
};

export function detectProvider(email: string): ProviderCategory {
  const atIndex = email.lastIndexOf('@');
  if (atIndex === -1) return 'custom_email';

  const domain = email.slice(atIndex + 1).toLowerCase().trim();
  if (!domain) return 'custom_email';

  if (CONSUMER_DOMAINS.has(domain)) {
    return PROVIDER_DOMAIN_MAP[domain] as ProviderCategory;
  }

  if (domain.endsWith('googlemail.com') || domain.endsWith('gmail.com')) {
    return 'gmail';
  }

  if (domain.endsWith('outlook.com') || domain.endsWith('hotmail.com') || domain.endsWith('live.com') || domain.endsWith('office365.com')) {
    return 'outlook';
  }

  if (domain.endsWith('yahoo.com') || domain.endsWith('yahoo.co.uk')) {
    return 'yahoo';
  }

  return 'custom_email';
}

export function getProviderGroup(category: ProviderCategory): ProviderGroup {
  return PROVIDER_GROUP[category] || 'other';
}

export function isSameProviderGroup(a: string, b: string): boolean {
  const catA = detectProvider(a);
  const catB = detectProvider(b);
  return getProviderGroup(catA) === getProviderGroup(catB);
}

export function isCrossProviderPair(a: string, b: string): boolean {
  const catA = detectProvider(a);
  const catB = detectProvider(b);
  return getProviderGroup(catA) !== getProviderGroup(catB);
}

export function getProviderDiversityDescription(email: string): string {
  const cat = detectProvider(email);
  const group = getProviderGroup(cat);
  if (cat === 'gmail') return 'Google (Gmail/Workspace)';
  if (cat === 'outlook') return 'Microsoft (Outlook/365)';
  if (cat === 'yahoo') return 'Yahoo Mail';
  if (cat === 'custom_email') return 'Custom SMTP';
  return `${cat.charAt(0).toUpperCase() + cat.slice(1)}`;
}

export function getProviderGroupName(cat: ProviderCategory): string {
  if (cat === 'gmail') return 'Google';
  if (cat === 'outlook') return 'Microsoft';
  return 'Other';
}

export function getGroupPairingScore(emailA: string, emailB: string): number {
  const groupA = getProviderGroup(detectProvider(emailA));
  const groupB = getProviderGroup(detectProvider(emailB));

  if (groupA !== groupB) return 3;
  if (groupA === 'other' && groupB === 'other' && detectProvider(emailA) !== detectProvider(emailB)) return 2;
  if (detectProvider(emailA) !== detectProvider(emailB)) return 1;
  return 0;
}

export function getPairingQualityLabel(emailA: string, emailB: string): string {
  const score = getGroupPairingScore(emailA, emailB);
  switch (score) {
    case 3: return `cross-provider (${getProviderGroupName(detectProvider(emailA))} ↔ ${getProviderGroupName(detectProvider(emailB))})`;
    case 2: return `different-provider (${detectProvider(emailA)} ↔ ${detectProvider(emailB)})`;
    case 1: return `same-group (${getProviderGroupName(detectProvider(emailA))})`;
    default: return `same-provider (${detectProvider(emailA)})`;
  }
}