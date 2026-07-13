import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockTrafficStatsList = vi.hoisted(() => vi.fn());
const mockDomainsList = vi.hoisted(() => vi.fn());

vi.mock('googleapis', () => {
  const MockGmailpostmastertools = vi.fn().mockImplementation(function() {
    return {
      domains: {
        trafficStats: {
          list: mockTrafficStatsList,
        },
        list: mockDomainsList,
      },
    };
  });

  return {
    google: {
      auth: {
        OAuth2: vi.fn(function() {
          return { setCredentials: vi.fn() };
        }),
      },
      gmailpostmastertools_v1: {
        Gmailpostmastertools: MockGmailpostmastertools,
      },
    },
  };
});

vi.mock('@shared/config/config/oauth-redirects.js', () => ({
  getOAuthRedirectUrl: vi.fn(() => 'https://localhost:5000/api/oauth/postmaster/callback'),
}));

describe('PostmasterService', () => {
  let PostmasterService: any;
  let postmasterService: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    const mod = await import('../postmaster-service.js');
    PostmasterService = mod.PostmasterService;
    postmasterService = new PostmasterService();
  });

  describe('constructor', () => {
    it('should be enabled when credentials are set', () => {
      expect(postmasterService.isEnabled).toBe(true);
    });

    it('should be disabled when GOOGLE_CLIENT_ID is missing', () => {
      delete process.env.GOOGLE_CLIENT_ID;
      const disabledService = new PostmasterService();
      expect(disabledService.isEnabled).toBe(false);
    });

    it('should be disabled when GOOGLE_CLIENT_SECRET is missing', () => {
      delete process.env.GOOGLE_CLIENT_SECRET;
      const disabledService = new PostmasterService();
      expect(disabledService.isEnabled).toBe(false);
    });
  });

  describe('mapReputation', () => {
    it('should map HIGH to 90', () => {
      expect((postmasterService as any).mapReputation('HIGH')).toBe(90);
    });

    it('should map MEDIUM to 60', () => {
      expect((postmasterService as any).mapReputation('MEDIUM')).toBe(60);
    });

    it('should map LOW to 30', () => {
      expect((postmasterService as any).mapReputation('LOW')).toBe(30);
    });

    it('should map BAD to 10', () => {
      expect((postmasterService as any).mapReputation('BAD')).toBe(10);
    });

    it('should map NOT_AVAILABLE to 50', () => {
      expect((postmasterService as any).mapReputation('NOT_AVAILABLE')).toBe(50);
    });

    it('should map unknown values to 50', () => {
      expect((postmasterService as any).mapReputation('UNKNOWN')).toBe(50);
    });
  });

  describe('ensureClient', () => {
    it('should return null when not enabled', () => {
      const disabledService = new PostmasterService();
      Object.defineProperty(disabledService, '_isEnabled', { value: false });
      const client = disabledService.ensureClient('some-token');
      expect(client).toBeNull();
    });

    it('should create a client when enabled', () => {
      const client = (postmasterService as any).ensureClient('test-access-token');
      expect(client).not.toBeNull();
      expect(client.domains).toBeDefined();
      expect(client.domains.trafficStats).toBeDefined();
    });
  });

  describe('fetchAllDomains', () => {
    it('should return empty array when not enabled', async () => {
      Object.defineProperty(postmasterService, '_isEnabled', { value: false });
      const result = await postmasterService.fetchAllDomains('token');
      expect(result).toEqual([]);
    });

    it('should return mapped domain names', async () => {
      mockDomainsList.mockResolvedValue({
        data: {
          domains: [
            { name: 'domains/example.com' },
            { name: 'domains/test.org' },
          ],
        },
      });

      const result = await postmasterService.fetchAllDomains('token');
      expect(result).toEqual(['example.com', 'test.org']);
    });

    it('should handle empty response', async () => {
      mockDomainsList.mockResolvedValue({ data: {} });

      const result = await postmasterService.fetchAllDomains('token');
      expect(result).toEqual([]);
    });
  });

  describe('fetchDomainMetrics', () => {
    it('should return null when not enabled', async () => {
      Object.defineProperty(postmasterService, '_isEnabled', { value: false });
      const result = await postmasterService.fetchDomainMetrics('example.com', 'token');
      expect(result).toBeNull();
    });

    it('should fetch and parse traffic stats correctly', async () => {
      mockTrafficStatsList.mockResolvedValue({
        data: {
          trafficStats: [
            {
              userReportedSpamRatio: 0.03,
              deliveryErrors: [
                { errorRatio: 0.01, errorType: 'rate_limit', errorClass: 'transient' },
              ],
              domainReputation: 'HIGH',
              inboundEncryptionRatio: 0.98,
              ipReputations: [
                { reputation: 'HIGH', sampleIps: ['203.0.113.1'] },
              ],
            },
          ],
        },
      });

      const result = await postmasterService.fetchDomainMetrics('example.com', 'token');

      expect(result).not.toBeNull();
      expect(result!.domain).toBe('example.com');
      expect(result!.spamRate).toBe(0.03);
      expect(result!.deliveryErrorRate).toBe(0.01);
      expect(result!.reputation).toBe(90);
      expect(result!.encryptedTrafficRate).toBe(0.98);
      expect(result!.ipsReputation.get('203.0.113.1')).toBe(90);
    });

    it('should return null when no traffic stats available', async () => {
      mockTrafficStatsList.mockResolvedValue({ data: {} });

      const result = await postmasterService.fetchDomainMetrics('example.com', 'token');
      expect(result).toBeNull();
    });

    it('should return null on 403/401 auth errors', async () => {
      const authError = new Error('Permission denied');
      (authError as any).code = 403;
      mockTrafficStatsList.mockRejectedValue(authError);

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = await postmasterService.fetchDomainMetrics('example.com', 'token');
      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should return null on 404', async () => {
      const notFound = new Error('Not found');
      (notFound as any).code = 404;
      mockTrafficStatsList.mockRejectedValue(notFound);

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = await postmasterService.fetchDomainMetrics('example.com', 'token');
      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should handle multiple delivery errors', async () => {
      mockTrafficStatsList.mockResolvedValue({
        data: {
          trafficStats: [
            {
              userReportedSpamRatio: 0.1,
              deliveryErrors: [
                { errorRatio: 0.03, errorType: 'rate_limit' },
                { errorRatio: 0.02, errorType: 'content_rejected' },
                { errorRatio: 0.01, errorType: 'unknown' },
              ],
              domainReputation: 'MEDIUM',
              inboundEncryptionRatio: 0.85,
              ipReputations: [],
            },
          ],
        },
      });

      const result = await postmasterService.fetchDomainMetrics('example.com', 'token');
      expect(result!.deliveryErrorRate).toBeCloseTo(0.06);
      expect(result!.reputation).toBe(60);
    });
  });
});
