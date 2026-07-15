import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('../config.js', () => ({
  config: {
    webhook: {
      url: 'http://localhost:5000/api/webhooks/deliverability',
      secret: 'webhook-secret-123',
    },
  },
}));

describe('notifyCore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('notifyCore', () => {
    it('should POST webhook with correct payload and headers', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const { notifyCore } = await import('../webhooks/notifyCore.js');
      const result = await notifyCore({
        campaignId: 'camp-1',
        userId: 'user-1',
        source: 'seed',
        inboxRate: 0.65,
        spamRate: 0.35,
        action: 'pause',
      });

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:5000/api/webhooks/deliverability');
      expect(opts.method).toBe('POST');
      expect(opts.headers['X-Webhook-Secret']).toBe('webhook-secret-123');
      expect(JSON.parse(opts.body)).toEqual({
        campaignId: 'camp-1',
        userId: 'user-1',
        source: 'seed',
        inboxRate: 0.65,
        spamRate: 0.35,
        action: 'pause',
      });
    });

    it('should return false on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const { notifyCore } = await import('../webhooks/notifyCore.js');
      const result = await notifyCore({
        campaignId: 'camp-1',
        source: 'postmaster',
        inboxRate: 0.8,
        spamRate: 0.001,
        action: 'warn',
      });
      expect(result).toBe(false);
    });

    it('should return false on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const { notifyCore } = await import('../webhooks/notifyCore.js');
      const result = await notifyCore({
        campaignId: 'camp-1',
        source: 'snds',
        inboxRate: 0.9,
        spamRate: 0.0005,
        action: 'warn',
      });
      expect(result).toBe(false);
    });
  });

  describe('notifySeedUpdate', () => {
    it('should POST to seed-update endpoint', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const { notifySeedUpdate } = await import('../webhooks/notifyCore.js');
      const result = await notifySeedUpdate({
        campaignId: 'camp-1',
        testId: 'test-1',
        seedEmail: 'seed@gmail.com',
        folder: 'inbox',
        provider: 'gmail',
      });

      expect(result).toBe(true);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:5000/api/webhooks/deliverability/seed-update');
      expect(JSON.parse(opts.body).seedEmail).toBe('seed@gmail.com');
      expect(JSON.parse(opts.body).folder).toBe('inbox');
    });

    it('should work with trailing slash on base URL', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const cfg = await import('../config.js');
      (cfg.config.webhook as any).url = 'http://localhost:5000/api/webhooks/deliverability/';

      const { notifySeedUpdate } = await import('../webhooks/notifyCore.js');
      const result = await notifySeedUpdate({
        campaignId: 'c1', testId: 't1', seedEmail: 's@e.com', folder: 'inbox', provider: 'gmail',
      });
      expect(result).toBe(true);
    });

    it('should return false on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Timeout'));

      const { notifySeedUpdate } = await import('../webhooks/notifyCore.js');
      const result = await notifySeedUpdate({
        campaignId: 'c1', testId: 't1', seedEmail: 's@e.com', folder: 'spam', provider: 'outlook',
      });
      expect(result).toBe(false);
    });
  });
});
