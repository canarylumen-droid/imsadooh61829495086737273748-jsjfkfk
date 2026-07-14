import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@shared/lib/db/db.js', () => {
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
  const mockExecute = vi.fn().mockResolvedValue({ rows: [] });

  const mockQueryResult: any[] = [];
  mockThen.mockImplementation((resolve: any) => resolve(mockQueryResult));

  return {
    db: {
      select: mockSelect,
      from: mockFrom,
      where: mockWhere,
      limit: mockLimit,
      orderBy: mockOrderBy,
      then: mockThen,
      execute: mockExecute,
      insert: mockInsert,
      values: mockValues,
      update: mockUpdate,
      set: mockSet,
      returning: mockReturning,
    },
  };
});

vi.mock('@shared/lib/crypto/encryption.js', () => ({
  encrypt: vi.fn((data: string) => `encrypted:${data}`),
  decrypt: vi.fn((data: string) => data.startsWith('encrypted:') ? data.slice(10) : data),
  encryptJSON: vi.fn((obj: any) => `encrypted:${JSON.stringify(obj)}`),
  decryptToJSON: vi.fn((data: string) => {
    const s = data.startsWith('encrypted:') ? data.slice(10) : data;
    return JSON.parse(s);
  }),
  tryDecryptToJSON: vi.fn(() => null),
}));

vi.mock('@shared/lib/realtime/websocket-sync.js', () => ({
  wsSync: { broadcastToUser: vi.fn(), notifySettingsUpdated: vi.fn() },
}));

vi.mock('@shared/lib/realtime/pubsub-service.js', () => ({
  pubsubService: { publishEvent: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('@services/email-service/src/email/postmaster-service.js', () => ({
  postmasterService: {
    fetchDomainMetrics: vi.fn(),
    fetchAllDomains: vi.fn(),
    isEnabled: true,
  },
}));

describe('ReputationManager', () => {
  let ReputationManager: any;
  let manager: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../reputation-manager.js');
    ReputationManager = mod.ReputationManager;
    manager = ReputationManager.getInstance();
  });

  describe('classifyReputation', () => {
    it('should classify 90 as healthy', () => expect(manager.classifyReputation(90)).toBe('healthy'));
    it('should classify 85 as healthy', () => expect(manager.classifyReputation(85)).toBe('healthy'));
    it('should classify 70 as cautious', () => expect(manager.classifyReputation(70)).toBe('cautious'));
    it('should classify 50 as poor', () => expect(manager.classifyReputation(50)).toBe('poor'));
    it('should classify 30 as critical', () => expect(manager.classifyReputation(30)).toBe('critical'));
    it('should classify 0 as critical', () => expect(manager.classifyReputation(0)).toBe('critical'));
    it('should handle boundary values', () => {
      expect(manager.classifyReputation(85)).toBe('healthy');
      expect(manager.classifyReputation(84)).toBe('cautious');
      expect(manager.classifyReputation(65)).toBe('cautious');
      expect(manager.classifyReputation(64)).toBe('poor');
      expect(manager.classifyReputation(40)).toBe('poor');
      expect(manager.classifyReputation(39)).toBe('critical');
    });
  });

  describe('mergeReputationScores', () => {
    it('should return max of local and postmaster scores', () => {
      expect(manager.mergeReputationScores(70, 90, 'example.com')).toBe(90);
    });

    it('should return local when higher', () => {
      expect(manager.mergeReputationScores(85, 60, 'example.com')).toBe(85);
    });

    it('should return postmaster when domain empty', () => {
      expect(manager.mergeReputationScores(0, 80, '')).toBe(80);
    });

    it('should default to 50 when all zero and domain empty', () => {
      expect(manager.mergeReputationScores(0, 0, '')).toBe(50);
    });
  });

  describe('nextCloudReputationScores', () => {
    it('should return max of local and postmaster', () => {
      const result = manager.mergeReputationScores(50, 90, 'example.com');
      expect(result).toBe(90);
    });
  });

  describe('calculateLocalReputation', () => {
    it('should return 50 when domain is null', async () => {
      const result = await manager.calculateLocalReputation('test-id', null);
      expect(result).toBe(50);
    });

    it('should return 50 when no integration found', async () => {
      const { db } = await import('@shared/lib/db/db.js');
      (db.then as any).mockImplementation((resolve: any) => resolve([]));
      const result = await manager.calculateLocalReputation('noexist', 'example.com');
      expect(result).toBe(50);
    });
  });

  describe('extractDomainFromIntegration', () => {
    it('should extract from smtp_user', async () => {
      const domain = await manager.extractDomainFromIntegration({
        encryptedMeta: 'encrypted:{"smtp_user":"sender@mybiz.com"}',
      });
      expect(domain).toBe('mybiz.com');
    });

    it('should return null when no email found', async () => {
      const domain = await manager.extractDomainFromIntegration({
        encryptedMeta: 'encrypted:{"no_email":"value"}',
      });
      expect(domain).toBeNull();
    });
  });

  describe('calculateLocalReputationFromMonitor', () => {
    it('should start at 100 for perfect health', async () => {
      const { db } = await import('@shared/lib/db/db.js');
      (db.then as any).mockImplementation((resolve: any) => resolve([]));
      (db.execute as any).mockResolvedValue({ rows: [{ count: 0 }] });
      const result = await manager.calculateLocalReputationFromMonitor('test-id', 'perfect.com');
      expect(result).toBe(100);
    });

    it('should penalize for blacklisted domains', async () => {
      const { db } = await import('@shared/lib/db/db.js');
      (db.orderBy as any).mockReturnThis();
      (db.limit as any).mockReturnThis();
      (db.then as any).mockImplementation((resolve: any) => resolve([{
        verificationResult: {
          blacklist: { isBlacklisted: true },
          spf: { valid: true }, dkim: { valid: true }, dmarc: { valid: true },
        },
      }]));
      (db.execute as any).mockResolvedValue({ rows: [{ count: 0 }] });
      const result = await manager.calculateLocalReputationFromMonitor('test-id', 'bad.com');
      expect(result).toBe(40);
    });

    it('should clamp score between 0 and 100', async () => {
      const { db } = await import('@shared/lib/db/db.js');
      (db.then as any).mockImplementation((resolve: any) => resolve([{
        verificationResult: {
          blacklist: { isBlacklisted: true },
          spf: { valid: false }, dkim: { valid: false }, dmarc: { valid: false },
        },
      }]));
      (db.execute as any).mockResolvedValue({ rows: [{ count: 999 }] });
      const result = await manager.calculateLocalReputationFromMonitor('test-id', 'worst.com');
      expect(result).toBe(0);
    });
  });
});
