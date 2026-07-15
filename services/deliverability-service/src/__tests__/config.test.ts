import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('dotenv', () => ({
  default: { config: vi.fn() },
  config: vi.fn(),
}));

describe('config', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...OLD_ENV };
  });

  it('should load default port 3100', async () => {
    delete process.env.PORT;
    const { config } = await import('../config.js');
    expect(config.port).toBe(3100);
  });

  it('should respect PORT env var', async () => {
    process.env.PORT = '4000';
    const { config } = await import('../config.js');
    expect(config.port).toBe(4000);
  });

  it('should detect missing DATABASE_URL in validateConfig', async () => {
    process.env.DATABASE_URL = '';
    const { validateConfig } = await import('../config.js');
    expect(() => validateConfig()).toThrow('DATABASE_URL');
  });

  it('should pass validation with DATABASE_URL set', async () => {
    process.env.DATABASE_URL = 'postgres://localhost/test';
    const { validateConfig } = await import('../config.js');
    expect(() => validateConfig()).not.toThrow();
  });

  it('should require INTERNAL_API_KEY and CORE_WEBHOOK_SECRET in production', async () => {
    process.env.DATABASE_URL = 'postgres://localhost/test';
    process.env.NODE_ENV = 'production';
    delete process.env.INTERNAL_API_KEY;
    delete process.env.CORE_WEBHOOK_SECRET;
    const { validateConfig } = await import('../config.js');
    expect(() => validateConfig()).toThrow(/INTERNAL_API_KEY.*CORE_WEBHOOK_SECRET/);
  });

  it('should load firstEnv with fallback chain', async () => {
    process.env.WARMUP_SERVICE_URL = 'http://warmup:8080';
    process.env.WARMUP_API_KEY = 'warmup-key-123';
    process.env.INTERNAL_API_KEY = 'fallback-key';
    delete process.env.WARMUP_INTERNAL_URL;
    const { config } = await import('../config.js');
    expect(config.warmup.url).toBe('http://warmup:8080');
    expect(config.warmup.apiKey).toBe('warmup-key-123');
  });

  it('should use fallback from INTERNAL_API_KEY when WARMUP_API_KEY missing', async () => {
    process.env.WARMUP_SERVICE_URL = 'http://warmup:8080';
    delete process.env.WARMUP_API_KEY;
    process.env.INTERNAL_API_KEY = 'internal-key';
    const { config } = await import('../config.js');
    expect(config.warmup.apiKey).toBe('internal-key');
  });

  it('should parse inbox rate thresholds', async () => {
    process.env.INBOX_RATE_WARN = '0.90';
    process.env.INBOX_RATE_PAUSE = '0.50';
    const { config } = await import('../config.js');
    expect(config.thresholds.inboxRateWarn).toBe(0.90);
    expect(config.thresholds.inboxRatePause).toBe(0.50);
  });
});
