/**
 * Pairing Engine
 * Tenant-aware pairing algorithm with provider diversity scoring.
 */

import { db } from '../db/warmup-db.js';
import { eq, and, not, sql } from 'drizzle-orm';
import { integrations, warmupMailboxes, warmupThreads } from '@audnix/shared';
import type { WarmupMailbox, PairingCandidate } from '../types/warmup-types.js';
import { WARMUP_CONFIG } from '../config/warmup-config.js';

export class PairingEngine {
  async findPartner(mailbox: WarmupMailbox): Promise<PairingCandidate | null> {
    const candidates =
      mailbox.poolType === 'enterprise' && mailbox.organizationId
        ? await this.getOrgCandidates(mailbox.organizationId, mailbox.id)
        : await this.getGlobalCandidates(mailbox.id);

    if (candidates.length === 0) {
      console.warn(
        `[Warmup][Pairing] No candidates for mailbox ${mailbox.id} (${mailbox.email}) — pausing defensively.`
      );
      await db
        .update(warmupMailboxes)
        .set({ status: 'paused', pauseReason: 'empty_pool_defensive' })
        .where(eq(warmupMailboxes.id, mailbox.id));
      return null;
    }

    const scored = candidates.map((c) => ({
      ...c,
      score: this.scoreCandidate(mailbox, c),
    }));

    scored.sort((a, b) => b.score - a.score);
    const top3 = scored.slice(0, 3);

    return this.weightedRandom(top3);
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
        organizationId: warmupMailboxes.organizationId,
        dailySentCount: warmupMailboxes.dailySentCount,
        dailyReceivedCount: warmupMailboxes.dailyReceivedCount,
        lastInteractionAt: warmupMailboxes.updatedAt,
      })
      .from(warmupMailboxes)
      .innerJoin(integrations, eq(warmupMailboxes.integrationId, integrations.id))
      .where(
        and(
          eq(warmupMailboxes.organizationId, organizationId),
          eq(warmupMailboxes.status, 'active'),
          not(eq(warmupMailboxes.id, excludeMailboxId)),
          sql`${warmupMailboxes.dailySentCount} < COALESCE(${integrations.warmupLimit}, ${WARMUP_CONFIG.DAILY_SENT_LIMIT})`,
          sql`${warmupMailboxes.dailyReceivedCount} < COALESCE(${integrations.warmupLimit}, ${WARMUP_CONFIG.DAILY_RECEIVED_LIMIT})`
        )
      );

    return Promise.all(
      rows.map(async (r: typeof rows[number]) => ({
        mailboxId: r.id,
        email: r.email,
        provider: r.provider,
        organizationId: r.organizationId,
        dailySentCount: r.dailySentCount,
        dailyReceivedCount: r.dailyReceivedCount,
        activeThreadCount: await this.countActiveThreads(r.id),
        lastInteractionAt: r.lastInteractionAt,
      }))
    );
  }

  private async getGlobalCandidates(
    excludeMailboxId: string
  ): Promise<PairingCandidate[]> {
    const rows = await db
      .select({
        id: warmupMailboxes.id,
        email: warmupMailboxes.email,
        provider: warmupMailboxes.provider,
        organizationId: warmupMailboxes.organizationId,
        dailySentCount: warmupMailboxes.dailySentCount,
        dailyReceivedCount: warmupMailboxes.dailyReceivedCount,
        lastInteractionAt: warmupMailboxes.updatedAt,
      })
      .from(warmupMailboxes)
      .innerJoin(integrations, eq(warmupMailboxes.integrationId, integrations.id))
      .where(
        and(
          eq(warmupMailboxes.poolType, 'global'),
          eq(warmupMailboxes.status, 'active'),
          not(eq(warmupMailboxes.id, excludeMailboxId)),
          sql`${warmupMailboxes.dailySentCount} < COALESCE(${integrations.warmupLimit}, ${WARMUP_CONFIG.DAILY_SENT_LIMIT})`,
          sql`${warmupMailboxes.dailyReceivedCount} < COALESCE(${integrations.warmupLimit}, ${WARMUP_CONFIG.DAILY_RECEIVED_LIMIT})`
        )
      );

    return Promise.all(
      rows.map(async (r: typeof rows[number]) => ({
        mailboxId: r.id,
        email: r.email,
        provider: r.provider,
        organizationId: r.organizationId,
        dailySentCount: r.dailySentCount,
        dailyReceivedCount: r.dailyReceivedCount,
        activeThreadCount: await this.countActiveThreads(r.id),
        lastInteractionAt: r.lastInteractionAt,
      }))
    );
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

  private scoreCandidate(self: WarmupMailbox, candidate: PairingCandidate): number {
    let score = 100;

    // Provider diversity (+40)
    if (self.provider !== candidate.provider) score += 40;

    // Volume balance (+30)
    if (candidate.dailySentCount < self.dailySentCount) score += 30;

    // Thread load
    if (candidate.activeThreadCount < 3) score += 20;
    else if (candidate.activeThreadCount > 8) score -= 30;

    // Org diversity for global pool (+10)
    if (
      self.poolType === 'global' &&
      self.organizationId !== candidate.organizationId
    )
      score += 10;

    // Staleness penalty
    const hoursSince = candidate.lastInteractionAt
      ? (Date.now() - new Date(candidate.lastInteractionAt).getTime()) / (1000 * 60 * 60)
      : 24;
    score -= Math.min(hoursSince * 5, 50);

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
}

export const pairingEngine = new PairingEngine();
