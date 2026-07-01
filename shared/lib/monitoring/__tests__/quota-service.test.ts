import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => {
  const mock = {
    existsSync: vi.fn(() => false),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
  return { ...mock, default: mock };
});

describe('QuotaService', () => {
  let quotaService: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../quota-service.js');
    quotaService = mod.quotaService;
    quotaService.resetQuota();
  });

  it('should initially not be restricted', () => {
    expect(quotaService.isRestricted()).toBe(false);
  });

  it('should detect quota errors and become restricted', () => {
    const quotaError = new Error('Your project has exceeded the data transfer quota.');
    quotaService.reportDbError(quotaError);
    expect(quotaService.isRestricted()).toBe(true);
  });

  it('should detect quota errors via code XX000', () => {
    const quotaError = { code: 'XX000', message: 'quota issues detected' };
    quotaService.reportDbError(quotaError);
    expect(quotaService.isRestricted()).toBe(true);
  });

  it('should detect quota errors via code QUOTA_EXCEEDED', () => {
    const quotaError = { code: 'QUOTA_EXCEEDED', message: 'You have exceeded your quota' };
    quotaService.reportDbError(quotaError);
    expect(quotaService.isRestricted()).toBe(true);
  });

  it('should detect quota errors via code 503', () => {
    const quotaError = { code: '503', message: 'Service unavailable' };
    quotaService.reportDbError(quotaError);
    expect(quotaService.isRestricted()).toBe(true);
  });

  it('should detect quota errors via code 504', () => {
    const quotaError = { code: '504', message: 'Gateway timeout from Neon' };
    quotaService.reportDbError(quotaError);
    expect(quotaService.isRestricted()).toBe(true);
  });

  it('should detect maintenance errors', () => {
    const maintError = new Error('database is currently undergoing maintenance');
    quotaService.reportDbError(maintError);
    expect(quotaService.isRestricted()).toBe(true);
  });

  it('should not be restricted for regular errors', () => {
    const regularError = new Error('Some other DB error');
    quotaService.reportDbError(regularError);
    expect(quotaService.isRestricted()).toBe(false);
  });

  it('should not be restricted for ECONNREFUSED', () => {
    const connError = { code: 'ECONNREFUSED', message: 'Connection refused' };
    quotaService.reportDbError(connError);
    expect(quotaService.isRestricted()).toBe(false);
  });

  it('should reset quota manually', () => {
    quotaService.reportDbError(new Error('quota exceeded'));
    expect(quotaService.isRestricted()).toBe(true);
    quotaService.resetQuota();
    expect(quotaService.isRestricted()).toBe(false);
  });

  it('should return remaining cooldown', () => {
    expect(quotaService.getRemainingCooldownMs()).toBe(0);
  });

  it('should provide sentinel middleware', () => {
    const middleware = quotaService.getSentinelMiddleware();
    expect(typeof middleware).toBe('function');
  });
});
