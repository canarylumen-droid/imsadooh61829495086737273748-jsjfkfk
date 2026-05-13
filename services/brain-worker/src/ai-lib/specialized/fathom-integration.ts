import { storage } from '@shared/lib/storage/storage.js';
import { db } from '@shared/lib/db/db.js';
import { leads, auditTrail, fathomCalls, prospectObjections, users, pendingPayments } from '@audnix/shared';
import { eq, and, ilike, desc } from 'drizzle-orm';
import { evaluateNextBestAction } from "@services/brain-worker/src/orchestrator/agents/autonomous-agent.js";
import fetch from 'node-fetch';
import { acquireLock, releaseLock } from '@shared/lib/redis/redis.js';

export interface FathomWebhookPayload {
  event: string;
  data: {
    id: string;
    meeting_url?: string;
    transcript?: string;
    summary?: string;
    title?: string;
    occurred_at?: string;
    video_url?: string;
    video_thumbnail?: string;
    attendees?: Array<{ name: string; email: string }>;
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
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

  try {
    // According to research, the transcript is at /external/v1/recordings/{id}/transcript
    const response = await fetch(`https://api.fathom.ai/external/v1/recordings/${recordingId}/transcript`, {
      headers: {
        'X-Api-Key': process.env.FATHOM_API_KEY
      },
      signal: controller.signal
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`Fathom API Error (${response.status}):`, errorBody);
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
  if (!apiKey) {
    console.warn("FATHOM_API_KEY is not set. Fathom webhooks are being received but API key is missing for further requests.");
  }
  
  if (payload.event !== 'meeting.finished') {
    return; // Only process finished meetings
  }

  const { id: fathomMeetingId, meeting_url, transcript: initialTranscript, summary: initialSummary, attendees, title, occurred_at, video_url, video_thumbnail } = payload.data;
  
  if (!attendees || attendees.length === 0) return;

  // Idempotency: Use Redis lock to prevent race conditions during duplicate webhook deliveries
  const lockKey = `fathom-webhook:${fathomMeetingId}`;
  const hasLock = await acquireLock(lockKey, 300); // 5 min lock
  if (!hasLock) {
    console.log(`[Idempotency] Fathom meeting ${fathomMeetingId} is already being processed. Skipping.`);
    return;
  }

  try {
    // Idempotency: Check if this meeting has already been fully processed
    const existingCalls = await db.select().from(fathomCalls).where(eq(fathomCalls.fathomMeetingId, fathomMeetingId));
    if (existingCalls.length > 0) {
      console.log(`[Idempotency] Fathom meeting ${fathomMeetingId} already exists in database. Skipping duplicate processing.`);
      return;
    }

  let fullTranscript = initialTranscript;
  let fullSummary = initialSummary;

  // Proactively fetch full details if missing or as verified backup
  if (apiKey && fathomMeetingId) {
    try {
      const details: any = await fetchFathomMeetingDetails(fathomMeetingId);
      if (details.transcript) fullTranscript = details.transcript;
      if (details.summary) fullSummary = details.summary;
    } catch (e: any) {
      console.warn(`Could not fetch full Fathom details for ${fathomMeetingId}:`, e.message);
    }
  }

  // For each attendee, attempt to match to an existing lead in the system
  for (const attendee of attendees) {
    if (!attendee.email) continue;
    
    // Find matching lead
    // Find matching lead using case-insensitive comparison
    const matchedLeads = await db.select().from(leads).where(ilike(leads.email, attendee.email.trim()));
    
    if (matchedLeads.length > 0) {
      const lead = matchedLeads[0];
      
      // 1. Persist to fathom_calls table via storage
      await storage.createFathomCall({
        userId: lead.userId,
        leadId: lead.id,
        fathomMeetingId: fathomMeetingId,
        title: title || `Meeting with ${lead.name}`,
        summary: fullSummary,
        transcript: fullTranscript,
        videoUrl: video_url || meeting_url,
        videoThumbnail: video_thumbnail,
        occurredAt: occurred_at ? new Date(occurred_at) : new Date(),
        metadata: {
          attendees,
          source: 'webhook'
        }
      });

      // 2. Update lead status if necessary via storage
      await storage.updateLead(lead.id, { 
        fathomMeetingId: fathomMeetingId,
        status: lead.status === 'booked' || lead.status === 'converted' ? lead.status : 'warm', 
        updatedAt: new Date()
      });
        
      // 3. Create Audit Trail Entry via storage
      await storage.createAuditLog({
        userId: lead.userId,
        leadId: lead.id,
        action: 'fathom_meeting_finished',
        details: {
          meeting_url,
          summary_snippet: fullSummary ? fullSummary.substring(0, 100) + '...' : null
        }
      });
      
      console.log(`✅ Fathom meeting processed and saved for lead ${lead.email} (ID: ${lead.id})`);

      // Real-time UI push
      const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
      wsSync.notifyInsightsUpdated(lead.userId);
      wsSync.notifyLeadsUpdated(lead.userId, { leadId: lead.id, action: 'fathom_updated' });

      // Pop-up notification
      await storage.createNotification({
        userId: lead.userId,
        type: 'system',
        title: '🎥 Fathom Call Finished',
        message: `Meeting with ${lead.name} has been processed. AI insights are ready!`,
        actionUrl: `/dashboard/leads/${lead.id}`,
        metadata: { leadId: lead.id, fathomMeetingId }
      });
      
      // Phase 11 & 12: Query past calls for Long Term Memory
      let pastContext = "";
      try {
        const pastCalls = await db.select()
          .from(fathomCalls)
          .where(eq(fathomCalls.leadId, lead.id))
          .orderBy(desc(fathomCalls.occurredAt))
          .limit(3);
        
        if (pastCalls.length > 0) {
          pastContext = pastCalls.map((c: any) => `Call ${c.occurredAt?.toISOString()}: ${c.summary}`).join("\n---\n");
        }
      } catch (e) {
        console.warn("Could not query past calls for context", e);
      }

      // 4. Autonomous Intelligence Analysis (Coaching & Outcome Audit)
      try {
        const { analyzeMeetingIntelligence } = await import("../core/post-call-intelligence.js");
        const analysis = await analyzeMeetingIntelligence(
          fullTranscript || "", 
          fullSummary || "",
          pastContext
        );
        
        // Update the call record with the analysis result
        await db.update(fathomCalls)
          .set({ analysis: analysis as any })
          .where(and(eq(fathomCalls.fathomMeetingId, fathomMeetingId), eq(fathomCalls.leadId, lead.id)));

        // Phase 3: Persist Buying Intent to Leads metadata autonomously
        if (analysis.buyingIntent || analysis.conversationalStage) {
           const leadRec = await db.select().from(leads).where(eq(leads.id, lead.id)).limit(1);
           if (leadRec.length > 0) {
              const currentMetadata = leadRec[0].metadata || {};
              await db.update(leads)
                .set({ 
                  metadata: {
                    ...currentMetadata,
                    buyingIntent: analysis.buyingIntent,
                    conversationalStage: analysis.conversationalStage
                  } as any
                })
                .where(eq(leads.id, lead.id));
              console.log(`🧠 Buying Intent & Stage automatically enriched for ${lead.email}`);
           }
        }

        // Phase 4: Save Primary Objection into Battle Card queue
        if (analysis.primaryObjection) {
           await db.insert(prospectObjections).values({
               leadId: lead.id,
               userId: lead.userId,
               fathomMeetingId: fathomMeetingId,
               category: analysis.primaryObjection.category,
               snippet: analysis.primaryObjection.snippet,
           });
           console.log(`⚔️ Objection Logged for Battle-Card agent: ${analysis.primaryObjection.category}`);
        }

        // --- LEVEL 20 AUTONOMOUS PAYMENT PIPELINE ---
        if (analysis.agreedToPay && analysis.confidence >= 0.7) {
          console.log(`💰 Prospect ${lead.email} agreed to pay on the call! Initiating Payment Pipeline.`);
          
          // Get user configuration for Autonomous Mode
          const userRec = await db.select().from(users).where(eq(users.id, lead.userId)).limit(1);
          const isAutonomous = !!(userRec[0]?.config as any)?.autonomousMode;
          // Robust numeric extraction for amountDetected
          let parsedAmount: number | null = null;
          if (analysis.paymentAmount) {
            const cleaned = analysis.paymentAmount.replace(/[^0-9.]/g, '');
            parsedAmount = cleaned ? parseFloat(cleaned) : null;
          }

          // NGA-1 "$5k Handoff Rule": If amount is > 5k or UNKNOWN, hand off to human.
          // We strictly use the user's setting (offerValue) if the call transcript didn't have a price.
          const userMetadata = (userRec[0]?.metadata as any) || {};
          const settingsOfferValue = userMetadata.offerValue ? parseFloat(userMetadata.offerValue) : 0;
          
          // The effective value we use for the $5k rule check
          const effectiveValue = parsedAmount !== null ? parsedAmount : settingsOfferValue;
          
          // NGA-1 "$5k Handoff Rule": ONLY hand off if we KNOW the value is >= 5000.
          // If the amount is unknown (0), we proceed with sending the link as requested.
          const isHighTicket = effectiveValue >= 5000;
          
          if (isHighTicket) {
             console.log(`⚠️ [High-Ticket Handoff] Explicit deal value ($${effectiveValue}) requires human review. Skipping autonomous checkout.`);
          }

          // Idempotency: Prevent duplicate payment rows if Fathom retries the same webhook
          const existingPayment = await db.select()
            .from(pendingPayments)
            .where(and(eq(pendingPayments.leadId, lead.id), eq(pendingPayments.fathomMeetingId, fathomMeetingId)))
            .limit(1);

          if (existingPayment.length > 0) {
            console.log(`[Idempotency] pending_payments record already exists for lead ${lead.id} + meeting ${fathomMeetingId}. Skipping duplicate insert.`);
          } else {
            // Calculate expiry (7 days from now)
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 7);

            // Insert into pending_payments (first time only)
            const insertedPayment = await db.insert(pendingPayments).values({
              userId: lead.userId,
              leadId: lead.id,
              fathomMeetingId: fathomMeetingId,
              status: 'pending' as any,
              amountDetected: parsedAmount || null,
              expiresAt,
            }).returning();

            if (isAutonomous && !isHighTicket) {
               console.log(`🤖 Autonomous Mode ON: Queuing instant checkout email dispatch for ${lead.email}`);
                const { queueCheckoutDispatch } = await import("@shared/lib/queues/billing-queue.js");
                await queueCheckoutDispatch(insertedPayment[0].id);
            } else {
               console.log(`${isHighTicket ? '🛑 High-Ticket Review' : '⏸️ Autonomous Mode OFF'}: Check pending dashboard to dispatch email for ${lead.email}`);
               // Create a notification for the user about the high-ticket handoff
               if (isHighTicket) {
                  await storage.createNotification({
                    userId: lead.userId,
                    type: 'info',
                    title: '🤝 High-Ticket Handoff Required',
                    message: `A $${effectiveValue} deal was detected for ${lead.name}. Please review and send the checkout link manually.`,
                    actionUrl: `/dashboard/leads/${lead.id}`,
                    metadata: { leadId: lead.id, amount: effectiveValue }
                  });
               }
            }
          }

          // Revenue & Pipeline Update: Close the deal as WON
          const { deals } = await import('@audnix/shared');
          const existingDeals = await db.select().from(deals).where(eq(deals.leadId, lead.id)).limit(1);
          
          if (existingDeals.length > 0) {
             const deal = existingDeals[0];
             if (deal.status !== 'closed_won') {
                await db.update(deals).set({ 
                  status: 'closed_won', 
                  convertedAt: new Date(),
                  notes: `Converted via Fathom AI Summary.`
                }).where(eq(deals.id, deal.id));
                console.log(`💰 Updated deal ${deal.id} to closed_won.`);
             }
          } else {
             const offerValue = userRec[0] ? ((userRec[0].metadata as any)?.offerValue || 1000) : 1000;
             await db.insert(deals).values({
                userId: lead.userId,
                leadId: lead.id,
                brand: 'Audnix AI',
                channel: lead.externalId ? 'instagram' : 'email',
                value: parsedAmount || offerValue,
                status: 'closed_won',
                notes: `Converted via Fathom AI Summary.`,
                convertedAt: new Date()
             });
             console.log(`💰 Created new won deal for Fathom summary.`);
          }
          try {
             const { wsSync } = await import('@shared/lib/realtime/websocket-sync.js');
             wsSync.notifyDealsUpdated(lead.userId);
          } catch (e) { /* ignore */ }

          // (Handled above in else block to allow deals to update even if idempotency skips payment insert)

          // [PHASE 20] SHIELD ACTIVATED: Pause AI outreach immediately
          // This ensures standard campaigns don't keep firing while we wait for payment.
          await db.update(leads)
            .set({ aiPaused: true, status: 'warm', updatedAt: new Date() })
            .where(eq(leads.id, lead.id));
          
          // Also abort any active campaign leads for this lead
          const { campaignLeads } = await import('@audnix/shared');
          await db.update(campaignLeads)
            .set({ status: 'aborted', updatedAt: new Date() })
            .where(eq(campaignLeads.leadId, lead.id));
          
          // Emit WebSocket event for real-time Dashboard 
          try {
             // In-App Notification System
             // We can fire a global event if socket.io is set up, but for now we write an audit trail so it appears instantly.
             await storage.createAuditLog({
                userId: lead.userId,
                leadId: lead.id,
                action: 'payment_agreed',
                details: { status: isAutonomous ? 'queued' : 'pending_review', amount: analysis.paymentAmount }
             });
          } catch (e) {
             console.warn("Failed to update realtime socket audit log.");
          }
        }

        console.log(`🧠 Autonomous Coaching Analysis complete for ${lead.email}`);
      } catch (e: any) {
        console.error("Coaching analysis failed:", e);
        // Persist failure state instead of mock data
        await db.update(fathomCalls)
          .set({ summary: `Coaching failed: ${e.message}` })
          .where(and(eq(fathomCalls.fathomMeetingId, fathomMeetingId), eq(fathomCalls.leadId, lead.id)));
      }

      // [PHASE 48] STATEFUL MEMORY: Update Procedural Memory after meeting
      try {
        const { campaignLeads } = await import('@audnix/shared');
        const campaignLead = await db.select().from(campaignLeads).where(eq(campaignLeads.leadId, lead.id)).limit(1);
        
        if (campaignLead.length > 0 && campaignLead[0].campaignId) {
          console.log(`🧠 Refining Procedural Memory for ${lead.email} based on meeting insights...`);
          const { planProceduralMemory, gatherCompetitorIntelligence } = await import("@services/brain-worker/src/orchestrator/agents/universal-sales-agent.js");
          const { getBrandContext } = await import("@services/brain-worker/src/ai-lib/context/brand-context.js");
          
          const brandContext = await getBrandContext(lead.userId);
          const competitive = await gatherCompetitorIntelligence(
            (brandContext as any).industry || "B2B",
            (brandContext as any).niche || "Sales",
            lead.company || undefined
          );
          
          // Re-plan strategy with meeting context
          const refinedStrategy = await planProceduralMemory({
            ...lead,
            metadata: { ...(lead.metadata as any || {}), lastMeetingSummary: fullSummary }
          } as any, brandContext, competitive);
          
          await storage.updateCampaignLeadProceduralMemory(campaignLead[0].campaignId, lead.id, { 
            strategy: refinedStrategy,
            meetingId: fathomMeetingId,
            updatedAt: new Date().toISOString()
          });
          console.log(`✅ Procedural Memory refined for ${lead.email}`);
        }
      } catch (memErr) {
        console.error("Failed to update procedural memory after meeting:", memErr);
      }

      // 5. Trigger the autonomous-agent.ts to evaluate the summary 
      try {
        await evaluateNextBestAction(lead.id, fullSummary || fullTranscript || "No meeting context provided.");
      } catch (e) {
        console.error("AI Next Best Action routing failed:", e);
      }
    }
  }
} finally {
    // Always release the lock
    await releaseLock(lockKey);
  }
}




