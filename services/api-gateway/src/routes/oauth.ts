import { Request, Response, Router } from 'express';
import { InstagramOAuth } from '@services/api-gateway/src/oauth/instagram.js';
import { gmailOAuth } from '@services/api-gateway/src/oauth/gmail.js';
import { GoogleCalendarOAuth } from '@services/api-gateway/src/oauth/google-calendar.js';
import { CalendlyOAuth, registerCalendlyWebhook } from '@services/api-gateway/src/oauth/calendly.js';
import { storage } from '@shared/lib/storage/storage.js';
import { encrypt, encryptState, decryptState } from '@shared/lib/crypto/encryption.js';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';
import { distributeLeadsFromPool } from '@services/outreach-worker/src/sales-engine/outreach-engine.js';
import googleRedirectRouter from './google-redirect.js';
import calendlyRedirectRouter from './calendly-redirect.js';
import instagramRedirectRouter from './instagram-redirect.js';
import outlookRedirectRouter from './outlook-redirect.js';
import { OutlookOAuth } from '@services/api-gateway/src/oauth/outlook.js';
import { requireAuthOrApiKey } from '../middleware/auth.js';

interface AuthenticatedRequest extends Request {
  session: Request['session'] & {
    userId?: string;
  };
}


interface CalendarEventBody {
  user_id?: string;
  summary: string;
  description?: string;
  startTime: string;
  endTime: string;
  attendeeEmail?: string;
  location?: string;
  leadId?: string;
}

interface DisconnectBody {
  user_id?: string;
}

interface CalendarEventData {
  id: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ displayName?: string; email?: string }>;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: Array<{ uri?: string }> };
  description?: string;
  location?: string;
  htmlLink?: string;
}

interface CalendlyStateData {
  userId: string;
  type: string;
}

interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  email?: string;
}

function getUserId(req: AuthenticatedRequest, fromBody = false): string | undefined {
  if (fromBody) {
    const body = req.body as DisconnectBody;
    return req.session?.userId || body.user_id;
  }
  return req.session?.userId || (req.query.user_id as string | undefined);
}

const router = Router();
const instagramOAuth = new InstagramOAuth();
const googleCalendarOAuth = new GoogleCalendarOAuth();
const calendlyOAuth = new CalendlyOAuth();
const outlookOAuth = new OutlookOAuth();

// Mount dedicated redirect handlers
router.use(googleRedirectRouter);
router.use(calendlyRedirectRouter);
router.use(instagramRedirectRouter);
router.use(outlookRedirectRouter);

// ==================== INSTAGRAM OAUTH ====================



// GET /auth/instagram - Redirect to Instagram OAuth authorization page
// This route is mounted at /api/oauth/instagram, but might be aliased
import { authLimiter } from '../middleware/rate-limit.js';

router.get('/connect/instagram', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req as AuthenticatedRequest);

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const state = encryptState(`${userId}:${Date.now()}`);
    const authUrl = instagramOAuth.getAuthorizationUrl(state);
    console.log('[Instagram Connect] Generated JSON URL for user:', userId);
    res.json({ authUrl });
  } catch (error) {
    console.error('Error initiating Instagram OAuth:', error);
    res.status(500).json({ error: 'Failed to initiate OAuth flow' });
  }
});

router.get('/instagram', authLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req as AuthenticatedRequest);
    const callbackUrl = process.env.META_CALLBACK_URL || "NOT SET IN ENV";

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("[Instagram OAuth] /api/oauth/instagram called");
    console.log("[Instagram OAuth] META_CALLBACK_URL: %s", callbackUrl);
    console.log("[Instagram OAuth] User ID from session: %s", userId || "NOT AUTHENTICATED");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    if (!userId) {
      // Redirect to login page if not authenticated
      res.redirect('/auth?error=not_authenticated&redirect=/dashboard/integrations');
      return;
    }

    const state = encryptState(`${userId}:${Date.now()}`);
    const authUrl = instagramOAuth.getAuthorizationUrl(state);
    console.log("[Instagram OAuth] Redirecting to:", authUrl);
    res.redirect(authUrl);
  } catch (error) {
    console.error('Error initiating Instagram OAuth:', error);
    res.redirect('/dashboard/integrations?error=oauth_init_failed');
  }
});

// Instagram callback logic moved to dedicated instagram-redirect.ts file

router.post('/instagram/disconnect', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req as AuthenticatedRequest, true);

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    await instagramOAuth.revokeToken(userId);
    // Using Neon database for integration storage - no Supabase needed
    res.json({ success: true });
  } catch (error) {
    console.error('Error disconnecting Instagram:', error);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

router.get('/instagram/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req as AuthenticatedRequest);

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const token = await instagramOAuth.getValidToken(userId);

    if (token) {
      try {
        const profile = await instagramOAuth.getUserProfile(token);
        res.json({
          connected: true,
          username: profile.username,
          userId: profile.id
        });
      } catch {
        res.json({ connected: false, error: 'Token expired or invalid' });
      }
    } else {
      res.json({ connected: false });
    }
  } catch (error) {
    console.error('Error checking Instagram status:', error);
    res.status(500).json({ error: 'Failed to check status' });
  }
});

// ==================== GMAIL OAUTH ====================

router.get('/connect/gmail', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req as AuthenticatedRequest);

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const state = encryptState(`${userId}:${Date.now()}`);
    const authUrl = gmailOAuth.getAuthorizationUrl(state); // Update getAuthorizationUrl to accept state directly
    res.json({ authUrl });
  } catch (error) {
    console.error('Error initiating Gmail OAuth:', error);
    res.status(500).json({ error: 'Failed to initiate OAuth flow' });
  }
});

// Gmail callback logic moved to dedicated google-redirect.ts file

router.post('/gmail/disconnect', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req as AuthenticatedRequest, true);

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const { integrationId } = req.query;
    if (integrationId && typeof integrationId === 'string') {
      const integration = await storage.getIntegrationById(integrationId);
      if (integration && integration.userId === userId) {
        if (integration.accountType) {
          await gmailOAuth.revokeToken(userId, integration.accountType);
        }
        await storage.deleteIntegrationById(integrationId);
      }
    } else {
      const allInts = await storage.getIntegrations(userId);
      const gmailInts = allInts.filter(i => i.provider === 'gmail');
      for (const i of gmailInts) {
        if (i.accountType) {
          await gmailOAuth.revokeToken(userId, i.accountType);
        }
      }
      await storage.disconnectIntegration(userId, 'gmail');
    }

    // Broadcast settings update to frontend
    try {
      const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
      wsSync.notifySettingsUpdated(userId);
    } catch (e) {
      console.warn('[OAuth Route] Failed to notify settings updated via WS:', e);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error disconnecting Gmail:', error);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

router.get('/gmail/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req as AuthenticatedRequest);

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const token = await gmailOAuth.getValidToken(userId);

    if (token) {
      try {
        const profile = await gmailOAuth.getGmailProfile(token);
        res.json({
          connected: true,
          email: profile.emailAddress
        });
      } catch {
        res.json({ connected: false, error: 'Token expired or invalid' });
      }
    } else {
      res.json({ connected: false });
    }
  } catch (error) {
    console.error('Error checking Gmail status:', error);
    res.status(500).json({ error: 'Failed to check status' });
  }
});

// ==================== OUTLOOK OAUTH ====================

router.get('/connect/outlook', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req as AuthenticatedRequest);

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const state = encryptState(`${userId}:${Date.now()}`);
    const authUrl = outlookOAuth.getAuthorizationUrl(state);
    res.json({ authUrl });
  } catch (error) {
    console.error('Error initiating Outlook OAuth:', error);
    res.status(500).json({ error: 'Failed to initiate OAuth flow' });
  }
});

router.post('/outlook/disconnect', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req as AuthenticatedRequest, true);

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const { integrationId } = req.query;
    if (integrationId && typeof integrationId === 'string') {
      const integration = await storage.getIntegrationById(integrationId);
      if (integration && integration.userId === userId) {
        if (integration.accountType) {
          await outlookOAuth.revokeToken(userId, integration.accountType);
        }
        await storage.deleteIntegrationById(integrationId);
      }
    } else {
      const allInts = await storage.getIntegrations(userId);
      const outlookInts = allInts.filter(i => i.provider === 'outlook');
      for (const i of outlookInts) {
        if (i.accountType) {
          await outlookOAuth.revokeToken(userId, i.accountType);
        }
      }
      await storage.disconnectIntegration(userId, 'outlook');
    }

    // Broadcast settings update to frontend
    try {
      const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
      wsSync.notifySettingsUpdated(userId);
    } catch (e) {
      console.warn('[OAuth Route] Failed to notify settings updated via WS:', e);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error disconnecting Outlook:', error);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

router.get('/outlook/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req as AuthenticatedRequest);

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const token = await outlookOAuth.getValidToken(userId);

    if (token) {
      try {
        const profile = await outlookOAuth.getUserProfile(token);
        res.json({
          connected: true,
          email: profile.mail || profile.userPrincipalName
        });
      } catch {
        res.json({ connected: false, error: 'Token expired or invalid' });
      }
    } else {
      res.json({ connected: false });
    }
  } catch (error) {
    console.error('Error checking Outlook status:', error);
    res.status(500).json({ error: 'Failed to check status' });
  }
});

// ==================== GOOGLE CALENDAR OAUTH ====================

async function handleGoogleCalendarConnect(req: Request, res: Response) {
  try {
    const userId = getUserId(req as AuthenticatedRequest);

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const state = encryptState(`${userId}:${Date.now()}`);
    const authUrl = googleCalendarOAuth.getAuthUrl(state);
    res.json({ authUrl });
  } catch (error) {
    console.error('Error initiating Google Calendar OAuth:', error);
    res.status(500).json({ error: 'Failed to initiate OAuth flow' });
  }
}

// Serve both hyphen and underscore variants for robustness
router.get('/connect/google-calendar', handleGoogleCalendarConnect);
router.get('/connect/google_calendar', handleGoogleCalendarConnect);

// Google Calendar callback logic moved to dedicated google-redirect.ts file

router.post('/google-calendar/disconnect', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req as AuthenticatedRequest, true);

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    await storage.disconnectIntegration(userId, 'google_calendar');

    wsSync.notifySettingsUpdated(userId);

    res.json({ success: true });
  } catch (error) {
    console.error('Error disconnecting Google Calendar:', error);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

router.post('/google-calendar/events', async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthenticatedRequest;
    const body = req.body as CalendarEventBody;
    const userId = authReq.session?.userId || body.user_id;

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const { summary, description, startTime, endTime, attendeeEmail, leadId, location } = body;

    if (!summary || !startTime || !endTime) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const integration = await storage.getIntegration(userId, 'google_calendar');

    if (!integration) {
      res.status(404).json({ error: 'Google Calendar not connected' });
      return;
    }

    const tokens: StoredTokens = JSON.parse(integration.encryptedMeta);
    const expiresAt = new Date(tokens.expiresAt);
    let accessToken = tokens.accessToken;

    if (expiresAt < new Date() && tokens.refreshToken) {
      const refreshedTokens = await googleCalendarOAuth.refreshAccessToken(tokens.refreshToken);
      accessToken = refreshedTokens.accessToken;
    }

    const event: CalendarEventData = await googleCalendarOAuth.createEvent(accessToken, {
      summary,
      description,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      attendeeEmail,
      location,
    });

    if (leadId) {
      await storage.createMessage({
        leadId,
        userId,
        provider: 'system',
        direction: 'outbound',
        body: `Calendar event created: ${summary}`,
        metadata: {
          eventId: event.id,
          eventLink: event.htmlLink,
          meetingLink: event.hangoutLink
        }
      });
    }

    res.json({ event });
  } catch (error) {
    console.error('Error creating calendar event:', error);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

router.get('/google-calendar/events', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req as AuthenticatedRequest);

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    const integration = await storage.getIntegration(userId, 'google_calendar');

    if (!integration || !integration.connected) {
      res.status(404).json({ error: 'Google Calendar not connected' });
      return;
    }

    const tokens: StoredTokens = JSON.parse(integration.encryptedMeta);
    const expiresAt = new Date(tokens.expiresAt);
    let accessToken = tokens.accessToken;

    if (expiresAt < new Date() && tokens.refreshToken) {
      const refreshedTokens = await googleCalendarOAuth.refreshAccessToken(tokens.refreshToken);
      accessToken = refreshedTokens.accessToken;

      const updatedTokens = {
        ...tokens,
        accessToken: refreshedTokens.accessToken,
        expiresAt: refreshedTokens.expiresAt.toISOString(),
      };

      await storage.updateIntegration(userId, 'google_calendar', {
        encryptedMeta: encrypt(JSON.stringify(updatedTokens)),
      });
    }

    const rawEvents: CalendarEventData[] = await googleCalendarOAuth.listUpcomingEvents(accessToken);

    const events = rawEvents.map((event: CalendarEventData) => ({
      id: event.id,
      title: event.summary || 'Untitled Event',
      startTime: event.start?.dateTime || event.start?.date,
      endTime: event.end?.dateTime || event.end?.date,
      leadName: event.attendees?.[0]?.displayName || event.attendees?.[0]?.email || null,
      meetingUrl: event.hangoutLink || event.conferenceData?.entryPoints?.[0]?.uri || null,
      isAiBooked: event.description?.includes('AI Scheduled') || false,
      location: event.location || null,
      description: event.description || null,
    }));

    res.json({ events });
  } catch (error) {
    console.error('Error fetching calendar events:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// ==================== CALENDLY OAUTH ====================

router.get('/connect/calendly', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getUserId(req as AuthenticatedRequest)!;

    if (!userId) {
      res.status(401).json({ error: 'User not authenticated' });
      return;
    }

    // Check if Calendly already connected for this user (per-user, not shareable)
    const existingInt = await storage.getIntegration(userId, 'calendly');
    if (existingInt) {
      res.status(409).json({ error: 'Calendly is already connected. Each Calendly account links to one Audnix user. Disconnect first to reconnect.' });
      return;
    }

    const state = encryptState(`${userId}:${Date.now()}`);
    const authUrl = calendlyOAuth.getAuthUrl(state);
    if (!authUrl || !authUrl.startsWith('https://')) {
      res.status(500).json({ error: 'Invalid Calendly authorization URL. Check Calendly client configuration.' });
      return;
    }
    res.json({ authUrl });
  } catch (error) {
    console.error('Error initiating Calendly OAuth:', error);
    res.status(500).json({ error: 'Failed to initiate Calendly connection. Please try again.' });
  }
});

// Calendly callback logic moved to dedicated calendly-redirect.ts file

import { getAllOAuthRedirectUrls } from '@shared/config/config/oauth-redirects.js';

router.get('/debug/redirect-urls', (req: Request, res: Response) => {
  res.json({
    environment: process.env.NODE_ENV,
    domain: process.env.DOMAIN,
    redirects: getAllOAuthRedirectUrls()
  });
});

export default router;

