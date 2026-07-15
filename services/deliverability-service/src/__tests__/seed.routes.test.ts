import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';

vi.mock('../config.js', () => ({
  config: {
    internalApiKey: 'test-api-key',
  },
}));

vi.mock('../db/client.js', () => ({
  db: {},
}));

const mockRegisterSeed = vi.fn();
const mockGetSeedStatus = vi.fn();

vi.mock('../jobs/pollSeedInboxes.js', () => ({
  registerSeed: (...args: any[]) => mockRegisterSeed(...args),
  getSeedStatus: (...args: any[]) => mockGetSeedStatus(...args),
}));

describe('seed routes', () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    const router = (await import('../routes/seed.routes.js')).default;
    app.use('/seed', router);
  });

  describe('POST /seed/register', () => {
    const validBody = { campaignId: 'camp-1', testId: 'test-1' };

    it('should return 201 on success', async () => {
      mockRegisterSeed.mockResolvedValue({ registered: 5, seedAccountRefs: ['s1', 's2'] });
      const res = await supertest(app)
        .post('/seed/register')
        .set('x-api-key', 'test-api-key')
        .send(validBody);
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('should reject missing api key when configured', async () => {
      const res = await supertest(app)
        .post('/seed/register')
        .send(validBody);
      expect(res.status).toBe(401);
    });

    it('should reject missing campaignId', async () => {
      const res = await supertest(app)
        .post('/seed/register')
        .set('x-api-key', 'test-api-key')
        .send({ testId: 'test-1' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('campaignId');
    });

    it('should reject missing testId', async () => {
      const res = await supertest(app)
        .post('/seed/register')
        .set('x-api-key', 'test-api-key')
        .send({ campaignId: 'camp-1' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('testId');
    });

    it('should reject invalid seedAccountRefs', async () => {
      const res = await supertest(app)
        .post('/seed/register')
        .set('x-api-key', 'test-api-key')
        .send({ ...validBody, seedAccountRefs: [123] });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('seedAccountRefs');
    });

    it('should forward all body params to registerSeed', async () => {
      mockRegisterSeed.mockResolvedValue({ registered: 3, seedAccountRefs: ['s1'] });
      await supertest(app)
        .post('/seed/register')
        .set('x-api-key', 'test-api-key')
        .send({ ...validBody, userId: 'user-1', sentAt: '2025-01-01T00:00:00Z', seedAccountRefs: ['s1', 's2'] });
      expect(mockRegisterSeed).toHaveBeenCalledWith({
        campaignId: 'camp-1',
        testId: 'test-1',
        userId: 'user-1',
        sentAt: '2025-01-01T00:00:00Z',
        seedAccountRefs: ['s1', 's2'],
      });
    });

    it('should use current time when sentAt not provided', async () => {
      mockRegisterSeed.mockResolvedValue({ registered: 1, seedAccountRefs: ['s1'] });
      const before = new Date().toISOString().slice(0, 16);
      await supertest(app)
        .post('/seed/register')
        .set('x-api-key', 'test-api-key')
        .send(validBody);
      const sentAt = mockRegisterSeed.mock.calls[0][0].sentAt;
      expect(sentAt.slice(0, 16)).toBe(before);
    });

    it('should return 503 when no seeds available', async () => {
      const err = new Error('No active seed accounts available from warmup service');
      (err as any).statusCode = 503;
      mockRegisterSeed.mockRejectedValue(err);
      const res = await supertest(app)
        .post('/seed/register')
        .set('x-api-key', 'test-api-key')
        .send(validBody);
      expect(res.status).toBe(503);
    });
  });

  describe('GET /seed/status/:campaignId', () => {
    it('should return seed status', async () => {
      mockGetSeedStatus.mockResolvedValue({ campaignId: 'camp-1', total: 5, checked: 3, inboxRate: 0.6 });
      const res = await supertest(app)
        .get('/seed/status/camp-1')
        .set('x-api-key', 'test-api-key');
      expect(res.status).toBe(200);
      expect(res.body.campaignId).toBe('camp-1');
      expect(res.body.inboxRate).toBe(0.6);
    });

    it('should require api key', async () => {
      const res = await supertest(app).get('/seed/status/camp-1');
      expect(res.status).toBe(401);
    });
  });
});
