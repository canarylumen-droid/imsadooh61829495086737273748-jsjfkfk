import { db } from '../db/warmup-db.js';
import { eq, and, inArray, isNull, sql, not } from 'drizzle-orm';
import {
  warmupMailboxes, warmupDomainClusters, warmupSeedAccounts, integrations,
} from '@audnix/shared';
import { WARMUP_CONFIG } from '../config/warmup-config.js';
import type { DomainClusterInfo, DomainAnchorMode, AnchorRole } from '../types/warmup-types.js';

export class DomainClusterEngine {
  async scanAndCluster(): Promise<void> {
    // 1. Process unclustered mailboxes (no registeredDomain yet)
    const unclustered = await db
      .select()
      .from(warmupMailboxes)
      .where(isNull(warmupMailboxes.registeredDomain));

    const grouped = new Map<string, typeof unclustered>();
    for (const mb of unclustered) {
      const domain = this.extractRegisteredDomain(mb.email);
      if (!domain) continue;
      if (!grouped.has(domain)) grouped.set(domain, []);
      grouped.get(domain)!.push(mb);
    }

    for (const [domain, mailboxes] of grouped) {
      const orgId = this.resolveOrgId(mailboxes);
      await this.ensureCluster(domain, orgId, mailboxes);

      const mailboxIds = mailboxes.map(m => m.id);
      await db
        .update(warmupMailboxes)
        .set({ registeredDomain: domain })
        .where(inArray(warmupMailboxes.id, mailboxIds));
    }

    // 2. Ensure all domains with registeredDomain have a cluster row.
    // Handles the case where mailboxes were clustered in a previous run
    // but the clusters table was wiped (deploy/truncate/migration).
    const allDomains = await db
      .select({
        domain: warmupMailboxes.registeredDomain,
        organizationId: warmupMailboxes.organizationId,
      })
      .from(warmupMailboxes)
      .where(sql`${warmupMailboxes.registeredDomain} IS NOT NULL AND ${warmupMailboxes.registeredDomain} != ''`);

    const seen = new Set<string>();
    for (const row of allDomains) {
      if (!row.domain) continue;
      const key = `${row.domain}|${row.organizationId ?? 'null'}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const existing = await db
        .select()
        .from(warmupDomainClusters)
        .where(
          and(
            eq(warmupDomainClusters.registeredDomain, row.domain),
            row.organizationId
              ? eq(warmupDomainClusters.organizationId, row.organizationId)
              : isNull(warmupDomainClusters.organizationId)
          )
        )
        .limit(1);

      if (existing.length === 0) {
        const mailboxes = await db
          .select()
          .from(warmupMailboxes)
          .where(
            and(
              eq(warmupMailboxes.registeredDomain, row.domain),
              row.organizationId
                ? eq(warmupMailboxes.organizationId, row.organizationId)
                : isNull(warmupMailboxes.organizationId)
            )
          );

        await this.ensureCluster(row.domain, row.organizationId, mailboxes as any[]);
      }
    }
  }

  private async ensureCluster(domain: string, orgId: string | null, mailboxes: Array<Record<string, any>>): Promise<void> {
    const existing = await db
      .select()
      .from(warmupDomainClusters)
      .where(
        and(
          eq(warmupDomainClusters.registeredDomain, domain),
          orgId ? eq(warmupDomainClusters.organizationId, orgId) : isNull(warmupDomainClusters.organizationId)
        )
      )
      .limit(1);

    const memberIds = mailboxes
      .filter(m => m.anchorRole === 'member' || !m.anchorRole)
      .map(m => m.id);
    const anchorIds = mailboxes.filter(m => m.anchorRole === 'anchor').map(m => m.id);

    const clusterData = {
      registeredDomain: domain,
      organizationId: orgId,
      memberMailboxIds: memberIds,
      anchorMailboxIds: anchorIds,
      totalMailboxes: mailboxes.length,
      anchorCount: anchorIds.length,
      lastActivityAt: new Date(),
    };

    if (existing.length === 0) {
      await db.insert(warmupDomainClusters).values({
        ...clusterData,
        mode: anchorIds.length >= WARMUP_CONFIG.ANCHORS_PER_DOMAIN ? 'user_provided' : 'internal_only',
        isHealthy: anchorIds.length >= WARMUP_CONFIG.ANCHORS_PER_DOMAIN,
      });
    } else {
      await db
        .update(warmupDomainClusters)
        .set(clusterData)
        .where(eq(warmupDomainClusters.id, existing[0].id));
    }
  }

  async getCluster(mailboxId: string): Promise<DomainClusterInfo | null> {
    const mb = await db
      .select()
      .from(warmupMailboxes)
      .where(eq(warmupMailboxes.id, mailboxId))
      .limit(1);

    if (!mb[0]?.registeredDomain) return null;

    const cluster = await db
      .select()
      .from(warmupDomainClusters)
      .where(
        and(
          eq(warmupDomainClusters.registeredDomain, mb[0].registeredDomain),
          mb[0].organizationId
            ? eq(warmupDomainClusters.organizationId, mb[0].organizationId)
            : isNull(warmupDomainClusters.organizationId)
        )
      )
      .limit(1);

    if (!cluster[0]) return null;

    return {
      registeredDomain: cluster[0].registeredDomain,
      organizationId: cluster[0].organizationId,
      mailboxCount: cluster[0].totalMailboxes,
      anchorMailboxIds: cluster[0].anchorMailboxIds,
      seedMailboxIds: cluster[0].seedMailboxIds,
      mode: cluster[0].mode as DomainAnchorMode,
      isHealthy: cluster[0].isHealthy,
    };
  }

  async getClusterByDomain(domain: string, orgId: string | null): Promise<DomainClusterInfo | null> {
    const cluster = await db
      .select()
      .from(warmupDomainClusters)
      .where(
        and(
          eq(warmupDomainClusters.registeredDomain, domain),
          orgId ? eq(warmupDomainClusters.organizationId, orgId) : isNull(warmupDomainClusters.organizationId)
        )
      )
      .limit(1);

    if (!cluster[0]) return null;

    return {
      registeredDomain: cluster[0].registeredDomain,
      organizationId: cluster[0].organizationId,
      mailboxCount: cluster[0].totalMailboxes,
      anchorMailboxIds: cluster[0].anchorMailboxIds,
      seedMailboxIds: cluster[0].seedMailboxIds,
      mode: cluster[0].mode as DomainAnchorMode,
      isHealthy: cluster[0].isHealthy,
    };
  }

  async assignSeedToCluster(seedMailboxId: string, domain: string, orgId: string | null): Promise<void> {
    const cluster = await db
      .select()
      .from(warmupDomainClusters)
      .where(
        and(
          eq(warmupDomainClusters.registeredDomain, domain),
          orgId ? eq(warmupDomainClusters.organizationId, orgId) : isNull(warmupDomainClusters.organizationId)
        )
      )
      .limit(1);

    if (cluster[0]) {
      const seedIds = new Set([...(cluster[0].seedMailboxIds || []), seedMailboxId]);
      await db
        .update(warmupDomainClusters)
        .set({
          seedMailboxIds: Array.from(seedIds),
          mode: 'platform_seed',
          isHealthy: true,
        })
        .where(eq(warmupDomainClusters.id, cluster[0].id));
    }
  }

  async getDomainsLackingAnchors(): Promise<Array<{ domain: string; orgId: string | null; mailboxCount: number }>> {
    const clusters = await db
      .select()
      .from(warmupDomainClusters)
      .where(
        and(
          eq(warmupDomainClusters.isHealthy, false),
          not(eq(warmupDomainClusters.mode, 'platform_seed')),
          sql`${warmupDomainClusters.anchorCount} < ${WARMUP_CONFIG.ANCHORS_PER_DOMAIN}`
        )
      );

    return clusters.map(c => ({
      domain: c.registeredDomain,
      orgId: c.organizationId,
      mailboxCount: c.totalMailboxes,
    }));
  }

  extractRegisteredDomain(email: string): string | null {
    const atIndex = email.lastIndexOf('@');
    if (atIndex === -1) return null;
    const fullDomain = email.slice(atIndex + 1).toLowerCase();
    if (!fullDomain || !fullDomain.includes('.')) return null;

    const parts = fullDomain.split('.');
    if (parts.length < 2) return null;

    const knownTwoPartTlds = new Set([
      'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'co.nz',
      'co.jp', 'or.jp', 'com.br', 'org.br', 'co.kr', 'or.kr',
    ]);

    if (parts.length >= 3) {
      const lastTwo = parts.slice(-2).join('.');
      const lastThree = parts.slice(-3).join('.');
      if (knownTwoPartTlds.has(lastThree)) return lastThree;
      if (knownTwoPartTlds.has(lastTwo)) return lastTwo;
      return parts.slice(-2).join('.');
    }

    return fullDomain;
  }

  private resolveOrgId(mailboxes: Array<Record<string, any>>): string | null {
    const orgIds = mailboxes.map(m => m.organizationId).filter(Boolean) as string[];
    return orgIds.length > 0 ? orgIds[0] : null;
  }
}

export const domainClusterEngine = new DomainClusterEngine();