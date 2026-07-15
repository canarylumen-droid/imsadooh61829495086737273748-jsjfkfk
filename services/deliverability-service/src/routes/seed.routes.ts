import { Router, Request, Response, NextFunction } from 'express';
import { registerSeed, getSeedStatus } from '../jobs/pollSeedInboxes.js';
import { config } from '../config.js';

const router: Router = Router();

function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const key = req.headers['x-api-key'];
  if (config.internalApiKey && key !== config.internalApiKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

router.post('/register', requireApiKey, async (req, res) => {
  try {
    const { campaignId, testId, sentAt, userId, seedAccountRefs } = req.body;
    if (!campaignId || !testId) {
      return res.status(400).json({ error: 'campaignId and testId are required' });
    }
    if (seedAccountRefs !== undefined && (!Array.isArray(seedAccountRefs) || seedAccountRefs.some(ref => typeof ref !== 'string'))) {
      return res.status(400).json({ error: 'seedAccountRefs must be an array of seed ids or emails' });
    }

    const result = await registerSeed({
      campaignId,
      testId,
      sentAt: sentAt || new Date().toISOString(),
      userId,
      seedAccountRefs,
    });
    res.status(201).json({ success: true, ...result });
  } catch (err: any) {
    console.error('[SeedRoutes] Register error:', err);
    const status = err.statusCode || 500;
    res.status(status).json({ error: status === 500 ? 'Internal server error' : err.message });
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
