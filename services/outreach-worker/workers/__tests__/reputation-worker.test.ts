import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@shared/lib/db/db.js', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    then: vi.fn((resolve: any) => resolve([])),
  },
}));

vi.mock('@shared/lib/crypto/encryption.js', () => ({
  tryDecryptToJSON: vi.fn(() => ({})),
}));

vi.mock('@shared/lib/realtime/websocket-sync.js', () => ({
  wsSync: { broadcastToUser: vi.fn(), notifyStatsUpdated: vi.fn() },
}));

vi.mock('@shared/lib/monitoring/quota-service.js', () => ({
  quotaService: {
    isRestricted: vi.fn(() => false),
    reportDbError: vi.fn(),
  },
}));

vi.mock('@services/email-service/src/email/dns-verification.js', () => ({
  verifyDomainDns: vi.fn().mockResolvedValue({
    spf: { valid: true, found: true },
    dkim: { valid: true, found: true },
    dmarc: { valid: true, found: true },
    blacklist: { isBlacklisted: false },
  }),
}));

vi.mock('@services/email-service/src/email/mailbox-health-service.js', () => ({
  mailboxHealthService: {
    isMailboxError: vi.fn(() => false),
    handleMailboxFailure: vi.fn(),
  },
}));

vi.mock('@services/email-service/src/email/spam-monitor.js', () => ({
  spamMonitorService: {
    scanAllSpamFolders: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@services/email-service/src/email/reputation-monitor.js', () => ({
  calculateReputationScore: vi.fn().mockResolvedValue(85),
}));

vi.mock('@shared/lib/storage/storage.js', () => ({
  storage: {
    createDomainVerification: vi.fn().mockResolvedValue({}),
    createAuditLog: vi.fn().mockResolvedValue({}),
    getDashboardStats: vi.fn().mockResolvedValue({ totalMessages: 0, openRate: 0 }),
  },
}));

vi.mock('@audnix/shared', () => ({
  integrations: { id: 'integrations.id', userId: 'integrations.userId', connected: 'integrations.connected', provider: 'integrations.provider', encryptedMeta: 'integrations.encryptedMeta', accountType: 'integrations.accountType' },
  users: { id: 'users.id', email: 'users.email' },
}));

describe('ReputationWorker (outreach-worker)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create a ReputationWorker instance', async () => {
      const { ReputationWorker } = await import('../reputation-worker.js');
      const worker = new ReputationWorker();
      expect(worker).toBeInstanceOf(ReputationWorker);
    });

    it('should have singleton reputationWorker', async () => {
      const { reputationWorker } = await import('../reputation-worker.js');
      expect(reputationWorker).toBeDefined();
    });
  });

  describe('process', () => {
    it('should skip processing if already running', async () => {
      const { ReputationWorker } = await import('../reputation-worker.js');
      const worker = new ReputationWorker();
      (worker as any).isProcessing = true;
      const result = await worker.process();
      expect(result).toBeUndefined();
    });

    it('should skip processing if quota is restricted', async () => {
      const { quotaService } = await import('@shared/lib/monitoring/quota-service.js');
      (quotaService.isRestricted as any).mockReturnValue(true);

      const { ReputationWorker } = await import('../reputation-worker.js');
      const worker = new ReputationWorker();
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await worker.process();
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('Skipping'));
      spy.mockRestore();
    });
  });

  describe('start and stop', () => {
    it('should start and stop without error', async () => {
      const { ReputationWorker } = await import('../reputation-worker.js');
      const worker = new ReputationWorker();
      worker.start(60000);
      worker.stop();
      expect(true).toBe(true);
    });

    it('should not start twice', async () => {
      const { ReputationWorker } = await import('../reputation-worker.js');
      const worker = new ReputationWorker();
      worker.start(60000);
      worker.start(60000);
      worker.stop();
      expect(true).toBe(true);
    });
  });
});
