import { createQueue } from './queue-manager.js';

export interface CalendlyWebhookPayload {
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
      uri?: string;
    };
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
 * The main queue for Calendly booking processing
 */
export const calendlyQueue = createQueue<CalendlyWebhookPayload>('calendly-processing');

/**
 * Enqueue a Calendly booking for background processing
 * Includes idempotency check via jobId (Calendly URI)
 */
export async function enqueueCalendlyBooking(payload: CalendlyWebhookPayload) {
  const eventUri = payload.payload.scheduled_event?.uri || payload.resource.uri;
  const inviteeUri = payload.payload.invitee?.uri;
  
  if (!eventUri) throw new Error('No URI found in Calendly payload');

  const jobId = `calendly-${eventUri}-${inviteeUri || 'global'}`;

  return await calendlyQueue.add('process-calendly-booking', payload, {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    jobId, // Native BullMQ idempotency
    removeOnComplete: true
  });
}
