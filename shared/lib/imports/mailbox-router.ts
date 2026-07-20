export interface MailboxInfo {
  id: string;
  email: string;
  provider: string;
  mailDomain?: string;
}

export interface DistributionEntry {
  mailboxId: string;
  count: number;
}

const OUTLOOK_DOMAINS = new Set(['outlook.com', 'hotmail.com', 'live.com', 'outlook.co.uk', 'outlook.fr', 'outlook.de', 'outlook.it', 'outlook.es']);

function floorCeilDistribute(count: number, slots: number): number[] {
  if (slots <= 0) return [];
  const base = Math.floor(count / slots);
  const remainder = count % slots;
  return Array.from({ length: slots }, (_, i) => base + (i < remainder ? 1 : 0));
}

export function getMailboxPool(integrations: any[]): MailboxInfo[] {
  return integrations
    .filter((i: any) =>
      ['gmail', 'outlook', 'custom_email'].includes(i.provider) && i.connected
    )
    .map((i: any) => ({
      id: i.id,
      email: (i as any).smtpUser || i.accountType || i.email || '',
      provider: i.provider,
      mailDomain: (i.accountType || i.email || '').split('@')[1]?.toLowerCase(),
    }))
    .filter(m => m.email);
}

export function assignMailbox(
  leadEmail: string | null | undefined,
  mailboxPool: MailboxInfo[],
  mailboxIndex: { current: number }
): string | null {
  if (!leadEmail || mailboxPool.length === 0) return null;

  const domain = leadEmail.split('@')[1]?.toLowerCase();
  if (!domain) return null;

  const isGmail = domain === 'gmail.com' || domain === 'googlemail.com';
  const isOutlook = OUTLOOK_DOMAINS.has(domain);

  let candidates: MailboxInfo[];

  if (isGmail) {
    candidates = mailboxPool.filter(m => m.provider === 'gmail');
  } else if (isOutlook) {
    candidates = mailboxPool.filter(m => m.provider === 'outlook');
  } else {
    const domainMailboxes = mailboxPool.filter(m => m.mailDomain === domain);
    if (domainMailboxes.length > 0) {
      candidates = domainMailboxes;
    } else {
      candidates = mailboxPool.filter(m => m.provider === 'custom_email');
      if (candidates.length === 0) candidates = mailboxPool;
    }
  }

  if (candidates.length === 0) candidates = mailboxPool;

  const mb = candidates[mailboxIndex.current % candidates.length];
  mailboxIndex.current++;
  return mb.id;
}

export function distributeLeadsEvenly(
  leadsByDomain: Map<string, number>,
  mailboxPool: MailboxInfo[],
): Map<string, DistributionEntry[]> {
  const result = new Map<string, DistributionEntry[]>();

  for (const [domain, count] of leadsByDomain) {
    if (count <= 0) continue;
    const dl = domain.toLowerCase();
    const isGmail = dl === 'gmail.com' || dl === 'googlemail.com';
    const isOutlook = OUTLOOK_DOMAINS.has(dl);

    let candidates: MailboxInfo[];
    if (isGmail) {
      candidates = mailboxPool.filter(m => m.provider === 'gmail');
    } else if (isOutlook) {
      candidates = mailboxPool.filter(m => m.provider === 'outlook');
    } else {
      const domainMatch = mailboxPool.filter(m => m.mailDomain === dl);
      if (domainMatch.length > 0) {
        candidates = domainMatch;
      } else {
        candidates = mailboxPool.filter(m => m.provider === 'custom_email');
        if (candidates.length === 0) candidates = mailboxPool;
      }
    }
    if (candidates.length === 0) candidates = mailboxPool;

    const shares = floorCeilDistribute(count, candidates.length);
    const entries: DistributionEntry[] = candidates.map((m, i) => ({
      mailboxId: m.id,
      count: shares[i],
    }));
    result.set(domain, entries);
  }

  return result;
}
