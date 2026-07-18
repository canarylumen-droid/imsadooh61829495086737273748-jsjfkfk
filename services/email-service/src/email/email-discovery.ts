import dns from 'dns';
import { promisify } from 'util';
import net from 'net';

const resolveMx = promisify(dns.resolveMx);

/**
 * Email Discovery Service
 * Automatically detects SMTP/IMAP settings based on email domain
 */

interface EmailSettings {
    smtp: {
        host: string;
        port: number;
    };
    imap: {
        host: string;
        port: number;
    };
    provider: string;
}

/**
 * Known MX → IMAP host mappings based on common providers.
 * Derived from the MX hostname, not the email domain.
 */
const MX_TO_IMAP: Record<string, string> = {
    'aspmx.l.google.com': 'imap.gmail.com',
    'alt1.aspmx.l.google.com': 'imap.gmail.com',
    'alt2.aspmx.l.google.com': 'imap.gmail.com',
    'alt3.aspmx.l.google.com': 'imap.gmail.com',
    'alt4.aspmx.l.google.com': 'imap.gmail.com',
    'mx1.office365.com': 'outlook.office365.com',
    'mx2.office365.com': 'outlook.office365.com',
    'mx3.office365.com': 'outlook.office365.com',
    'mx4.office365.com': 'outlook.office365.com',
    'mx1.microsoft365.com': 'outlook.office365.com',
    'mx2.microsoft365.com': 'outlook.office365.com',
    'mx1.hotmail.com': 'outlook.office365.com',
    'mx2.hotmail.com': 'outlook.office365.com',
    'mx1.mail.yahoo.com': 'imap.mail.yahoo.com',
    'mx2.mail.yahoo.com': 'imap.mail.yahoo.com',
    'mx1.zoho.com': 'imappro.zoho.com',
    'mx2.zoho.com': 'imappro.zoho.com',
    'mx3.zoho.com': 'imappro.zoho.com',
};

const PROVIDER_MAP: Record<string, EmailSettings> = {
    'gmail.com': {
        smtp: { host: 'smtp.gmail.com', port: 465 },
        imap: { host: 'imap.gmail.com', port: 993 },
        provider: 'gmail'
    },
    'googlemail.com': {
        smtp: { host: 'smtp.gmail.com', port: 465 },
        imap: { host: 'imap.gmail.com', port: 993 },
        provider: 'gmail'
    },
    'outlook.com': {
        smtp: { host: 'smtp-mail.outlook.com', port: 587 },
        imap: { host: 'outlook.office365.com', port: 993 },
        provider: 'outlook'
    },
    'hotmail.com': {
        smtp: { host: 'smtp-mail.outlook.com', port: 587 },
        imap: { host: 'outlook.office365.com', port: 993 },
        provider: 'outlook'
    },
    'live.com': {
        smtp: { host: 'smtp-mail.outlook.com', port: 587 },
        imap: { host: 'outlook.office365.com', port: 993 },
        provider: 'outlook'
    },
    'icloud.com': {
        smtp: { host: 'smtp.mail.me.com', port: 587 },
        imap: { host: 'imap.mail.me.com', port: 993 },
        provider: 'icloud'
    },
    'me.com': {
        smtp: { host: 'smtp.mail.me.com', port: 587 },
        imap: { host: 'imap.mail.me.com', port: 993 },
        provider: 'icloud'
    },
    'yahoo.com': {
        smtp: { host: 'smtp.mail.yahoo.com', port: 465 },
        imap: { host: 'imap.mail.yahoo.com', port: 993 },
        provider: 'yahoo'
    },
    'ymail.com': {
        smtp: { host: 'smtp.mail.yahoo.com', port: 465 },
        imap: { host: 'imap.mail.yahoo.com', port: 993 },
        provider: 'yahoo'
    },
    'zoho.com': {
        smtp: { host: 'smtppro.zoho.com', port: 465 },
        imap: { host: 'imappro.zoho.com', port: 993 },
        provider: 'zoho'
    },
    'zoho.in': {
        smtp: { host: 'smtppro.zoho.in', port: 465 },
        imap: { host: 'imappro.zoho.in', port: 993 },
        provider: 'zoho'
    },
    'office365.com': {
        smtp: { host: 'smtp.office365.com', port: 587 },
        imap: { host: 'outlook.office365.com', port: 993 },
        provider: 'outlook'
    },
    'microsoft365.com': {
        smtp: { host: 'smtp.office365.com', port: 587 },
        imap: { host: 'outlook.office365.com', port: 993 },
        provider: 'outlook'
    },
    'privateemail.com': {
        smtp: { host: 'mail.privateemail.com', port: 465 },
        imap: { host: 'mail.privateemail.com', port: 993 },
        provider: 'namecheap'
    },
    'secureserver.net': {
        smtp: { host: 'smtpout.secureserver.net', port: 465 },
        imap: { host: 'imap.secureserver.net', port: 993 },
        provider: 'godaddy'
    },
    'protonmail.com': {
        smtp: { host: '127.0.0.1', port: 1025 },
        imap: { host: '127.0.0.1', port: 1143 },
        provider: 'protonmail'
    },
    'proton.me': {
        smtp: { host: '127.0.0.1', port: 1025 },
        imap: { host: '127.0.0.1', port: 1143 },
        provider: 'protonmail'
    },
    'aol.com': {
        smtp: { host: 'smtp.aol.com', port: 465 },
        imap: { host: 'imap.aol.com', port: 993 },
        provider: 'aol'
    },
    'gmx.com': {
        smtp: { host: 'mail.gmx.com', port: 587 },
        imap: { host: 'imap.gmx.com', port: 993 },
        provider: 'gmx'
    },
    'hostinger.com': {
        smtp: { host: 'smtp.hostinger.com', port: 465 },
        imap: { host: 'imap.hostinger.com', port: 993 },
        provider: 'hostinger'
    },
    'fastmail.com': {
        smtp: { host: 'smtp.fastmail.com', port: 465 },
        imap: { host: 'imap.fastmail.com', port: 993 },
        provider: 'fastmail'
    },
    'dreamhost.com': {
        smtp: { host: 'smtp.dreamhost.com', port: 465 },
        imap: { host: 'imap.dreamhost.com', port: 993 },
        provider: 'dreamhost'
    },
    'rackspace.com': {
        smtp: { host: 'smtp.emailsrvr.com', port: 465 },
        imap: { host: 'secure.emailsrvr.com', port: 993 },
        provider: 'rackspace'
    }
};

export class EmailDiscoveryService {
    /**
     * Resolve settings for a given email address
     */
    static async discoverSettings(email: string): Promise<EmailSettings & { suggestedName?: string } | null> {
        const domain = email.split('@')[1]?.toLowerCase();
        if (!domain) return null;

        const suggestedName = this.suggestNameFromEmail(email);

        // 1. Check known providers
        if (PROVIDER_MAP[domain]) {
            return {
                ...PROVIDER_MAP[domain],
                suggestedName
            };
        }

        // 2. MX-based discovery: resolve MX, derive SMTP/IMAP from MX host
        const mxHost = await this.resolveMxHost(domain);
        if (mxHost) {
            const smtpHost = mxHost;
            // Try to derive IMAP from MX host mapping, or guess from domain
            const imapHost = MX_TO_IMAP[mxHost.toLowerCase()]
                || this.guessImapFromMx(mxHost, domain);

            return {
                smtp: { host: smtpHost, port: 587 },
                imap: { host: imapHost, port: 993 },
                provider: 'custom',
                suggestedName
            };
        }

        // 3. Fallback: probe common subdomains + port combinations
        const smtpCandidates: Array<{ host: string; port: number }> = [
            { host: `smtp.${domain}`, port: 587 },
            { host: `smtp.${domain}`, port: 465 },
            { host: `mail.${domain}`, port: 587 },
            { host: `mail.${domain}`, port: 465 },
            { host: `mx.${domain}`, port: 587 },
            { host: domain, port: 587 },
            { host: domain, port: 25 },
        ];
        const imapCandidates: Array<{ host: string; port: number }> = [
            { host: `imap.${domain}`, port: 993 },
            { host: `imap.${domain}`, port: 143 },
            { host: `mail.${domain}`, port: 993 },
            { host: `mail.${domain}`, port: 995 },
            { host: domain, port: 993 },
        ];

        const probePort = (host: string, port: number, timeoutMs = 3000): Promise<boolean> =>
            new Promise(resolve => {
                const sock = new net.Socket();
                sock.setTimeout(timeoutMs);
                sock.once('connect', () => { sock.destroy(); resolve(true); });
                sock.once('timeout', () => { sock.destroy(); resolve(false); });
                sock.once('error', () => resolve(false));
                sock.connect(port, host);
            });

        let smtpResult = smtpCandidates[0];
        for (const candidate of smtpCandidates) {
            if (await probePort(candidate.host, candidate.port)) {
                smtpResult = candidate;
                break;
            }
        }

        let imapResult = imapCandidates[0];
        for (const candidate of imapCandidates) {
            if (await probePort(candidate.host, candidate.port)) {
                imapResult = candidate;
                break;
            }
        }

        return {
            smtp: smtpResult,
            imap: imapResult,
            provider: 'custom',
            suggestedName
        };
    }

    /**
     * Resolve the highest-priority MX hostname for a domain.
     */
    private static async resolveMxHost(domain: string): Promise<string | null> {
        try {
            const records = await resolveMx(domain);
            if (!records || records.length === 0) return null;
            records.sort((a, b) => a.priority - b.priority);
            return records[0].exchange.replace(/\.$/, '');
        } catch {
            return null;
        }
    }

    /**
     * Guess IMAP host from MX hostname or domain.
     */
    private static guessImapFromMx(mxHost: string, domain: string): string {
        const mxl = mxHost.toLowerCase();
        if (mxl.includes('google') || mxl.includes('aspmx')) return 'imap.gmail.com';
        if (mxl.includes('office365') || mxl.includes('outlook') || mxl.includes('hotmail')) return 'outlook.office365.com';
        if (mxl.includes('yahoo')) return 'imap.mail.yahoo.com';
        if (mxl.includes('zoho')) return 'imappro.zoho.com';
        if (mxl.includes('icloud') || mxl.includes('me.com')) return 'imap.mail.me.com';
        if (mxl.includes('aol')) return 'imap.aol.com';
        if (mxl.includes('gmx')) return 'imap.gmx.com';

        // Fallback: guess from domain
        return `imap.${domain}`;
    }

    /**
     * Extract a likely display name from an email address
     */
    static suggestNameFromEmail(email: string): string {
        try {
            const prefix = email.split('@')[0];
            if (!prefix) return '';

            const parts = prefix.split(/[._+\-]/);

            return parts
                .map(part => part.trim())
                .filter(part => part.length > 0)
                .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
                .filter(part => !/^\d+$/.test(part))
                .join(' ')
                .trim();
        } catch (e) {
            return '';
        }
    }
}
