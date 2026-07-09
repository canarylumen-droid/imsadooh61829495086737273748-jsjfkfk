import { Router, Request, Response } from 'express';
import { OutlookOAuth } from '@services/api-gateway/src/oauth/outlook.js';
import { storage } from '@shared/lib/storage/storage.js';
import { encrypt, decryptState } from '@shared/lib/crypto/encryption.js';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';
import { emailSyncWorker } from '@services/email-service/src/email/email-sync-worker.js';

const router = Router();
const outlookOAuth = new OutlookOAuth();

/**
 * GET /api/oauth/outlook/callback
 * Main Outlook OAuth redirect handler.
 * Exchanges the code for tokens and saves them to both
 * oauth_accounts and integrations tables.
 */
router.get('/outlook/callback', async (req: Request, res: Response): Promise<void> => {
  try {
    const { code, state, error, error_description } = req.query;

    console.log(`[Outlook Redirect] Callback received. State: ${state ? 'present' : 'missing'}`);

    if (error) {
      console.error(`[Outlook Redirect] OAuth error from Microsoft: ${error} - ${error_description}`);
      res.redirect('/dashboard/integrations?error=outlook_denied');
      return;
    }

    if (!code || !state) {
      console.error('[Outlook Redirect] Missing code or state in callback');
      res.redirect('/dashboard/integrations?error=invalid_request');
      return;
    }

    // 1. Verify state and retrieve user context
    const decodedState = outlookOAuth.verifyState(state as string);
    if (!decodedState) {
      console.error('[Outlook Redirect] Invalid or expired state signature');
      res.redirect('/dashboard/integrations?error=invalid_state');
      return;
    }

    const userId = decodedState.userId;
    console.log(`[Outlook Redirect] Authenticated user: ${userId}`);

    // 2. Re-attach userId to session
    if ((req as any).session) {
      (req as any).session.userId = userId;
    }

    // 3. Exchange authorization code for tokens
    console.log(`[Outlook Redirect] Exchanging code for tokens...`);
    const tokens = await outlookOAuth.exchangeCodeForToken(code as string);

    if (!tokens.access_token) {
      console.error('[Outlook Redirect] Token exchange succeeded but access_token is missing');
      res.redirect('/dashboard/integrations?error=outlook_oauth_failed');
      return;
    }

    // 4. Fetch Outlook profile
    const profile = await outlookOAuth.getUserProfile(tokens.access_token);
    const emailAddress = profile.mail || profile.userPrincipalName;

    if (!emailAddress) {
      console.error('[Outlook Redirect] Could not determine email address from Outlook profile');
      res.redirect('/dashboard/integrations?error=outlook_oauth_failed');
      return;
    }

    console.log(`[Outlook Redirect] Outlook account identified: ${emailAddress}`);

    // 5. Check mailbox limits
    const limitCheck = await storage.checkMailboxLimit(userId);
    if (!limitCheck.allowed) {
      const existing = await storage.getIntegrations(userId);
      const hasExisting = existing.some(i => i.provider === 'outlook' && i.accountType === emailAddress);
      if (!hasExisting) {
        console.warn(`[Outlook Redirect] Mailbox limit reached: ${limitCheck.current}/${limitCheck.limit}`);
        res.redirect(`/dashboard/integrations?error=limit_reached&limit=${limitCheck.limit}&plan=${encodeURIComponent(limitCheck.plan)}`);
        return;
      }
    }

    // 6. Save tokens to oauth_accounts table
    await outlookOAuth.saveToken(userId, tokens, profile);

    // 7. Build encrypted meta for integrations table
    const integrationMeta = encrypt(JSON.stringify({
      email: emailAddress,
      name: profile.displayName || '',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      expiry_date: new Date(Date.now() + (tokens.expires_in * 1000)).toISOString(),
      scope: tokens.scope,
    }));

    // 8. Upsert integration row
    const allIntegrations = await storage.getIntegrations(userId);
    const existingOutlook = allIntegrations.find(
      i => i.provider === 'outlook' && i.accountType === emailAddress
    );

    if (existingOutlook) {
      console.log(`[Outlook Redirect] Updating existing Outlook integration (${existingOutlook.id})`);
      await storage.updateIntegrationById(existingOutlook.id, {
        encryptedMeta: integrationMeta,
        connected: true,
        lastSync: new Date(),
        healthStatus: 'connected' as const,
      });
    } else {
      console.log(`[Outlook Redirect] Creating new Outlook integration`);
      try {
        await storage.createIntegration({
          userId,
          provider: 'outlook' as const,
          accountType: emailAddress,
          encryptedMeta: integrationMeta,
          connected: true,
          lastSync: new Date(),
          healthStatus: 'connected' as const,
        });
      } catch (err: any) {
        console.error(`[Outlook Redirect] Failed to create integration: ${err.message}`);
        res.redirect(`/dashboard/integrations?error=${encodeURIComponent(err.message)}`);
        return;
      }
    }

    // 9. Notify frontend
    wsSync.notifySettingsUpdated(userId);

    // 10. Background: lead distribution
    try {
      const { distributeLeadsFromPool } = await import('@services/outreach-worker/src/sales-engine/outreach-engine.js');
      const updatedIntegrations = await storage.getIntegrations(userId);
      const outlookInt = updatedIntegrations.find(
        i => i.provider === 'outlook' && i.accountType === emailAddress
      );
      if (outlookInt) {
        distributeLeadsFromPool(userId, outlookInt.id).catch(err =>
          console.error('[Outlook Redirect] Lead distribution failed:', err)
        );
        const { notifyMailboxConnected } = await import('@shared/lib/queues/verification-routing-queue.js');
        notifyMailboxConnected(userId, outlookInt.id).catch(err =>
          console.error('[Outlook Redirect] Smart reroute failed (non-fatal):', err)
        );
      }
    } catch (distErr) {
      console.warn('[Outlook Redirect] Could not trigger lead distribution:', distErr);
    }

    // 11. Redirect back
    console.log(`[Outlook Redirect] ✅ Outlook connected successfully. Saving session...`);
    req.session.save(() => {
      res.redirect('/dashboard/integrations?success=outlook_connected');
    });

  } catch (error: any) {
    console.error(`[Outlook Redirect] ❌ Outlook exchange failed:`, error);
    res.redirect(`/dashboard/integrations?error=outlook_oauth_failed&details=${encodeURIComponent(error.message || 'Unknown error')}`);
  }
});

export default router;

