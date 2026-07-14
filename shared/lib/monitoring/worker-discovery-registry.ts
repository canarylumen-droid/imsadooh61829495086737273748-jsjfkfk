/**
 * ─── WORKER DISCOVERY REGISTRY ────────────────────────────────────────────────
 *
 * Every ECS Fargate pod registers its ECS_TASK_ID and claims mailboxes.
 * Redis Schema:
 *   worker:assignment:{taskId}  →  { integrationIds: string[], lastSeen: number }
 *   mailbox:owner:{integrationId}  →  { taskId, claimedAt }
 *
 * Heartbeat: every 30s, TTL 90s on worker:assignment keys.
 * On deregister (SIGTERM), the pod releases all claimed mailboxes.
 *
 * Used by:
 *   - ImapIdleManager → claim mailbox on connection open
 *   - MailboxReassignmentWatchdog → detect dead workers, reassign orphaned mailboxes
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { getRedisClient } from '@shared/lib/redis/redis.js';
import { createStructuredLogger } from './structured-logger.js';

const log = createStructuredLogger('WORKER-REGISTRY');

function getTaskId(): string {
  return process.env.ECS_TASK_ID
    || process.env.RAILWAY_REPLICA_ID
    || process.env.HOSTNAME
    || 'local-' + process.pid;
}

export interface WorkerAssignment {
  taskId: string;
  role: string;
  integrationIds: string[];
  lastSeen: number;
}

export interface MailboxOwner {
  taskId: string;
  claimedAt: number;
}

export class WorkerDiscoveryRegistry {
  private taskId: string;
  private readonly role: string;
  private heartbeatInterval?: NodeJS.Timeout;
  private readonly HEARTBEAT_MS = 30_000;
  private readonly TTL_SECONDS = 90;

  constructor(role: string) {
    this.taskId = getTaskId();
    this.role = role;
  }

  /**
   * Resolve the true ECS task ID from the v4 metadata endpoint.
   * On Fargate, HOSTNAME is already the task ID, but this is the canonical source.
   */
  private async resolveEcsTaskId(): Promise<void> {
    const metadataUri = process.env.ECS_CONTAINER_METADATA_URI_V4;
    if (!metadataUri) return;
    try {
      const res = await fetch(`${metadataUri}/task`);
      const data = await res.json() as any;
      const arn = data?.TaskARN || data?.TaskArn;
      if (arn) {
        const segments = arn.split('/');
        const realId = segments[segments.length - 1];
        if (realId) {
          this.taskId = realId;
          log.info('Resolved ECS task ID from metadata endpoint', { taskId: this.taskId });
        }
      }
    } catch (_e) {
      // Fallback to HOSTNAME / constructor default
    }
  }

  /**
   * Register this worker in Redis. Called once on boot.
   */
  async register(): Promise<void> {
    await this.resolveEcsTaskId();

    const redis = await getRedisClient();
    if (!redis) {
      log.error('Redis unavailable — cannot register worker', { taskId: this.taskId });
      return;
    }

    const assignment: WorkerAssignment = {
      taskId: this.taskId,
      role: this.role,
      integrationIds: [],
      lastSeen: Date.now(),
    };

    await redis.setEx(
      `worker:assignment:${this.taskId}`,
      this.TTL_SECONDS,
      JSON.stringify(assignment)
    );

    log.info('Worker registered', { taskId: this.taskId, role: this.role });

    // Start heartbeat
    this.heartbeatInterval = setInterval(() => this.heartbeat(), this.HEARTBEAT_MS);
  }

  /**
   * Claim ownership of a mailbox (integrationId).
   * Returns true if claim succeeded, false if another worker already owns it.
   */
  async claimMailbox(integrationId: string): Promise<boolean> {
    const redis = await getRedisClient();
    if (!redis) return false;

    const ownerKey = `mailbox:owner:${integrationId}`;
    const existing = await redis.get(ownerKey);

    if (existing) {
      const owner: MailboxOwner = JSON.parse(existing);
      // If same worker, just refresh
      if (owner.taskId === this.taskId) {
        await redis.setEx(ownerKey, this.TTL_SECONDS, JSON.stringify({ taskId: this.taskId, claimedAt: Date.now() }));
        return true;
      }
      // Another worker owns it — check if it's still alive
      const workerAlive = await redis.get(`worker:assignment:${owner.taskId}`);
      if (workerAlive) {
        return false; // Still alive, cannot steal
      }
      // Owner is dead — steal it
      log.warn('Stealing mailbox from dead worker', { integrationId, deadTaskId: owner.taskId, newTaskId: this.taskId });
    }

    // Claim the mailbox
    await redis.setEx(ownerKey, this.TTL_SECONDS, JSON.stringify({ taskId: this.taskId, claimedAt: Date.now() }));

    // Add to our assignment set
    const raw = await redis.get(`worker:assignment:${this.taskId}`);
    if (raw) {
      const assignment: WorkerAssignment = JSON.parse(raw);
      if (!assignment.integrationIds.includes(integrationId)) {
        assignment.integrationIds.push(integrationId);
        assignment.lastSeen = Date.now();
        await redis.setEx(`worker:assignment:${this.taskId}`, this.TTL_SECONDS, JSON.stringify(assignment));
      }
    }

    return true;
  }

  /**
   * Release a mailbox (e.g., on disconnect or shutdown).
   */
  async releaseMailbox(integrationId: string): Promise<void> {
    const redis = await getRedisClient();
    if (!redis) return;

    const ownerKey = `mailbox:owner:${integrationId}`;
    const existing = await redis.get(ownerKey);
    if (existing) {
      const owner: MailboxOwner = JSON.parse(existing);
      if (owner.taskId === this.taskId) {
        await redis.del(ownerKey);
      }
    }

    const raw = await redis.get(`worker:assignment:${this.taskId}`);
    if (raw) {
      const assignment: WorkerAssignment = JSON.parse(raw);
      assignment.integrationIds = assignment.integrationIds.filter(id => id !== integrationId);
      assignment.lastSeen = Date.now();
      await redis.setEx(`worker:assignment:${this.taskId}`, this.TTL_SECONDS, JSON.stringify(assignment));
    }
  }

  /**
   * Release ALL mailboxes on graceful shutdown.
   */
  async releaseAll(): Promise<void> {
    const redis = await getRedisClient();
    if (!redis) return;

    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);

    const raw = await redis.get(`worker:assignment:${this.taskId}`);
    if (raw) {
      const assignment: WorkerAssignment = JSON.parse(raw);
      for (const integrationId of assignment.integrationIds) {
        await redis.del(`mailbox:owner:${integrationId}`);
      }
      await redis.del(`worker:assignment:${this.taskId}`);
      log.info('Released all mailboxes on shutdown', { taskId: this.taskId, count: assignment.integrationIds.length });
    }
  }

  /**
   * Heartbeat: refresh TTL on our assignment record.
   */
  private async heartbeat(): Promise<void> {
    const redis = await getRedisClient();
    if (!redis) return;

    try {
      const raw = await redis.get(`worker:assignment:${this.taskId}`);
      if (!raw) return;

      const assignment: WorkerAssignment = JSON.parse(raw);
      assignment.lastSeen = Date.now();

      // Refresh TTL on assignment key
      await redis.setEx(`worker:assignment:${this.taskId}`, this.TTL_SECONDS, JSON.stringify(assignment));

      // Refresh TTL on each mailbox we own
      for (const integrationId of assignment.integrationIds) {
        const ownerKey = `mailbox:owner:${integrationId}`;
        const ownerRaw = await redis.get(ownerKey);
        if (ownerRaw) {
          const owner: MailboxOwner = JSON.parse(ownerRaw);
          if (owner.taskId === this.taskId) {
            await redis.expire(ownerKey, this.TTL_SECONDS);
          }
        }
      }
    } catch (err: any) {
      log.error('Worker heartbeat failed', { taskId: this.taskId, error: err.message });
    }
  }

  getTaskId(): string {
    return this.taskId;
  }
}
