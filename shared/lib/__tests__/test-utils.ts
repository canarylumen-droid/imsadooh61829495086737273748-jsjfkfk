import { vi } from 'vitest';

export function createMockDb() {
  const mockQueryResult: any[] = [];
  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    then: vi.fn((resolve: any) => resolve(mockQueryResult)),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    onConflictDoUpdate: vi.fn().mockResolvedValue([]),
    $dynamic: vi.fn().mockReturnThis(),
  };

  const mockQueryResultArray: any[] = [];

  mockDb.then.mockImplementation((resolve: any) => resolve(mockQueryResultArray));

  return { mockDb, mockQueryResult: mockQueryResultArray };
}

export function createMockEncryption() {
  return {
    encrypt: vi.fn((data: string) => `encrypted:${data}`),
    decrypt: vi.fn((data: string) => {
      if (data.startsWith('encrypted:')) return data.slice(10);
      return data;
    }),
    encryptJSON: vi.fn((obj: any) => `encrypted:${JSON.stringify(obj)}`),
    decryptToJSON: vi.fn((data: string) => {
      if (data.startsWith('encrypted:')) return JSON.parse(data.slice(10));
      return JSON.parse(data);
    }),
    tryDecryptToJSON: vi.fn((data: string) => {
      try {
        if (data.startsWith('encrypted:')) return JSON.parse(data.slice(10));
        return JSON.parse(data);
      } catch { return null; }
    }),
    generateEncryptionKey: vi.fn(() => 'test-key-32-chars-long!'),
    encryptState: vi.fn((data: any) => `state:${JSON.stringify(data)}`),
    decryptState: vi.fn((data: string, _maxAgeMs?: number) => {
      if (data.startsWith('state:')) return JSON.parse(data.slice(6));
      return null;
    }),
  };
}

export function createMockWsSync() {
  return {
    broadcastToUser: vi.fn(),
    notifySettingsUpdated: vi.fn(),
    initialize: vi.fn(),
    getConnectedUsers: vi.fn().mockReturnValue([]),
    broadcast: vi.fn(),
  };
}

export function createMockPubSub() {
  return {
    publishEvent: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
    stop: vi.fn(),
  };
}

export function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

export function createMockIntegration(overrides: Record<string, any> = {}) {
  return {
    id: 'test-integration-id',
    userId: 'test-user-id',
    provider: 'gmail',
    encryptedMeta: 'encrypted:{"smtp_user":"test@example.com","gmailAccessToken":"mock-token"}',
    connected: true,
    accountType: 'test@example.com',
    healthStatus: 'connected',
    reputationScore: 75,
    spamRiskScore: 0.1,
    healthLevel: 'healthy',
    lastReputationCheck: null,
    sourceOfScore: null,
    ...overrides,
  };
}

export function createMockPostmasterMetrics(overrides: Record<string, any> = {}) {
  return {
    domain: 'example.com',
    spamRate: 0.05,
    deliveryErrorRate: 0.02,
    reputation: 80,
    encryptedTrafficRate: 0.95,
    ipsReputation: new Map([['192.168.1.1', 90]]),
    lastUpdated: new Date(),
    ...overrides,
  };
}
