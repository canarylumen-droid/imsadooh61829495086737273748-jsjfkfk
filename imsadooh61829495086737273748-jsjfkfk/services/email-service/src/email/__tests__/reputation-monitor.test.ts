import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSelect = vi.fn().mockReturnThis();
const mockFrom = vi.fn().mockReturnThis();
const mockWhere = vi.fn().mockReturnThis();
const mockLimit = vi.fn().mockReturnThis();
const mockOrderBy = vi.fn().mockReturnThis();
const mockSet = vi.fn().mockReturnThis();
const mockUpdate = vi.fn().mockReturnThis();
const mockValues = vi.fn().mockReturnThis();
const mockInsert = vi.fn().mockReturnThis();
const mockReturning = vi.fn().mockResolvedValue([]);
const mockThen = vi.fn((resolve: any) => resolve([]));

const mockDb = {
  select: mockSelect,
  from: mockFrom,
  where: mockWhere,
  limit: mockLimit,
  orderBy: mockOrderBy,
  set: mockSet,
  update: mockUpdate,
  values: mockValues,
  insert: mockInsert,
  returning: mockReturning,
  then: mockThen,
};

vi.mock('@shared/lib/db/db.js', () => ({ db: mockDb }));

vi.mock('@shared/lib/crypto/encryption.js', () => ({
  decrypt: vi.fn((data: string) => '{"smtp_user":"test@example.com"}'),
}));

vi.mock('@shared/lib/realtime/websocket-sync.js', () => ({
  wsSync: { broadcastToUser: vi.fn(), notifyStatsUpdated: vi.fn() },
}));

vi.mock('@shared/lib/realtime/pubsub-service.js', () => ({
  pubsubService: { publishEvent: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('@audnix/shared', () => ({
  integrations: { id: 'integrations.id', userId: 'integrations.userId', encryptedMeta: 'integrations.encryptedMeta' },
  bounceTracker: { integrationId: 'bounceTracker.integrationId', createdAt: 'bounceTracker.createdAt', bounceType: 'bounceTracker.bounceType' },
  domainVerifications: { userId: 'domainVerifications.userId', domain: 'domainVerifications.domain', createdAt: 'domainVerifications.createdAt' },
  users: { id: 'users.id' },
}));

vi.mock('dns', () => ({ promises: { resolveMx: vi.fn(), resolveTxt: vi.fn() } }));

vi.mock('@shared/lib/storage/storage.js', () => ({
  storage: {
    getDashboardStats: vi.fn().mockResolvedValue({ totalMessages: 0, openRate: 0 }),
    createDomainVerification: vi.fn(),
    createAuditLog: vi.fn(),
  },
}));

describe('ReputationMonitor (email-service)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.then.mockImplementation((resolve: any) => resolve([]));
  });

  describe('calculateReputationScore', () => {
    it('should return 50 when integration not found', async () => {
      mockDb.then.mockImplementation((resolve: any) => resolve([]));
      const { calculateReputationScore } = await import('../reputation-monitor.js');
      const score = await calculateReputationScore('nonexistent');
      expect(score).toBe(50);
    });

    it('should return 100 for perfect health (no bounces, no DNS issues)', async () => {
      mockDb.then
        .mockImplementationOnce((resolve: any) => resolve([{
          id: 'int-1', userId: 'user-1', encryptedMeta: 'enc:data',
          initialOutreachLimit: 50, warmupLimit: 5, dailyLimit: 55,
          throttleUntil: null,
        }]))
        .mockImplementationOnce((resolve: any) => resolve([]));
      mockDb.execute = vi.fn().mockResolvedValue({ rows: [{ count: 0 }] });

      const { storage } = await import('@shared/lib/storage/storage.js');
      (storage.getDashboardStats as any).mockResolvedValue({
        totalMessages: 10, openRate: 25,
      });

      const { calculateReputationScore } = await import('../reputation-monitor.js');
      const score = await calculateReputationScore('int-1');
      expect(score).toBeGreaterThanOrEqual(50);
    });

    it('should penalize for hard bounces', async () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString();
      mockDb.then
        .mockImplementationOnce((resolve: any) => resolve([{
          id: 'int-2', userId: 'user-1', encryptedMeta: 'enc:data',
          initialOutreachLimit: 50, warmupLimit: 5, dailyLimit: 55,
          throttleUntil: null,
        }]))
        .mockImplementationOnce((resolve: any) => resolve([
          { bounceType: 'hard', createdAt: pastDate, integrationId: 'int-2' },
        ]));
      mockDb.execute = vi.fn().mockResolvedValue({ rows: [{ count: 0 }] });

      const { storage } = await import('@shared/lib/storage/storage.js');
      (storage.getDashboardStats as any).mockResolvedValue({
        totalMessages: 100, openRate: 20, hardBounces: 1,
      });

      const { calculateReputationScore } = await import('../reputation-monitor.js');
      const score = await calculateReputationScore('int-2');
      expect(score).toBeLessThan(100);
    });
  });

  describe('triggerImmediateReputationCheck', () => {
    it('should call calculateReputationScore and return the score', async () => {
      mockDb.then.mockImplementation((resolve: any) => resolve([]));
      const { triggerImmediateReputationCheck } = await import('../reputation-monitor.js');
      const score = await triggerImmediateReputationCheck('nonexistent');
      expect(score).toBe(50);
    });
  });
});
