import { db } from '../db/warmup-db.js';
import { eq, and, inArray, isNull, sql, not } from 'drizzle-orm';
import {
  warmupMailboxes, warmupDomainClusters, integrations,
} from '@audnix/shared';
import { WARMUP_CONFIG } from '../config/warmup-config.js';
import { domainClusterEngine } from './domain-cluster.js';
import { seedFleetManager } from './seed-fleet-manager.js';
import { detectProvider, ProviderCategory } from '../lib/provider-utils.js';
import type { DomainAnchorMode, AnchorRole } from '../types/warmup-types.js';

export class AnchorEngine {
  async rebalanceAll(): Promise<void> {
    const clusters = await db.select().from(warmupDomainClusters);

    for (const cluster of clusters) {
      await this.rebalanceDomain(cluster.registeredDomain, cluster.organizationId);
    }
  }

  async rebalanceDomain(domain: string, orgId: string | null): Promise<void> {
    const cluster = await domainClusterEngine.getClusterByDomain(domain, orgId);
    if (!cluster) return;

    const anchorMailboxes = await db
      .select()
      .from(warmupMailboxes)
      .where(
        and(
          eq(warmupMailboxes.registeredDomain, domain),
          eq(warmupMailboxes.anchorRole, 'anchor'),
          eq(warmupMailboxes.status, 'active'),
          orgId ? eq(warmupMailboxes.organizationId, orgId) : isNull(warmupMailboxes.organizationId)
        )
      );

    const seedMailboxes = await db
      .select()
      .from(warmupMailboxes)
      .where(
        and(
          eq(warmupMailboxes.registeredDomain, domain),
          eq(warmupMailboxes.anchorRole, 'seed'),
          eq(warmupMailboxes.status, 'active'),
          orgId ? eq(warmupMailboxes.organizationId, orgId) : isNull(warmupMailboxes.organizationId)
        )
      );

    const totalAnchors = anchorMailboxes.length + seedMailboxes.length;

    if (totalAnchors >= WARMUP_CONFIG.ANCHORS_PER_DOMAIN) {
      await db
        .update(warmupDomainClusters)
        .set({
          isHealthy: true,
          mode: anchorMailboxes.length > 0 ? 'user_provided' : 'platform_seed',
          anchorCount: totalAnchors,
        })
        .where(
          and(
            eq(warmupDomainClusters.registeredDomain, domain),
            orgId ? eq(warmupDomainClusters.organizationId, orgId) : isNull(warmupDomainClusters.organizationId)
          )
        );

      const allAnchorIds = [...anchorMailboxes.map(m => m.id), ...seedMailboxes.map(m => m.id)];
      await this.assignMembersToAnchors(domain, orgId, allAnchorIds);

      await this.unpauseMembers(domain, orgId);
      return;
    }

    // Check if domain has only custom_email mailboxes — they don't need same-domain anchors.
    // Custom SMTP mailboxes can warm up independently by pairing with platform seeds or
    // cross-domain Gmail/Outlook partners. No need to pause them.
    const allDomainMailboxes = await db
      .select({ provider: warmupMailboxes.provider })
      .from(warmupMailboxes)
      .where(
        and(
          eq(warmupMailboxes.registeredDomain, domain),
          orgId ? eq(warmupMailboxes.organizationId, orgId) : isNull(warmupMailboxes.organizationId)
        )
      );
    const allCustom = allDomainMailboxes.length > 0 && allDomainMailboxes.every(m => m.provider === 'custom_email');
    if (allCustom) {
      await db
        .update(warmupDomainClusters)
        .set({
          isHealthy: true,
          mode: 'internal_only',
        })
        .where(
          and(
            eq(warmupDomainClusters.registeredDomain, domain),
            orgId ? eq(warmupDomainClusters.organizationId, orgId) : isNull(warmupDomainClusters.organizationId)
          )
        );
      return;
    }

    if (WARMUP_CONFIG.PLATFORM_SEED_ENABLED) {
      const assigned = await seedFleetManager.assignSeedToDomainWithFallback(domain, orgId);
      if (assigned) {
        await this.rebalanceDomain(domain, orgId);
        return;
      }
    }

    await db
      .update(warmupDomainClusters)
      .set({
        isHealthy: false,
        mode: 'internal_only',
      })
      .where(
        and(
          eq(warmupDomainClusters.registeredDomain, domain),
          orgId ? eq(warmupDomainClusters.organizationId, orgId) : isNull(warmupDomainClusters.organizationId)
        )
      );

    await this.pauseMembers(domain, orgId);
  }

  async promoteToAnchor(mailboxId: string): Promise<void> {
    const mb = await db
      .select()
      .from(warmupMailboxes)
      .where(eq(warmupMailboxes.id, mailboxId))
      .limit(1);

    if (!mb[0]) return;
    const providerCat = detectProvider(mb[0].email);
    if (providerCat === 'custom_email') {
      console.warn(`[Warmup][Anchor] Cannot promote ${mb[0].email} to anchor — custom email providers cannot be anchors`);
      return;
    }
    if (providerCat === 'yahoo' || providerCat === 'aol') {
      console.warn(`[Warmup][Anchor] ${mb[0].email} is ${providerCat} — anchors work best with Gmail/Outlook, but will attempt`);
    }

    await db
      .update(warmupMailboxes)
      .set({ anchorRole: 'anchor' })
      .where(eq(warmupMailboxes.id, mailboxId));

    await domainClusterEngine.scanAndCluster();
    await this.rebalanceDomain(mb[0].registeredDomain!, mb[0].organizationId);
  }

  async demoteAnchor(mailboxId: string): Promise<void> {
    const mb = await db
      .select()
      .from(warmupMailboxes)
      .where(eq(warmupMailboxes.id, mailboxId))
      .limit(1);

    if (!mb[0]) return;

    await db
      .update(warmupMailboxes)
      .set({ anchorRole: 'member', anchorMailboxId: null })
      .where(eq(warmupMailboxes.id, mailboxId));

    const cluster = await domainClusterEngine.getCluster(mailboxId);
    if (cluster) {
      const remaining = cluster.anchorMailboxIds.filter(id => id !== mailboxId);
      await db
        .update(warmupDomainClusters)
        .set({
          anchorMailboxIds: remaining,
          anchorCount: remaining.length + cluster.seedMailboxIds.length,
          isHealthy: (remaining.length + cluster.seedMailboxIds.length) >= WARMUP_CONFIG.ANCHORS_PER_DOMAIN,
        })
        .where(
          and(
            eq(warmupDomainClusters.registeredDomain, cluster.registeredDomain),
            cluster.organizationId
              ? eq(warmupDomainClusters.organizationId, cluster.organizationId)
              : isNull(warmupDomainClusters.organizationId)
          )
        );
    }
  }

  async getAnchorForMailbox(mailboxId: string): Promise<string | null> {
    const mb = await db
      .select()
      .from(warmupMailboxes)
      .where(eq(warmupMailboxes.id, mailboxId))
      .limit(1);

    if (!mb[0]) return null;

    if (mb[0].anchorRole === 'anchor' || mb[0].anchorRole === 'seed') return mb[0].id;

    if (mb[0].anchorMailboxId) return mb[0].anchorMailboxId;

    const cluster = await domainClusterEngine.getCluster(mailboxId);
    if (!cluster) return null;

    const allAnchors = [...cluster.anchorMailboxIds, ...cluster.seedMailboxIds];
    if (allAnchors.length === 0) return null;

    const assigned = allAnchors[Math.floor(Math.random() * allAnchors.length)];
    await db
      .update(warmupMailboxes)
      .set({ anchorMailboxId: assigned })
      .where(eq(warmupMailboxes.id, mailboxId));

    return assigned;
  }

  async getDomainAnchors(domain: string, orgId: string | null): Promise<Array<{ id: string; email: string; provider: string }>> {
    const mailboxes = await db
      .select({ id: warmupMailboxes.id, email: warmupMailboxes.email, provider: warmupMailboxes.provider })
      .from(warmupMailboxes)
      .where(
        and(
          eq(warmupMailboxes.registeredDomain, domain),
          inArray(warmupMailboxes.anchorRole, ['anchor', 'seed'] as AnchorRole[]),
          eq(warmupMailboxes.status, 'active'),
          orgId ? eq(warmupMailboxes.organizationId, orgId) : isNull(warmupMailboxes.organizationId)
        )
      );

    return mailboxes;
  }

  private async assignMembersToAnchors(domain: string, orgId: string | null, anchorIds: string[]): Promise<void> {
    const members = await db
      .select()
      .from(warmupMailboxes)
      .where(
        and(
          eq(warmupMailboxes.registeredDomain, domain),
          eq(warmupMailboxes.anchorRole, 'member'),
          orgId ? eq(warmupMailboxes.organizationId, orgId) : isNull(warmupMailboxes.organizationId)
        )
      );

    const membersPerAnchor = Math.max(1, Math.ceil(members.length / anchorIds.length));

    for (let i = 0; i < members.length; i++) {
      const anchorIndex = Math.floor(i / membersPerAnchor) % anchorIds.length;
      const anchorId = anchorIds[anchorIndex];

      if (members[i].anchorMailboxId !== anchorId) {
        await db
          .update(warmupMailboxes)
          .set({ anchorMailboxId: anchorId })
          .where(eq(warmupMailboxes.id, members[i].id));
      }
    }
  }

  private async pauseMembers(domain: string, orgId: string | null): Promise<void> {
    await db
      .update(warmupMailboxes)
      .set({ status: 'paused', pauseReason: 'domain_lacks_anchor' })
      .where(
        and(
          eq(warmupMailboxes.registeredDomain, domain),
          eq(warmupMailboxes.anchorRole, 'member'),
          eq(warmupMailboxes.status, 'active'),
          orgId ? eq(warmupMailboxes.organizationId, orgId) : isNull(warmupMailboxes.organizationId)
        )
      );
  }

  private async unpauseMembers(domain: string, orgId: string | null): Promise<void> {
    await db
      .update(warmupMailboxes)
      .set({ status: 'active', pauseReason: null })
      .where(
        and(
          eq(warmupMailboxes.registeredDomain, domain),
          inArray(warmupMailboxes.anchorRole, ['member', 'seed'] as AnchorRole[]),
          eq(warmupMailboxes.status, 'paused'),
          sql`${warmupMailboxes.pauseReason} IN ('domain_lacks_anchor', 'no_anchor_available')`,
          orgId ? eq(warmupMailboxes.organizationId, orgId) : isNull(warmupMailboxes.organizationId)
        )
      );
  }
}

export const anchorEngine = new AnchorEngine();