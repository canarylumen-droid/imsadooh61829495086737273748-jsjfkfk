import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';

vi.mock('../config.js', () => ({
  config: {
    internalApiKey: 'test-api-key',
  },
}));

const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();

vi.mock('../db/client.js', () => ({
  db: {
    select: (...args: any[]) => ({
      from: (...args2: any[]) => ({
        where: (...args3: any[]) => ({
          orderBy: (...args4: any[]) => ({
            limit: (...args5: any[]) => mockLimit(...args5),
          }),
        }),
      }),
    }),
  },
}));

vi.mock('../db/schema.js', () => ({
  reputationSnapshots: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => 'eq'),
  desc: vi.fn(() => 'desc'),
}));

describe('reputation routes', () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    const router = (await import('../routes/reputation.routes.js')).default;
    app.use('/reputation', router);
  });

  describe('GET /reputation/:domain', () => {
    it('should return reputation data for domain', async () => {
      const mockRows = [
        { domain: 'example.com', source: 'postmaster', spamRate: 0.002, checkedAt: '2025-01-01' },
      ];
      mockLimit.mockResolvedValue(mockRows);

      const res = await supertest(app)
        .get('/reputation/example.com')
        .set('x-api-key', 'test-api-key');
      expect(res.status).toBe(200);
      expect(res.body.domain).toBe('example.com');
      expect(res.body.latest).toEqual(mockRows[0]);
      expect(res.body.history).toEqual(mockRows);
    });

    it('should return null latest when no data', async () => {
      mockLimit.mockResolvedValue([]);

      const res = await supertest(app)
        .get('/reputation/example.com')
        .set('x-api-key', 'test-api-key');
      expect(res.status).toBe(200);
      expect(res.body.latest).toBeNull();
      expect(res.body.history).toEqual([]);
    });

    it('should require api key', async () => {
      const res = await supertest(app).get('/reputation/example.com');
      expect(res.status).toBe(401);
    });

    it('should return 500 on db error', async () => {
      mockLimit.mockRejectedValue(new Error('DB connection failed'));

      const res = await supertest(app)
        .get('/reputation/example.com')
        .set('x-api-key', 'test-api-key');
      expect(res.status).toBe(500);
    });
  });
});
