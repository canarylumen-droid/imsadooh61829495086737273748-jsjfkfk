import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    postmaster: {
      apiKey: 'pm-key',
      clientId: 'pm-client-id',
      clientSecret: 'pm-client-secret',
      refreshToken: 'pm-refresh-token',
    },
  },
}));

describe('postmasterClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('should return null when token fetch fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400 });

    const { fetchPostmasterData } = await import('../services/postmasterClient.js');
    const result = await fetchPostmasterData('example.com');
    expect(result).toBeNull();
  });

  it('should fetch access token and return postmaster data', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'test-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          trafficStats: [{
            spamRate: 0.002,
            ipReputation: 'HIGH',
          }],
        }),
      });

    const { fetchPostmasterData } = await import('../services/postmasterClient.js');
    const result = await fetchPostmasterData('example.com');
    expect(result).not.toBeNull();
    expect(result!.domain).toBe('example.com');
    expect(result!.spamRate).toBe(0.002);
    expect(result!.ipReputation).toBe('HIGH');
    expect(result!.checkedAt).toBeTruthy();
  });

  it('should return null when token refresh fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400 });

    const { fetchPostmasterData } = await import('../services/postmasterClient.js');
    const result = await fetchPostmasterData('example.com');
    expect(result).toBeNull();
  });

  it('should return null when API request fails', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token' }),
      })
      .mockResolvedValueOnce({ ok: false, status: 403 });

    const { fetchPostmasterData } = await import('../services/postmasterClient.js');
    const result = await fetchPostmasterData('example.com');
    expect(result).toBeNull();
  });

  it('should return null when no traffic stats', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

    const { fetchPostmasterData } = await import('../services/postmasterClient.js');
    const result = await fetchPostmasterData('example.com');
    expect(result).toBeNull();
  });

  it('should include correct URL and auth header', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'my-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ trafficStats: [{ spamRate: 0.001 }] }),
      });

    const { fetchPostmasterData } = await import('../services/postmasterClient.js');
    await fetchPostmasterData('my-domain.com');

    const statsCall = fetchMock.mock.calls[1];
    expect(statsCall[0]).toContain('my-domain.com');
    expect(statsCall[0]).toContain('gmailpostmaster.googleapis.com');
    expect(statsCall[1]?.headers?.Authorization).toBe('Bearer my-token');
  });

  it('should export getAccessToken for use by pollPostmaster', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'shared-token' }),
    });

    const { getAccessToken } = await import('../services/postmasterClient.js');
    const token = await getAccessToken();
    expect(token).toBe('shared-token');

    expect(fetchMock.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/token');
    const body = fetchMock.mock.calls[0][1]?.body;
    expect(body.get('client_id')).toBe('pm-client-id');
    expect(body.get('grant_type')).toBe('refresh_token');
  });
});
