/**
 * Email Verification + Routing Queue System
 *
 * Architecture:
 *   [Lead Upload]
 *       ↓
 *   [BullMQ: verification-queue] → Workers (50 concurrent SMTP checks)
 *       ↓
 *   [Redis: verify:{hash} → result TTL 7d]
 *       ↓
 *   [BullMQ: routing-queue] → Workers → Assign mailboxes
 *       ↓
 *   [Postgres: campaignLeads.integrationId set] + [Redis: mailbox:load:{id}:{date}]
 *       ↓
 *   [Outreach queue ready]
 *
 * Live re-routing:
 *   Redis pub/sub on channel "mailbox:event" triggers rerouteAffectedLeads().
 */

import { Queue, Worker, type Job } from 'bullmq';
import { redisConnection, hasRedis } from './redis-config.js';
import { createHash } from 'crypto';
import { db } from '@shared/lib/db/db.js';
import { campaignLeads, leads, integrations } from '@audnix/shared';
import { eq, and, isNull, or, inArray } from 'drizzle-orm';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';

// ─── Redis Key Schema ─────────────────────────────────────────────────────────
// verify:{sha256(email)}                       → VerificationResult (TTL: 7d)
// mailbox:load:{integrationId}:{YYYY-MM-DD}    → sent count (TTL: 25h)
// routing:lock:{campaignLeadId}                → '1' (TTL: 30s, idempotency)
// lead:assign:{campaignLeadId}                 → assignment JSON (TTL: 7d)
// leads:fallback:domain:{campaignId}:{domain}  → Set<campaignLeadId> (TTL: 7d)
// leads:fallback:family:{campaignId}:{family}  → Set<campaignLeadId> (TTL: 7d)

const KEY_TTL_VERIFICATION = 7 * 24 * 60 * 60;
const KEY_TTL_MAILBOX_LOAD  = 25 * 60 * 60;

function emailKey(email: string): string {
  return `verify:${createHash('sha256').update(email.toLowerCase().trim()).digest('hex')}`;
}

function mailboxLoadKey(integrationId: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return `mailbox:load:${integrationId}:${date}`;
}

function routingLockKey(campaignLeadId: string): string {
  return `routing:lock:${campaignLeadId}`;
}

// ─── Job type definitions ─────────────────────────────────────────────────────

export interface VerifyEmailJobData {
  email: string;
  campaignLeadId: string;
  campaignId: string;
  userId: string;
}

export interface RouteLeadJobData {
  campaignLeadId: string;
  email: string;
  campaignId: string;
  userId: string;
  verificationStatus: 'valid' | 'risky' | 'invalid' | 'unknown';
}

export interface RerouteMailboxJobData {
  failedMailboxId: string;
  campaignId: string;
  userId: string;
}

export interface NewMailboxJobData {
  type: 'new_mailbox_connect';
  newMailboxId: string;
  newMailboxProviderFamily: string;
  candidateLeadIds: string[];
  campaignId: string;
  userId: string;
}

type VerificationQueueJobData = VerifyEmailJobData;
type RoutingQueueJobData      = RouteLeadJobData | RerouteMailboxJobData;
type ReassignQueueJobData     = NewMailboxJobData | RerouteMailboxJobData;

// ─── Queue instances ──────────────────────────────────────────────────────────

export const verificationQueue = hasRedis
  ? new Queue<VerificationQueueJobData>('email-verification', {
      connection: redisConnection as any,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 2000 },
        removeOnFail: { count: 500, age: 24 * 3600 },
      },
    })
  : null;

export const routingQueue = hasRedis
  ? new Queue<RoutingQueueJobData>('email-routing', {
      connection: redisConnection as any,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 3_000 },
        removeOnComplete: { count: 2000 },
        removeOnFail: { count: 500, age: 24 * 3600 },
      },
    })
  : null;

// Dedicated queue for reassignment events (new mailbox connect / mailbox failure)
export const reassignQueue = hasRedis
  ? new Queue<ReassignQueueJobData>('email-reassign', {
      connection: redisConnection as any,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 200, age: 24 * 3600 },
      },
    })
  : null;

// ─── Public API ───────────────────────────────────────────────────────────────

export class VerificationRoutingManager {

  /**
   * Enqueue a full batch of leads for verification then routing.
   * Deduplicates via Redis: skips leads already verified within 7 days.
   * Called when a campaign is created or new leads are imported.
   */
  async enqueueLeads(
    userId: string,
    campaignId: string,
    leadRows: Array<{ campaignLeadId: string; email: string }>
  ): Promise<void> {
    if (!leadRows.length) return;
    console.log(`[VerifyRoute] 📥 Enqueueing ${leadRows.length} leads for campaign ${campaignId}`);

    const jobs = [];
    for (const { campaignLeadId, email } of leadRows) {
      const emailNorm = email.toLowerCase().trim();

      // Dedup check: if cached result exists in Redis, skip verification and go straight to routing
      if (redisConnection) {
        const cached = await redisConnection.get(emailKey(emailNorm));
        if (cached) {
          const { status } = JSON.parse(cached) as { status: string };
          if (status !== 'invalid') {
            jobs.push({ queueFn: () => this.enqueueRouting(campaignLeadId, emailNorm, campaignId, userId, status as any) });
          } else {
            await this.markLeadInvalid(campaignLeadId, 'Cached: invalid email');
          }
          continue;
        }
      }

      // Fresh lead: push to verification queue
      if (verificationQueue) {
        await verificationQueue.add(
          `verify:${campaignLeadId}`,
          { email: emailNorm, campaignLeadId, campaignId, userId },
          { jobId: `verify:${campaignLeadId}`, priority: 5 }
        );
      } else {
        // No Redis — run inline (dev mode)
        await processVerification({ email: emailNorm, campaignLeadId, campaignId, userId });
      }
    }

    // Drain the routing fast-path jobs
    await Promise.all(jobs.map(j => j.queueFn()));
    console.log(`[VerifyRoute] ✅ Batch enqueued for campaign ${campaignId}`);
  }

  /**
   * Re-route all leads from a failed mailbox to healthy alternatives.
   * Triggered by mailbox health events (connect/disconnect/flagged).
   * Target: complete within 30 seconds.
   */
  async triggerReroute(userId: string, campaignId: string, failedMailboxId: string): Promise<void> {
    console.log(`[VerifyRoute] 🔄 Triggering re-route for failed mailbox ${failedMailboxId}`);

    if (routingQueue) {
      await routingQueue.add(
        `reroute:${failedMailboxId}:${campaignId}`,
        { failedMailboxId, campaignId, userId },
        { jobId: `reroute:${failedMailboxId}:${campaignId}`, priority: 0 } // P0 — highest priority
      );
    } else {
      await processReroute({ failedMailboxId, campaignId, userId });
    }
  }

  /** Push one lead directly to routing queue (after verification or cache hit). */
  async enqueueRouting(
    campaignLeadId: string,
    email: string,
    campaignId: string,
    userId: string,
    verificationStatus: 'valid' | 'risky' | 'invalid' | 'unknown'
  ): Promise<void> {
    if (routingQueue) {
      await routingQueue.add(
        `route:${campaignLeadId}`,
        { campaignLeadId, email, campaignId, userId, verificationStatus },
        { jobId: `route:${campaignLeadId}`, priority: 3 }
      );
    } else {
      await processRouting({ campaignLeadId, email, campaignId, userId, verificationStatus });
    }
  }

  private async markLeadInvalid(campaignLeadId: string, reason: string): Promise<void> {
    await db.update(campaignLeads)
      .set({ status: 'failed', error: reason })
      .where(eq(campaignLeads.id, campaignLeadId));
  }
}

export const verificationRoutingManager = new VerificationRoutingManager();

// ─── Verification Worker ──────────────────────────────────────────────────────

async function processVerification(data: VerifyEmailJobData): Promise<void> {
  const { email, campaignLeadId, campaignId, userId } = data;

  let status: 'valid' | 'risky' | 'invalid' | 'unknown' = 'unknown';
  let details: Record<string, any> = {};

  try {
    const { emailVerifier } = await import('@services/email-service/src/email/email-verifier.js');
    const result = await emailVerifier.verifySingle(email);
    status = result.status;
    details = result.verification_details as any;
  } catch (err: any) {
    console.warn(`[VerifyWorker] SMTP check failed for ${email}:`, err.message);
    status = 'unknown'; // Fail open — do not block outreach for timeouts
  }

  // Persist to Redis cache (7d TTL)
  if (redisConnection) {
    await redisConnection.setex(
      emailKey(email),
      KEY_TTL_VERIFICATION,
      JSON.stringify({ status, details, verifiedAt: new Date().toISOString() })
    );
  }

  // Update lead verification status in Postgres
  await db.update(campaignLeads)
    .set({ metadata: { verificationStatus: status, verificationDetails: details } as any })
    .where(eq(campaignLeads.id, campaignLeadId));

  // Push UI update
  wsSync?.broadcastToUser(userId, {
    type: 'leads_updated',
    payload: { action: 'verification-update', campaignLeadId, status }
  });

  if (status === 'invalid') {
    await db.update(campaignLeads)
      .set({ status: 'failed', error: 'Email failed verification: invalid' })
      .where(eq(campaignLeads.id, campaignLeadId));
    console.log(`[VerifyWorker] ❌ Skipped invalid email: ${email}`);
    return;
  }

  // Hand off to routing queue
  await verificationRoutingManager.enqueueRouting(campaignLeadId, email, campaignId, userId, status);
}

// ─── Routing Worker ───────────────────────────────────────────────────────────

async function processRouting(data: RouteLeadJobData): Promise<void> {
  const { campaignLeadId, email, campaignId, userId, verificationStatus } = data;

  // Idempotency lock (30s TTL)
  if (redisConnection) {
    const lockKey = routingLockKey(campaignLeadId);
    const acquired = await redisConnection.set(lockKey, '1', 'EX', 30, 'NX');
    if (!acquired) {
      console.log(`[RoutingWorker] 🔒 Lock exists for ${campaignLeadId} — skipping duplicate`);
      return;
    }
  }

  try {
    const { routingEngine } = await import('@services/email-service/src/email/routing-engine.js');

    // The routing engine needs all leads for the campaign to do proper load balancing.
    // For single-lead routing, we wrap it in the same interface.
    const assignments = await routingEngine.assignLeads(userId, [email]);
    const assignment = assignments[0];

    if (!assignment) {
      console.warn(`[RoutingWorker] No mailbox found for ${email} — leaving unassigned`);
      return;
    }

    // Resolve mailbox ID — routing engine now returns assigned_mailbox_id directly
    const matchedMailbox = assignment.assigned_mailbox_id
      ? { id: assignment.assigned_mailbox_id }
      : null;

    // Write assignment to Postgres
    await db.update(campaignLeads)
      .set({
        integrationId: matchedMailbox?.id ?? null,
        status: 'pending',
        metadata: {
          verificationStatus,
          routingReason: assignment.reason,
          matchType: assignment.match_type,
          matchScore: assignment.match_score,
          providerDetected: assignment.provider_detected,
        } as any,
      })
      .where(eq(campaignLeads.id, campaignLeadId));

    // Track mailbox load in Redis
    if (redisConnection && matchedMailbox) {
      const loadKey = mailboxLoadKey(matchedMailbox.id);
      await redisConnection.incr(loadKey);
      await redisConnection.expire(loadKey, KEY_TTL_MAILBOX_LOAD);
    }

    // Push UI update
    wsSync?.broadcastToUser(userId, {
      type: 'leads_updated',
      payload: {
        action: 'assigned',
        campaignLeadId,
        integrationId: matchedMailbox?.id,
        routingReason: assignment.reason,
        matchType: assignment.match_type,
      }
    });

    console.log(`[RoutingWorker] ✅ ${email} → ${assignment.assigned_mailbox} (${assignment.match_type}: ${assignment.reason})`);

  } finally {
    // Always release lock
    if (redisConnection) {
      await redisConnection.del(routingLockKey(campaignLeadId));
    }
  }
}

async function processReroute(data: RerouteMailboxJobData): Promise<void> {
  const { failedMailboxId, campaignId, userId } = data;
  console.log(`[RoutingWorker] 🔄 Re-routing leads from ${failedMailboxId} in campaign ${campaignId}`);

  // Find all pending/queued leads assigned to the failed mailbox
  const affectedLeads = await db
    .select({ id: campaignLeads.id, leadId: campaignLeads.leadId })
    .from(campaignLeads)
    .where(and(
      eq(campaignLeads.campaignId, campaignId),
      eq(campaignLeads.integrationId, failedMailboxId),
      or(eq(campaignLeads.status, 'pending'), eq(campaignLeads.status, 'queued'))
    ));

  if (affectedLeads.length === 0) {
    console.log(`[RoutingWorker] No affected leads for mailbox ${failedMailboxId}`);
    return;
  }

  // Unassign leads so routing engine can reassign
  await db.update(campaignLeads)
    .set({ integrationId: null, status: 'queued' })
    .where(inArray(campaignLeads.id, affectedLeads.map(l => l.id)));

  // Get email addresses for affected leads
  const leadIds = affectedLeads.map(l => l.leadId).filter(Boolean) as string[];
  const { leads: leadsTable } = await import('@audnix/shared');
  const leadEmails = await db
    .select({ id: leadsTable.id, email: leadsTable.email })
    .from(leadsTable)
    .where(inArray(leadsTable.id, leadIds));

  const emailMap = new Map(leadEmails.map(l => [l.id, l.email]));

  // Re-enqueue each for routing
  for (const cl of affectedLeads) {
    const email = emailMap.get(cl.leadId ?? '');
    if (!email) continue;
    await verificationRoutingManager.enqueueRouting(cl.id, email, campaignId, userId, 'valid');
  }

  console.log(`[RoutingWorker] ✅ Re-queued ${affectedLeads.length} leads from mailbox ${failedMailboxId}`);
  wsSync?.broadcastToUser(userId, {
    type: 'campaigns_updated',
    payload: { action: 'reroute-complete', campaignId, count: affectedLeads.length, failedMailboxId }
  });
}

// ─── New Mailbox Connect Handler ─────────────────────────────────────────────

async function processNewMailboxConnect(data: NewMailboxJobData): Promise<void> {
  const { newMailboxId, newMailboxProviderFamily, candidateLeadIds, campaignId, userId } = data;
  if (!candidateLeadIds.length) return;

  console.log(`[ReassignWorker] ⚡ Upgrading ${candidateLeadIds.length} leads to new mailbox ${newMailboxId}`);

  // Fetch current assignments and lead emails from Postgres in one query
  const affectedRows = await db
    .select({ id: campaignLeads.id, leadId: campaignLeads.leadId })
    .from(campaignLeads)
    .where(
      and(
        eq(campaignLeads.campaignId, campaignId),
        inArray(campaignLeads.id, candidateLeadIds),
        or(eq(campaignLeads.status, 'pending'), eq(campaignLeads.status, 'queued'))
      )
    );

  if (!affectedRows.length) return;

  const leadIds = affectedRows.map(r => r.leadId).filter(Boolean) as string[];
  const { leads: leadsTable } = await import('@audnix/shared');
  const leadEmailRows = await db
    .select({ id: leadsTable.id, email: leadsTable.email })
    .from(leadsTable)
    .where(inArray(leadsTable.id, leadIds));
  const emailMap = new Map(leadEmailRows.map(l => [l.id, l.email]));

  // Reassign in Postgres + Redis pipeline
  let reassignedCount = 0;
  for (const row of affectedRows) {
    const email = emailMap.get(row.leadId ?? '');
    if (!email) continue;

    await db.update(campaignLeads)
      .set({
        integrationId: newMailboxId,
        status: 'pending',
        metadata: {
          routingReason: `Upgraded: new ${newMailboxProviderFamily} mailbox connected`,
          matchType: 'provider_family',
          matchScore: 0.8,
          providerDetected: newMailboxProviderFamily,
        } as any,
      })
      .where(eq(campaignLeads.id, row.id));

    // Update Redis assignment
    if (redisConnection) {
      await redisConnection.setex(
        `lead:assign:${row.id}`,
        7 * 24 * 60 * 60,
        JSON.stringify({
          email,
          assigned_mailbox_id: newMailboxId,
          match_type: 'provider_family',
          match_score: 0.8,
          reason: `Upgraded to new ${newMailboxProviderFamily} mailbox`,
        })
      );
    }
    reassignedCount++;
  }

  console.log(`[ReassignWorker] ✅ ${reassignedCount} leads upgraded to mailbox ${newMailboxId}`);
  wsSync?.broadcastToUser(userId, {
    type: 'campaigns_updated',
    payload: {
      action: 'reassign-complete',
      campaignId,
      newMailboxId,
      reassignedCount,
      providerFamily: newMailboxProviderFamily
    }
  });
}

// ─── BullMQ Workers (started in email-service entry point) ───────────────────

export function startVerificationWorker() {
  if (!hasRedis) {
    console.log('[VerifyRoute] Redis unavailable — workers not started (inline fallback active)');
    return null;
  }

  const worker = new Worker<VerifyEmailJobData>(
    'email-verification',
    async (job: Job<VerifyEmailJobData>) => {
      await processVerification(job.data);
    },
    {
      connection: redisConnection as any,
      concurrency: 50,  // 50 parallel SMTP checks
      limiter: {
        max: 100,        // Max 100 jobs per minute per worker (rate-limit SMTP servers)
        duration: 60_000,
      },
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`[VerifyWorker] Job failed: ${job?.id}`, err.message);
  });

  worker.on('completed', (job) => {
    console.log(`[VerifyWorker] ✅ Verified: ${job.data.email}`);
  });

  console.log('[VerifyWorker] 🚀 Verification worker started (concurrency: 50)');
  return worker;
}

export function startRoutingWorker() {
  if (!hasRedis) return null;

  const worker = new Worker<RoutingQueueJobData>(
    'email-routing',
    async (job: Job<RoutingQueueJobData>) => {
      const data = job.data as any;
      if ('failedMailboxId' in data) {
        await processReroute(data as RerouteMailboxJobData);
      } else {
        await processRouting(data as RouteLeadJobData);
      }
    },
    { connection: redisConnection as any, concurrency: 20 }
  );

  worker.on('failed', (job, err) => {
    console.error(`[RoutingWorker] Job failed: ${job?.id}`, err.message);
  });

  console.log('[RoutingWorker] 🚀 Routing worker started (concurrency: 20)');
  return worker;
}

export function startReassignWorker() {
  if (!hasRedis) return null;

  const worker = new Worker<ReassignQueueJobData>(
    'email-reassign',
    async (job: Job<ReassignQueueJobData>) => {
      const data = job.data as any;
      if (data.type === 'new_mailbox_connect') {
        await processNewMailboxConnect(data as NewMailboxJobData);
      } else {
        await processReroute(data as RerouteMailboxJobData);
      }
    },
    {
      connection: redisConnection as any,
      concurrency: 10, // Reassign is high-priority but low-volume
    }
  );

  worker.on('completed', (job) => {
    console.log(`[ReassignWorker] ✅ Done: ${job.id}`);
  });
  worker.on('failed', (job, err) => {
    console.error(`[ReassignWorker] ❌ Failed: ${job?.id}`, err.message);
  });

  console.log('[ReassignWorker] 🚀 Reassign worker started (concurrency: 10)');
  return worker;
}

// ─── Redis Pub/Sub: Live Re-routing Trigger ───────────────────────────────────

/**
 * Subscribe to mailbox health events published by mailbox-health-service.ts.
 * When a mailbox is flagged/disconnected, trigger immediate re-routing.
 *
 * Publishers call:  redis.publish('mailbox:event', JSON.stringify({ event, mailboxId, campaignId, userId }))
 */
export async function startMailboxEventListener() {
  if (!redisConnection) return;

  // BullMQ uses the shared connection for blocking commands.
  // We need a separate subscriber connection for pub/sub.
  const subscriber = redisConnection.duplicate();

  await subscriber.subscribe('mailbox:event');
  subscriber.on('message', async (_channel: string, message: string) => {
    try {
      const { event, mailboxId, campaignId, userId } = JSON.parse(message);
      if (event === 'mailbox:flagged' || event === 'mailbox:disconnected' || event === 'mailbox:daily_limit_hit') {
        console.log(`[MailboxEvent] 📡 Received ${event} for mailbox ${mailboxId} — triggering re-route`);
        // Use reassign-queue (P0) for fast recovery within 30s
        if (reassignQueue) {
          await reassignQueue.add(
            `reroute:${mailboxId}:${campaignId}`,
            { failedMailboxId: mailboxId, campaignId, userId },
            { priority: 0 }
          );
        } else {
          await verificationRoutingManager.triggerReroute(userId, campaignId, mailboxId);
        }
      } else if (event === 'mailbox:connected') {
        // New mailbox — trigger smart upgrade of fallback-assigned leads
        console.log(`[MailboxEvent] 🔌 New mailbox ${mailboxId} — checking for upgrade candidates`);
        const { routingEngine } = await import('@services/email-service/src/email/routing-engine.js');
        await routingEngine.onNewMailboxConnected(userId, campaignId, mailboxId);
      }
    } catch (err: any) {
      console.error('[MailboxEvent] Failed to handle pub/sub event:', err.message);
    }
  });

  console.log('[MailboxEvent] 📡 Subscribed to mailbox:event channel');
}
