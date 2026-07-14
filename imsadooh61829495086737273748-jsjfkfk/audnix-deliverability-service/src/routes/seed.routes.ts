import { Router, Request, Response, NextFunction } from 'express';
import { registerSeed, getSeedStatus } from '../jobs/pollSeedInboxes.js';

const router = Router();

function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const key = req.headers['x-api-key'];
  if (process.env.INTERNAL_API_KEY && key !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

router.post('/register', requireApiKey, async (req, res) => {
  try {
    const { campaignId, testId, sentAt } = req.body;
    if (!campaignId || !testId) {
      return res.status(400).json({ error: 'campaignId and testId are required' });
    }
    const row = await registerSeed(campaignId, testId, sentAt || new Date().toISOString());
    res.json({ success: true, id: row.id });
  } catch (err: any) {
    console.error('[SeedRoutes] Register error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/status/:campaignId', requireApiKey, async (req, res) => {
  try {
    const status = await getSeedStatus(req.params.campaignId);
    res.json(status);
  } catch (err: any) {
    console.error('[SeedRoutes] Status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
