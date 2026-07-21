import { Router, Request, Response } from 'express';
import { requireAuthOrApiKey, getCurrentUserId } from '../middleware/auth.js';
import {
  getAvailableTimeSlots,
  sendBookingLinkToLead,
  bookMeeting,
  formatBookingMessage
} from '@shared/lib/calendar/calendar-booking.js';
import { validateCalendlyToken } from '@shared/lib/calendar/calendly.js';
import { storage } from '@shared/lib/storage/storage.js';
import { db } from '@shared/lib/db/db.js';
import { users, calendarSettings, calendarBookings, calendarEvents, aiActionLogs } from '@audnix/shared';
import { eq, and, desc } from 'drizzle-orm';
import type { ChannelType } from '@shared/types.js';
import { calendlyOAuth } from '@services/api-gateway/src/oauth/calendly.js';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';
import { clusterSync } from '@shared/lib/realtime/redis-pubsub.js';

const router = Router();

// Start automatic Calendly sync for free plan users (polls every 10 minutes)
import('@shared/lib/calendar/calendly-sync-worker.js').then(({ startAutomaticCalendlySync }) => {
  startAutomaticCalendlySync();
  console.log('✅ [Calendly] Automatic sync started (polls every 10 minutes)');
}).catch(err => {
  console.error('⚠️ Failed to start Calendly automatic sync:', err);
});

/**
 * Get calendar settings for user
 */
router.get('/settings', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;

    const [settings] = await db
      .select()
      .from(calendarSettings)
      .where(eq(calendarSettings.userId, userId))
      .limit(1);

    const integrations = await storage.getIntegrations(userId);
    const calendlyIntegration = integrations.find(i => i.provider === 'calendly' && i.connected);
    const googleIntegration = integrations.find(i => i.provider === 'google_calendar' && i.connected);

    let calendlyUsername = null;
    let calendlySchedulingUrl = null;
    if (calendlyIntegration?.encryptedMeta) {
      try {
        const { decrypt } = await import('@shared/lib/crypto/encryption.js');
        const decrypted = await decrypt(calendlyIntegration.encryptedMeta);
        const data = JSON.parse(decrypted);
        calendlyUsername = data.username || 'connected';
        calendlySchedulingUrl = data.schedulingUrl || null;
      } catch { }
    }

    const [userRow] = await db
      .select({ calendarLink: users.calendarLink, calendlyUserUri: users.calendlyUserUri })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const calendarLink = userRow?.calendarLink || calendlySchedulingUrl || (calendlyUsername ? `https://calendly.com/${calendlyUsername}` : null);

    res.json({ 
      settings: settings ? {
        ...settings,
        calendlyEnabled: !!calendlyIntegration,
        calendlyUsername,
        calendarLink,
        googleCalendarEnabled: !!googleIntegration,
      } : {
        id: null,
        calendlyEnabled: !!calendlyIntegration,
        calendlyUsername,
        calendarLink,
        googleCalendarEnabled: !!googleIntegration,
        autoBookingEnabled: false,
        minIntentScore: 70,
        minTimingScore: 60,
        meetingDuration: 30,
        titleTemplate: '{{lead_name}} - Discovery Call',
        bufferBefore: 10,
        bufferAfter: 5,
        workingHoursStart: 9,
        workingHoursEnd: 17,
        timezone: 'America/New_York',
      }
    });
  } catch (error: any) {
    console.error('Error getting calendar settings:', error.message);
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

/**
 * Update calendar settings
 */
router.patch('/settings', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const updates = req.body;

    const [existing] = await db
      .select()
      .from(calendarSettings)
      .where(eq(calendarSettings.userId, userId))
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(calendarSettings)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(calendarSettings.userId, userId))
        .returning();
      res.json({ settings: updated });
    } else {
      const [created] = await db
        .insert(calendarSettings)
        .values({ userId, ...updates })
        .returning();
      res.json({ settings: created });
    }
  } catch (error: any) {
    console.error('Error updating calendar settings:', error.message);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

/**
 * Get calendar bookings
 */
router.get('/bookings', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;

    const bookings = await db
      .select()
      .from(calendarBookings)
      .where(eq(calendarBookings.userId, userId))
      .orderBy(desc(calendarBookings.startTime))
      .limit(50);

    res.json({ bookings });
  } catch (error: any) {
    console.error('Error getting bookings:', error.message);
    res.status(500).json({ error: 'Failed to get bookings' });
  }
});

/**
 * Get calendar events (synced from Calendly, Google Calendar, etc.)
 */
router.get('/events', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const events = await db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.userId, userId))
      .orderBy(desc(calendarEvents.startTime))
      .limit(100);
    res.json({ events });
  } catch (error: any) {
    console.error('Error getting calendar events:', error.message);
    res.status(500).json({ error: 'Failed to get events' });
  }
});

/**
 * Get AI action logs for calendar
 */
router.get('/ai-logs', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;

    const logs = await db
      .select()
      .from(aiActionLogs)
      .where(and(eq(aiActionLogs.userId, userId), eq(aiActionLogs.actionType, 'calendar_booking')))
      .orderBy(desc(aiActionLogs.createdAt))
      .limit(20);

    res.json({ logs });
  } catch (error: any) {
    console.error('Error getting AI logs:', error.message);
    res.status(500).json({ error: 'Failed to get logs' });
  }
});

/**
 * Connect Calendly with token
 */
router.post('/connect-calendly', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { token } = req.body;

    if (!token?.trim()) {
      res.status(400).json({ error: 'Token required' });
      return;
    }

    const validation = await validateCalendlyToken(token);
    if (!validation.valid || !validation.userUri || !validation.organizationUri) {
      res.status(400).json({ error: validation.error || 'Invalid token or missing user/org data' });
      return;
    }

    const { encrypt } = await import('@shared/lib/crypto/encryption.js');
    const encrypted = await encrypt(JSON.stringify({
      api_token: token,
      username: validation.userName,
      user_uri: validation.userUri,
      organization_uri: validation.organizationUri,
      scheduling_url: validation.schedulingUrl
    }));

    const existingIntegrations = await storage.getIntegrations(userId);
    const existingCalendly = existingIntegrations.find(i => i.provider === 'calendly');

    if (existingCalendly) {
      await storage.deleteIntegration(userId, 'calendly');
    }

    // Register webhook automatically with Calendly
    const { setupCalendlyWebhook } = await import('@shared/lib/calendar/calendly.js');
    const webhookSuccess = await setupCalendlyWebhook(token, validation.organizationUri, validation.userUri);
    
    if (!webhookSuccess) {
      console.warn(`[Calendly] Webhook registration failed for user ${userId}, but continuing integration.`);
    }

    await storage.createIntegration({
      userId,
      provider: 'calendly',
      connected: true,
      encryptedMeta: encrypted,
      accountType: 'personal',
      syncMetadata: {
        userUri: validation.userUri,
        organizationUri: validation.organizationUri,
        webhookActive: webhookSuccess
      }
    });

    // Also update the user record for direct matching
    await storage.updateUser(userId, {
      calendlyUserUri: validation.userUri,
      ...(validation.schedulingUrl && { calendarLink: validation.schedulingUrl }),
      calendlyAccessToken: "manual_connected",
      updatedAt: new Date()
    });

    const [existingSettings] = await db
      .select()
      .from(calendarSettings)
      .where(eq(calendarSettings.userId, userId))
      .limit(1);

    const settingsPayload = {
      calendlyEnabled: true,
      calendlyToken: token,
      calendlyUsername: validation.userName,
      updatedAt: new Date()
    };

    if (existingSettings) {
      await db.update(calendarSettings).set(settingsPayload).where(eq(calendarSettings.userId, userId));
    } else {
      await db.insert(calendarSettings).values({ userId, ...settingsPayload });
    }

    console.log(`✓ Calendly connected and webhooks registered for user: ${userId} (${validation.userName})`);

    res.json({ 
      success: true, 
      username: validation.userName,
      webhookActive: webhookSuccess 
    });
  } catch (error: any) {
    console.error('Error connecting Calendly:', error.message);
    res.status(500).json({ error: 'Failed to connect' });
  }
});

/**
 * Disconnect Calendly
 * Cleans up ALL Calendly traces across users, integrations, and calendar_settings.
 */
router.post('/disconnect-calendly', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;

    // 1. Revoke token remotely (best-effort — don't fail if Calendly API is down)
    try {
      await calendlyOAuth.revokeToken(userId);
    } catch (revokeErr: any) {
      console.warn('[Calendar] Remote token revocation failed:', revokeErr.message);
    }

    // 2. Delete integration record
    await storage.deleteIntegration(userId, 'calendly');

    // 3. Clear user-level Calendly fields
    await db.update(users).set({
      calendlyAccessToken: null as any,
      calendlyRefreshToken: null as any,
      calendlyExpiresAt: null as any,
      calendlyUserUri: null as any,
      calendarLink: null as any,
    }).where(eq(users.id, userId));

    // 4. Disable calendar settings
    await db.update(calendarSettings).set({
      calendlyEnabled: false,
      calendlyToken: null as any,
      calendlyUsername: null as any,
      calendlyEventTypeUri: null as any,
    }).where(eq(calendarSettings.userId, userId));

    // 5. Notify frontend — both direct and cross-process
    wsSync.notifySettingsUpdated(userId);
    clusterSync.notifyStatsUpdated(userId).catch(() => {});
    clusterSync.notifyStatsCacheInvalidate(userId).catch(() => {});

    res.json({ success: true });
  } catch (error: any) {
    console.error('Error disconnecting Calendly:', error.message);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

/**
 * Get available time slots for booking
 */
router.get('/slots', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const daysAhead = req.query.daysAhead as string | undefined;
    const duration = req.query.duration as string | undefined;

    const slots = await getAvailableTimeSlots(
      userId,
      daysAhead ? parseInt(daysAhead, 10) : 7,
      duration ? parseInt(duration, 10) : 30
    );

    res.json({
      success: true,
      count: slots.length,
      slots: slots.map(slot => ({
        start: slot.startTime.toISOString(),
        end: slot.endTime.toISOString(),
        available: slot.available,
        timezone: slot.timezone
      }))
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error getting time slots:', errorMessage);
    res.status(500).json({ error: 'Failed to get available slots' });
  }
});

/**
 * Send booking link to lead
 */
router.post('/send-link', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { leadEmail, leadName, leadId, campaignId, duration } = req.body as {
      leadEmail?: string;
      leadName?: string;
      leadId?: string;
      campaignId?: string;
      duration?: number;
    };

    if (!leadEmail || !leadName || !leadId) {
      res.status(400).json({ error: 'Lead email, name, and leadId required' });
      return;
    }

    const result = await sendBookingLinkToLead({
      leadEmail,
      leadName,
      userId,
      leadId,
      campaignId: campaignId || '',
      duration: duration || 30
    });

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({
      success: true,
      bookingLink: result.bookingLink,
      message: `Booking link ready to send to ${leadName}`
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error sending booking link:', errorMessage);
    res.status(500).json({ error: 'Failed to send booking link' });
  }
});

/**
 * Book meeting when lead accepts
 */
router.post('/book', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const { leadEmail, leadName, startTime, endTime, duration } = req.body as {
      leadEmail?: string;
      leadName?: string;
      startTime?: string;
      endTime?: string;
      duration?: number;
    };

    if (!leadEmail || !startTime) {
      res.status(400).json({
        error: 'Lead email and start time required'
      });
      return;
    }

    const result = await bookMeeting(
      userId,
      leadEmail,
      leadName || 'Guest',
      new Date(startTime),
      new Date(endTime || startTime),
      duration || 30
    );

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({
      success: true,
      eventId: result.eventId,
      meetingLink: result.meetingLink,
      message: `Meeting booked with ${leadName || 'Guest'}`
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error booking meeting:', errorMessage);
    res.status(500).json({ error: 'Failed to book meeting' });
  }
});

/**
 * Get formatted message for sending booking link
 */
router.post('/format-message', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const { leadName, bookingLink, channel } = req.body as {
      leadName?: string;
      bookingLink?: string;
      channel?: string;
    };

    if (!leadName || !bookingLink || !channel) {
      res.status(400).json({
        error: 'Lead name, booking link, and channel required'
      });
      return;
    }

    if (!['email', 'instagram'].includes(channel)) {
      res.status(400).json({
        error: 'Channel must be email or instagram'
      });
      return;
    }

    const message = formatBookingMessage(leadName, bookingLink, channel as ChannelType);

    res.json({
      success: true,
      message,
      channel
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error formatting message:', errorMessage);
    res.status(500).json({ error: 'Failed to format message' });
  }
});

/**
 * Get calendar status (which provider is connected)
 */
router.get('/status', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getCurrentUserId(req)!;
    const integrations = await storage.getIntegrations(userId);

    const calendly = integrations.find(i => i.provider === 'calendly' && i.connected);
    const google = integrations.find(i => i.provider === 'google_calendar' && i.connected);

    res.json({
      success: true,
      calendly: {
        connected: !!calendly,
        provider: 'calendly',
        accountType: calendly?.accountType || null
      },
      google: {
        connected: !!google,
        provider: 'google_calendar',
        accountType: google?.accountType || null
      },
      primary: calendly ? 'calendly' : google ? 'google_calendar' : null,
      message: calendly
        ? 'Using Calendly for instant booking'
        : google
          ? 'Using Google Calendar for booking'
          : 'No calendar connected. Connect Calendly or Google Calendar to enable booking.'
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error getting calendar status:', errorMessage);
    res.status(500).json({ error: 'Failed to get calendar status' });
  }
});

/**
 * Public booking page for leads (no auth required)
 */
router.get('/public/:userId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    const leadEmail = req.query.leadEmail as string | undefined;
    const leadName = req.query.leadName as string | undefined;

    const user = await storage.getUserById(userId as string);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const slots = await getAvailableTimeSlots(userId as string, 14, 30);

    res.json({
      success: true,
      hostName: user.name || user.company,
      hostEmail: user.email,
      leadEmail: leadEmail || null,
      leadName: leadName || null,
      availableSlots: slots.map(s => ({
        start: s.startTime.toISOString(),
        end: s.endTime.toISOString()
      }))
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error loading public booking page:', errorMessage);
    res.status(500).json({ error: 'Failed to load booking page' });
  }
});

export default router;
