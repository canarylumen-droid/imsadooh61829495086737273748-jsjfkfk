import { Router } from 'express';
import { registerSeed, getSeedStatus } from '../jobs/pollSeedInboxes.js';

const router = Router();

router.post('/register', async (req, res) => {
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

router.get('/status/:campaignId', async (req, res) => {
  try {
    const status = await getSeedStatus(req.params.campaignId);
    res.json(status);
  } catch (err: any) {
    console.error('[SeedRoutes] Status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
