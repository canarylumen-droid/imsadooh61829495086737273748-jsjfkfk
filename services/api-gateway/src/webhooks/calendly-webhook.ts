import { db } from '@shared/lib/db/db.js';
import { eq } from "drizzle-orm";
import { Request, Response } from "express";
import crypto from "crypto";
import { users } from "@audnix/shared";

interface CalendlyWebhookEvent {
  resource: {
    resource_type: string;
    event_type: string;
    created_at: string;
    uri?: string;
  };
  payload: {
    scheduled_event?: {
      uri: string;
      user?: string;
      event_memberships?: Array<{ user: string }>;
    };
    event?: {
      uri: string;
      user?: string;
      event_memberships?: Array<{ user: string }>;
    };
  };
}

/**
 * Verify Calendly webhook signature
 */
export function verifyCalendlySignature(req: Request, secret: string): boolean {
  const signature = req.headers['calendly-webhook-signature'] as string;
  const timestamp = req.headers['calendly-webhook-timestamp'] as string;

  if (!signature || !timestamp) return false;
  if (!secret) {
    console.error('Calendly Webhook: No signing secret configured - rejecting webhook');
    return false; // Require signing secret, never fail open
  }

  const rawBody = (req as any).rawBody ? (req as any).rawBody.toString() : JSON.stringify(req.body);
  const payload = `${timestamp}.${rawBody}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  const incomingSignature = signature.replace('v1=', '');
  return incomingSignature === expectedSignature;
}

/**
 * Handle Calendly webhook events (Fast-In Gateway Entry)
 */
export async function handleCalendlyWebhook(req: Request, res: Response): Promise<void> {
  try {
    const event: CalendlyWebhookEvent = req.body;

    if (!event.resource || !event.payload) {
      res.status(400).json({ error: 'Invalid webhook payload' });
      return;
    }

    // Identify user owner first to find the correct signing key
    const scheduledEvent = event.payload.scheduled_event || event.payload.event;
    const eventOwnerUri = (scheduledEvent as any)?.event_memberships?.[0]?.user || (scheduledEvent as any)?.user;
    
    let signingSecret = process.env.CALENDLY_WEBHOOK_SECRET || '';

    if (eventOwnerUri) {
      const [user] = await db.select().from(users).where(eq(users.calendlyUserUri, eventOwnerUri)).limit(1);
      if (user) {
        const metadata = (user.metadata || {}) as any;
        if (metadata.calendlySigningKey) {
          signingSecret = metadata.calendlySigningKey;
        }
      }
    }

    // VERIFY SIGNATURE with user-specific secret
    if (!verifyCalendlySignature(req, signingSecret)) {
      console.warn('⚠️ Calendly Webhook: Signature verification failed');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    // Enqueue the event for background processing (Asynchronous Scaling)
    const { enqueueCalendlyBooking } = await import("@shared/lib/queues/calendly-queue.js");
    await enqueueCalendlyBooking(event as any);

    console.log(`[Calendly Webhook] Event ${event.resource.event_type} queued for processing`);
    res.json({ ok: true, queued: true });
  } catch (error: any) {
    console.error('Error handling Calendly webhook:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}

/**
 * Handle Calendly verification ping
 */
export function handleCalendlyVerification(req: Request, res: Response): void {
  res.status(200).json({ ok: true, message: 'Calendly webhook verified' });
}
