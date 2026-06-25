import { db } from '../db/warmup-db.js';
import { eq, and, not, sql, inArray, isNull } from 'drizzle-orm';
import { integrations, warmupMailboxes, warmupThreads, warmupDomainClusters } from '@audnix/shared';
import type { PairingCandidate, AnchorRole, WarmupMailbox } from '../types/warmup-types.js';
import { WARMUP_CONFIG } from '../config/warmup-config.js';
import { detectProvider, getGroupPairingScore, getPairingQualityLabel, isCrossProviderPair } from './provider-utils.js';

export class PairingEngine {
  async findPartner(mailbox: WarmupMailbox): Promise<PairingCandidate | null> {
    if (mailbox.anchorRole === 'member') {
      return this.findPartnerForMember(mailbox);
    }

    if (mailbox.anchorRole === 'anchor' || mailbox.anchorRole === 'seed') {
      return this.findPartnerForAnchor(mailbox);
    }

    // Enterprise pool: can initiate warmup with anyone (enterprise, global, seeds)
    if (mailbox.poolType === 'enterprise') {
      const candidates = await this.getEnterpriseCandidates(mailbox.id);
      if (candidates.length === 0) {
        await this.pauseEmpty(mailbox.id);
        return null;
      }
      return this.pickBest(mailbox, candidates);
    }

    // Global pool: cannot initiate warmup — only enterprise or seeds can talk to them
    await this.pauseEmpty(mailbox.id);
    return null;
  }

  private async findPartnerForMember(mailbox: WarmupMailbox): Promise<PairingCandidate | null> {
    // Global pool members cannot initiate warmup — only enterprise or seeds can talk to them
    if (mailbox.poolType !== 'enterprise') {
      await this.pauseEmpty(mailbox.id);
      return null;
    }

    const anchorId = mailbox.anchorMailboxId;
    if (!anchorId) {
      await this.pauseNoAnchor(mailbox.id);
      return null;
    }

    const memberCandidates = await this.getMemberCandidates(mailbox);
    if (memberCandidates.length > 0) {
      return this.pickBest(mailbox, memberCandidates);
    }

    const anchorCandidate = await this.getAnchorCandidate(anchorId);
    if (anchorCandidate) return anchorCandidate;

    await this.pauseNoAnchor(mailbox.id);
    return null;
  }

  private async findPartnerForAnchor(mailbox: WarmupMailbox): Promise<PairingCandidate | null> {
    // Seeds can initiate with anyone; non-enterprise anchors cannot initiate
    if (mailbox.anchorRole !== 'seed' && mailbox.poolType !== 'enterprise') {
      await this.pauseEmpty(mailbox.id);
      return null;
    }

    const isSeed = mailbox.anchorRole === 'seed';
    const selfProvider = detectProvider(mailbox.email);

    // Seeds can only pair with enterprise pool mailboxes
    const anchorCandidates = await this.getAnchorCandidates(mailbox);
    const poolFiltered = anchorCandidates.filter(c =>
      isSeed ? c.poolType === 'enterprise' : true
    );
    const filtered = poolFiltered.filter(c =>
      c.mailboxId !== mailbox.id &&
      (isSeed || c.anchorRole === 'anchor' || c.anchorRole === 'seed' ||
       (c.registeredDomain !== mailbox.registeredDomain))
    );

    const crossProviderAnchors = filtered.filter(c =>
      isCrossProviderPair(mailbox.email, c.email)
    );

    if (crossProviderAnchors.length >= 3) {
      return this.pickBest(mailbox, crossProviderAnchors);
    }

    if (filtered.length >= 3) {
      return this.pickBest(mailbox, filtered);
    }

    // Seeds skip global pool entirely — they only talk to enterprise
    if (!isSeed) {
      const globalCandidates = await this.getGlobalCandidates(mailbox.id);
      const crossProviderGlobal = globalCandidates.filter(c =>
        c.mailboxId !== mailbox.id &&
        isCrossProviderPair(mailbox.email, c.email)
      );

      const sameProviderDifferentDomain = globalCandidates.filter(c =>
        c.mailboxId !== mailbox.id &&
        !isCrossProviderPair(mailbox.email, c.email) &&
        c.registeredDomain !== mailbox.registeredDomain
      );

      const combined = [...filtered, ...crossProviderGlobal, ...sameProviderDifferentDomain];

      if (combined.length > 0) {
        return this.pickBest(mailbox, combined);
      }

      const anyGlobal = globalCandidates.filter(c => c.mailboxId !== mailbox.id);
      if (anyGlobal.length > 0) {
        console.log(
          `[Warmup][Pairing] Anchors in same-provider pool (${selfProvider}) — ` +
          `pairing within same provider since no cross-provider options exist`
        );
        return this.pickBest(mailbox, anyGlobal);
      }
    }

    // For seeds or if nothing found above, try enterprise-only candidates
    const enterpriseCandidates = await this.getEnterpriseCandidates(mailbox.id);
    const filteredEnterprise = enterpriseCandidates.filter(c => c.mailboxId !== mailbox.id);
    if (filteredEnterprise.length > 0) {
      return this.pickBest(mailbox, filteredEnterprise);
    }

    await this.pauseEmpty(mailbox.id);
    return null;
  }

  private limitExpr() {
    return sql`COALESCE(${warmupMailboxes.dailyLimit}, ${integrations.warmupLimit}, ${WARMUP_CONFIG.DAILY_SENT_LIMIT})`;
  }

  private async getAnchorCandidates(self: WarmupMailbox): Promise<PairingCandidate[]> {
    const anchors = await db
      .select({
        id: warmupMailboxes.id,
        email: warmupMailboxes.email,
        provider: warmupMailboxes.provider,
        poolType: warmupMailboxes.poolType,
        organizationId: warmupMailboxes.organizationId,
        registeredDomain: warmupMailboxes.registeredDomain,
        anchorRole: warmupMailboxes.anchorRole,
        dailySentCount: warmupMailboxes.dailySentCount,
        dailyReceivedCount: warmupMailboxes.dailyReceivedCount,
        dailyLimit: warmupMailboxes.dailyLimit,
        warmupLimit: integrations.warmupLimit,
        lastInteractionAt: warmupMailboxes.updatedAt,
      })
      .from(warmupMailboxes)
      .leftJoin(integrations, eq(warmupMailboxes.integrationId, integrations.id))
      .where(
        and(
          inArray(warmupMailboxes.anchorRole, ['anchor', 'seed'] as AnchorRole[]),
          eq(warmupMailboxes.status, 'active'),
          sql`${warmupMailboxes.dailySentCount} < COALESCE(${warmupMailboxes.dailyLimit}, ${integrations.warmupLimit}, ${WARMUP_CONFIG.DAILY_SENT_LIMIT})`,
          sql`${warmupMailboxes.dailyReceivedCount} < COALESCE(${warmupMailboxes.dailyLimit}, ${integrations.warmupLimit}, ${WARMUP_CONFIG.DAILY_RECEIVED_LIMIT})`
        )
      );

    const threadCounts = await this.batchCountActiveThreads(anchors.map((a: any) => a.id));

    return anchors.map((a: any) => ({
      mailboxId: a.id,
      email: a.email,
      provider: a.provider,
      organizationId: a.organizationId,
      registeredDomain: a.registeredDomain,
      anchorRole: a.anchorRole as AnchorRole,
      dailySentCount: a.dailySentCount,
      dailyReceivedCount: a.dailyReceivedCount,
      activeThreadCount: threadCounts.get(a.id) ?? 0,
      lastInteractionAt: a.lastInteractionAt,
    }));
  }

  private async getMemberCandidates(self: WarmupMailbox): Promise<PairingCandidate[]> {
    const domain = self.registeredDomain;
    if (!domain) return [];

    const members = await db
      .select({
        id: warmupMailboxes.id,
        email: warmupMailboxes.email,
        provider: warmupMailboxes.provider,
        poolType: warmupMailboxes.poolType,
        organizationId: warmupMailboxes.organizationId,
        registeredDomain: warmupMailboxes.registeredDomain,
        anchorRole: warmupMailboxes.anchorRole,
        dailySentCount: warmupMailboxes.dailySentCount,
        dailyReceivedCount: warmupMailboxes.dailyReceivedCount,
        dailyLimit: warmupMailboxes.dailyLimit,
        warmupLimit: integrations.warmupLimit,
        lastInteractionAt: warmupMailboxes.updatedAt,
      })
      .from(warmupMailboxes)
      .leftJoin(integrations, eq(warmupMailboxes.integrationId, integrations.id))
      .where(
        and(
          eq(warmupMailboxes.registeredDomain, domain),
          eq(warmupMailboxes.status, 'active'),
          not(eq(warmupMailboxes.id, self.id)),
          sql`${warmupMailboxes.dailySentCount} < COALESCE(${warmupMailboxes.dailyLimit}, ${integrations.warmupLimit}, ${WARMUP_CONFIG.DAILY_SENT_LIMIT})`,
          sql`${warmupMailboxes.dailyReceivedCount} < COALESCE(${warmupMailboxes.dailyLimit}, ${integrations.warmupLimit}, ${WARMUP_CONFIG.DAILY_RECEIVED_LIMIT})`
        )
      );

    const threadCounts = await this.batchCountActiveThreads(members.map((m: any) => m.id));

    return members.map((m: any) => ({
      mailboxId: m.id,
      email: m.email,
      provider: m.provider,
      organizationId: m.organizationId,
      registeredDomain: m.registeredDomain,
      anchorRole: m.anchorRole as AnchorRole,
      dailySentCount: m.dailySentCount,
      dailyReceivedCount: m.dailyReceivedCount,
      activeThreadCount: threadCounts.get(m.id) ?? 0,
      lastInteractionAt: m.lastInteractionAt,
    }));
  }

  private async getAnchorCandidate(anchorId: string): Promise<PairingCandidate | null> {
    const anchor = await db
      .select()
      .from(warmupMailboxes)
      .where(and(eq(warmupMailboxes.id, anchorId), eq(warmupMailboxes.status, 'active')))
      .limit(1);

    if (!anchor[0]) return null;

    return {
      mailboxId: anchor[0].id,
      email: anchor[0].email,
      provider: anchor[0].provider,
      organizationId: anchor[0].organizationId,
      registeredDomain: anchor[0].registeredDomain,
      anchorRole: anchor[0].anchorRole as AnchorRole,
      dailySentCount: anchor[0].dailySentCount,
      dailyReceivedCount: anchor[0].dailyReceivedCount,
      activeThreadCount: await this.countActiveThreads(anchor[0].id),
      lastInteractionAt: anchor[0].updatedAt,
    };
  }

  private async getOrgCandidates(
    organizationId: string,
    excludeMailboxId: string
  ): Promise<PairingCandidate[]> {
    const rows = await db
      .select({
        id: warmupMailboxes.id,
        email: warmupMailboxes.email,
        provider: warmupMailboxes.provider,
        poolType: warmupMailboxes.poolType,
        organizationId: warmupMailboxes.organizationId,
        registeredDomain: warmupMailboxes.registeredDomain,
        anchorRole: warmupMailboxes.anchorRole,
        dailySentCount: warmupMailboxes.dailySentCount,
        dailyReceivedCount: warmupMailboxes.dailyReceivedCount,
        dailyLimit: warmupMailboxes.dailyLimit,
        warmupLimit: integrations.warmupLimit,
        lastInteractionAt: warmupMailboxes.updatedAt,
      })
      .from(warmupMailboxes)
      .leftJoin(integrations, eq(warmupMailboxes.integrationId, integrations.id))
      .where(
        and(
          eq(warmupMailboxes.organizationId, organizationId),
          eq(warmupMailboxes.status, 'active'),
          not(eq(warmupMailboxes.id, excludeMailboxId)),
          sql`${warmupMailboxes.dailySentCount} < COALESCE(${warmupMailboxes.dailyLimit}, ${integrations.warmupLimit}, ${WARMUP_CONFIG.DAILY_SENT_LIMIT})`,
          sql`${warmupMailboxes.dailyReceivedCount} < COALESCE(${warmupMailboxes.dailyLimit}, ${integrations.warmupLimit}, ${WARMUP_CONFIG.DAILY_RECEIVED_LIMIT})`
        )
      );

    const threadCounts = await this.batchCountActiveThreads(rows.map((r: any) => r.id));

    return rows.map((r: any) => ({
      mailboxId: r.id,
      email: r.email,
      provider: r.provider,
      poolType: r.poolType,
      organizationId: r.organizationId,
      registeredDomain: r.registeredDomain,
      anchorRole: r.anchorRole as AnchorRole,
      dailySentCount: r.dailySentCount,
      dailyReceivedCount: r.dailyReceivedCount,
      activeThreadCount: threadCounts.get(r.id) ?? 0,
      lastInteractionAt: r.lastInteractionAt,
    }));
  }

  private async getEnterpriseCandidates(
    excludeMailboxId: string
  ): Promise<PairingCandidate[]> {
    const rows = await db
      .select({
        id: warmupMailboxes.id,
        email: warmupMailboxes.email,
        provider: warmupMailboxes.provider,
        poolType: warmupMailboxes.poolType,
        organizationId: warmupMailboxes.organizationId,
        registeredDomain: warmupMailboxes.registeredDomain,
        anchorRole: warmupMailboxes.anchorRole,
        dailySentCount: warmupMailboxes.dailySentCount,
        dailyReceivedCount: warmupMailboxes.dailyReceivedCount,
        dailyLimit: warmupMailboxes.dailyLimit,
        warmupLimit: integrations.warmupLimit,
        lastInteractionAt: warmupMailboxes.updatedAt,
      })
      .from(warmupMailboxes)
      .leftJoin(integrations, eq(warmupMailboxes.integrationId, integrations.id))
      .where(
        and(
          inArray(warmupMailboxes.poolType, ['enterprise', 'global'] as any),
          eq(warmupMailboxes.status, 'active'),
          not(eq(warmupMailboxes.id, excludeMailboxId)),
          sql`${warmupMailboxes.dailySentCount} < COALESCE(${warmupMailboxes.dailyLimit}, ${integrations.warmupLimit}, ${WARMUP_CONFIG.DAILY_SENT_LIMIT})`,
          sql`${warmupMailboxes.dailyReceivedCount} < COALESCE(${warmupMailboxes.dailyLimit}, ${integrations.warmupLimit}, ${WARMUP_CONFIG.DAILY_RECEIVED_LIMIT})`
        )
      );

    const threadCounts = await this.batchCountActiveThreads(rows.map((r: any) => r.id));

    return rows.map((r: any) => ({
      mailboxId: r.id,
      email: r.email,
      provider: r.provider,
      poolType: r.poolType,
      organizationId: r.organizationId,
      registeredDomain: r.registeredDomain,
      anchorRole: r.anchorRole as AnchorRole,
      dailySentCount: r.dailySentCount,
      dailyReceivedCount: r.dailyReceivedCount,
      activeThreadCount: threadCounts.get(r.id) ?? 0,
      lastInteractionAt: r.lastInteractionAt,
    }));
  }

  private async getGlobalCandidates(
    excludeMailboxId: string
  ): Promise<PairingCandidate[]> {
    const rows = await db
      .select({
        id: warmupMailboxes.id,
        email: warmupMailboxes.email,
        provider: warmupMailboxes.provider,
        poolType: warmupMailboxes.poolType,
        organizationId: warmupMailboxes.organizationId,
        registeredDomain: warmupMailboxes.registeredDomain,
        anchorRole: warmupMailboxes.anchorRole,
        dailySentCount: warmupMailboxes.dailySentCount,
        dailyReceivedCount: warmupMailboxes.dailyReceivedCount,
        dailyLimit: warmupMailboxes.dailyLimit,
        warmupLimit: integrations.warmupLimit,
        lastInteractionAt: warmupMailboxes.updatedAt,
      })
      .from(warmupMailboxes)
      .leftJoin(integrations, eq(warmupMailboxes.integrationId, integrations.id))
      .where(
        and(
          eq(warmupMailboxes.poolType, 'global'),
          eq(warmupMailboxes.status, 'active'),
          not(eq(warmupMailboxes.id, excludeMailboxId)),
          sql`${warmupMailboxes.dailySentCount} < COALESCE(${warmupMailboxes.dailyLimit}, ${integrations.warmupLimit}, ${WARMUP_CONFIG.DAILY_SENT_LIMIT})`,
          sql`${warmupMailboxes.dailyReceivedCount} < COALESCE(${warmupMailboxes.dailyLimit}, ${integrations.warmupLimit}, ${WARMUP_CONFIG.DAILY_RECEIVED_LIMIT})`
        )
      );

    const threadCounts = await this.batchCountActiveThreads(rows.map((r: any) => r.id));

    return rows.map((r: any) => ({
      mailboxId: r.id,
      email: r.email,
      provider: r.provider,
      poolType: r.poolType,
      organizationId: r.organizationId,
      registeredDomain: r.registeredDomain,
      anchorRole: r.anchorRole as AnchorRole,
      dailySentCount: r.dailySentCount,
      dailyReceivedCount: r.dailyReceivedCount,
      activeThreadCount: threadCounts.get(r.id) ?? 0,
      lastInteractionAt: r.lastInteractionAt,
    }));
  }

  private async batchCountActiveThreads(mailboxIds: string[]): Promise<Map<string, number>> {
    if (mailboxIds.length === 0) return new Map();
    const result = await db
      .select({
        mailboxId: sql<string>`CASE WHEN ${warmupThreads.senderMailboxId} = ANY(ARRAY[${sql.join(mailboxIds.map(id => sql`${id}`), sql`, `)}]::uuid[]) THEN ${warmupThreads.senderMailboxId} ELSE ${warmupThreads.recipientMailboxId} END`,
        count: sql<number>`count(*)`,
      })
      .from(warmupThreads)
      .where(
        and(
          eq(warmupThreads.status, 'active'),
          sql`(${warmupThreads.senderMailboxId} = ANY(ARRAY[${sql.join(mailboxIds.map(id => sql`${id}`), sql`, `)}]::uuid[]) OR ${warmupThreads.recipientMailboxId} = ANY(ARRAY[${sql.join(mailboxIds.map(id => sql`${id}`), sql`, `)}]::uuid[]))`
        )
      )
      .groupBy(sql`1`);

    const map = new Map<string, number>();
    for (const row of result) {
      map.set(row.mailboxId, row.count);
    }
    return map;
  }

  private async countActiveThreads(mailboxId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(warmupThreads)
      .where(
        and(
          eq(warmupThreads.status, 'active'),
          sql`(${warmupThreads.senderMailboxId} = ${mailboxId} OR ${warmupThreads.recipientMailboxId} = ${mailboxId})`
        )
      );
    return result[0]?.count ?? 0;
  }

  private pickBest(self: WarmupMailbox, candidates: PairingCandidate[]): PairingCandidate {
    const scored = candidates.map(c => ({
      ...c,
      score: this.scoreCandidate(self, c),
    }));

    scored.sort((a, b) => b.score - a.score);
    const top3 = scored.slice(0, 3);
    return this.weightedRandom(top3);
  }

  private scoreCandidate(self: WarmupMailbox, candidate: PairingCandidate): number {
    let score = WARMUP_CONFIG.PAIRING_BASE_SCORE;

    const isAnchorOrSeed = self.anchorRole === 'anchor' || self.anchorRole === 'seed';
    const isDifferentDomain = self.registeredDomain && candidate.registeredDomain &&
      self.registeredDomain !== candidate.registeredDomain;

    const pairingScore = getGroupPairingScore(self.email, candidate.email);
    const isCrossProviderGroup = pairingScore >= 3;
    const isDifferentProvider = pairingScore >= 1;

    if (isCrossProviderGroup) {
      score += WARMUP_CONFIG.PAIRING_CROSS_PROVIDER_BONUS;
    } else if (isDifferentProvider) {
      score += Math.floor(WARMUP_CONFIG.PAIRING_CROSS_PROVIDER_BONUS * 0.6);
    }

    if (isDifferentDomain) {
      score += WARMUP_CONFIG.PAIRING_DIFFERENT_DOMAIN_BONUS;
    }

    if (isAnchorOrSeed && isCrossProviderGroup && isDifferentDomain) {
      score += WARMUP_CONFIG.PAIRING_ANCHOR_PAIRING_BOOST;
    } else if (isAnchorOrSeed && isDifferentDomain) {
      score += Math.floor(WARMUP_CONFIG.PAIRING_ANCHOR_PAIRING_BOOST * 0.5);
    }

    if (candidate.dailySentCount < self.dailySentCount) {
      score += WARMUP_CONFIG.PAIRING_VOLUME_BALANCE_BONUS;
    }

    if (candidate.activeThreadCount < 3) score += WARMUP_CONFIG.PAIRING_THREAD_LIGHT_BONUS;
    else if (candidate.activeThreadCount > 8) score += WARMUP_CONFIG.PAIRING_THREAD_HEAVY_PENALTY;

    if (
      self.poolType === 'global' &&
      self.organizationId !== candidate.organizationId
    ) {
      score += WARMUP_CONFIG.PAIRING_ORG_DIVERSITY_BONUS;
    }

    const hoursSince = candidate.lastInteractionAt
      ? (Date.now() - new Date(candidate.lastInteractionAt).getTime()) / (1000 * 60 * 60)
      : 24;
    score += Math.max(
      hoursSince * WARMUP_CONFIG.PAIRING_STALENESS_PENALTY_PER_HOUR,
      WARMUP_CONFIG.PAIRING_MAX_STALENESS_PENALTY
    );

    return Math.max(score, 1);
  }

  private weightedRandom(candidates: Array<PairingCandidate & { score: number }>): PairingCandidate {
    const total = candidates.reduce((sum, c) => sum + c.score, 0);
    let threshold = Math.random() * total;
    for (const c of candidates) {
      threshold -= c.score;
      if (threshold <= 0) {
        const { score: _, ...rest } = c;
        return rest;
      }
    }
    const { score: _, ...rest } = candidates[candidates.length - 1];
    return rest;
  }

  private async pauseEmpty(mailboxId: string): Promise<void> {
    await db
      .update(warmupMailboxes)
      .set({ status: 'paused', pauseReason: 'empty_pool_defensive' })
      .where(eq(warmupMailboxes.id, mailboxId));
  }

  private async pauseNoAnchor(mailboxId: string): Promise<void> {
    await db
      .update(warmupMailboxes)
      .set({ status: 'paused', pauseReason: 'no_anchor_available' })
      .where(eq(warmupMailboxes.id, mailboxId));
  }
}

export const pairingEngine = new PairingEngine();