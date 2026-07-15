import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/client.js', () => ({
  db: { insert: vi.fn(() => ({ values: vi.fn() })) },
}));
vi.mock('../db/schema.js', () => ({ reputationSnapshots: {} }));

const mockFetchPostmasterData = vi.fn();
const mockGetAccessToken = vi.fn();
vi.mock('../services/postmasterClient.js', () => ({
  fetchPostmasterData: (...args: any[]) => mockFetchPostmasterData(...args),
  getAccessToken: (...args: any[]) => mockGetAccessToken(...args),
}));

const mockNotifyCore = vi.fn();
vi.mock('../webhooks/notifyCore.js', () => ({
  notifyCore: (...args: any[]) => mockNotifyCore(...args),
}));

vi.mock('uuid', () => ({ v4: vi.fn(() => 'mocked-uuid') }));

vi.mock('../config.js', () => ({
  config: {
    postmaster: { clientId: 'pm-client-id' },
    thresholds: { postmasterSpamRateWarn: 0.003 },
  },
}));

describe('pollPostmaster', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('should skip when no verified domains', async () => {
    mockGetAccessToken.mockResolvedValue('token');
    fetchMock.mockResolvedValueOnce({
      ok: true, json: async () => ({ domains: [] }),
    });

    const { pollPostmaster } = await import('../jobs/pollPostmaster.js');
    await pollPostmaster();

    expect(mockFetchPostmasterData).not.toHaveBeenCalled();
  });

  it('should poll data for each domain and insert snapshot', async () => {
    mockGetAccessToken.mockResolvedValue('token');
    fetchMock.mockResolvedValueOnce({
      ok: true, json: async () => ({ domains: [{ name: 'domains/example.com' }, { name: 'domains/test.org' }] }),
    });

    mockFetchPostmasterData
      .mockResolvedValueOnce({ domain: 'example.com', spamRate: 0.002, ipReputation: 'HIGH', checkedAt: '2025-01-01' })
      .mockResolvedValueOnce({ domain: 'test.org', spamRate: 0.001, ipReputation: 'MEDIUM', checkedAt: '2025-01-01' });

    const { pollPostmaster } = await import('../jobs/pollPostmaster.js');
    await pollPostmaster();

    expect(mockFetchPostmasterData).toHaveBeenCalledTimes(2);
    expect(mockNotifyCore).not.toHaveBeenCalled();
  });

  it('should send warn webhook when spam rate exceeds threshold', async () => {
    mockGetAccessToken.mockResolvedValue('token');
    fetchMock.mockResolvedValueOnce({
      ok: true, json: async () => ({ domains: [{ name: 'domains/bad.com' }] }),
    });

    mockFetchPostmasterData.mockResolvedValueOnce({
      domain: 'bad.com', spamRate: 0.005, ipReputation: 'LOW', checkedAt: '2025-01-01',
    });

    const { pollPostmaster } = await import('../jobs/pollPostmaster.js');
    await pollPostmaster();

    expect(mockNotifyCore).toHaveBeenCalledWith({
      campaignId: '', source: 'postmaster', inboxRate: 0.995, spamRate: 0.005, action: 'warn',
    });
  });

  it('should handle no access token', async () => {
    mockGetAccessToken.mockResolvedValue(null);

    const { pollPostmaster } = await import('../jobs/pollPostmaster.js');
    await pollPostmaster();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should handle API failure when fetching domains', async () => {
    mockGetAccessToken.mockResolvedValue('token');
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });

    const { pollPostmaster } = await import('../jobs/pollPostmaster.js');
    await pollPostmaster();

    expect(mockFetchPostmasterData).not.toHaveBeenCalled();
  });
});
