/**
 * Pool Health Monitor
 * Evaluates pool health every 5 minutes and flips mailboxes between active/paused.
 */

import { db } from '../db/warmup-db.js';
import { eq, and, sql, isNull } from 'drizzle-orm';
import { warmupMailboxes, warmupPoolState, organizations } from '@audnix/shared';
import { WARMUP_CONFIG } from '../config/warmup-config.js';
import type { PoolType } from '../types/warmup-types.js';

export class PoolHealthMonitor {
  async evaluate(): Promise<void> {
    console.log('[Warmup][PoolHealth] Evaluating pool health...');

    // 1. Global pool
    await this.evaluateGlobalPool();

    // 2. Per-organization enterprise pools
    const orgs = await db
      .selectDistinct({ organizationId: warmupMailboxes.organizationId })
      .from(warmupMailboxes)
      .where(eq(warmupMailboxes.poolType, 'enterprise'));

    for (const org of orgs) {
      if (org.organizationId) {
        await this.evaluateEnterprisePool(org.organizationId);
      }
    }

    console.log('[Warmup][PoolHealth] Evaluation complete.');
  }

  private async evaluateGlobalPool(): Promise<void> {
    const globalActiveCount = await this.getActiveCount('global', null);
    const globalTotalCount = await this.getTotalCount('global', null);
    const isHealthy = globalActiveCount >= WARMUP_CONFIG.GLOBAL_POOL_MINIMUM;

    await this.upsertPoolState('global', null, globalTotalCount, globalActiveCount, isHealthy);

    if (isHealthy) {
      await this.activatePausedMailboxes(null, 'global');
    } else {
      await this.pauseMailboxes(null, 'global', 'empty_global_pool');
    }
  }

  private async evaluateEnterprisePool(organizationId: string): Promise<void> {
    const activeCount = await this.getActiveCount('enterprise', organizationId);
    const totalCount = await this.getTotalCount('enterprise', organizationId);
    const isHealthy = activeCount >= WARMUP_CONFIG.ENTERPRISE_POOL_MINIMUM;

    await this.upsertPoolState('enterprise', organizationId, totalCount, activeCount, isHealthy);

    if (isHealthy) {
      await this.activatePausedMailboxes(organizationId, 'enterprise');
    } else {
      await this.pauseMailboxes(organizationId, 'enterprise', 'single_mailbox_enterprise');
    }
  }

  private async getActiveCount(poolType: PoolType, orgId: string | null): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(warmupMailboxes)
      .where(
        and(
          eq(warmupMailboxes.poolType, poolType),
          eq(warmupMailboxes.status, 'active'),
          orgId ? eq(warmupMailboxes.organizationId, orgId) : isNull(warmupMailboxes.organizationId)
        )
      );
    return result[0]?.count ?? 0;
  }

  private async getTotalCount(poolType: PoolType, orgId: string | null): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(warmupMailboxes)
      .where(
        and(
          eq(warmupMailboxes.poolType, poolType),
          orgId ? eq(warmupMailboxes.organizationId, orgId) : isNull(warmupMailboxes.organizationId)
        )
      );
    return result[0]?.count ?? 0;
  }

  private async upsertPoolState(
    poolType: PoolType,
    orgId: string | null,
    total: number,
    active: number,
    healthy: boolean
  ): Promise<void> {
    const paused = total - active;

    const existing = await db
      .select()
      .from(warmupPoolState)
      .where(
        and(
          eq(warmupPoolState.poolType, poolType),
          orgId
            ? eq(warmupPoolState.organizationId, orgId)
            : isNull(warmupPoolState.organizationId)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(warmupPoolState)
        .set({
          totalMailboxes: total,
          activeMailboxes: active,
          pausedMailboxes: paused,
          isHealthy: healthy,
          lastSnapshotAt: new Date(),
        })
        .where(eq(warmupPoolState.id, existing[0].id));
    } else {
      await db.insert(warmupPoolState).values({
        poolType,
        organizationId: orgId,
        totalMailboxes: total,
        activeMailboxes: active,
        pausedMailboxes: paused,
        isHealthy: healthy,
        lastSnapshotAt: new Date(),
      });
    }
  }

  private async activatePausedMailboxes(orgId: string | null, poolType: PoolType): Promise<void> {
    // [CRITICAL] Only reactivate mailboxes paused for POOL reasons.
    // Never reactivate mailboxes paused for operational reasons (daily limits,
    // IMAP/SMTP errors, empty_pool_defensive) — those must be resolved by
    // their respective handlers (midnight reset, error recovery, etc.).
    const result = await db
      .update(warmupMailboxes)
      .set({ status: 'active', pauseReason: null })
      .where(
        and(
          eq(warmupMailboxes.status, 'paused'),
          eq(warmupMailboxes.poolType, poolType),
          sql`${warmupMailboxes.pauseReason} IN ('empty_global_pool', 'single_mailbox_enterprise')`,
          orgId
            ? eq(warmupMailboxes.organizationId, orgId)
            : isNull(warmupMailboxes.organizationId)
        )
      )
      .returning();

    if (result.length > 0) {
      console.log(
        `[Warmup][PoolHealth] Activated ${result.length} ${poolType} mailbox(es)` +
          (orgId ? ` for org ${orgId}` : '')
      );
    }
  }

  private async pauseMailboxes(
    orgId: string | null,
    poolType: PoolType,
    reason: string
  ): Promise<void> {
    const result = await db
      .update(warmupMailboxes)
      .set({ status: 'paused', pauseReason: reason })
      .where(
        and(
          eq(warmupMailboxes.status, 'active'),
          eq(warmupMailboxes.poolType, poolType),
          orgId
            ? eq(warmupMailboxes.organizationId, orgId)
            : isNull(warmupMailboxes.organizationId)
        )
      )
      .returning();

    if (result.length > 0) {
      console.log(
        `[Warmup][PoolHealth] Paused ${result.length} ${poolType} mailbox(es)` +
          (orgId ? ` for org ${orgId}` : '') +
          ` — reason: ${reason}`
      );
    }
  }
}

export const poolHealthMonitor = new PoolHealthMonitor();
