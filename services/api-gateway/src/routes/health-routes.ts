import { Router } from 'express';
import { workerHealthMonitor } from '@shared/lib/monitoring/worker-health.js';
import { quotaService } from '@shared/lib/monitoring/quota-service.js';

const router = Router();

import { getRedisClient } from '@shared/lib/redis/redis.js';
import { db } from '@shared/lib/db/db.js';
import { sql } from 'drizzle-orm';

/**
 * Health check route for background workers and system status
 */
router.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'api-gateway', timestamp: new Date().toISOString() });
});

router.get('/status', async (req, res) => {
  const workers = workerHealthMonitor.getHealthStatus();
  const allWorkersHealthy = workers.every((w: any) => w.status === 'healthy');
  
  let dbStatus = 'healthy';
  try {
    await db.execute(sql`SELECT 1`);
  } catch (err) {
    dbStatus = 'unhealthy';
  }

  let redisStatus = 'healthy';
  try {
    const client = await getRedisClient();
    if (!client) redisStatus = 'unhealthy';
  } catch (err) {
    redisStatus = 'unhealthy';
  }

  const isHealthy = allWorkersHealthy && dbStatus === 'healthy' && redisStatus === 'healthy';

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    db: dbStatus,
    redis: redisStatus,
    workers
  });
});

export default router;

