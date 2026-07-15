import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config.js', () => ({
  config: {
    warmup: { url: 'http://warmup:3101', apiKey: 'test-api-key' },
    seedCheck: { cacheTtlMs: 60_000 },
  },
}));

describe('warmupServiceClient', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    const mod = await import('../services/warmupServiceClient.js');
    mod.invalidateCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should fetch and return seed accounts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        seeds: [{ id: 's1', email: 'seed1@gmail.com', provider: 'gmail', imapHost: 'imap.gmail.com', imapPort: 993, imapUser: 'seed1@gmail.com', imapPass: 'app-pw' }],
      }),
    }));

    const { fetchSeedAccounts } = await import('../services/warmupServiceClient.js');
    const seeds = await fetchSeedAccounts();
    expect(seeds).toHaveLength(1);
    expect(seeds[0].email).toBe('seed1@gmail.com');
  });

  it('should return cached results on second call within TTL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        seeds: [{ id: 's1', email: 's1@gmail.com', provider: 'gmail', imapHost: 'imap.gmail.com', imapPort: 993, imapUser: 's1@gmail.com', imapPass: 'pw' }],
      }),
    }));

    const { fetchSeedAccounts } = await import('../services/warmupServiceClient.js');
    await fetchSeedAccounts();
    vi.stubGlobal('fetch', vi.fn());

    const seeds2 = await fetchSeedAccounts();
    expect(seeds2).toHaveLength(1);
  });

  it('should refetch after cache TTL expires', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        seeds: [{ id: 's1', email: 's1@gmail.com', provider: 'gmail', imapHost: 'imap.gmail.com', imapPort: 993, imapUser: 's1@gmail.com', imapPass: 'pw' }],
      }),
    }));

    const { fetchSeedAccounts } = await import('../services/warmupServiceClient.js');
    await fetchSeedAccounts();
    vi.stubGlobal('fetch', vi.fn());

    vi.advanceTimersByTime(120_000);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        seeds: [{ id: 's2', email: 's2@gmail.com', provider: 'gmail', imapHost: 'imap.gmail.com', imapPort: 993, imapUser: 's2@gmail.com', imapPass: 'pw' }],
      }),
    }));

    const seeds2 = await fetchSeedAccounts();
    expect(seeds2).toHaveLength(1);
    expect(seeds2[0].id).toBe('s2');
  });

  it('should filter out seeds without imapHost or imapPass', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        seeds: [
          { id: 's1', email: 'good@gmail.com', provider: 'gmail', imapHost: 'imap.gmail.com', imapPort: 993, imapUser: 'good@gmail.com', imapPass: 'pw' },
          { id: 's2', email: 'nohost@gmail.com', provider: 'gmail', imapHost: '', imapPort: 993, imapUser: 'nohost@gmail.com', imapPass: 'pw' },
          { id: 's3', email: 'nopass@gmail.com', provider: 'gmail', imapHost: 'imap.gmail.com', imapPort: 993, imapUser: 'nopass@gmail.com', imapPass: '' },
        ],
      }),
    }));

    const { fetchSeedAccounts } = await import('../services/warmupServiceClient.js');
    const seeds = await fetchSeedAccounts();
    expect(seeds).toHaveLength(1);
    expect(seeds[0].id).toBe('s1');
  });

  it('should fall back to cached list on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        seeds: [{ id: 's1', email: 's1@gmail.com', provider: 'gmail', imapHost: 'imap.gmail.com', imapPort: 993, imapUser: 's1@gmail.com', imapPass: 'pw' }],
      }),
    }));

    const { fetchSeedAccounts } = await import('../services/warmupServiceClient.js');
    await fetchSeedAccounts();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 500 }));

    const seeds2 = await fetchSeedAccounts();
    expect(seeds2).toHaveLength(1);
  });

  it('should return empty array on first fetch failure with no cache', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('Network error')));
    const { fetchSeedAccounts } = await import('../services/warmupServiceClient.js');
    const seeds = await fetchSeedAccounts();
    expect(seeds).toEqual([]);
  });

  it('should use email as imapUser fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        seeds: [{ id: 's1', email: 'seed@test.com', provider: 'gmail', imapHost: 'imap.gmail.com', imapPort: 993, imapPass: 'pw' }],
      }),
    }));

    const { fetchSeedAccounts } = await import('../services/warmupServiceClient.js');
    const seeds = await fetchSeedAccounts();
    expect(seeds[0].imapUser).toBe('seed@test.com');
  });

  it('should send Authorization header when apiKey is set', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ seeds: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { fetchSeedAccounts } = await import('../services/warmupServiceClient.js');
    await fetchSeedAccounts();

    const callUrl = fetchMock.mock.calls[0][0];
    const callHeaders = fetchMock.mock.calls[0][1]?.headers;
    expect(callUrl).toBe('http://warmup:3101/api/internal/seed-accounts');
    expect(callHeaders['Authorization']).toBe('Bearer test-api-key');
  });
});
