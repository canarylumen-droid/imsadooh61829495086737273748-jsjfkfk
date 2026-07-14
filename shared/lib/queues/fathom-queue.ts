import { createQueue } from './queue-manager.js';

export interface FathomWebhookPayload {
  event: string;
  data: {
    recording_id: string; // The REAL Fathom ID field
    id?: string;         // Fallback
    share_url?: string;  // REAL Fathom share URL
    meeting_title?: string;
    started_at?: string;
    ended_at?: string;
    video_url?: string;
    video_thumbnail?: string;
    attendees?: Array<{ name: string; email: string }>;
    transcript?: string;
    summary?: string;
  }
}

/**
 * The main queue for Fathom meeting processing
 */
export const fathomQueue = createQueue<FathomWebhookPayload>('fathom-processing');

/**
 * Enqueue a Fathom meeting for background processing
 */
export async function enqueueFathomMeeting(payload: FathomWebhookPayload) {
  const meetingId = payload.data.recording_id || payload.data.id;
  if (!meetingId) throw new Error('No recording_id found in Fathom payload');

  return await fathomQueue.add('process-fathom-meeting', payload, {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    jobId: `fathom-${meetingId}`
  });
}
