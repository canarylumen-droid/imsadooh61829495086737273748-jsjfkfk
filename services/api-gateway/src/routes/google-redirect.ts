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
        dailyLimit: 50,
      });
    } else {
      console.log(`[Google Redirect] Creating new Gmail integration for: ${emailAddress}`);
      try {
        await storage.createIntegration({
          userId,
          provider: 'gmail' as const,
          accountType: emailAddress,
          encryptedMeta: integrationMeta,
          connected: true,
          lastSync: new Date(),
          healthStatus: 'connected' as const,
          dailyLimit: 50,
        });
      } catch (err: any) {
        console.error(`[Google Redirect] Failed to create integration: ${err.message}`);
        res.redirect(`/dashboard/integrations?error=${encodeURIComponent(err.message)}`);
        return;
      }
    }

    // 9. Background: DNS verification for this domain
    const domain = emailAddress.split('@')[1];
    if (domain) {
      (async () => {
        try {
          const { verifyDnsWithFallback } = await import('@shared/lib/queues/dns-verify-queue.js');
          const result = await verifyDnsWithFallback(userId!, domain);
          if (result) {
            const { db } = await import('@shared/lib/db/db.js');
            const { sql } = await import('drizzle-orm');
            await db.execute(sql`
              INSERT INTO domain_verifications (id, user_id, domain, verification_result, created_at)
              VALUES (gen_random_uuid(), ${userId}, ${domain}, ${JSON.stringify(result)}::jsonb, NOW())
              ON CONFLICT (user_id, domain)
              DO UPDATE SET verification_result = ${JSON.stringify(result)}::jsonb, created_at = NOW()
            `);
            wsSync.notifyDnsVerified(userId, {
              domain,
              score: result.overall_score ?? 0,
              spf: result.spf?.valid ?? false,
              dkim: result.dkim?.valid ?? false,
              dmarc: result.dmarc?.valid ?? false,
              mx: result.mx_found ?? false,
              blacklist: result.blacklist?.is_blacklisted ?? false,
            });
          }
        } catch (e) {
          // DNS verification is best-effort, non-blocking
        }
      })();
    }

    // 10. Notify frontend to refresh integration state via WebSocket
    wsSync.notifySettingsUpdated(userId);

    // 11. Background: distribute leads from inventory pool to this new mailbox
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
        const { notifyMailboxConnected } = await import('@shared/lib/queues/verification-routing-queue.js');
        notifyMailboxConnected(userId, gmailInt.id).catch(err =>
          console.error('[Google Redirect] Smart reroute failed (non-fatal):', err)
        );
      }
    } catch (distErr) {
      console.warn('[Google Redirect] Could not trigger lead distribution:', distErr);
    }

    // 11. Redirect back to dashboard with success confirmation
    console.log(`[Google Redirect] ✅ Gmail connected successfully for ${emailAddress}. Saving session and redirecting...`);
    await new Promise<void>((resolve, reject) => {
      req.session.save((err: any) => {
        if (err) { reject(err); return; }
        resolve();
      });
    });
    // Explicit cookie set to survive cross-site OAuth redirect browsers
    res.cookie('audnix.sid', req.sessionID, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 30,
      path: '/',
    });
    res.redirect('/dashboard/integrations?success=gmail_connected&t=' + Date.now());

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
      res.redirect('/dashboard/calendar?error=denied');
      return;
    }

    if (!code || !state) {
      res.redirect('/dashboard/calendar?error=invalid_request');
      return;
    }

    const stateData = decryptState(state as string);
    if (!stateData) {
      console.error('[Google Redirect] Invalid or expired Calendar state signature');
      res.redirect('/dashboard/calendar?error=invalid_state');
      return;
    }

    const userId = stateData.userId;

    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((err) => {
        if (err) { reject(err); return; }
        resolve();
      });
    });
    (req as any).session.userId = userId;

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
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((err) => {
        if (err) { reject(err); return; }
        resolve();
      });
    });
    (req as any).session.userId = userId;
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => {
        if (err) { reject(err); return; }
        resolve();
      });
    });
    res.cookie('audnix.sid', req.sessionID, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 30,
      path: '/',
    });
    res.redirect('/dashboard/calendar?success=google_calendar_connected&t=' + Date.now());
  } catch (error) {
    console.error('[Google Redirect] Google Calendar OAuth callback error:', error);
    res.redirect('/dashboard/calendar?error=oauth_failed');
  }
});

export default router;

