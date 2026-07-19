export interface MailboxInfo {
  id: string;
  email: string;
  provider: string;
}

const OUTLOOK_DOMAINS = new Set(['outlook.com', 'hotmail.com', 'live.com', 'outlook.co.uk', 'outlook.fr', 'outlook.de', 'outlook.it', 'outlook.es']);

export function getMailboxPool(integrations: any[]): MailboxInfo[] {
  return integrations
    .filter((i: any) =>
      ['gmail', 'outlook', 'custom_email'].includes(i.provider) && i.connected
    )
    .map((i: any) => ({
      id: i.id,
      email: (i as any).smtpUser || i.accountType || i.email || '',
      provider: i.provider,
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
    const domainMailboxes = mailboxPool.filter(m => {
      const mailboxDomain = m.email.split('@')[1]?.toLowerCase();
      return mailboxDomain === domain;
    });
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
