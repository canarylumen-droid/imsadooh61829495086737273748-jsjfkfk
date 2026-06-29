import { db } from '../db/warmup-db.js';
import { eq, and, or, sql, gte } from 'drizzle-orm';
import { warmupMailboxes, warmupInteractions, integrations } from '@audnix/shared';
import { WARMUP_CONFIG } from '../config/warmup-config.js';
import type { RecoveryLevel, ReputationState } from '../types/warmup-types.js';

const SCORE_THRESHOLDS = {
  critical: 40,
  poor: 65,
  cautious: 85,
} as const;

const LEVEL_ORDER: RecoveryLevel[] = ['critical', 'poor', 'cautious', 'healthy'];

export class ReputationRecovery {
  async evaluateAll(): Promise<void> {
    console.log('[Warmup][Recovery] Scanning mailboxes for reputation recovery...');

    const candidates = await db
      .select()
      .from(warmupMailboxes)
      .where(
        or(
          eq(warmupMailboxes.status, 'active'),
          and(
            eq(warmupMailboxes.status, 'paused'),
            eq(warmupMailboxes.pauseReason, 'recovery_mode')
          )
        )
      );

    let recovered = 0;
    let escalated = 0;
    let steppedDown = 0;

    for (const mb of candidates) {
      try {
        if (mb.anchorRole === 'seed') continue;
        if (!mb.integrationId) continue;

        const result = await this.evaluateMailbox(mb);
        if (result.transition) {
          if (result.transition === 'recovered') recovered++;
          else if (result.transition === 'escalated') escalated++;
          else if (result.transition === 'stepped_down') steppedDown++;
        }
      } catch (err: any) {
        console.error(`[Warmup][Recovery] Error evaluating ${mb.email}:`, err.message);
      }
    }

    if (recovered > 0 || escalated > 0 || steppedDown > 0) {
      console.log(
        `[Warmup][Recovery] Scan complete — recovered=${recovered} escalated=${escalated} stepped_down=${steppedDown}`
      );
    } else {
      console.log('[Warmup][Recovery] Scan complete.');
    }
  }

  async evaluateMailbox(
    mb: typeof warmupMailboxes.$inferSelect
  ): Promise<ReputationState & { transition?: string }> {
    const now = new Date();

    // ── Fix #3: Check integration still exists and is healthy ────────────
    const [integration] = await db
      .select({
        id: integrations.id,
        connected: integrations.connected,
        healthStatus: integrations.healthStatus,
        mailboxPauseUntil: integrations.mailboxPauseUntil,
        reputationScore: integrations.reputationScore,
      })
      .from(integrations)
      .where(eq(integrations.id, mb.integrationId!))
      .limit(1);

    if (!integration) {
      await this.markUnenrolled(mb, 'integration_disconnected');
      return { ...this.getDefaultState(), lastEvaluatedAt: now.toISOString(), transition: 'unenrolled' };
    }

    // If integration is disconnected or suspended, unenroll
    if (!integration.connected || integration.healthStatus === 'failed' || integration.healthStatus === 'warning') {
      await this.markUnenrolled(mb, 'integration_disconnected');
      return { ...this.getDefaultState(), lastEvaluatedAt: now.toISOString(), transition: 'unenrolled' };
    }

    // ── Fix #5: Respect mailboxPauseUntil from reputation-monitor ────────
    if (integration.mailboxPauseUntil && new Date(integration.mailboxPauseUntil) > now) {
      if (mb.status === 'active') {
        await db
          .update(warmupMailboxes)
          .set({ status: 'paused', pauseReason: 'recovery_mode' })
          .where(eq(warmupMailboxes.id, mb.id));
        console.log(`[Warmup][Recovery] ${mb.email} paused — integration paused until ${integration.mailboxPauseUntil}`);
      }
      return { ...this.getDefaultState(), lastEvaluatedAt: now.toISOString() };
    }

    // ── Score & level classification ──────────────────────────────────────
    const score = integration.reputationScore ?? 100;
    const scoreBasedLevel = this.classifyRecoveryLevel(score);
    const meta = mb.metadata as any;
    const recoveryMeta = meta?.recovery as Partial<ReputationState> | undefined;

    // ── Fix #2: Durable step-down ─────────────────────────────────────────
    // stepDownLevel persists across scans so we don't flip-flop
    let persistedStepDownLevel = recoveryMeta?.stepDownLevel ?? null;

    // Determine effective recovery level:
    // Start from score-based, then apply any durable step-down improvement
    let recoveryLevel = scoreBasedLevel;
    if (persistedStepDownLevel) {
      const persistedIdx = LEVEL_ORDER.indexOf(persistedStepDownLevel);
      const scoreIdx = LEVEL_ORDER.indexOf(scoreBasedLevel);
      // Only use step-down if it's actually better (lower index = worse)
      if (persistedIdx > scoreIdx) {
        recoveryLevel = persistedStepDownLevel;
      } else {
        // Score has caught up or passed the step-down — clear it
        persistedStepDownLevel = null;
      }
    }

    // ── Bounce tracking ──────────────────────────────────────────────────
    const last24hBounces = await this.countRecentBounces(mb.id, 24);
    const last24hSends = await this.countRecentSends(mb.id, 24);
    const hasRecentBounce = last24hBounces > 0;

    // ── Consecutive clean days (Fix: uses actual interval) ────────────────
    let consecutiveCleanDays = recoveryMeta?.consecutiveCleanDays ?? 0;
    const scanIntervalMinutes = WARMUP_CONFIG.RECOVERY_SCAN_INTERVAL_MS / (60 * 1000);
    if (!hasRecentBounce && last24hSends > 0) {
      consecutiveCleanDays += scanIntervalMinutes / (60 * 24);
    } else if (hasRecentBounce) {
      consecutiveCleanDays = 0;
    }
    consecutiveCleanDays = Math.min(consecutiveCleanDays, 30);

    // ── Step-down logic (durable) ─────────────────────────────────────────
    let stepDownLevel: RecoveryLevel | null = persistedStepDownLevel;
    let transition: string | undefined;

    if (this.shouldStepDown(recoveryLevel, consecutiveCleanDays)) {
      const nextLevel = this.getNextLevelDown(recoveryLevel);
      stepDownLevel = nextLevel;
      recoveryLevel = nextLevel;
      consecutiveCleanDays = 0;

      if (nextLevel === 'healthy') {
        transition = 'recovered';
        console.log(`[Warmup][Recovery] ${mb.email} FULLY RECOVERED → healthy (score=${score})`);
      } else {
        transition = 'stepped_down';
        console.log(`[Warmup][Recovery] ${mb.email} stepped down ${recoveryLevel} → ${nextLevel} (score=${score})`);
      }
    }

    // ── Escalation detection (score got worse) ────────────────────────────
    const prevLevel = recoveryMeta?.recoveryLevel;
    if (prevLevel && LEVEL_ORDER.indexOf(scoreBasedLevel) < LEVEL_ORDER.indexOf(prevLevel)) {
      // Score degraded — reset step-down, re-escalate
      stepDownLevel = null;
      recoveryLevel = scoreBasedLevel;
      transition = 'escalated';
      consecutiveCleanDays = 0;
      console.log(`[Warmup][Recovery] ${mb.email} escalated ${prevLevel} → ${scoreBasedLevel} (score=${score})`);
    }

    // ── Build state ──────────────────────────────────────────────────────
    const warmupLimit = this.getWarmupLimit(recoveryLevel);
    const maxThreads = this.getMaxThreads(recoveryLevel);

    const recoveryState: ReputationState = {
      recoveryLevel,
      reputationScore: score,
      warmupLimit,
      maxThreads,
      consecutiveCleanDays,
      lastBounceAt: hasRecentBounce ? now.toISOString() : (recoveryMeta?.lastBounceAt ?? null),
      recoveryStartedAt: recoveryMeta?.recoveryStartedAt ?? (
        recoveryLevel !== 'healthy' ? now.toISOString() : null
      ),
      recoveryEscalatedAt: recoveryMeta?.recoveryEscalatedAt ?? (
        recoveryLevel === 'critical' || recoveryLevel === 'poor' ? now.toISOString() : null
      ),
      lastEvaluatedAt: now.toISOString(),
      stepDownLevel,
    };

    // ── Fix #7: Clean up metadata when healthy for more than 7 days ──────
    if (recoveryLevel === 'healthy' && (recoveryMeta?.consecutiveCleanDays ?? 0) > 7 && recoveryMeta?.recoveryStartedAt) {
      // Remove recovery key entirely to clean up metadata
      await db
        .update(warmupMailboxes)
        .set({
          metadata: sql`${warmupMailboxes.metadata} - 'recovery'`,
        })
        .where(eq(warmupMailboxes.id, mb.id));
      return { ...recoveryState, transition: transition ?? 'cleaned' };
    }

    // ── Pause/reactivate based on recent bounces ──────────────────────────
    const wantPaused = recoveryLevel !== 'healthy' && hasRecentBounce;
    if (wantPaused && mb.status === 'active') {
      await db
        .update(warmupMailboxes)
        .set({
          status: 'paused',
          pauseReason: 'recovery_mode',
          metadata: sql`jsonb_set(${warmupMailboxes.metadata}, '{recovery}', ${JSON.stringify(recoveryState)}::jsonb)`,
        })
        .where(eq(warmupMailboxes.id, mb.id));
      console.log(`[Warmup][Recovery] ${mb.email} paused — recent bounce during recovery (score=${score})`);
    } else if (!wantPaused && mb.status === 'paused' && mb.pauseReason === 'recovery_mode') {
      await db
        .update(warmupMailboxes)
        .set({
          status: 'active',
          pauseReason: null,
          metadata: sql`jsonb_set(${warmupMailboxes.metadata}, '{recovery}', ${JSON.stringify(recoveryState)}::jsonb)`,
        })
        .where(eq(warmupMailboxes.id, mb.id));
      console.log(`[Warmup][Recovery] ${mb.email} reactivated — no recent bounces`);
    } else {
      await db
        .update(warmupMailboxes)
        .set({
          metadata: sql`jsonb_set(${warmupMailboxes.metadata}, '{recovery}', ${JSON.stringify(recoveryState)}::jsonb)`,
        })
        .where(eq(warmupMailboxes.id, mb.id));
    }

    if (recoveryLevel !== 'healthy') {
      console.log(
        `[Warmup][Recovery] ${mb.email} [${recoveryLevel}] score=${score} ` +
        `warmupLimit=${recoveryState.warmupLimit} maxThreads=${recoveryState.maxThreads} ` +
        `clean=${consecutiveCleanDays.toFixed(1)}d bounces_24h=${last24hBounces}`
      );
    }

    return { ...recoveryState, transition };
  }

  getEffectiveLimit(mb: typeof warmupMailboxes.$inferSelect, baseLimit: number): number {
    const meta = mb.metadata as any;
    const recoveryMeta = meta?.recovery as ReputationState | undefined;
    if (!recoveryMeta || recoveryMeta.recoveryLevel === 'healthy') {
      return baseLimit;
    }
    return Math.max(baseLimit, recoveryMeta.warmupLimit ?? baseLimit);
  }

  getMaxThreadsForMailbox(mb: typeof warmupMailboxes.$inferSelect): number {
    const meta = mb.metadata as any;
    const recoveryMeta = meta?.recovery as ReputationState | undefined;
    if (!recoveryMeta || recoveryMeta.recoveryLevel === 'healthy') {
      return 3;
    }
    return recoveryMeta.maxThreads ?? 3;
  }

  // ── Fix #12: Utility method to check if a mailbox is in recovery mode ──
  isInRecovery(mb: typeof warmupMailboxes.$inferSelect): boolean {
    const meta = mb.metadata as any;
    return !!(meta?.recovery?.recoveryLevel && meta.recovery.recoveryLevel !== 'healthy');
  }

  private async markUnenrolled(mb: typeof warmupMailboxes.$inferSelect, reason: string): Promise<void> {
    await db
      .update(warmupMailboxes)
      .set({
        status: 'unenrolled',
        pauseReason: reason,
        metadata: sql`${warmupMailboxes.metadata} - 'recovery'`,
      })
      .where(eq(warmupMailboxes.id, mb.id));
    console.log(`[Warmup][Recovery] ${mb.email} unenrolled — ${reason}`);
  }

  private classifyRecoveryLevel(score: number): RecoveryLevel {
    if (score < SCORE_THRESHOLDS.critical) return 'critical';
    if (score < SCORE_THRESHOLDS.poor) return 'poor';
    if (score < SCORE_THRESHOLDS.cautious) return 'cautious';
    return 'healthy';
  }

  private getWarmupLimit(level: RecoveryLevel): number {
    switch (level) {
      case 'critical': return WARMUP_CONFIG.RECOVERY_CRITICAL_WARMUP_LIMIT;
      case 'poor':     return WARMUP_CONFIG.RECOVERY_POOR_WARMUP_LIMIT;
      case 'cautious': return WARMUP_CONFIG.RECOVERY_CAUTIOUS_WARMUP_LIMIT;
      case 'healthy':  return WARMUP_CONFIG.DAILY_SENT_LIMIT;
    }
  }

  private getMaxThreads(level: RecoveryLevel): number {
    switch (level) {
      case 'critical': return WARMUP_CONFIG.RECOVERY_MAX_THREADS_CRITICAL;
      case 'poor':     return WARMUP_CONFIG.RECOVERY_MAX_THREADS_POOR;
      case 'cautious': return WARMUP_CONFIG.RECOVERY_MAX_THREADS_CAUTIOUS;
      case 'healthy':  return 3;
    }
  }

  private shouldStepDown(currentLevel: RecoveryLevel, consecutiveCleanDays: number): boolean {
    if (currentLevel === 'critical') {
      return consecutiveCleanDays >= WARMUP_CONFIG.RECOVERY_MIN_CLEAN_DAYS_CRITICAL;
    }
    if (currentLevel === 'poor') {
      return consecutiveCleanDays >= WARMUP_CONFIG.RECOVERY_MIN_CLEAN_DAYS_POOR;
    }
    return false;
  }

  private getNextLevelDown(current: RecoveryLevel): RecoveryLevel {
    switch (current) {
      case 'critical': return 'poor';
      case 'poor':     return 'cautious';
      case 'cautious': return 'healthy';
      default:         return 'healthy';
    }
  }

  private async countRecentBounces(mailboxId: string, hours: number): Promise<number> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(warmupInteractions)
      .where(
        and(
          eq(warmupInteractions.fromMailboxId, mailboxId),
          eq(warmupInteractions.direction, 'outbound'),
          eq(warmupInteractions.status, 'bounced'),
          gte(warmupInteractions.sentAt, since)
        )
      );
    return result[0]?.count ?? 0;
  }

  private async countRecentSends(mailboxId: string, hours: number): Promise<number> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(warmupInteractions)
      .where(
        and(
          eq(warmupInteractions.fromMailboxId, mailboxId),
          eq(warmupInteractions.direction, 'outbound'),
          gte(warmupInteractions.sentAt, since)
        )
      );
    return result[0]?.count ?? 0;
  }

  private getDefaultState(): ReputationState {
    return {
      recoveryLevel: 'healthy',
      reputationScore: 100,
      warmupLimit: WARMUP_CONFIG.DAILY_SENT_LIMIT,
      maxThreads: 3,
      consecutiveCleanDays: 0,
      lastBounceAt: null,
      recoveryStartedAt: null,
      recoveryEscalatedAt: null,
      lastEvaluatedAt: new Date().toISOString(),
      stepDownLevel: null,
    };
  }
}

export const reputationRecovery = new ReputationRecovery();
