import { Router, Request, Response } from 'express';
import { requireAuthOrApiKey, getCurrentUserId } from '../middleware/auth.js';
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
  googleCalendar: ChannelStatus;
}

router.get('/all', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;

    const integrations = await storage.getIntegrations(userId);

    const emailIntegration = integrations.find(
      i => (i.provider === 'custom_email' || i.provider === 'gmail' || i.provider === 'outlook') && i.connected
    );
    const instagramIntegration = integrations.find(
      i => i.provider === 'instagram' && i.connected
    );
    const calendlyIntegration = integrations.find(
      i => i.provider === 'calendly' && i.connected
    );
    const googleCalendarIntegration = integrations.find(
      i => i.provider === 'google_calendar' && i.connected
    );

    const response: AllChannelsResponse = {
      email: {
        provider: emailIntegration?.provider || 'custom_smtp',
        connected: !!emailIntegration,
        accountName: emailIntegration?.accountType || undefined,
      },
      instagram: {
        provider: 'instagram',
        connected: !!instagramIntegration,
        accountName: instagramIntegration?.accountType || undefined,
      },
      calendly: {
        provider: 'calendly',
        connected: !!calendlyIntegration,
        accountName: calendlyIntegration?.accountType || undefined,
      },
      googleCalendar: {
        provider: 'google_calendar',
        connected: !!googleCalendarIntegration,
        accountName: googleCalendarIntegration?.accountType || undefined,
      }
    };

    res.json({ success: true, channels: response });
  } catch (error: unknown) {
    console.error('Error fetching channel status:', error);
    res.status(500).json({ error: 'Failed to fetch channel status' });
  }
});

router.get('/email', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const integrations = await storage.getIntegrations(userId);
    const integration = integrations.find(
      i => (i.provider === 'custom_email' || i.provider === 'gmail' || i.provider === 'outlook') && i.connected
    );

    res.json({
      success: true,
      provider: integration ? integration.provider : 'custom_smtp',
      connected: !!integration,
      accountName: integration?.accountType || null,
    });
  } catch (error: unknown) {
    console.error('Error fetching email status:', error);
    res.status(500).json({ error: 'Failed to fetch email status' });
  }
});

router.get('/instagram', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
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

router.get('/google-calendar', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const integration = await storage.getIntegration(userId, 'google_calendar');

    res.json({
      success: true,
      provider: 'google_calendar',
      connected: !!integration?.connected,
      accountName: integration?.accountType || null,
    });
  } catch (error: unknown) {
    console.error('Error fetching google calendar status:', error);
    res.status(500).json({ error: 'Failed to fetch google calendar status' });
  }
});

router.get('/calendly', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
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
