import { Router, Request, Response } from 'express';
import { gmailOAuth } from '@services/api-gateway/src/oauth/gmail.js';
import { googleCalendarOAuth } from '@services/api-gateway/src/oauth/google-calendar.js';
import { storage } from '@shared/lib/storage/storage.js';
import { encrypt, decryptState } from '@shared/lib/crypto/encryption.js';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';
import { emailSyncWorker } from '@services/email-service/src/email/email-sync-worker.js';

const router = Router();

/**
 * GET /api/oauth/gmail/callback
 * Main Google OAuth redirect handler for Gmail.
 * Exchanges the code for tokens, saves credentials to BOTH
 * the `oauth_accounts` table (for token refresh) AND the `integrations`
 * table (for the unified mailbox UI/outreach engine).
 */
router.get('/gmail/callback', async (req: Request, res: Response): Promise<void> => {
  try {
    const { code, state, error } = req.query;

    console.log(`[Google Redirect] Gmail callback received. State: ${state ? 'present' : 'missing'}`);

    if (error) {
      console.error(`[Google Redirect] OAuth error from Google: ${error}`);
      res.redirect('/dashboard/integrations?error=gmail_denied');
      return;
    }

    if (!code || !state) {
      console.error('[Google Redirect] Missing code or state in callback');
      res.redirect('/dashboard/integrations?error=invalid_request');
      return;
    }

    // 1. Verify state and retrieve user context (AES-256-GCM encrypted)
    const stateData = decryptState(state as string);
    if (!stateData) {
      console.error('[Google Redirect] Invalid or expired state signature — possible CSRF attempt');
      res.redirect('/dashboard/integrations?error=invalid_state');
      return;
    }

    const userId = stateData.userId;
    console.log(`[Google Redirect] Authenticated user: ${userId}`);

    // 2. Re-attach userId to session (OAuth redirect creates a new browser context)
    if ((req as any).session) {
      (req as any).session.userId = userId;
    }

    // 3. Exchange authorization code for tokens
    console.log(`[Google Redirect] Exchanging code for tokens...`);
    const tokens = await gmailOAuth.exchangeCodeForToken(code as string);

    if (!tokens.access_token) {
      console.error('[Google Redirect] Token exchange succeeded but access_token is missing');
      res.redirect('/dashboard/integrations?error=gmail_oauth_failed');
      return;
    }

    // 4. Fetch Gmail & Google profile
    const [userProfile, gmailProfile] = await Promise.all([
      gmailOAuth.getUserProfile(tokens.access_token),
      gmailOAuth.getGmailProfile(tokens.access_token),
    ]);

    const emailAddress = gmailProfile.emailAddress || userProfile.email;
    if (!emailAddress) {
      console.error('[Google Redirect] Could not determine email address from Google profile');
      res.redirect('/dashboard/integrations?error=gmail_oauth_failed');
      return;
    }

    console.log(`[Google Redirect] Gmail account identified: ${emailAddress}`);

    // 5. Check mailbox limits before persisting
    const limitCheck = await storage.checkMailboxLimit(userId);
    if (!limitCheck.allowed) {
      // Check if an existing integration for this exact email already exists (reconnect scenario)
      const existing = await storage.getIntegrations(userId);
      const hasExisting = existing.some(i => i.provider === 'gmail' && i.accountType === emailAddress);
      if (!hasExisting) {
        console.warn(`[Google Redirect] Mailbox limit reached: ${limitCheck.current}/${limitCheck.limit}`);
        res.redirect(`/dashboard/integrations?error=limit_reached&limit=${limitCheck.limit}&plan=${encodeURIComponent(limitCheck.plan)}`);
        return;
      }
    }

    // 6. Save tokens to oauth_accounts table (for token refresh via getValidToken)
    await gmailOAuth.saveToken(userId, tokens, { ...userProfile, ...gmailProfile, emailAddress });

    // 7. Build the encrypted meta payload for the integrations table
    //    This is what sendEmail() and the outreach engine decrypt to get the from-address.
    const integrationMeta = encrypt(JSON.stringify({
      email: emailAddress,
      name: userProfile.name || '',
      picture: userProfile.picture || '',
      // Embed tokens directly so the integration is self-contained
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      expiry_date: tokens.expiry_date || null,
      scope: tokens.scope,
    }));

    // 8. Upsert the integration row (create or update by email + userId)
    const allIntegrations = await storage.getIntegrations(userId);
    const existingGmail = allIntegrations.find(
      i => i.provider === 'gmail' && i.accountType === emailAddress
    );

    if (existingGmail) {
      console.log(`[Google Redirect] Updating existing Gmail integration (${existingGmail.id}) for: ${emailAddress}`);
      await storage.updateIntegrationById(existingGmail.id, {
        encryptedMeta: integrationMeta,
        connected: true,
        lastSync: new Date(),
        healthStatus: 'connected' as const,
      });
    } else {
      console.log(`[Google Redirect] Creating new Gmail integration for: ${emailAddress}`);
      await storage.createIntegration({
        userId,
        provider: 'gmail' as const,
        accountType: emailAddress,
        encryptedMeta: integrationMeta,
        connected: true,
        lastSync: new Date(),
        healthStatus: 'connected' as const,
      });
    }

    // 9. Notify frontend to refresh integration state via WebSocket
    wsSync.notifySettingsUpdated(userId);

    // 10. Notify frontend to refresh integration state via WebSocket
    wsSync.notifySettingsUpdated(userId);

    // 10. Background: distribute leads from inventory pool to this new mailbox
    try {
      const { distributeLeadsFromPool } = await import('@services/outreach-worker/src/sales-engine/outreach-engine.js');
      const updatedIntegrations = await storage.getIntegrations(userId);
      const gmailInt = updatedIntegrations.find(
        i => i.provider === 'gmail' && i.accountType === emailAddress
      );
      if (gmailInt) {
        console.log(`[Google Redirect] Launching lead distribution for mailbox: ${gmailInt.id}`);
        distributeLeadsFromPool(userId, gmailInt.id).catch(err =>
          console.error('[Google Redirect] Lead distribution failed (non-fatal):', err)
        );
      }
    } catch (distErr) {
      console.warn('[Google Redirect] Could not trigger lead distribution:', distErr);
    }

    // 11. Redirect back to dashboard with success confirmation
    console.log(`[Google Redirect] ✅ Gmail connected successfully for ${emailAddress}. Saving session and redirecting...`);
    req.session.save(() => {
      res.redirect('/dashboard/integrations?success=gmail_connected');
    });

  } catch (error: any) {
    // Advanced error logging for Google exchange failures
    const errorMsg = error?.message || String(error);
    console.error(`[Google Redirect] ❌ Gmail exchange failed: ${errorMsg}`);
    
    // Check if it's a specific Google error that we should report back
    if (errorMsg.includes('invalid_grant')) {
      res.redirect('/dashboard/integrations?error=gmail_oauth_failed&reason=invalid_grant');
    } else if (errorMsg.includes('invalid_client')) {
      res.redirect('/dashboard/integrations?error=gmail_oauth_failed&reason=invalid_client');
    } else {
      res.redirect(`/dashboard/integrations?error=gmail_oauth_failed&details=${encodeURIComponent(errorMsg.substring(0, 100))}`);
    }
  }
});

/**
 * GET /api/oauth/google-calendar/callback
 * Handles Google Calendar authorization callbacks.
 */
router.get('/google-calendar/callback', async (req: Request, res: Response): Promise<void> => {
  try {
    const { code, state, error } = req.query;

    if (error === 'access_denied') {
      res.redirect('/dashboard/integrations?error=denied');
      return;
    }

    if (!code || !state) {
      res.redirect('/dashboard/integrations?error=invalid_request');
      return;
    }

    const stateData = decryptState(state as string);
    if (!stateData) {
      console.error('[Google Redirect] Invalid or expired Calendar state signature');
      res.redirect('/dashboard/integrations?error=invalid_state');
      return;
    }

    const userId = stateData.userId;
    if ((req as any).session) {
      (req as any).session.userId = userId;
    }

    const tokenData = await googleCalendarOAuth.exchangeCodeForTokens(code as string);

    const encryptedTokens = encrypt(JSON.stringify({
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      expiresAt: tokenData.expiresAt.toISOString(),
      email: tokenData.email,
    }));

    const existingCalendar = await storage.getIntegration(userId, 'google_calendar');
    if (existingCalendar) {
      await storage.updateIntegration(userId, existingCalendar.id, {
        encryptedMeta: encryptedTokens,
        connected: true,
        lastSync: new Date(),
      });
    } else {
      await storage.createIntegration({
        userId,
        provider: 'google_calendar',
        encryptedMeta: encryptedTokens,
        connected: true,
        lastSync: new Date(),
      });
    }

    wsSync.notifySettingsUpdated(userId);

    console.log(`[Google Redirect] Calendar connection successful for user: ${userId}. Saving session and redirecting...`);
    req.session.save(() => {
      res.redirect('/dashboard/integrations?success=google_calendar_connected');
    });
  } catch (error) {
    console.error('[Google Redirect] Google Calendar OAuth callback error:', error);
    res.redirect('/dashboard/integrations?error=oauth_failed');
  }
});

export default router;

