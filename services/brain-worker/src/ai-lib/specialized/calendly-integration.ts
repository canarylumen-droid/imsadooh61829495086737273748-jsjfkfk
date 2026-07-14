import { storage } from '@shared/lib/storage/storage.js';
import { wsSync } from "@shared/lib/realtime/websocket-sync.js";
import { users, integrations, calendarEvents, notifications, leads, messages as sharedMessages, deals } from "@audnix/shared";
import { socketService } from "@shared/lib/realtime/socket-service.js";
import { db } from '@shared/lib/db/db.js';
import { eq, and, sql } from "drizzle-orm";

export interface CalendlyWebhookEvent {
  resource: {
    resource_type: string;
    event_type: string;
    created_at: string;
    uri?: string;
  };
  payload: {
    event_type?: string;
    invitee?: {
      email: string;
      name: string;
      first_name?: string;
      last_name?: string;
      uri?: string;
    };
    event?: any;
    scheduled_event?: {
      start_time: string;
      end_time: string;
      uri: string;
      name?: string;
      location?: {
        type: string;
        location?: string;
      };
    };
  };
}

/**
 * Main entry point for processing Calendly jobs from the queue
 */
export async function processCalendlyWebhook(event: CalendlyWebhookEvent): Promise<void> {
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
}

/**
 * Enterprise Admin Reporting Helper
 */
async function reportProcessingError(userId: string | null, error: any, context: string, metadata: any = {}) {
  console.error(`[Calendly Error] ${context}:`, error);
  if (userId) {
    await db.insert(notifications).values({
      userId,
      type: 'webhook_error',
      title: 'Calendly Processing Failed 🚨',
      message: `Failed to process ${context}. Error: ${error instanceof Error ? error.message : String(error)}`,
      metadata: { 
        ...metadata, 
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
        service: 'calendly-worker'
      }
    }).catch(e => console.error('Failed to log admin notification:', e));
  }
}

/**
 * Handle when a meeting is booked
 * REFACTORED: Transaction-safe + Circuit Breaker for AI
 */
async function handleMeetingBooked(event: CalendlyWebhookEvent): Promise<void> {
  let activeUserId: string | null = null;
  try {
    const payload = event.payload;
    const invitee = payload.invitee;
    const scheduledEvent = payload.scheduled_event || payload.event;

    if (!invitee || !scheduledEvent) return;

    // Identify owner
    const eventOwnerUri = (scheduledEvent as any).event_memberships?.[0]?.user || (scheduledEvent as any).user;
    if (eventOwnerUri) {
      const [user] = await db.select().from(users).where(eq(users.calendlyUserUri, eventOwnerUri)).limit(1);
      if (user) activeUserId = user.id;
    }

    if (!activeUserId) {
      const [integration] = await db.select().from(integrations).where(eq(integrations.provider, 'calendly')).limit(1);
      if (integration) activeUserId = integration.userId;
    }

    if (!activeUserId) throw new Error(`No user found for Calendly URI: ${eventOwnerUri}`);

    const userId = activeUserId; // Fixed for closure
    const attendeeEmail = invitee.email;
    const tracking = (payload as any).tracking || {};
    const leadIdFromTracking = tracking.utm_content || tracking.salesforce_uuid;

    // START TRANSACTION: Ensure booking, lead update, and deal sync happen as ONE unit
    await db.transaction(async (tx) => {
      const [booking] = await tx.insert(calendarEvents).values({
        userId,
        leadId: leadIdFromTracking || null,
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

      // Update Lead status to 'booked'
      const [updatedLead] = await tx.update(leads)
        .set({ 
          status: 'booked', 
          updatedAt: new Date(),
          metadata: booking ? sql`jsonb_set(coalesce(${leads.metadata}, '{}'::jsonb), '{lastBooking}', ${JSON.stringify(booking)}::jsonb)` : sql`${leads.metadata}`
        })
        .where(
          leadIdFromTracking 
            ? eq(leads.id, leadIdFromTracking) 
            : and(eq(leads.userId, userId), eq(leads.email, attendeeEmail))
        )
        .returning();

      if (updatedLead) {
        // Sync booking to lead if it wasn't already
        if (!booking.leadId) {
          await tx.update(calendarEvents).set({ leadId: updatedLead.id }).where(eq(calendarEvents.id, booking.id));
        }

        // Deal Pipeline Sync
        const [existingDeal] = await tx.select().from(deals).where(eq(deals.leadId, updatedLead.id)).limit(1);
        if (existingDeal) {
          await tx.update(deals).set({ status: 'closed_won', convertedAt: new Date() }).where(eq(deals.id, existingDeal.id));
        } else {
          const [u] = await tx.select({ offerValue: users.offerValue }).from(users).where(eq(users.id, userId)).limit(1);
          await tx.insert(deals).values({
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
      }
    });

    // POST-TRANSACTION: Non-critical operations (Circuit Breaker Pattern)
    const [freshLead] = await db.select().from(leads).where(
        leadIdFromTracking ? eq(leads.id, leadIdFromTracking) : and(eq(leads.userId, userId), eq(leads.email, attendeeEmail))
    ).limit(1);

    if (freshLead) {
        await storage.clearFollowUpQueue(freshLead.id);
        wsSync.notifyLeadsUpdated(userId, { event: 'UPDATE', leadId: freshLead.id });
        wsSync.notifyDealsUpdated(userId, { event: 'UPDATE' });

        // AI Circuit Breaker: Run AI SDR Analysis in a separate try/catch
        // If AI is down, we still finished the booking successfully
        try {
            console.log(`[Calendly Worker] 🧠 Triggering AI SDR analysis for lead ${freshLead.id}...`);
            const { generateLeadIntelligenceDashboard } = await import("../context/lead-intelligence.js");
            const leadMessages = await db.select().from(sharedMessages).where(eq(sharedMessages.leadId, freshLead.id));
            
            const intelligence = await generateLeadIntelligenceDashboard(freshLead as any, leadMessages as any);
            
            await db.insert(notifications).values({
                userId,
                type: 'insight',
                title: 'Post-Call / Booking Insight 🧠',
                message: `AI Insight for ${freshLead.name}: ${(intelligence as any)?.summary || 'Review lead details.'}`,
                metadata: { leadId: freshLead.id, insight: (intelligence as any)?.summary }
            });
        } catch (aiErr) {
            console.warn(`[Calendly Worker] ⚠️ AI Circuit Breaker Triggered: SDR Analysis failed for ${freshLead.id}`, aiErr);
            // We don't report this to Admin Panel as a "Fatal" error because the booking still worked.
        }
    }

    // Success notifications
    await db.insert(notifications).values({
      userId,
      type: 'conversion',
      title: 'New Meeting Booked! 📅',
      message: `${invitee.name} just scheduled a meeting via Calendly.`,
      metadata: { leadId: freshLead?.id, attendeeEmail }
    });

    wsSync.broadcastToUser(userId, {
      type: 'CALENDAR_UPDATED',
      payload: { attendeeEmail, status: 'scheduled' }
    });

  } catch (error) {
    await reportProcessingError(activeUserId, error, 'handleMeetingBooked', { event: event.resource.uri });
    throw error; // Rethrow to let BullMQ retry
  }
}

/**
 * Handle when a meeting is cancelled
 */
async function handleMeetingCancelled(event: CalendlyWebhookEvent): Promise<void> {
  let activeUserId: string | null = null;
  try {
    const scheduledEvent = event.payload.scheduled_event || event.payload.event;
    if (!scheduledEvent) return;

    await db.transaction(async (tx) => {
      const [booking] = await tx.update(calendarEvents)
        .set({ status: 'cancelled' })
        .where(eq(calendarEvents.externalId, scheduledEvent.uri))
        .returning();

      if (booking) {
        activeUserId = booking.userId;
        const [updatedLead] = await tx.update(leads)
          .set({ status: 'contacted', updatedAt: new Date() })
          .where(and(eq(leads.userId, booking.userId), eq(leads.email, booking.attendeeEmail || '')))
          .returning();

        if (updatedLead) {
          // Notify system
          wsSync.notifyLeadsUpdated(booking.userId, { event: 'UPDATE', leadId: updatedLead.id });
          await tx.insert(notifications).values({
            userId: booking.userId,
            type: 'system',
            title: 'Meeting Cancelled 📅',
            message: `${booking.attendeeName || booking.attendeeEmail} cancelled their meeting.`,
            metadata: { leadId: updatedLead.id, attendeeEmail: booking.attendeeEmail }
          });
        }
      }
    });

  } catch (error) {
    await reportProcessingError(activeUserId, error, 'handleMeetingCancelled');
    throw error;
  }
}

/**
 * Handle when an invitee does not show up
 */
async function handleMeetingNoShow(event: CalendlyWebhookEvent): Promise<void> {
  let activeUserId: string | null = null;
  try {
    const payload = event.payload as any;
    const eventUri = payload.event || payload.scheduled_event?.uri || payload.scheduled_event;

    if (typeof eventUri === 'string' && eventUri.startsWith('https://api.calendly.com')) {
      await db.transaction(async (tx) => {
        const [booking] = await tx.update(calendarEvents)
          .set({ status: 'no_show' })
          .where(eq(calendarEvents.externalId, eventUri))
          .returning();

        if (booking) {
          activeUserId = booking.userId;
          const [updatedLead] = await tx.update(leads)
            .set({ status: 'no_show', updatedAt: new Date() })
            .where(and(eq(leads.userId, booking.userId), eq(leads.email, booking.attendeeEmail || '')))
            .returning();

          if (updatedLead) {
            wsSync.notifyLeadsUpdated(booking.userId, { event: 'UPDATE', leadId: updatedLead.id });
            
            // Post-NoShow Automation (Circuit Breaker)
            try {
              const { scheduleInitialFollowUp } = await import("../core/follow-up-worker.js");
              await scheduleInitialFollowUp(booking.userId, updatedLead.id, 'email');
            } catch (fErr) {
              console.warn('[Calendly Worker] No-Show Follow-up Circuit Breaker triggered:', fErr);
            }
          }
        }
      });
    }
  } catch (error) {
    await reportProcessingError(activeUserId, error, 'handleMeetingNoShow');
    throw error;
  }
}
