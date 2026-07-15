import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    snds: {
      clientId: 'snds-id',
      clientSecret: 'snds-secret',
      tenantId: 'snds-tenant',
    },
  },
}));

describe('sndsClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('should fetch token and return SNDS data', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'snds-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([{
          spamRate: 0.001,
          reputation: 'good',
          isBlacklisted: false,
        }]),
      });

    const { fetchSNDSData } = await import('../services/sndsClient.js');
    const result = await fetchSNDSData('example.com');
    expect(result).not.toBeNull();
    expect(result!.domain).toBe('example.com');
    expect(result!.spamRate).toBe(0.001);
    expect(result!.ipReputation).toBe('good');
    expect(result!.blacklisted).toBe(false);
  });

  it('should handle single object response (not array)', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          spamRate: 0.005,
          reputation: 'medium',
          isBlacklisted: false,
        }),
      });

    const { fetchSNDSData } = await import('../services/sndsClient.js');
    const result = await fetchSNDSData('example.com');
    expect(result?.spamRate).toBe(0.005);
    expect(result?.ipReputation).toBe('medium');
  });

  it('should use spam_complaint_rate fallback', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([{
          spam_complaint_rate: 0.003,
          reputation: 'low',
          blacklisted: true,
        }]),
      });

    const { fetchSNDSData } = await import('../services/sndsClient.js');
    const result = await fetchSNDSData('example.com');
    expect(result?.spamRate).toBe(0.003);
    expect(result?.blacklisted).toBe(true);
  });

  it('should return null when token fetch fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });

    const { fetchSNDSData } = await import('../services/sndsClient.js');
    const result = await fetchSNDSData('example.com');
    expect(result).toBeNull();
  });

  it('should return null when SNDS API fails', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token' }),
      })
      .mockResolvedValueOnce({ ok: false, status: 500 });

    const { fetchSNDSData } = await import('../services/sndsClient.js');
    const result = await fetchSNDSData('example.com');
    expect(result).toBeNull();
  });

  it('should use correct auth endpoint and scopes', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([]),
      });

    const { fetchSNDSData } = await import('../services/sndsClient.js');
    await fetchSNDSData('example.com');

    const tokenCall = fetchMock.mock.calls[0];
    expect(tokenCall[0]).toContain('login.microsoftonline.com/snds-tenant');
    expect(tokenCall[1]?.body?.get('scope')).toBe('https://outlook.office365.com/.default');
    expect(tokenCall[1]?.body?.get('grant_type')).toBe('client_credentials');
  });
});
