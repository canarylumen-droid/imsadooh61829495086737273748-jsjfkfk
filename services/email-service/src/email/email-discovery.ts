
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

        // 2. Heuristic: try common subdomains
        return {
            smtp: {
                host: `smtp.${domain}`,
                port: 587
            },
            imap: {
                host: `imap.${domain}`,
                port: 993
            },
            provider: 'custom',
            suggestedName
        };
    }

    /**
     * Extract a likely display name from an email address
     */
    static suggestNameFromEmail(email: string): string {
        try {
            const prefix = email.split('@')[0];
            if (!prefix) return '';

            // Handle common delimiters: dots, underscores, plus signs, hyphens
            const parts = prefix.split(/[._+\-]/);
            
            // Capitalize each part and join with spaces
            return parts
                .map(part => part.trim())
                .filter(part => part.length > 0)
                .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
                .filter(part => !/^\d+$/.test(part)) // Filter out purely numeric parts
                .join(' ')
                .trim();
        } catch (e) {
            return '';
        }
    }
}

