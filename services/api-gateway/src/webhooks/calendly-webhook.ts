import { storage } from '@shared/lib/storage/storage.js';
import { wsSync } from "@shared/lib/realtime/websocket-sync.js";
import { users, integrations, calendarEvents, notifications, leads } from "@audnix/shared";
import { socketService } from "@shared/lib/realtime/socket-service.js";
import { db } from '@shared/lib/db/db.js';
import { eq, and, sql } from "drizzle-orm";
import { Request, Response } from "express";
import crypto from "crypto";
import { availabilityService } from "@shared/lib/calendar/availability-service.js";

interface CalendlyEventLocation {
  type: string;
  location?: string;
}

interface CalendlyInvitee {
  email: string;
  name: string;
  first_name?: string;
  last_name?: string;
  uri?: string;
}

interface CalendlyWebhookEvent {
  resource: {
    resource_type: string;
    event_type: string;
    created_at: string;
    uri?: string;
  };
  payload: {
    event_type?: string;
    invitee?: CalendlyInvitee;
    event?: {
      start_time: string;
      end_time: string;
      uri: string;
      event_type?: {
        name: string;
        duration?: number;
      };
      name?: string;
      location?: CalendlyEventLocation;
    };
    scheduled_event?: {
      start_time: string;
      end_time: string;
      uri: string;
      name?: string;
      location?: CalendlyEventLocation;
    };
  };
}

/**
 * Verify Calendly webhook signature
 */
export function verifyCalendlySignature(req: Request): boolean {
  const signature = req.headers['calendly-webhook-signature'] as string;
  const timestamp = req.headers['calendly-webhook-timestamp'] as string;

  if (!signature || !timestamp) return false;

  const secret = process.env.CALENDLY_WEBHOOK_SECRET || '';
  if (!secret) return true; // Skip if no secret configured

  const payload = `${timestamp}.${JSON.stringify(req.body)}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex'); // Calendly uses hex for v1 signatures

  const incomingSignature = signature.replace('v1=', '');
  return incomingSignature === expectedSignature;
}

/**
 * Handle Calendly webhook events
 */
export async function handleCalendlyWebhook(req: Request, res: Response): Promise<void> {
  try {
    const event: CalendlyWebhookEvent = req.body;

    if (!event.resource || !event.payload) {
      res.status(400).json({ error: 'Invalid webhook payload' });
      return;
    }

    const eventType = event.resource.event_type || event.payload.event_type;

    switch (eventType) {
      case 'invitee.created':
        await handleMeetingBooked(event);
        break;
      case 'invitee.canceled':
        await handleMeetingCancelled(event);
        break;
      case 'invitee.no_show.created':
        await handleMeetingNoShow(event);
        break;
      default:
        console.log(`Unhandled Calendly webhook event: ${eventType}`);
    }

    res.json({ ok: true });
  } catch (error: any) {
    console.error('Error handling Calendly webhook:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}

/**
 * Handle when a meeting is booked
 */
async function handleMeetingBooked(event: CalendlyWebhookEvent): Promise<void> {
  try {
    const payload = event.payload;
    const invitee = payload.invitee;
    const scheduledEvent = payload.scheduled_event || payload.event;

    if (!invitee || !scheduledEvent) return;

    // Find the user associated with this Calendly account
    // Use the scheduled event owner or the explicitly saved URI
    let userId: string | null = null;
    
    // Attempt 1: Match by direct Calendly User URI if available in payload
    const eventOwnerUri = (scheduledEvent as any).event_memberships?.[0]?.user;
    if (eventOwnerUri) {
      const [user] = await db.select().from(users).where(eq(users.calendlyUserUri, eventOwnerUri)).limit(1);
      if (user) userId = user.id;
    }

    // Attempt 2: Fallback to any Calendly integration (Legacy/Generic)
    if (!userId) {
      const { integrations } = await import("@audnix/shared");
      const [integration] = await db.select().from(integrations).where(eq(integrations.provider, 'calendly')).limit(1);
      if (integration) userId = integration.userId;
    }

    if (!userId) {
      console.warn(`[Calendly Webhook] No user found for event owner: ${eventOwnerUri}`);
      return;
    }

    const attendeeEmail = invitee.email;

    const [booking] = await db.insert(calendarEvents).values({
      userId,
      provider: 'calendly',
      externalId: scheduledEvent.uri,
      title: scheduledEvent.name || 'Discovery Call',
      startTime: new Date(scheduledEvent.start_time),
      endTime: new Date(scheduledEvent.end_time),
      meetingUrl: scheduledEvent.location ? (scheduledEvent.location as any).location : null,
      attendeeEmail: attendeeEmail,
      attendeeName: invitee.name || `${invitee.first_name || ''} ${invitee.last_name || ''}`.trim(),
      status: 'scheduled',
      isAiBooked: true 
    }).returning();

    // PHASE 14: Update Lead status to 'booked' 
    const { leads } = await import("@audnix/shared");
    const [updatedLead] = await db.update(leads)
      .set({ 
        status: 'booked', 
        updatedAt: new Date(),
        metadata: booking ? sql`jsonb_set(coalesce(${leads.metadata}, '{}'::jsonb), '{lastBooking}', ${JSON.stringify(booking)}::jsonb)` : sql`${leads.metadata}`
      })
      .where(and(eq(leads.userId, userId), eq(leads.email, attendeeEmail)))
      .returning();

    if (updatedLead) {
      console.log(`✓ Lead ${updatedLead.id} (${attendeeEmail}) status updated to 'booked' via Calendly webhook`);
      
      // PHASE 3: Stop all follow-ups immediately
      await storage.clearFollowUpQueue(updatedLead.id);
      console.log(`✓ Follow-up queue cleared for lead: ${updatedLead.id}`);

      wsSync.notifyLeadsUpdated(userId, { event: 'UPDATE', leadId: updatedLead.id });

      // 🚀 SDR MANAGER: Run autonomous analysis on the booking notes/intent
      try {
        const { generateLeadIntelligenceDashboard } = await import("@services/brain-worker/src/ai-lib/context/lead-intelligence.js");
        const { messages: sharedMessages, deals } = await import("@audnix/shared");
        const messages = await db.select().from(sharedMessages).where(eq(sharedMessages.leadId, updatedLead.id));
        
        const intelligence = await generateLeadIntelligenceDashboard(updatedLead as any, messages as any);
        console.log(`✓ SDR Analysis updated for booked lead: ${updatedLead.id}`);
        
        // Push "booked" event with enriched metadata
        wsSync.notifyActivityUpdated(userId, {
            type: 'lead_booked',
            title: 'Lead Booked! 📅',
            message: `${updatedLead.name} at ${updatedLead.company || 'their company'} just booked a call.`,
            metadata: { leadId: updatedLead.id, status: 'booked' }
        });

        // 🧠 Push specific AI Insight Notification
        await db.insert(notifications).values({
          userId,
          type: 'insight',
          title: 'Post-Call / Booking Insight 🧠',
          message: `AI Insight for ${updatedLead.name}: ${(intelligence as any)?.summary || 'Review lead details.'}`,
          metadata: { leadId: updatedLead.id, insight: (intelligence as any)?.summary }
        });

        // 💰 Update Deals Pipeline
        // Check if deal exists
        const [existingDeal] = await db.select().from(deals).where(eq(deals.leadId, updatedLead.id)).limit(1);
        if (existingDeal) {
          await db.update(deals).set({ status: 'closed_won', convertedAt: new Date() }).where(eq(deals.id, existingDeal.id));
        } else {
          // If no deal exists, fetch default user offer value
          const [u] = await db.select({ offerValue: users.offerValue }).from(users).where(eq(users.id, userId)).limit(1);
          await db.insert(deals).values({
            userId,
            leadId: updatedLead.id,
            brand: updatedLead.company || 'Unknown',
            channel: 'email',
            value: u?.offerValue || 0,
            status: 'closed_won',
            convertedAt: new Date(),
            meetingScheduled: true,
            meetingUrl: scheduledEvent.location ? (scheduledEvent.location as any).location : null
          });
        }
        wsSync.notifyDealsUpdated(userId, { event: 'UPDATE' });

      } catch (sdrErr) {
        console.error('Error in SDR booking analysis:', sdrErr);
      }
    }

    // Notify user
    await db.insert(notifications).values({
      userId,
      type: 'conversion',
      title: 'New Meeting Booked! 📅',
      message: `${booking.attendeeName} just scheduled a meeting for ${new Date(booking.startTime).toLocaleDateString()}`,
      metadata: { leadId: updatedLead?.id, attendeeEmail }
    });

    // Broadcast to dashboard
    wsSync.broadcastToUser(userId, {
      type: 'CALENDAR_UPDATED',
      payload: booking
    });

  } catch (error) {
    console.error('Error in handleMeetingBooked:', error);
  }
}

/**
 * Handle when a meeting is cancelled
 */
async function handleMeetingCancelled(event: CalendlyWebhookEvent): Promise<void> {
  try {
    const scheduledEvent = event.payload.scheduled_event || event.payload.event;
    const invitee = event.payload.invitee;
    if (!scheduledEvent) return;

    const [booking] = await db.update(calendarEvents)
      .set({ status: 'cancelled' })
      .where(eq(calendarEvents.externalId, scheduledEvent.uri))
      .returning();

    if (booking) {
      // Update lead status to 'open' so re-engagement can happen
      const { leads } = await import("@audnix/shared");
      const [updatedLead] = await db.update(leads)
        .set({ status: 'open', updatedAt: new Date() })
        .where(and(eq(leads.userId, booking.userId), eq(leads.email, booking.attendeeEmail || '')))
        .returning();

      if (updatedLead) {
        console.log(`[Calendly] Booking cancelled – Lead ${updatedLead.id} status reset to 'open'`);
        wsSync.notifyLeadsUpdated(booking.userId, { event: 'UPDATE', leadId: updatedLead.id });
        // Phase 8: Emit real-time event
        socketService.notifyCalendarUpdate(booking.userId, {
          bookingId: booking.id,
          status: 'cancelled',
          attendeeEmail: booking.attendeeEmail || undefined,
        });
        socketService.notifyLeadUpdate(booking.userId, {
          leadId: updatedLead.id,
          status: 'open',
          reason: 'Calendly booking cancelled',
        });
      }

      // Notify user of cancellation
      await db.insert(notifications).values({
        userId: booking.userId,
        type: 'system',
        title: 'Meeting Cancelled 📅',
        message: `${booking.attendeeName || booking.attendeeEmail} cancelled their meeting scheduled for ${new Date(booking.startTime).toLocaleDateString()}`,
        metadata: { leadId: updatedLead?.id, attendeeEmail: booking.attendeeEmail }
      }).catch(() => {}); // Non-critical

      // Legacy WS broadcast
      wsSync.broadcastToUser(booking.userId, {
        type: 'CALENDAR_UPDATED',
        payload: { ...booking, status: 'cancelled' }
      });
    }
  } catch (error) {
    console.error('Error in handleMeetingCancelled:', error);
  }
}

/**
 * Handle when an invitee does not show up
 */
async function handleMeetingNoShow(event: CalendlyWebhookEvent): Promise<void> {
  try {
    const payload = event.payload as any;
    const inviteeUri = typeof payload.invitee === 'string' ? payload.invitee : payload.invitee?.uri;
    const eventUri = payload.event || payload.scheduled_event?.uri || payload.scheduled_event;

    if (!eventUri && !inviteeUri) {
      console.warn('Calendly no-show payload missing event/invitee URI', payload);
      return;
    }

    if (typeof eventUri === 'string' && eventUri.startsWith('https://api.calendly.com')) {
      const [booking] = await db.update(calendarEvents)
        .set({ status: 'no_show' })
        .where(eq(calendarEvents.externalId, eventUri))
        .returning();

      if (booking) {
        console.log(`✓ Lead (${booking.attendeeEmail}) marked as no-show for booking ${booking.id}`);

        // Phase 8: Emit real-time event
        socketService.notifyCalendarUpdate(booking.userId, {
          bookingId: booking.id,
          status: 'no_show',
          attendeeEmail: booking.attendeeEmail || undefined,
          startTime: booking.startTime?.toISOString(),
        });

        wsSync.broadcastToUser(booking.userId, {
          type: 'CALENDAR_UPDATED',
          payload: booking
        });

        const { leads } = await import("@audnix/shared");
        const [updatedLead] = await db.update(leads)
          .set({ status: 'no_show', updatedAt: new Date() })
          .where(and(eq(leads.userId, booking.userId), eq(leads.email, booking.attendeeEmail || '')))
          .returning();

        if (updatedLead) {
          wsSync.notifyLeadsUpdated(booking.userId, { event: 'UPDATE', leadId: updatedLead.id });
          socketService.notifyLeadUpdate(booking.userId, {
            leadId: updatedLead.id,
            status: 'no_show',
            reason: 'Did not attend scheduled Calendly meeting',
          });

          // Schedule a re-engagement follow-up for no-shows (after 2 days)
          try {
            const { scheduleInitialFollowUp } = await import("@services/brain-worker/src/ai-lib/core/follow-up-worker.js");
            await scheduleInitialFollowUp(booking.userId, updatedLead.id, 'email');
            console.log(`[Calendly] Re-engagement follow-up queued for no-show lead: ${updatedLead.id}`);
          } catch (fErr) {
            console.warn('[Calendly] Could not schedule no-show follow-up:', fErr);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error in handleMeetingNoShow:', error);
  }
}

/**
 * Handle Calendly verification ping
 */
export function handleCalendlyVerification(req: Request, res: Response): void {
  res.status(200).json({ ok: true, message: 'Calendly webhook verified' });
}







