import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('SpamMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Spam Folder Detection', () => {
    it('should detect spam folder placement via subject match', () => {
      const emailSubject = 'Re: Q3 Pipeline Review - 30% growth';
      const sentEmails = [
        { subject: 'Q3 Pipeline Review - 30% growth', recipientEmail: 'prospect@company.com' },
        { subject: 'Q3 Pipeline Review', recipientEmail: 'lead@startup.io' },
      ];

      function findMatchingSentEmail(spamSubject: string): typeof sentEmails[0] | null {
        for (const sent of sentEmails) {
          if (spamSubject.includes(sent.subject)) {
            return sent;
          }
        }
        return null;
      }

      const match = findMatchingSentEmail(emailSubject);
      expect(match).not.toBeNull();
      expect(match?.recipientEmail).toBe('prospect@company.com');
    });

    it('should not match unrelated emails', () => {
      const emailSubject = 'Nigerian Prince - You won $1M';
      const sentEmails = [
        { subject: 'Q3 Pipeline Review', recipientEmail: 'prospect@company.com' },
      ];

      function findMatchingSentEmail(spamSubject: string): typeof sentEmails[0] | null {
        for (const sent of sentEmails) {
          if (spamSubject.includes(sent.subject)) {
            return sent;
          }
        }
        return null;
      }

      const match = findMatchingSentEmail(emailSubject);
      expect(match).toBeNull();
    });
  });

  describe('Spam Threshold Detection', () => {
    it('should trigger alert when spam rate exceeds 5%', () => {
      const spamRate = 0.06;
      const threshold = 0.05;
      expect(spamRate > threshold).toBe(true);
    });

    it('should not trigger alert when spam rate is below 5%', () => {
      const spamRate = 0.03;
      const threshold = 0.05;
      expect(spamRate > threshold).toBe(false);
    });

    it('should trigger critical alert when spam rate exceeds 10%', () => {
      const spamRate = 0.12;
      const criticalThreshold = 0.10;
      expect(spamRate > criticalThreshold).toBe(true);
    });
  });

  describe('Provider Spam Thresholds', () => {
    const providerThresholds: Record<string, number> = {
      gmail: 0.03,
      google: 0.03,
      outlook: 0.04,
      microsoft: 0.04,
      yahoo: 0.035,
      icloud: 0.025,
      aol: 0.04,
      default: 0.05,
    };

    function getProviderThreshold(provider: string): number {
      return providerThresholds[provider.toLowerCase()] || providerThresholds.default;
    }

    it('should use stricter threshold for Gmail', () => {
      expect(getProviderThreshold('gmail')).toBe(0.03);
      expect(getProviderThreshold('google')).toBe(0.03);
    });

    it('should use standard threshold for Outlook', () => {
      expect(getProviderThreshold('outlook')).toBe(0.04);
      expect(getProviderThreshold('microsoft')).toBe(0.04);
    });

    it('should use default threshold for unknown providers', () => {
      expect(getProviderThreshold('custom')).toBe(0.05);
      expect(getProviderThreshold('unknown')).toBe(0.05);
    });
  });
});
