import { Router, Request, Response } from 'express';
import { requireAuth, getCurrentUserId } from '../middleware/auth.js';
import { storage } from '@shared/lib/storage/storage.js';

const router = Router();

interface ChannelStatus {
  provider: string;
  connected: boolean;
  accountName?: string;
  lastSync?: string;
  error?: string;
}

interface AllChannelsResponse {
  email: ChannelStatus;
  instagram: ChannelStatus;
  calendly: ChannelStatus;
}

router.get('/all', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;

    const [emailIntegration, instagramIntegration, calendlyIntegration] = await Promise.all([
      storage.getIntegration(userId, 'custom_email'),
      storage.getIntegration(userId, 'instagram'),
      storage.getIntegration(userId, 'calendly')
    ]);

    const response: AllChannelsResponse = {
      email: {
        provider: 'custom_smtp',
        connected: !!emailIntegration?.connected,
        accountName: emailIntegration?.accountType || undefined,
      },
      instagram: {
        provider: 'instagram',
        connected: !!instagramIntegration?.connected,
        accountName: instagramIntegration?.accountType || undefined,
      },
      calendly: {
        provider: 'calendly',
        connected: !!calendlyIntegration?.connected,
        accountName: calendlyIntegration?.accountType || undefined,
      }
    };

    res.json({ success: true, channels: response });
  } catch (error: unknown) {
    console.error('Error fetching channel status:', error);
    res.status(500).json({ error: 'Failed to fetch channel status' });
  }
});

router.get('/email', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const integration = await storage.getIntegration(userId, 'custom_email');

    res.json({
      success: true,
      provider: 'custom_smtp',
      connected: !!integration?.connected,
      accountName: integration?.accountType || null,
    });
  } catch (error: unknown) {
    console.error('Error fetching email status:', error);
    res.status(500).json({ error: 'Failed to fetch email status' });
  }
});

router.get('/instagram', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const integration = await storage.getIntegration(userId, 'instagram');

    res.json({
      success: true,
      provider: 'instagram',
      connected: !!integration?.connected,
      accountName: integration?.accountType || null,
    });
  } catch (error: unknown) {
    console.error('Error fetching instagram status:', error);
    res.status(500).json({ error: 'Failed to fetch instagram status' });
  }
});

router.get('/calendly', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const integration = await storage.getIntegration(userId, 'calendly');

    res.json({
      success: true,
      provider: 'calendly',
      connected: !!integration?.connected,
      accountName: integration?.accountType || null,
    });
  } catch (error: unknown) {
    console.error('Error fetching calendly status:', error);
    res.status(500).json({ error: 'Failed to fetch calendly status' });
  }
});

export default router;
