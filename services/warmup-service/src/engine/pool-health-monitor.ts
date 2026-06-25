import { db } from '../db/warmup-db.js';
import { eq, and, sql, isNull, inArray, not } from 'drizzle-orm';
import { warmupMailboxes, warmupPoolState, warmupDomainClusters } from '@audnix/shared';
import { WARMUP_CONFIG } from '../config/warmup-config.js';
import { domainClusterEngine } from './domain-cluster.js';
import { anchorEngine } from './anchor-engine.js';
import { seedFleetManager } from './seed-fleet-manager.js';
import type { PoolType } from '../types/warmup-types.js';

export class PoolHealthMonitor {
  async evaluate(): Promise<void> {
    console.log('[Warmup][PoolHealth] Evaluating pool health...');

    await this.evaluateGlobalPool();

    const orgs = await db
      .selectDistinct({ organizationId: warmupMailboxes.organizationId })
      .from(warmupMailboxes)
      .where(eq(warmupMailboxes.poolType, 'enterprise'));

    for (const org of orgs) {
      if (org.organizationId) {
        await this.evaluateEnterprisePool(org.organizationId);
      }
    }

    // Also evaluate enterprise pool for users without an org
    const enterpriseNoOrgCount = await this.getTotalCount('enterprise', null);
    if (enterpriseNoOrgCount > 0) {
      await this.evaluateEnterprisePool(null);
    }

    await this.evaluateDomainClusters();

    await seedFleetManager.rotateExhaustedSeeds();

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

  private async evaluateEnterprisePool(organizationId: string | null): Promise<void> {
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

  private async evaluateDomainClusters(): Promise<void> {
    const clusters = await db.select().from(warmupDomainClusters);

    for (const cluster of clusters) {
      const anchorCount = await this.countActiveAnchors(cluster.registeredDomain, cluster.organizationId);
      const seedCount = await this.countActiveSeeds(cluster.registeredDomain, cluster.organizationId);
      const totalAnchors = anchorCount + seedCount;
      const hasHealthAnchors = totalAnchors >= WARMUP_CONFIG.ANCHORS_PER_DOMAIN;

      if (hasHealthAnchors && !cluster.isHealthy) {
        await anchorEngine.rebalanceDomain(cluster.registeredDomain, cluster.organizationId);
      }

      if (!hasHealthAnchors && cluster.isHealthy) {
        await db
          .update(warmupDomainClusters)
          .set({ isHealthy: false })
          .where(
            and(
              eq(warmupDomainClusters.id, cluster.id),
              not(eq(warmupDomainClusters.mode, 'platform_seed'))
            )
          );
      }
    }
  }

  private async countActiveAnchors(domain: string, orgId: string | null): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(warmupMailboxes)
      .where(
        and(
          eq(warmupMailboxes.registeredDomain, domain),
          eq(warmupMailboxes.anchorRole, 'anchor'),
          eq(warmupMailboxes.status, 'active'),
          orgId ? eq(warmupMailboxes.organizationId, orgId) : isNull(warmupMailboxes.organizationId)
        )
      );
    return result[0]?.count ?? 0;
  }

  private async countActiveSeeds(domain: string, orgId: string | null): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(warmupMailboxes)
      .where(
        and(
          eq(warmupMailboxes.registeredDomain, domain),
          eq(warmupMailboxes.anchorRole, 'seed'),
          eq(warmupMailboxes.status, 'active'),
          orgId ? eq(warmupMailboxes.organizationId, orgId) : isNull(warmupMailboxes.organizationId)
        )
      );
    return result[0]?.count ?? 0;
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