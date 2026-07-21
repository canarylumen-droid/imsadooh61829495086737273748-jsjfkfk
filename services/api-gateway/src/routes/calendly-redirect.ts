import { Router, Request, Response } from 'express';
import { calendlyOAuth, registerCalendlyWebhook } from '@services/api-gateway/src/oauth/calendly.js';
import { storage } from '@shared/lib/storage/storage.js';
import { encrypt, decryptState } from '@shared/lib/crypto/encryption.js';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';
import { clusterSync } from '@shared/lib/realtime/redis-pubsub.js';
import { db } from '@shared/lib/db/db.js';
import { users, calendarSettings } from '@audnix/shared';
import { eq } from 'drizzle-orm';

const router = Router();

interface CalendlyStateData {
  userId: string;
  type: string;
}

/**
 * GET /api/oauth/calendly/callback
 * Handles Calendly OAuth synchronization in the background.
 */
router.get('/calendly/callback', async (req: Request, res: Response): Promise<void> => {
  try {
    const { code, state, error } = req.query;

    console.log(`[Calendly Redirect] Callback received. State: ${state}`);

    if (error) {
      console.error(`[Calendly Redirect] OAuth error: ${error}`);
      res.redirect('/dashboard/calendar?error=calendly_denied');
      return;
    }

    if (!code || !state) {
      res.redirect('/dashboard/calendar?error=invalid_request');
      return;
    }

    // 1. Verify state and retrieve user context (Production-grade AES-256-GCM)
    const stateData = decryptState(state as string);
    if (!stateData) {
      console.error('[Calendly Redirect] Invalid or expired state signature');
      res.redirect('/dashboard/calendar?error=invalid_state');
      return;
    }

    const userId = stateData.userId;

    // Re-attach userId to session (OAuth redirect may create a new browser context)
    if ((req as any).session) {
      (req as any).session.userId = userId;
    }

    // Exchange code for tokens
    console.log(`[Calendly Redirect] Exchanging code for tokens for user: ${userId}`);
    const tokenData = await calendlyOAuth.exchangeCodeForToken(code as string);

    // 2. Remove any existing Calendly integration first — prevents duplicate records
    //    when users reconnect via OAuth without manually disconnecting first.
    const existingIntegration = await storage.getIntegration(userId, 'calendly');
    if (existingIntegration) {
      await calendlyOAuth.revokeToken(userId).catch(() => {});
      await storage.deleteIntegrationById(existingIntegration.id);
    }

    // 2.5 Encrypt and persist
    const encryptedMeta = encrypt(JSON.stringify({
      access_token: tokenData.accessToken,
      refresh_token: tokenData.refreshToken,
      expiresAt: tokenData.expiresAt.toISOString()
    }));

    await storage.createIntegration({
      userId: userId,
      provider: 'calendly',
      accountType: tokenData.user?.email || tokenData.user?.name || 'calendly',
      encryptedMeta: encryptedMeta,
      connected: true,
      lastSync: new Date(),
    });

    // 3. Save Calendly User Info and Timezone — fresh clean slate
    if (tokenData.user) {
      console.log(`[Calendly Redirect] Saving timezone (${tokenData.user.timezone}) and URI for user: ${userId}`);
      
      // Update User table — always overwrite with fresh data
      await db.update(users).set({
        timezone: tokenData.user.timezone || "America/New_York",
        calendlyUserUri: tokenData.user.uri,
        calendarLink: tokenData.user.schedulingUrl || undefined,
        calendlyAccessToken: "oauth_connected",
      }).where(eq(users.id, userId));

      // Upsert Calendar Settings — fresh clean state
      await db.insert(calendarSettings).values({
        userId,
        timezone: tokenData.user.timezone || "America/New_York",
        calendlyEnabled: true,
      }).onConflictDoUpdate({
        target: calendarSettings.userId,
        set: {
          timezone: tokenData.user.timezone || "America/New_York",
          calendlyEnabled: true,
        },
      });
    }

    // 3. Register Webhook for real-time meetings (Async background task)
    registerCalendlyWebhook(userId, tokenData.accessToken).catch(err => {
      console.error('[Calendly Redirect] Failed to register webhook:', err);
      (req as any).webhookSetupIssue = true;
    });
    
    // Schedule a delayed check so we can surface webhook setup issues in the session
    setTimeout(async () => {
      if ((req as any).webhookSetupIssue && (req as any).session) {
        (req as any).session.calendlyWebhookWarning = 'Webhook registration failed. Real-time meeting sync may be unavailable. Try reconnecting or upgrading your Calendly plan.';
      }
    }, 100);

    // 4. Notify frontend — both direct and cross-process
    wsSync.notifySettingsUpdated(userId);
    clusterSync.notifyStatsUpdated(userId).catch(() => {});
    clusterSync.notifyStatsCacheInvalidate(userId).catch(() => {});

    console.log('[Calendly Redirect] Success. Saving session and redirecting back to dashboard.');
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => {
        if (err) { reject(err); return; }
        resolve();
      });
    });
    // Explicitly set cookie to survive cross-site OAuth redirect browsers
    res.cookie('audnix.sid', req.sessionID, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 30,
      path: '/',
    });
    res.redirect('/dashboard/calendar?success=calendly_connected&t=' + Date.now());
  } catch (error) {
    console.error('[Calendly Redirect] Fatal callback error:', error);
    res.redirect('/dashboard/calendar?error=calendly_oauth_failed');
  }
});

export default router;

