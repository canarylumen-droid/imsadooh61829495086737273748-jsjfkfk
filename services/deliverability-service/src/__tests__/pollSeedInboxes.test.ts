import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

class SelectBuilder {
  from = vi.fn(() => this);
  where = vi.fn(() => []);
  groupBy = vi.fn(() => []);
}

const mockSelect = new SelectBuilder();
const mockInsertValues = vi.fn(() => ({ onConflictDoNothing: vi.fn() }));
const mockUpdateSet = vi.fn(() => ({ where: vi.fn() }));

vi.mock('../db/client.js', () => ({
  db: {
    select: vi.fn(() => mockSelect),
    insert: vi.fn(() => ({ values: mockInsertValues })),
    update: vi.fn(() => ({ set: mockUpdateSet })),
  },
}));

vi.mock('../db/schema.js', () => ({
  seedResults: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => 'eq'),
  isNull: vi.fn(() => 'isnull'),
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mocked-uuid'),
}));

const mockCheckSeedPlacement = vi.fn();
vi.mock('../services/imapClient.js', () => ({
  checkSeedPlacement: (...args: any[]) => mockCheckSeedPlacement(...args),
}));

const mockFetchSeedAccounts = vi.fn();
vi.mock('../services/warmupServiceClient.js', () => ({
  fetchSeedAccounts: (...args: any[]) => mockFetchSeedAccounts(...args),
}));

const mockNotifyCore = vi.fn();
const mockNotifySeedUpdate = vi.fn();
vi.mock('../webhooks/notifyCore.js', () => ({
  notifyCore: (...args: any[]) => mockNotifyCore(...args),
  notifySeedUpdate: (...args: any[]) => mockNotifySeedUpdate(...args),
}));

vi.mock('../config.js', () => ({
  config: {
    seedCheck: { maxWaitMinutes: 120, cacheTtlMs: 60000 },
    thresholds: { inboxRateWarn: 0.85, inboxRatePause: 0.70 },
  },
}));

function makeRow(overrides = {}) {
  return {
    id: 'row-1', campaignId: 'camp-1', testId: 'test-1',
    seedAccountRef: 's1', userId: 'u1', provider: 'gmail',
    folderFound: null, checkedAt: null,
    createdAt: '2025-06-01T11:55:00Z',
    ...overrides,
  };
}

const defaultSeed = { id: 's1', email: 's1@g.com', provider: 'gmail' as const, imapHost: 'imap.gmail.com', imapPort: 993, imapUser: 's1@g.com', imapPass: 'pw' };

describe('pollSeedInboxes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-01T12:00:00Z'));
    mockSelect.where.mockResolvedValue([]);
    mockSelect.groupBy.mockResolvedValue([]);
    mockUpdateSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mockInsertValues.mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('pollSeedInboxes', () => {
    it('should skip when no seed accounts', async () => {
      mockFetchSeedAccounts.mockResolvedValue([]);

      const { pollSeedInboxes } = await import('../jobs/pollSeedInboxes.js');
      await pollSeedInboxes();

      expect(mockFetchSeedAccounts).toHaveBeenCalledOnce();
    });

    it('should skip when no pending rows', async () => {
      mockFetchSeedAccounts.mockResolvedValue([defaultSeed]);
      mockSelect.where.mockResolvedValue([]);

      const { pollSeedInboxes } = await import('../jobs/pollSeedInboxes.js');
      await pollSeedInboxes();

      expect(mockCheckSeedPlacement).not.toHaveBeenCalled();
    });

    it('should expire rows past maxWaitMinutes', async () => {
      mockFetchSeedAccounts.mockResolvedValue([defaultSeed]);
      mockSelect.where
        .mockResolvedValueOnce([makeRow({ createdAt: '2025-06-01T08:00:00Z' })])
        .mockResolvedValue([]);

      const { pollSeedInboxes } = await import('../jobs/pollSeedInboxes.js');
      await pollSeedInboxes();

      expect(mockUpdateSet).toHaveBeenCalledWith({ folderFound: 'not_found', checkedAt: '2025-06-01T12:00:00.000Z' });
      expect(mockCheckSeedPlacement).not.toHaveBeenCalled();
    });

    it('should check pending seeds and update results', async () => {
      mockFetchSeedAccounts.mockResolvedValue([defaultSeed]);
      mockSelect.where
        .mockResolvedValueOnce([makeRow()])
        .mockResolvedValue([]);

      mockCheckSeedPlacement.mockResolvedValue({ folder: 'inbox' });

      const { pollSeedInboxes } = await import('../jobs/pollSeedInboxes.js');
      await pollSeedInboxes();

      expect(mockCheckSeedPlacement).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }), 'test-1', 20);
      expect(mockUpdateSet).toHaveBeenCalledWith({ folderFound: 'inbox', checkedAt: '2025-06-01T12:00:00.000Z' });
      expect(mockNotifySeedUpdate).toHaveBeenCalledWith({
        campaignId: 'camp-1', testId: 'test-1', seedEmail: 's1@g.com', folder: 'inbox', provider: 'gmail', userId: 'u1',
      });
    });

    it('should handle expired rows with empty createdAt', async () => {
      mockFetchSeedAccounts.mockResolvedValue([defaultSeed]);
      mockSelect.where
        .mockResolvedValueOnce([makeRow({ createdAt: '' })])
        .mockResolvedValue([]);

      const { pollSeedInboxes } = await import('../jobs/pollSeedInboxes.js');
      await pollSeedInboxes();

      expect(mockUpdateSet).toHaveBeenCalledWith({ folderFound: 'not_found', checkedAt: '2025-06-01T12:00:00.000Z' });
    });
  });

  describe('registerSeed', () => {
    it('should register seeds for all accounts', async () => {
      mockFetchSeedAccounts.mockResolvedValue([defaultSeed, { ...defaultSeed, id: 's2', email: 's2@g.com' }]);

      const { registerSeed } = await import('../jobs/pollSeedInboxes.js');
      const result = await registerSeed({ campaignId: 'camp-1', testId: 'test-1', sentAt: '2025-06-01T10:00:00Z' });

      expect(result.registered).toBe(2);
    });

    it('should filter seeds by seedAccountRefs', async () => {
      mockFetchSeedAccounts.mockResolvedValue([defaultSeed, { ...defaultSeed, id: 's2', email: 's2@g.com' }]);

      const { registerSeed } = await import('../jobs/pollSeedInboxes.js');
      const result = await registerSeed({ campaignId: 'camp-1', testId: 'test-1', sentAt: '2025-06-01T10:00:00Z', seedAccountRefs: ['s1'] });
      expect(result.registered).toBe(1);
    });

    it('should throw 503 when no seeds match', async () => {
      mockFetchSeedAccounts.mockResolvedValue([defaultSeed]);

      const { registerSeed } = await import('../jobs/pollSeedInboxes.js');
      await expect(registerSeed({ campaignId: 'camp-1', testId: 'test-1', seedAccountRefs: ['nonexistent'] })).rejects.toThrow('No matching active seed accounts found');
    });
  });

  describe('getSeedStatus', () => {
    it('should return aggregated status', async () => {
      const rows = [
        { id: 'r1', userId: 'u1', seedAccountRef: 's1', provider: 'gmail', campaignId: 'camp-1', testId: 'test-1', folderFound: 'inbox', checkedAt: '2025-01-01', createdAt: '2025-01-01' },
        { id: 'r2', userId: 'u1', seedAccountRef: 's2', provider: 'gmail', campaignId: 'camp-1', testId: 'test-1', folderFound: 'spam', checkedAt: '2025-01-01', createdAt: '2025-01-01' },
        { id: 'r3', userId: 'u1', seedAccountRef: 's3', provider: 'gmail', campaignId: 'camp-1', testId: 'test-1', folderFound: null, checkedAt: null, createdAt: '2025-01-01' },
      ];
      mockSelect.where.mockResolvedValue(rows);

      const { getSeedStatus } = await import('../jobs/pollSeedInboxes.js');
      const status = await getSeedStatus('camp-1');

      expect(status.campaignId).toBe('camp-1');
      expect(status.total).toBe(3);
      expect(status.checked).toBe(2);
      expect(status.inboxRate).toBe(0.5);
      expect(status.spamRate).toBe(0.5);
    });
  });
});
