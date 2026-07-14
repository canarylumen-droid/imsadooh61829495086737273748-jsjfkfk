import { db } from '@shared/lib/db/db.js';
import { users, integrations, calendarEvents, leads } from '@audnix/shared';
import { eq, and, desc, sql } from 'drizzle-orm';
import { calendlyService } from './calendly-service.js';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';

/**
 * Automatic Calendly sync worker
 * Polls Calendly API for all users with connected Calendly accounts
 * Syncs events to database without requiring webhooks (free plan compatible)
 */
export async function syncCalendlyEventsForAllUsers() {
  console.log('[Calendly Sync] Starting automatic sync for all users...');
  
  try {
    // Get all users with connected Calendly
    const connectedIntegrations = await db
      .select({
        userId: integrations.userId,
        connected: integrations.connected,
      })
      .from(integrations)
      .where(eq(integrations.provider, 'calendly'));

    if (connectedIntegrations.length === 0) {
      console.log('[Calendly Sync] No users with Calendly connected');
      return;
    }

    let totalSynced = 0;
    for (const integration of connectedIntegrations) {
      if (!integration.connected) continue;

      try {
        const synced = await syncCalendlyEventsForUser(integration.userId);
        totalSynced += synced;
      } catch (err) {
        console.error(`[Calendly Sync] Failed to sync for user ${integration.userId}:`, err);
      }
    }

    console.log(`[Calendly Sync] Completed. Synced ${totalSynced} new events across ${connectedIntegrations.length} users`);
  } catch (error) {
    console.error('[Calendly Sync] Fatal error:', error);
  }
}

/**
 * Sync Calendly events for a single user
 */
async function syncCalendlyEventsForUser(userId: string): Promise<number> {
  console.log(`[Calendly Sync] Syncing events for user ${userId}...`);

  // Fetch events from Calendly API (last 7 days to next 30 days)
  const minStartTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const maxStartTime = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const events = await calendlyService.listScheduledEvents(userId, minStartTime, maxStartTime);

  if (events.length === 0) {
    console.log(`[Calendly Sync] No events found for user ${userId}`);
    return 0;
  }

  let syncedCount = 0;
  for (const event of events) {
    const { uri, start_time, end_time, name, location, status } = event;
    const invitee = event.event_invitees?.[0];

    if (!invitee) continue;

    // Check if already exists
    const existing = await db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.externalId, uri))
      .limit(1);

    if (existing.length === 0) {
      // Find lead by email
      let [lead] = await db
        .select()
        .from(leads)
        .where(and(eq(leads.userId, userId), eq(leads.email, invitee.email)))
        .limit(1);

      // Fallback: match by name if email didn't match (e.g. personal email used)
      if (!lead && invitee.name) {
        [lead] = await db
          .select()
          .from(leads)
          .where(and(
            eq(leads.userId, userId),
            sql`LOWER(${leads.name}) = LOWER(${invitee.name})`
          ))
          .limit(1);

        if (lead) {
          console.log(`[Calendly Sync] Matched lead by name "${invitee.name}" for user ${userId}`);
        }
      }

      const [booking] = await db.insert(calendarEvents).values({
        userId,
        leadId: lead?.id || null,
        provider: 'calendly',
        externalId: uri,
        title: name || 'Meeting',
        startTime: new Date(start_time),
        endTime: new Date(end_time),
        meetingUrl: location?.location || null,
        attendeeEmail: invitee.email,
        attendeeName: `${invitee.name || ''}`.trim(),
        status: status === 'active' ? 'scheduled' : status,
        isAiBooked: false
      }).returning();

      syncedCount++;

      // Update lead status if lead found
      if (lead) {
        await db.update(leads)
          .set({ status: 'booked', updatedAt: new Date() })
          .where(eq(leads.id, lead.id));

        // Notify frontend
        wsSync.notifyLeadsUpdated(userId, { event: 'UPDATE', leadId: lead.id });
      }

      // Notify calendar update
      wsSync.broadcastToUser(userId, {
        type: 'CALENDAR_UPDATED',
        payload: { attendeeEmail: invitee.email, status: 'scheduled' }
      });

      console.log(`[Calendly Sync] Synced new event: ${name} for ${invitee.email}`);
    }
  }

  console.log(`[Calendly Sync] Synced ${syncedCount} new events for user ${userId}`);
  return syncedCount;
}

/**
 * Start automatic sync interval
 * Runs every 10 minutes
 */
let syncInterval: NodeJS.Timeout | null = null;

export function startAutomaticCalendlySync() {
  if (syncInterval) {
    console.log('[Calendly Sync] Already running');
    return;
  }

  console.log('[Calendly Sync] Starting automatic sync (every 10 minutes)...');
  
  // Run immediately on start
  syncCalendlyEventsForAllUsers();
  
  // Then run every 5 minutes
  syncInterval = setInterval(() => {
    syncCalendlyEventsForAllUsers();
  }, 5 * 60 * 1000); // 5 minutes
}

export function stopAutomaticCalendlySync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log('[Calendly Sync] Stopped automatic sync');
  }
}
