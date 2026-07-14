import { Router, Request, Response } from 'express';
import { InstagramOAuth } from '@services/api-gateway/src/oauth/instagram.js';
import { storage } from '@shared/lib/storage/storage.js';
import { encrypt, decryptState } from '@shared/lib/crypto/encryption.js';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';

const router = Router();
const instagramOAuth = new InstagramOAuth();

/**
 * GET /api/oauth/instagram/callback
 * Handle Instagram OAuth callback (matches Meta's registered URL)
 * This handles the background work and final redirect.
 */
router.get('/instagram/callback', async (req: Request, res: Response): Promise<void> => {
  try {
    const { code, state, error_reason, error, error_description } = req.query;

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('[Instagram Redirect] Callback received:', {
      hasCode: !!code,
      hasState: !!state,
      error_reason,
      error,
      error_description
    });
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    if (error_reason === 'user_denied' || error === 'access_denied') {
      res.redirect('/dashboard/integrations?error=denied');
      return;
    }

    if (error) {
      console.error('[Instagram Redirect] Error from Meta:', { error, error_description });
      res.redirect(`/dashboard/integrations?error=${encodeURIComponent(String(error))}`);
      return;
    }

    if (!code || !state) {
      console.error('[Instagram Redirect] Missing code or state');
      res.redirect('/dashboard/integrations?error=invalid_request');
      return;
    }

    // 1. Verify state and retrieve user context (Production-grade AES-256-GCM)
    const stateData = decryptState(state as string);
    if (!stateData || !stateData.userId) {
      console.error('[Instagram Redirect] Invalid or expired state signature');
      res.redirect('/dashboard/integrations?error=invalid_state');
      return;
    }

    // Re-attach userId to session (critical: OAuth redirect creates a fresh browser session)
    if ((req as any).session) {
      (req as any).session.userId = stateData.userId;
    }

    // 2. "Background Work" - Exchange code for tokens
    console.log(`[Instagram Redirect] Exchanging code for tokens for user: ${stateData.userId}`);
    const tokenData = await instagramOAuth.exchangeCodeForToken(code as string);
    if (!tokenData || !tokenData.access_token) {
      console.error('[Instagram Redirect] Token exchange failed');
      res.redirect('/dashboard/integrations?error=token_exchange_failed');
      return;
    }

    // 3. Check subscription limits
    const limitCheck = await storage.checkMailboxLimit(stateData.userId);
    if (!limitCheck.allowed) {
      console.warn(`[Instagram Redirect] Limit reached: ${limitCheck.current}/${limitCheck.limit}`);
      res.redirect(`/dashboard/integrations?error=limit_reached&limit=${limitCheck.limit}&plan=${encodeURIComponent(limitCheck.plan)}`);
      return;
    }

    // 4. Get long-lived token
    console.log('[Instagram Redirect] Requesting long-lived token...');
    const longLivedToken = await instagramOAuth.exchangeForLongLivedToken(tokenData.access_token);
    if (!longLivedToken || !longLivedToken.access_token) {
      console.error('[Instagram Redirect] Long-lived token exchange failed');
      res.redirect('/dashboard/integrations?error=token_exchange_failed');
      return;
    }

    // 5. Fetch Instagram Business Profile
    console.log('[Instagram Redirect] Fetching Instagram Business Account...');
    const igAccount = await instagramOAuth.getInstagramBusinessAccount(longLivedToken.access_token);
    if (!igAccount) {
      console.error('[Instagram Redirect] No linked Instagram Business account found');
      res.redirect('/dashboard/integrations?error=no_business_account');
      return;
    }

    // 6. Encrypt and persist
    const encryptedMeta = encrypt(JSON.stringify({
      accessToken: igAccount.pageToken, // Save Page Token for messaging
      instagramBusinessAccountId: igAccount.instagramId,
      username: igAccount.username,
      fbUserToken: longLivedToken.access_token,
      expiresAt: new Date(Date.now() + (longLivedToken.expires_in * 1000)).toISOString()
    }));

    await storage.createIntegration({
      userId: stateData.userId,
      provider: 'instagram',
      connected: true,
      encryptedMeta: encryptedMeta,
      accountType: igAccount.username,
      lastSync: new Date()
    });

    // 7. Notify frontend
    wsSync.notifySettingsUpdated(stateData.userId);

    // 8. Lead Distribution (Async background task)
    const { distributeLeadsFromPool } = await import('@services/outreach-worker/src/sales-engine/outreach-engine.js');
    distributeLeadsFromPool(stateData.userId, igAccount.instagramId).catch(err =>
      console.error('[Instagram Redirect] Lead distribution failed:', err)
    );

    // 9. Final Redirect
    console.log('[Instagram Redirect] Success. Saving session and redirecting back to dashboard.');
    req.session.save(() => {
      res.redirect('/dashboard/integrations?success=instagram_connected');
    });
    
  } catch (error) {
    console.error('[Instagram Redirect] Fatal callback error:', error);
    res.redirect('/dashboard/integrations?error=oauth_failed');
  }
});

/**
 * POST /api/oauth/instagram/callback
 * Some clients/webhooks might POST to this endpoint.
 */
router.post('/instagram/callback', async (req: Request, res: Response): Promise<void> => {
  const code = req.body?.code || req.query.code;
  const state = req.body?.state || req.query.state;
  const error = req.body?.error || req.query.error;

  const qs = new URLSearchParams();
  if (code) qs.set('code', String(code));
  if (state) qs.set('state', String(state));
  if (error) qs.set('error', String(error));

  res.redirect(307, `/api/oauth/instagram/callback?${qs.toString()}`);
});

export default router;

