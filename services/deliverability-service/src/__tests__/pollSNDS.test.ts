import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/client.js', () => ({
  db: { insert: vi.fn(() => ({ values: vi.fn() })) },
}));
vi.mock('../db/schema.js', () => ({ reputationSnapshots: {} }));

const mockFetchSNDSData = vi.fn();
vi.mock('../services/sndsClient.js', () => ({
  fetchSNDSData: (...args: any[]) => mockFetchSNDSData(...args),
}));

const mockNotifyCore = vi.fn();
vi.mock('../webhooks/notifyCore.js', () => ({
  notifyCore: (...args: any[]) => mockNotifyCore(...args),
}));

vi.mock('uuid', () => ({ v4: vi.fn(() => 'mocked-uuid') }));

vi.mock('../config.js', () => ({
  config: {
    snds: { clientId: 'snds-client-id' },
    thresholds: { postmasterSpamRateWarn: 0.003 },
  },
}));

describe('pollSNDS', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('should skip when no monitored domains', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'token' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ([]) });

    const { pollSNDS } = await import('../jobs/pollSNDS.js');
    await pollSNDS();

    expect(mockFetchSNDSData).not.toHaveBeenCalled();
  });

  it('should poll data for each domain and insert snapshot', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'snds-token' }) })
      .mockResolvedValueOnce({
        ok: true, json: async () => ([
          { domain: 'example.com' },
          { domain: 'test.org' },
        ]),
      });

    mockFetchSNDSData
      .mockResolvedValueOnce({ domain: 'example.com', spamRate: 0.001, ipReputation: 'HIGH', blacklisted: false, checkedAt: '2025-01-01' })
      .mockResolvedValueOnce({ domain: 'test.org', spamRate: 0.002, ipReputation: 'MEDIUM', blacklisted: false, checkedAt: '2025-01-01' });

    const { pollSNDS } = await import('../jobs/pollSNDS.js');
    await pollSNDS();

    expect(mockFetchSNDSData).toHaveBeenCalledTimes(2);
    expect(mockNotifyCore).not.toHaveBeenCalled();
  });

  it('should send pause webhook when blacklisted', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'token' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ([{ domain: 'blacklisted.com' }]) });

    mockFetchSNDSData.mockResolvedValueOnce({
      domain: 'blacklisted.com', spamRate: 0.1, ipReputation: 'BAD', blacklisted: true, checkedAt: '2025-01-01',
    });

    const { pollSNDS } = await import('../jobs/pollSNDS.js');
    await pollSNDS();

    expect(mockNotifyCore).toHaveBeenCalledWith({
      campaignId: '', source: 'snds', inboxRate: 0, spamRate: 1, action: 'pause',
    });
  });

  it('should send warn webhook when spam rate exceeds threshold', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'token' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ([{ domain: 'spammy.com' }]) });

    mockFetchSNDSData.mockResolvedValueOnce({
      domain: 'spammy.com', spamRate: 0.005, ipReputation: 'LOW', blacklisted: false, checkedAt: '2025-01-01',
    });

    const { pollSNDS } = await import('../jobs/pollSNDS.js');
    await pollSNDS();

    expect(mockNotifyCore).toHaveBeenCalledWith({
      campaignId: '', source: 'snds', inboxRate: 0.995, spamRate: 0.005, action: 'warn',
    });
  });

  it('should handle no access token', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });

    const { pollSNDS } = await import('../jobs/pollSNDS.js');
    await pollSNDS();

    expect(mockFetchSNDSData).not.toHaveBeenCalled();
  });

  it('should deduplicate domains', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'token' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ([{ domain: 'example.com' }, { domain: 'example.com' }]) });

    mockFetchSNDSData.mockResolvedValue({ domain: 'example.com', spamRate: 0.001, ipReputation: 'HIGH', blacklisted: false, checkedAt: '2025-01-01' });

    const { pollSNDS } = await import('../jobs/pollSNDS.js');
    await pollSNDS();

    expect(mockFetchSNDSData).toHaveBeenCalledTimes(1);
  });
});
