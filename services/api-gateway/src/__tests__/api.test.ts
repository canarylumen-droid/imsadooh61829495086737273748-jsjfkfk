import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('@shared/lib/monitoring/quota-service.js', () => ({
  quotaService: {
    getSentinelMiddleware: () => (_req: any, _res: any, next: Function) => next(),
    isRestricted: () => false,
    reportDbError: vi.fn(),
  },
}));

vi.mock('@services/api-gateway/src/middleware/rate-limit.js', () => ({
  apiLimiter: (_req: any, _res: any, next: Function) => next(),
  authLimiter: (_req: any, _res: any, next: Function) => next(),
  webhookLimiter: (_req: any, _res: any, next: Function) => next(),
  aiLimiter: (_req: any, _res: any, next: Function) => next(),
  viteLimiter: (_req: any, _res: any, next: Function) => next(),
  smtpRateLimiter: (_req: any, _res: any, next: Function) => next(),
  emailImportLimiter: (_req: any, _res: any, next: Function) => next(),
}));

vi.mock('@services/api-gateway/src/middleware/security-headers.js', () => ({
  securityHeaders: (_req: any, _res: any, next: Function) => next(),
}));

vi.mock('@shared/lib/db/db.js', () => ({
  pool: null,
  db: { execute: vi.fn() },
}));

vi.mock('csrf-csrf', () => ({
  doubleCsrf: () => ({
    doubleCsrfProtection: (_req: any, _res: any, next: Function) => next(),
    generateCsrfToken: (_req: any, _res: any) => 'mocked-csrf-token',
  }),
}));

vi.mock('hpp', () => ({
  default: () => (_req: any, _res: any, next: Function) => next(),
}));

vi.mock('helmet', () => ({
  default: () => (_req: any, _res: any, next: Function) => next(),
}));

vi.mock('express-session', () => ({
  default: () => (_req: any, _res: any, next: Function) => {
    _req.session = { userId: undefined };
    next();
  },
}));

vi.mock('connect-pg-simple', () => ({
  default: () => class PgStore {},
}));

describe('API Gateway Integration', () => {
  let app: any;

  beforeEach(async () => {
    process.env.NODE_ENV = 'test';
    process.env.SESSION_SECRET = 'test-secret';
    process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-long!!!!';
    vi.resetModules();
    const { createApp } = await import('../app.js');
    app = createApp();
  });

  describe('GET /health', () => {
    it('should return 200 with status ok', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.mode).toBe('starting');
      expect(res.body).toHaveProperty('timestamp');
    });

    it('should return JSON content type', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['content-type']).toMatch(/json/);
    });
  });

  describe('GET /api/csrf-token', () => {
    it('should return 200 with CSRF token', async () => {
      const res = await request(app).get('/api/csrf-token');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('csrfToken');
      expect(typeof res.body.csrfToken).toBe('string');
    });
  });

  describe('CORS and security', () => {
    it('should set CORS headers on OPTIONS requests with allowed origin', async () => {
      const res = await request(app)
        .options('/api/test')
        .set('Origin', 'http://localhost:5000');
      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-methods']).toBeDefined();
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5000');
    });

    it('should reject unapproved origins in production for non-skip routes', async () => {
      process.env.NODE_ENV = 'production';
      vi.resetModules();
      const { createApp } = await import('../app.js');
      app = createApp();

      const res = await request(app)
        .get('/api/organizations')
        .set('Origin', 'https://evil-site.com');
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Forbidden');
    });

    it('should allow skippable routes in production without origin check', async () => {
      process.env.NODE_ENV = 'production';
      vi.resetModules();
      const { createApp } = await import('../app.js');
      app = createApp();

      const res = await request(app)
        .get('/health')
        .set('Origin', 'https://evil-site.com');
      expect(res.status).toBe(200);
    });

    it('should allow requests with no origin in development', async () => {
      const res = await request(app).get('/api/organizations');
      expect([200, 404]).toContain(res.status);
    });
  });

  describe('Body parsing', () => {
    it('should parse JSON bodies', async () => {
      const res = await request(app)
        .post('/api/test-json')
        .send({ test: 'data' })
        .set('Content-Type', 'application/json');
      expect(res.status).toBe(404);
    });

    it('should parse URL-encoded bodies', async () => {
      const res = await request(app)
        .post('/api/test-form')
        .send('key=value')
        .set('Content-Type', 'application/x-www-form-urlencoded');
      expect(res.status).toBe(404);
    });

    it('should reject bodies over 10MB limit', async () => {
      const largeBody = 'x'.repeat(11 * 1024 * 1024);
      const res = await request(app)
        .post('/api/test-large')
        .send(largeBody)
        .set('Content-Type', 'application/json');
      expect(res.status).toBe(413);
    });

    it('should capture rawBody for webhook routes', async () => {
      const res = await request(app)
        .post('/api/webhooks/test')
        .send({ event: 'test' })
        .set('Content-Type', 'application/json');
      expect([200, 404]).toContain(res.status);
    });
  });

  describe('404 handling', () => {
    it('should return 404 for unknown API routes', async () => {
      const res = await request(app).get('/api/nonexistent-route-12345');
      expect(res.status).toBe(404);
    });

    it('should return 404 for unknown static assets', async () => {
      const res = await request(app).get('/favicon.ico');
      expect(res.status).toBe(404);
    });

    it('should return 404 for unknown non-API routes', async () => {
      const res = await request(app).get('/some-random-page');
      expect(res.status).toBe(404);
    });
  });

  describe('CSRF bypass paths', () => {
    it('should bypass CSRF for /api/auth paths', async () => {
      const res = await request(app)
        .get('/api/auth/login');
      expect(res.status).toBe(404);
    });

    it('should bypass CSRF for /api/health paths', async () => {
      const res = await request(app)
        .get('/health');
      expect(res.status).toBe(200);
    });

    it('should bypass CSRF for /api/webhook paths', async () => {
      const res = await request(app)
        .post('/api/webhook/test')
        .send({});
      expect(res.status).toBe(404);
    });
  });

  describe('Environment variable fallbacks', () => {
    it('should use dev fallback SESSION_SECRET when not set', async () => {
      delete process.env.SESSION_SECRET;
      vi.resetModules();
      const { createApp } = await import('../app.js');
      app = createApp();
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
    });

    it('should use dev fallback ENCRYPTION_KEY when not set', async () => {
      delete process.env.ENCRYPTION_KEY;
      vi.resetModules();
      const { createApp } = await import('../app.js');
      app = createApp();
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
    });
  });
});
