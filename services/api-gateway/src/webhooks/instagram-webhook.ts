import { Request, Response } from 'express';
import * as crypto from 'crypto';
import { analyzeLeadIntent, IntentAnalysis } from "@services/brain-worker/src/ai-lib/analyzers/intent-analyzer.js";
import { followUpWorker } from "@services/brain-worker/src/ai-lib/core/follow-up-worker.js";
import { saveConversationToMemory } from "@services/brain-worker/src/ai-lib/core/conversation-ai.js";
import { scheduleAutomatedDMReply, checkUserAutomationSettings } from "@services/brain-worker/src/ai-lib/core/dm-automation.js";
import { analyzeInboundMessage } from '@services/brain-worker/src/ai-lib/analyzers/inbound-message-analyzer.js';
import { storage } from '@shared/lib/storage/storage.js';
import { type Lead } from "@audnix/shared";
import { InstagramOAuth } from '../oauth/instagram.js';

interface InstagramMessage {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    attachments?: Array<{
      type: string;
      payload: { url: string };
    }>;
    is_echo?: boolean;
  };
  postback?: {
    payload: string;
    title: string;
  };
}

interface InstagramCommentValue {
  from: { id: string; username: string };
  media: { id: string };
  text: string;
  id: string;
}

interface InstagramWebhookEntry {
  id: string;
  time: number;
  messaging?: InstagramMessage[];
  changes?: Array<{
    field: string;
    value: InstagramCommentValue;
  }>;
}

interface InstagramProfile {
  name?: string;
  username?: string;
}

interface LeadRecord {
  id: string;
  user_id: string;
  external_id: string;
  name: string;
  channel: string;
  status: string;
  tags: string[];
  last_message_at: string;
  lead_score?: number;
  message_count?: number;
  follow_up_count?: number;
  preferred_name?: string;
  intent_analysis?: IntentAnalysis;
}

interface IntegrationRecord {
  user_id: string;
}

function verifySignature(req: Request): boolean {
  const signature = req.headers['x-hub-signature-256'] as string;

  // Check for explicit test mode flag (controlled, not automatic)
  const isTestMode = process.env.INSTAGRAM_WEBHOOK_TEST_MODE === 'true';

  if (!signature) {
    console.log('[IG_WEBHOOK] No x-hub-signature-256 header found');
    if (isTestMode) {
      console.warn('[IG_WEBHOOK] TEST MODE: Allowing unsigned request (disable in production!)');
      return true;
    }
    return false;
  }

  const appSecret = process.env.META_APP_SECRET || '';
  if (!appSecret) {
    console.error('[IG_WEBHOOK] META_APP_SECRET not configured');
    if (isTestMode) {
      console.warn('[IG_WEBHOOK] TEST MODE: Allowing request without META_APP_SECRET');
      return true;
    }
    return false;
  }

  // Raw body must be preserved by middleware for signature verification
  const rawBody = (req as any).rawBody;
  if (!rawBody) {
    console.error('[IG_WEBHOOK] Raw body not available - middleware not configured for this route');
    console.error('[IG_WEBHOOK] Ensure route uses express.json with verify callback to preserve rawBody');
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  const expectedFull = `sha256=${expectedSignature}`;
  const isValid = signature === expectedFull;

  if (!isValid) {
    console.log('[IG_WEBHOOK] Signature mismatch');
    console.log('[IG_WEBHOOK] Received:', signature);
    console.log('[IG_WEBHOOK] Expected:', expectedFull);
  }

  return isValid;
}

export function handleInstagramVerification(req: Request, res: Response): void {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = process.env.META_VERIFY_TOKEN;

  console.log('[Instagram Webhook] Verification request received');
  console.log('[Instagram Webhook] Mode:', mode);
  console.log('[Instagram Webhook] Verification request received');
  console.log('[Instagram Webhook] Token configured:', !!verifyToken);

  // If no token configured, show helpful error
  if (!verifyToken) {
    console.error('[Instagram Webhook] ❌ META_VERIFY_TOKEN not configured!');
    console.error('[Instagram Webhook] Set META_VERIFY_TOKEN in environment to fix this');
    console.log('[Instagram Webhook] Verification token not configured');
    res.status(403).json({ error: 'META_VERIFY_TOKEN not configured on server' });
    return;
  }

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('[Instagram Webhook] ✅ Verification successful');
    // Sanitize challenge to prevent Reflected XSS
    const safeChallenge = String(challenge || '').replace(/[^\w-]/g, '');
    res.status(200).type('text/plain').send(safeChallenge);
  } else {
    console.error('[Instagram Webhook] ❌ Verification failed');
    console.error('[Instagram Webhook] Expected token:', verifyToken);
    console.error('[Instagram Webhook] Received token:', token);
    res.sendStatus(403);
  }
}

export async function handleInstagramWebhook(req: Request, res: Response): Promise<void> {
  try {
    console.log('[IG_EVENT] Webhook received:', JSON.stringify(req.body, null, 2));
    // recordWebhookEvent(); // Removed undefined function call

    if (!verifySignature(req)) {
      console.log('[IG_EVENT] Signature verification failed');
      res.sendStatus(403);
      return;
    }

    const { object, entry } = req.body as { object: string; entry: InstagramWebhookEntry[] };
    console.log(`[IG_EVENT] Object: ${object}, Entries: ${entry?.length || 0}`);

    if (object !== 'instagram') {
      console.log(`[IG_EVENT] Ignoring non-instagram object: ${object}`);
      res.sendStatus(404);
      return;
    }

    for (const item of entry) {
      console.log(`[IG_EVENT] Processing entry ID: ${item.id}, Time: ${item.time}`);

      if (item.messaging) {
        for (const message of item.messaging) {
          const eventType = message.message ? 'message' :
            message.postback ? 'postback' :
              'unknown';
          console.log(`[IG_EVENT] Message event: ${eventType}, Sender: ${message.sender.id}`);

          if (message.message?.text) {
            console.log(`[IG_EVENT] Message text: "${message.message.text.substring(0, 100)}..."`);
          }

          await processInstagramMessage(message);
        }
      }

      if (item.changes) {
        for (const change of item.changes) {
          console.log(`[IG_EVENT] Change event: ${change.field}`);

          if (change.field === 'comments') {
            console.log(`[IG_EVENT] Comment from: ${change.value.from?.username}, text: "${change.value.text?.substring(0, 100)}..."`);
            await processInstagramComment(change.value);
          } else if (change.field === 'message_reactions') {
            console.log(`[IG_EVENT] Message reaction received`);
          } else if (change.field === 'messaging_seen') {
            console.log(`[IG_EVENT] Message seen event`);
          } else if (change.field === 'messaging_postbacks') {
            console.log(`[IG_EVENT] Postback event`);
          } else if (change.field === 'messaging_referral') {
            console.log(`[IG_EVENT] Referral event`);
          }
        }
      }
    }

    console.log('[IG_EVENT] Webhook processed successfully');
    res.sendStatus(200);
  } catch (error) {
    console.error('[IG_EVENT] Error handling Instagram webhook:', error);
    res.sendStatus(500);
  }
}

async function processInstagramMessage(message: InstagramMessage): Promise<void> {
  const isEcho = message.message?.is_echo || false;
  const customerId = isEcho ? message.recipient.id : message.sender.id;
  const messageText = message.message?.text || '';
  const attachments = message.message?.attachments || [];

  if (!messageText && attachments.length === 0) return;


  try {

    // 1. Get Integration
    const integrations = await storage.getIntegrationsByProvider('instagram');
    const integration = integrations.find(i => i.connected);

    if (!integration) {
      console.log(`[IG_EVENT] No active Instagram integration found for message from ${customerId}.`);
      return;
    }

    console.log(`[IG_EVENT] Using integration for user: ${integration.userId}`);

    // 2. Get or Create Lead
    const userLeads = await storage.getLeads({ userId: integration.userId });
    let existingLead = userLeads.find(l => l.externalId === customerId && l.channel === 'instagram');

    if (!existingLead) {
      console.log(`[IG_EVENT] Creating new lead for customerId: ${customerId}`);
      const senderProfile = await fetchInstagramProfile(customerId, integration.userId);
      const newLeadData = {
        userId: integration.userId,
        externalId: customerId,
        name: senderProfile.name || senderProfile.username || 'Instagram User',
        channel: 'instagram' as "instagram" | "email",
        status: 'new' as "new" | "contacted" | "replied" | "converted" | "not_interested" | "cold",
        tags: ['instagram', 'auto-captured'],
        metadata: { preferred_name: senderProfile.name?.split(' ')[0] }
      };

      existingLead = await storage.createLead(newLeadData);
      console.log(`[IG_EVENT] Successfully created lead: ${existingLead.id}`);
    } else {
      console.log(`[IG_EVENT] Found existing lead: ${existingLead.id}`);
    }

    const lead = existingLead;

    // 3. Save Message
    await storage.createMessage({
      userId: integration.userId,
      leadId: lead.id,
      direction: isEcho ? 'outbound' : 'inbound',
      provider: 'instagram',
      body: messageText || (attachments.length > 0 ? `[Media: ${attachments[0].type}]` : ''),
      metadata: {
        external_id: message.message?.mid,
        is_echo: isEcho,
        attachments: attachments
      }
    });

    if (isEcho) {
      return;
    }

    const messages = await storage.getMessagesByLeadId(lead.id);
    const latestMessage = messages.find(m => m.body === messageText);
    
    let fullAnalysis: any = null;
    if (latestMessage) {
      try {
        fullAnalysis = await analyzeInboundMessage(lead.id, latestMessage, lead as any);
        console.log(`[IG_EVENT] Full inbound analysis: urgency=${fullAnalysis.urgencyLevel}, quality=${fullAnalysis.qualityScore}, action=${fullAnalysis.suggestedAction}`);

        // Phase 11: Trigger Intelligence-governed Automation Rules
        const { AutomationRuleEngine } = await import('@shared/lib/automation/rule-engine.js');
        await AutomationRuleEngine.processEvent(integration.userId, lead.id, {
          channel: 'instagram',
          intentScore: fullAnalysis.qualityScore,
          confidence: (fullAnalysis.intent as any)?.confidence || 0.8,
          messageBody: messageText,
          messageId: latestMessage.id
        });
      } catch (analysisError) {
        console.error('[IG_EVENT] Inbound message analysis error:', analysisError);
      }
    }

    // Reload the lead to see if the analyzer marked it as qualified or paused
    const freshLead = await storage.getLeadById(lead.id);
    const leadToUse = freshLead || lead;

    // Check if positive intent was detected or lead is in a terminal status after analysis
    const isPositiveIntent =
      fullAnalysis?.intent?.readyToBuy === true ||
      fullAnalysis?.intent?.wantsToSchedule === true ||
      fullAnalysis?.deepIntent?.intentLevel === "high";

    const isTerminalState = ['qualified', 'converted', 'booked'].includes(leadToUse.status) || leadToUse.aiPaused || isPositiveIntent;

    if (isTerminalState) {
      console.log(`[IG_EVENT] skipping DM automation & status updates - lead ${lead.name} is in positive or paused/terminal status: ${leadToUse.status} (Paused: ${leadToUse.aiPaused})`);
      
      const intent = fullAnalysis?.intent || { isInterested: false, isNegative: false, needsMoreInfo: false, wantsToSchedule: false, readyToBuy: false };
      
      // 7. Recent Activity (Audit Trail)
      await storage.createAuditLog({
        userId: integration.userId,
        leadId: lead.id,
        integrationId: integration.id,
        action: 'message_received',
        details: {
          channel: 'instagram',
          description: `${lead.name} sent: "${messageText.substring(0, 50)}..."`,
          intent,
          auto_tagged: true
        }
      });

      // 8. Memory
      try {
        const messages = await storage.getMessagesByLeadId(lead.id);
        if (messages.length > 0) {
          await saveConversationToMemory(integration.userId, leadToUse as any, messages);
        }
      } catch (memoryError) {
        console.error('Failed to save conversation to memory:', memoryError);
      }
      return;
    }

    // Reuse the intent analysis from the analyzer to avoid duplicate API calls
    const intent = fullAnalysis?.intent || await analyzeLeadIntent(messageText, leadToUse as any);

    let newStatus = leadToUse.status;
    let newTags = [...(leadToUse.tags || [])];

    if (intent.isInterested && ((intent as any).confidence ?? 1) > 0.7) {
      newStatus = 'contacted'; // mapped 'interested' -> 'contacted' (schema enum)
      newTags.push('hot-lead');

      if (intent.wantsToSchedule || intent.readyToBuy) {
        newStatus = 'contacted';
        newTags.push('ready-to-buy');

        await storage.createFollowUp({
          userId: integration.userId,
          leadId: lead.id,
          channel: 'instagram',
          status: 'pending',
          scheduledAt: new Date(Date.now() + 2 * 60 * 1000), // Reply with link in 2 mins
          context: {
            intent: intent.readyToBuy ? 'payment' : 'booking',
            reasoning: 'AI detected high intent to buy/schedule from Instagram webhook.'
          }
        });
      }
    } else if (intent.isNegative && ((intent as any).confidence ?? 1) > 0.7) {
      newStatus = 'not_interested'; // valid enum
      newTags.push('cold');
    } else if (intent.needsMoreInfo) {
      newStatus = 'contacted'; // 'nurturing' not in enum
      newTags.push('needs-info');
    }

    // 5. Update Lead
    await storage.updateLead(lead.id, {
      status: newStatus as any,
      tags: Array.from(new Set(newTags)),
      lastMessageAt: new Date(),
      score: calculateLeadScore(intent, leadToUse as any),
      metadata: { ...leadToUse.metadata, intent_analysis: intent }
    });

    // 6. Follow Up Queue
    if (newStatus !== 'not_interested' && newStatus !== 'converted') {
      const messages = await storage.getMessagesByLeadId(lead.id);
      await storage.createFollowUp({
        userId: integration.userId,
        leadId: lead.id,
        channel: 'instagram',
        status: 'pending',
        scheduledAt: new Date(getSmartScheduleTime(intent, leadToUse as any)),
        context: {
          last_message: messageText,
          intent,
          message_count: messages.length
        }
      });
    }

    // 7. Recent Activity (Audit Trail)
    await storage.createAuditLog({
      userId: integration.userId,
      leadId: lead.id,
      integrationId: integration.id,
      action: 'message_received',
      details: {
        channel: 'instagram',
        description: `${lead.name} sent: "${messageText.substring(0, 50)}..."`,
        intent,
        auto_tagged: true
      }
    });

    // 8. Memory & Automation
    try {
      const messages = await storage.getMessagesByLeadId(lead.id);
      if (messages.length > 0) {
        await saveConversationToMemory(integration.userId, leadToUse as any, messages);
      }
    } catch (memoryError) {
      console.error('Failed to save conversation to memory:', memoryError);
    }

    try {
      const automationSettings = await checkUserAutomationSettings(integration.userId);

      if (automationSettings.enabled && newStatus !== 'not_interested') {
        console.log(`[IG_EVENT] Scheduling automated DM reply for lead ${lead.name}`);

        await scheduleAutomatedDMReply(
          integration.userId,
          lead.id,
          customerId,
          messageText,
          intent
        );

        console.log(`[IG_EVENT] Automated reply scheduled with 2-8 min delay`);
      } else {
        console.log(`[IG_EVENT] DM automation skipped - enabled: ${automationSettings.enabled}, status: ${newStatus}`);
      }
    } catch (automationError) {
      console.error('[IG_EVENT] Error scheduling DM automation:', automationError);
    }

  } catch (error) {
    console.error('Error processing Instagram message:', error);
  }

}

async function processInstagramComment(comment: InstagramCommentValue): Promise<void> {
  try {
    const { from, text, media } = comment;

    // 1. Get Integration
    const integrations = await storage.getIntegrationsByProvider('instagram');
    const integration = integrations.find(i => i.connected);

    if (!integration) {
      console.log(`[IG_EVENT] No active Instagram integration found for comment from ${from.username}.`);
      return;
    }

    console.log(`[IG_EVENT] Using integration for user: ${integration.userId}`);

    // 2. Get or Create Lead
    const userLeads = await storage.getLeads({ userId: integration.userId });
    let existingLead = userLeads.find(l => l.externalId === from.id && l.channel === 'instagram');

    if (!existingLead) {
      console.log(`[IG_EVENT] Creating new lead for comment from: ${from.username} (${from.id})`);
      // Comments usually don't give us phone/email, just username/name
      const newLeadData = {
        userId: integration.userId,
        externalId: from.id,
        name: from.username,
        channel: 'instagram' as "instagram" | "email",
        status: 'new' as "new" | "contacted" | "replied" | "converted" | "not_interested" | "cold",
        tags: ['instagram-comment', 'auto-captured'],
        metadata: {
          preferred_name: from.username
        }
      };
      existingLead = await storage.createLead(newLeadData);
      console.log(`[IG_EVENT] Successfully created lead from comment: ${existingLead.id}`);
    } else {
      console.log(`[IG_EVENT] Found existing lead for comment: ${existingLead.id}`);
    }

    const lead = existingLead;

    // 3. Save Message/Comment
    await storage.createMessage({
      userId: integration.userId,
      leadId: lead.id,
      direction: 'inbound',
      provider: 'instagram', // 'instagram-comment' not in enum, sticking to 'instagram'
      body: text,
      metadata: { media_id: media.id, type: 'comment' }
    });

    // 4. Analyze Intent
    const intent = await analyzeLeadIntent(text, lead as any);

    if (intent.isInterested || intent.hasQuestion) {
      // 5. Follow Up Queue
      await storage.createFollowUp({
        userId: integration.userId,
        leadId: lead.id,
        channel: 'instagram',
        status: 'pending',
        scheduledAt: new Date(Date.now() + 5 * 60 * 1000),
        context: {
          comment_text: text,
          media_id: media.id,
          priority: 'high'
        }
      });

      // 6. Automation
      try {
        const automationSettings = await checkUserAutomationSettings(integration.userId);

        if (automationSettings.enabled) {
          console.log(`[IG_EVENT] Scheduling automated DM reply for comment from ${from.username}`);

          await scheduleAutomatedDMReply(
            integration.userId,
            lead.id,
            from.id,
            text,
            intent
          );
        }
      } catch (automationError) {
        console.error('[IG_EVENT] Error scheduling comment DM automation:', automationError);
      }
    }

  } catch (error) {
    console.error('Error processing Instagram comment:', error);
  }
}

async function fetchInstagramProfile(userId: string, appUserId: string): Promise<InstagramProfile> {
  try {
    // Supabase dependency removed, using direct Instagram API with token from storage

    // Updated to use storage for OAuth token
    const tokenData = await storage.getOAuthAccount(appUserId, 'instagram');

    if (!tokenData || !tokenData.accessToken) {
      console.error('No Instagram access token found for user');
      return { username: 'Instagram User' };
    }

    if (!/^\d+$/.test(userId)) {
      console.error('Invalid Instagram user ID format');
      return { username: 'Instagram User' };
    }

    const allowedHost = 'graph.instagram.com';
    const url = new URL(`https://${allowedHost}/${userId}`);
    url.searchParams.set('fields', 'name,username');
    url.searchParams.set('access_token', tokenData.accessToken);

    if (url.hostname !== allowedHost) {
      return { username: 'Instagram User' };
    }

    const response = await fetch(url.toString());

    if (!response.ok) {
      console.error('Instagram API error:', response.status, response.statusText);
      
      // If unauthorized (401), attempt to refresh the token once
      if (response.status === 401 && tokenData.accessToken) {
        try {
          console.log('[IG_AUTH] Attempting to refresh expired long-lived token...');
          const instagramOAuth = new InstagramOAuth();
          const refreshed = await instagramOAuth.refreshLongLivedToken(tokenData.accessToken);
          
          if (refreshed && refreshed.access_token) {
            await storage.saveOAuthAccount({
              ...tokenData,
              accessToken: refreshed.access_token,
              expiresAt: refreshed.expires_in ? new Date(Date.now() + refreshed.expires_in * 1000) : tokenData.expiresAt,
              updatedAt: new Date()
            });
            
            // Retry the profile fetch with new token
            const retryRes = await fetch(`https://${allowedHost}/${userId}?fields=name,username&access_token=${refreshed.access_token}`);
            if (retryRes.ok) {
              return await retryRes.json() as InstagramProfile;
            }
          }
        } catch (refreshError) {
          console.error('[IG_AUTH] Token refresh failed:', refreshError);
        }
      }
      return { username: 'Instagram User' };
    }

    const profile = await response.json() as InstagramProfile;
    
    // Preventive Refresh: If token is valid but older than 50 days, refresh it in the background
    const tokenAgeDays = tokenData.updatedAt ? (Date.now() - new Date(tokenData.updatedAt).getTime()) / (1000 * 60 * 60 * 24) : 0;
    if (tokenAgeDays > 50) {
      console.log(`[IG_AUTH] Token for user ${appUserId} is ${Math.round(tokenAgeDays)} days old. Refreshing in background...`);
      const instagramOAuth = new InstagramOAuth();
      instagramOAuth.refreshLongLivedToken(tokenData.accessToken).then(async (newTokens) => {
        await storage.saveOAuthAccount({
          ...tokenData,
          accessToken: newTokens.access_token,
          expiresAt: newTokens.expires_in ? new Date(Date.now() + newTokens.expires_in * 1000) : tokenData.expiresAt,
          updatedAt: new Date()
        });
        console.log(`[IG_AUTH] Background refresh successful for user ${appUserId}`);
      }).catch(err => console.error('[IG_AUTH] Background refresh failed:', err));
    }

    return profile;
  } catch (error) {
    console.error('Error fetching Instagram profile:', error);
    return { username: 'Instagram User' };
  }
}

function calculateLeadScore(intent: IntentAnalysis, lead: LeadRecord): number {
  let score = lead.lead_score || 50;

  if (intent.isInterested) score += 20;
  if (intent.wantsToSchedule) score += 30;
  if (intent.readyToBuy) score = Math.max(score, 90);
  if (intent.isNegative) score -= 30;
  if (intent.hasObjection) score -= 10;

  const messageCount = lead.message_count || 1;
  if (messageCount > 5) score += 10;
  if (messageCount > 10) score += 10;

  const lastMessageDays = (Date.now() - new Date(lead.last_message_at).getTime()) / (1000 * 60 * 60 * 24);
  if (lastMessageDays > 7) score -= 10;
  if (lastMessageDays > 30) score -= 20;

  return Math.max(0, Math.min(100, score));
}

function getSmartScheduleTime(intent: IntentAnalysis, lead: LeadRecord): string {
  const now = Date.now();
  let delayMs: number;

  if (intent.wantsToSchedule || intent.readyToBuy) {
    delayMs = (2 + Math.random() * 3) * 60 * 1000;
  } else if (intent.isInterested) {
    delayMs = (15 + Math.random() * 15) * 60 * 1000;
  } else if (intent.hasQuestion) {
    delayMs = (10 + Math.random() * 10) * 60 * 1000;
  } else {
    const followUpCount = lead.follow_up_count || 0;
    if (followUpCount === 0) {
      delayMs = (60 + Math.random() * 60) * 60 * 1000;
    } else if (followUpCount < 3) {
      delayMs = 24 * 60 * 60 * 1000;
    } else {
      delayMs = 3 * 24 * 60 * 60 * 1000;
    }
  }

  return new Date(now + delayMs).toISOString();
}









