import { Router, Request, Response, NextFunction } from 'express';
import { db } from '../db/client.js';
import { reputationSnapshots } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { config } from '../config.js';

const router: Router = Router();

function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const key = req.headers['x-api-key'];
  if (config.internalApiKey && key !== config.internalApiKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

router.get('/:domain', requireApiKey, async (req, res) => {
  try {
    const { domain } = req.params;
    const rows = await db
      .select()
      .from(reputationSnapshots)
      .where(eq(reputationSnapshots.domain, domain))
      .orderBy(desc(reputationSnapshots.checkedAt))
      .limit(20);

    res.json({
      domain,
      latest: rows[0] || null,
      history: rows,
    });
  } catch (err: any) {
    console.error('[ReputationRoutes] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
