import { Router } from 'express';
import { db } from '../db/client.js';
import { reputationSnapshots } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';

const router = Router();

router.get('/:domain', async (req, res) => {
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
