import { FathomWebhookPayload } from '@shared/lib/queues/fathom-queue.js';

/**
 * Parses and processes incoming webhook payload from Fathom AI
 * NOTE: Fathom is disabled — call processing is handled by Calendly flow.
 * Meetings are tracked via calendarBookings table instead.
 */
export async function processFathomWebhook(payload: FathomWebhookPayload) {
  console.log(`[Fathom] Webhook received but Fathom integration is disabled. Event: ${payload.event}, ID: ${payload.data.recording_id || payload.data.id}`);
}
