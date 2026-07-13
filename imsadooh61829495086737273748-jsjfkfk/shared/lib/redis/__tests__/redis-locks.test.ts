import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockClient = vi.hoisted(() => ({
  set: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
  expire: vi.fn(),
  quit: vi.fn(),
  on: vi.fn(),
  connect: vi.fn().mockResolvedValue(undefined),
  duplicate: vi.fn().mockReturnThis(),
  isOpen: true,
}));

vi.mock('redis', () => ({
  createClient: vi.fn(() => mockClient),
}));

vi.mock('@shared/lib/redis/latency-telemetry.js', () => ({
  instrumentRedisClient: vi.fn((client: any) => client),
  validateRedisEndpoint: vi.fn((url: string) => url),
}));

describe('Redis Locks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.REDIS_TLS = 'false';
    process.env.REDIS_PRIVATE_ENDPOINT_REQUIRED = 'false';
  });

  describe('acquireLock', () => {
    it('should acquire lock with SET NX EX', async () => {
      mockClient.set.mockResolvedValue('OK');
      const { acquireLock } = await import('../redis.js');
      const result = await acquireLock('test-lock', 30);
      expect(result).toBe(true);
      expect(mockClient.set).toHaveBeenCalledWith('lock:test-lock', 'locked', { NX: true, EX: 30 });
    });

    it('should return false when lock already held', async () => {
      mockClient.set.mockResolvedValue(null);
      const { acquireLock } = await import('../redis.js');
      const result = await acquireLock('test-lock', 30);
      expect(result).toBe(false);
    });

    it('should use default TTL of 30 seconds', async () => {
      mockClient.set.mockResolvedValue('OK');
      const { acquireLock } = await import('../redis.js');
      await acquireLock('test-lock');
      expect(mockClient.set).toHaveBeenCalledWith('lock:test-lock', 'locked', { NX: true, EX: 30 });
    });
  });

  describe('releaseLock', () => {
    it('should release lock by deleting key', async () => {
      const { releaseLock } = await import('../redis.js');
      await releaseLock('test-lock');
      expect(mockClient.del).toHaveBeenCalledWith('lock:test-lock');
    });

    it('should handle deletion of non-existent lock', async () => {
      mockClient.del.mockResolvedValue(0);
      const { releaseLock } = await import('../redis.js');
      await releaseLock('nonexistent-lock');
      expect(mockClient.del).toHaveBeenCalledWith('lock:nonexistent-lock');
    });
  });

  describe('acquireDistributedLock', () => {
    it('should acquire lock with worker ID as value', async () => {
      mockClient.set.mockResolvedValue('OK');
      const { acquireDistributedLock } = await import('../redis.js');
      const result = await acquireDistributedLock('dist-lock', 60);
      expect(result).toBe(true);
      expect(mockClient.set).toHaveBeenCalledWith('lock:dist-lock', expect.any(String), { NX: true, EX: 60 });
    });
  });

  describe('isLockOwner', () => {
    it('should return true when current worker owns the lock', async () => {
      const { isLockOwner, getWorkerId } = await import('../redis.js');
      const workerId = getWorkerId();
      mockClient.get.mockResolvedValue(workerId);
      const result = await isLockOwner('test-lock');
      expect(result).toBe(true);
    });

    it('should return false when another worker owns the lock', async () => {
      mockClient.get.mockResolvedValue('worker-other');
      const { isLockOwner } = await import('../redis.js');
      const result = await isLockOwner('test-lock');
      expect(result).toBe(false);
    });

    it('should return false when lock does not exist', async () => {
      mockClient.get.mockResolvedValue(null);
      const { isLockOwner } = await import('../redis.js');
      const result = await isLockOwner('test-lock');
      expect(result).toBe(false);
    });
  });

  describe('extendLock', () => {
    it('should extend TTL when current worker owns the lock', async () => {
      const { extendLock, getWorkerId } = await import('../redis.js');
      const workerId = getWorkerId();
      mockClient.get.mockResolvedValue(workerId);
      const result = await extendLock('test-lock', 60);
      expect(result).toBe(true);
      expect(mockClient.expire).toHaveBeenCalledWith('lock:test-lock', 60);
    });

    it('should not extend when another worker owns the lock', async () => {
      mockClient.get.mockResolvedValue('worker-other');
      const { extendLock } = await import('../redis.js');
      const result = await extendLock('test-lock', 60);
      expect(result).toBe(false);
    });
  });
});
