import { describe, it, expect } from 'vitest';

describe('Email Channel - Unsubscribe Domain', () => {
  function extractSenderDomain(from: string): string {
    return from.includes('@') ? from.split('@')[1] : 'audnixai.com';
  }

  function buildUnsubscribeUrl(from: string, leadId: string): string {
    const domain = extractSenderDomain(from);
    const appUrl = process.env.PUBLIC_URL || `https://${domain}`;
    return `${appUrl}/api/unsubscribe/${leadId}`;
  }

  function buildUnsubscribeEmail(from: string): string {
    const domain = extractSenderDomain(from);
    return `unsubscribe@${domain}`;
  }

  function buildMessageIdDomain(from: string): string {
    return extractSenderDomain(from);
  }

  describe('Domain Extraction', () => {
    it('should extract domain from email address', () => {
      expect(extractSenderDomain('user@gmail.com')).toBe('gmail.com');
      expect(extractSenderDomain('sender@company.com')).toBe('company.com');
      expect(extractSenderDomain('outreach@audnixai.com')).toBe('audnixai.com');
    });

    it('should handle complex email addresses', () => {
      expect(extractSenderDomain('user.name+tag@subdomain.domain.com')).toBe('subdomain.domain.com');
      expect(extractSenderDomain('user@outlook.com')).toBe('outlook.com');
      expect(extractSenderDomain('user@yahoo.com')).toBe('yahoo.com');
    });

    it('should fallback to audnixai.com for invalid emails', () => {
      expect(extractSenderDomain('invalid-email')).toBe('audnixai.com');
      expect(extractSenderDomain('')).toBe('audnixai.com');
    });
  });

  describe('Unsubscribe URL Generation', () => {
    it('should generate URL with sender domain', () => {
      const url = buildUnsubscribeUrl('user@gmail.com', 'lead-123');
      expect(url).toBe('https://gmail.com/api/unsubscribe/lead-123');
    });

    it('should use PUBLIC_URL when available', () => {
      process.env.PUBLIC_URL = 'https://app.mycrm.com';
      const url = buildUnsubscribeUrl('user@gmail.com', 'lead-123');
      expect(url).toBe('https://app.mycrm.com/api/unsubscribe/lead-123');
      delete process.env.PUBLIC_URL;
    });

    it('should use custom domain when no PUBLIC_URL', () => {
      delete process.env.PUBLIC_URL;
      const url = buildUnsubscribeUrl('sender@mycompany.com', 'lead-456');
      expect(url).toBe('https://mycompany.com/api/unsubscribe/lead-456');
    });
  });

  describe('Unsubscribe Email Generation', () => {
    it('should generate mailto with sender domain', () => {
      const email = buildUnsubscribeEmail('user@gmail.com');
      expect(email).toBe('unsubscribe@gmail.com');
    });

    it('should handle different domains', () => {
      expect(buildUnsubscribeEmail('user@outlook.com')).toBe('unsubscribe@outlook.com');
      expect(buildUnsubscribeEmail('user@yahoo.com')).toBe('unsubscribe@yahoo.com');
      expect(buildUnsubscribeEmail('user@mycompany.com')).toBe('unsubscribe@mycompany.com');
    });
  });

  describe('Message-ID Domain', () => {
    it('should use sender domain for Message-ID', () => {
      expect(buildMessageIdDomain('user@gmail.com')).toBe('gmail.com');
      expect(buildMessageIdDomain('sender@outlook.com')).toBe('outlook.com');
    });
  });

  describe('List-Unsubscribe Header', () => {
    it('should include both web and mailto URLs', () => {
      const from = 'sender@mycompany.com';
      const leadId = 'lead-789';
      const domain = extractSenderDomain(from);
      const appUrl = process.env.PUBLIC_URL || `https://${domain}`;
      const unsubscribeUrl = `${appUrl}/api/unsubscribe/${leadId}`;
      const unsubscribeEmail = `unsubscribe@${domain}`;

      const header = `List-Unsubscribe: <${unsubscribeUrl}>, <mailto:${unsubscribeEmail}?subject=unsubscribe>`;

      expect(header).toContain('https://mycompany.com/api/unsubscribe/lead-789');
      expect(header).toContain('mailto:unsubscribe@mycompany.com?subject=unsubscribe');
    });
  });
});
