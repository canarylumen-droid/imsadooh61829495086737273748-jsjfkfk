import { storage } from '@shared/lib/storage/storage.js';
import { db } from '@shared/lib/db/db.js';
import { leads, auditTrail, fathomCalls, prospectObjections, users, pendingPayments, notifications, deals, campaignLeads } from '@audnix/shared';
import { eq, and, ilike, desc, sql, inArray } from 'drizzle-orm';
import { wsSync } from "@shared/lib/realtime/websocket-sync.js";
import { evaluateNextBestAction } from "@services/brain-worker/src/orchestrator/agents/autonomous-agent.js";
import fetch from 'node-fetch';
import { acquireLock, releaseLock } from '@shared/lib/redis/redis.js';

import { FathomWebhookPayload } from '@shared/lib/queues/fathom-queue.js';

/**
 * Enterprise Admin Reporting Helper
 */
async function reportProcessingError(userId: string | null, error: any, context: string, metadata: any = {}) {
  console.error(`[Fathom Error] ${context}:`, error);
  if (userId) {
    await db.insert(notifications).values({
      userId,
      type: 'webhook_error',
      title: 'Fathom Processing Failed 🚨',
      message: `Failed to process ${context}. Error: ${error instanceof Error ? error.message : String(error)}`,
      metadata: { 
        ...metadata, 
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
        service: 'fathom-worker'
      }
    }).catch(e => console.error('Failed to log admin notification:', e));
  }
}

/**
 * Fetches full meeting details from Fathom API using the recording ID
 */
export async function fetchFathomMeetingDetails(recordingId: string) {
  if (!process.env.FATHOM_API_KEY) {
    throw new Error("FATHOM_API_KEY is missing");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); 

  try {
    const response = await fetch(`https://api.fathom.ai/external/v1/recordings/${recordingId}/transcript`, {
      headers: { 'X-Api-Key': process.env.FATHOM_API_KEY },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Fathom transcript: ${response.statusText}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Parses and processes incoming webhook payload from Fathom AI
 */
export async function processFathomWebhook(payload: FathomWebhookPayload) {
  const apiKey = process.env.FATHOM_API_KEY;
  if (payload.event !== 'meeting.finished') return;

  const { recording_id, id: fallbackId, transcript: initialTranscript, summary: initialSummary, attendees, meeting_title: title, started_at: occurred_at, video_url, video_thumbnail, share_url: meeting_url } = payload.data;
  
  const fathomMeetingId = recording_id || fallbackId;
  if (!fathomMeetingId || !attendees || attendees.length === 0) return;

  const lockKey = `fathom-webhook:${fathomMeetingId}`;
  const hasLock = await acquireLock(lockKey, 300);
  if (!hasLock) return;

  let activeUserId: string | null = null;

  try {
    const existingCalls = await db.select().from(fathomCalls).where(eq(fathomCalls.fathomMeetingId, fathomMeetingId));
    if (existingCalls.length > 0) return;

    let fullTranscript = initialTranscript;
    let fullSummary = initialSummary;

    if (apiKey && fathomMeetingId) {
      try {
        const details: any = await fetchFathomMeetingDetails(fathomMeetingId);
        if (details.transcript) fullTranscript = details.transcript;
        if (details.summary) fullSummary = details.summary;
      } catch (e: any) {
        console.warn(`[Fathom] Transcript fetch failed for ${fathomMeetingId}`);
      }
    }

    for (const attendee of attendees) {
      if (!attendee.email) continue;
      
      const [lead] = await db.select().from(leads).where(ilike(leads.email, attendee.email.trim())).limit(1);
      if (!lead) continue;
      activeUserId = lead.userId;

      await db.transaction(async (tx) => {
        await tx.insert(fathomCalls).values({
          userId: lead.userId,
          leadId: lead.id,
          fathomMeetingId: fathomMeetingId,
          title: title || `Meeting with ${lead.name}`,
          summary: fullSummary,
          transcript: fullTranscript,
          videoUrl: video_url || meeting_url,
          videoThumbnail: video_thumbnail,
          occurredAt: occurred_at ? new Date(occurred_at) : new Date(),
          metadata: { attendees, source: 'webhook' }
        });

        await tx.update(leads)
          .set({ 
            fathomMeetingId: fathomMeetingId,
            status: lead.status === 'converted' ? 'converted' : 'warm',
            aiPaused: true, 
            updatedAt: new Date()
          })
          .where(eq(leads.id, lead.id));

        await tx.insert(notifications).values({
          userId: lead.userId,
          type: 'info',
          title: '🎥 Fathom Call Finished',
          message: `Meeting with ${lead.name} processed. AI analyzing payment status...`,
          metadata: { leadId: lead.id, fathomMeetingId }
        });
      });

      // POST-TRANSACTION AI Analysis
      try {
        const { analyzeMeetingIntelligence } = await import("../core/post-call-intelligence.js");
        const analysis = await analyzeMeetingIntelligence(fullTranscript || "", fullSummary || "");
        
        await db.update(fathomCalls)
          .set({ analysis: analysis as any })
          .where(and(eq(fathomCalls.fathomMeetingId, fathomMeetingId), eq(fathomCalls.leadId, lead.id)));

        // Handle Payment Detection
        if (analysis.alreadyPaidOnCall) {
          console.log(`💰 [AI Confirmed] Lead ${lead.email} paid ON THE CALL via ${analysis.paymentMethodDetected || 'external method'}.`);
          await markLeadAsPaidManually(lead, analysis, fathomMeetingId);
        } else if (analysis.agreedToPay && analysis.confidence >= 0.7) {
          await handleAutonomousPayment(lead, analysis, fathomMeetingId);
        }

        await evaluateNextBestAction(lead.id, fullSummary || "Meeting finished.");

      } catch (aiErr) {
        console.warn(`[Fathom Worker] AI Intelligence failed for ${lead.id}`, aiErr);
      }
    }

  } catch (error) {
    await reportProcessingError(activeUserId, error, 'processFathomWebhook', { recording_id });
    throw error;
  } finally {
    await releaseLock(lockKey);
  }
}

/**
 * Handle scenario where AI detects they ALREADY paid on call
 */
async function markLeadAsPaidManually(lead: any, analysis: any, fathomMeetingId: string) {
  await db.transaction(async (tx) => {
    await tx.update(leads).set({
      status: 'converted',
      aiPaused: true,
      updatedAt: new Date(),
      metadata: sql`jsonb_set(coalesce(${leads.metadata}, '{}'::jsonb), '{payment_detected_on_call}', 'true'::jsonb)`
    }).where(eq(leads.id, lead.id));

    // Abort active campaigns
    await tx.update(campaignLeads).set({ status: 'aborted' }).where(and(eq(campaignLeads.leadId, lead.id), inArray(campaignLeads.status, ['pending', 'sent', 'queued'])));

    // Notify user
    await tx.insert(notifications).values({
      userId: lead.userId,
      type: 'conversion',
      title: '💰 Payment Detected on Call!',
      message: `AI detected that ${lead.name} paid via ${analysis.paymentMethodDetected || 'external link'} during the call. outreach paused.`,
      metadata: { leadId: lead.id, method: analysis.paymentMethodDetected }
    });
  });
  
  wsSync.notifyLeadsUpdated(lead.userId, { leadId: lead.id, action: 'converted' });
}

/**
 * Handle Autonomous Payment Logic
 */
async function handleAutonomousPayment(lead: any, analysis: any, fathomMeetingId: string) {
  try {
    const [user] = await db.select().from(users).where(eq(users.id, lead.userId)).limit(1);
    if (!user || lead.status === 'converted') return;

    const isAutonomous = !!(user.config as any)?.autonomousMode;
    const cleaned = analysis.paymentAmount?.replace(/[^0-9.]/g, '');
    const parsedAmount = cleaned ? parseFloat(cleaned) : null;
    
    const userMetadata = (user.metadata as any) || {};
    const settingsOfferValue = userMetadata.offerValue ? parseFloat(userMetadata.offerValue) : 0;
    const effectiveValue = parsedAmount !== null ? parsedAmount : settingsOfferValue;
    const isHighTicket = effectiveValue >= 5000;

    await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(pendingPayments)
        .where(and(eq(pendingPayments.leadId, lead.id), eq(pendingPayments.fathomMeetingId, fathomMeetingId)))
        .limit(1);
      
      if (!existing) {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

        const [payment] = await tx.insert(pendingPayments).values({
          userId: lead.userId,
          leadId: lead.id,
          fathomMeetingId,
          status: 'pending' as any,
          amountDetected: parsedAmount || null,
          expiresAt
        }).returning();

        if (isHighTicket) {
          await tx.insert(notifications).values({
            userId: lead.userId,
            type: 'info',
            title: '🤝 High-Ticket Review',
            message: `$${effectiveValue} deal requires manual link approval for ${lead.name}.`,
            metadata: { leadId: lead.id, amount: effectiveValue }
          });
        }
      }
    });

    if (isAutonomous && !isHighTicket) {
       const { queueCheckoutDispatch } = await import("@shared/lib/queues/billing-queue.js");
       const [payment] = await db.select().from(pendingPayments).where(and(eq(pendingPayments.leadId, lead.id), eq(pendingPayments.fathomMeetingId, fathomMeetingId)));
       if (payment) await queueCheckoutDispatch(payment.id);
    }
  } catch (err) {
    console.error('[Fathom Payment] Failed:', err);
  }
}
