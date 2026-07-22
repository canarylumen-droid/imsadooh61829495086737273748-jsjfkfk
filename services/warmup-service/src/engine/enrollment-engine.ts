import { db } from '../db/warmup-db.js';
import { eq, and, or, not, inArray, isNull, gte } from 'drizzle-orm';
import {
  integrations,
  users,
  organizations,
  teamMembers,
  userOutreachSettings,
  warmupMailboxes,
} from '@audnix/shared';
import type { PoolType, AnchorRole } from '../types/warmup-types.js';
import { decrypt } from '@shared/lib/crypto/encryption.js';
import { domainClusterEngine } from './domain-cluster.js';
import { anchorEngine } from './anchor-engine.js';
import { WARMUP_CONFIG } from '../config/warmup-config.js';

const ALLOWED_PROVIDERS = ['gmail', 'outlook', 'custom_email'] as const;
const BLOCKED_HEALTH = ['suspended', 'revoked', 'error'] as const;

export class EnrollmentEngine {
  async scan(): Promise<number> {
    console.log('[Warmup][Enrollment] Scanning for new mailboxes...');

    const eligible = await this.findEligibleIntegrations();
    let enrolled = 0;

    for (const integration of eligible) {
      try {
        await this.enroll(integration);
        enrolled++;
      } catch (err: any) {
        console.error(`[Warmup][Enrollment] Failed to enroll ${(integration as any).id}:`, err.message);
      }
    }

    await this.cleanupDisconnected();

    if (enrolled > 0) {
      console.log(`[Warmup][Enrollment] Enrolled ${enrolled} new mailbox(es).`);

      await domainClusterEngine.scanAndCluster();

      const unclustered = await db
        .select({ registeredDomain: warmupMailboxes.registeredDomain, organizationId: warmupMailboxes.organizationId })
        .from(warmupMailboxes)
        .where(isNull(warmupMailboxes.anchorRole));

      const domains = new Set<string>();
      for (const mb of unclustered) {
        if (mb.registeredDomain) {
          const key = `${mb.registeredDomain}::${mb.organizationId || 'null'}`;
          if (!domains.has(key)) {
            domains.add(key);
            await this.autoAssignAnchorRoles(mb.registeredDomain, mb.organizationId);
          }
        }
      }

      for (const domainKey of domains) {
        const [domain, orgIdStr] = domainKey.split('::');
        const orgId = orgIdStr === 'null' ? null : orgIdStr;
        await anchorEngine.rebalanceDomain(domain, orgId);
      }
    }
    return enrolled;
  }

  private async autoAssignAnchorRoles(domain: string, orgId: string | null): Promise<void> {
    const gmailOutlook = await db
      .select()
      .from(warmupMailboxes)
      .where(
        and(
          eq(warmupMailboxes.registeredDomain, domain),
          orgId ? eq(warmupMailboxes.organizationId, orgId) : isNull(warmupMailboxes.organizationId),
          eq(warmupMailboxes.status, 'paused'),
          inArray(warmupMailboxes.provider, ['gmail', 'outlook']),
          isNull(warmupMailboxes.anchorRole)
        )
      )
      .orderBy(warmupMailboxes.createdAt)
      .limit(WARMUP_CONFIG.ANCHORS_PER_DOMAIN);

    for (const mb of gmailOutlook) {
      await db
        .update(warmupMailboxes)
        .set({ anchorRole: 'anchor' })
        .where(eq(warmupMailboxes.id, mb.id));
      console.log(`[Warmup][Enrollment] Auto-promoted ${mb.email} to anchor for domain ${domain}`);
    }

    await db
      .update(warmupMailboxes)
      .set({ anchorRole: 'member' })
      .where(
        and(
          eq(warmupMailboxes.registeredDomain, domain),
          orgId ? eq(warmupMailboxes.organizationId, orgId) : isNull(warmupMailboxes.organizationId),
          isNull(warmupMailboxes.anchorRole)
        )
      );
  }

  private async findEligibleIntegrations() {
    const candidates = await db
      .select({
        integration: integrations,
        user: users,
      })
      .from(integrations)
      .innerJoin(users, eq(integrations.userId, users.id))
      .where(
        and(
          inArray(integrations.provider, ALLOWED_PROVIDERS as any),
          eq(integrations.connected, true),
          not(inArray(integrations.healthStatus, BLOCKED_HEALTH as any)),
          // Reputation pre-check: skip domains with critically low reputation
          or(
            gte(integrations.reputationScore, 20),
            isNull(integrations.reputationScore)
          )
        )
      );

    const alreadyEnrolled = await db
      .select({ integrationId: warmupMailboxes.integrationId })
      .from(warmupMailboxes);
    const enrolledIds = new Set(alreadyEnrolled.map((r: any) => r.integrationId));

    const eligible: Array<{
      integrationId: string;
      userId: string;
      email: string;
      provider: string;
      organizationId: string | null;
      plan: string;
      subscriptionTier: string | null;
      encryptedMeta: string | null;
      warmupLimit: number | null;
    }> = [];

    for (const row of candidates) {
      if (enrolledIds.has(row.integration.id)) continue;

      const isTrial = row.user.plan === 'trial' && row.user.subscriptionTier === 'free';
      if (isTrial) {
        const settings = await db
          .select()
          .from(userOutreachSettings)
          .where(eq(userOutreachSettings.userId, row.user.id))
          .limit(1);
        const warmupEnabled = settings[0]?.warmupEnabled ?? true;
        if (!warmupEnabled) continue;
      }

      let orgId: string | null = null;
      const team = await db
        .select()
        .from(teamMembers)
        .where(eq(teamMembers.userId, row.user.id))
        .limit(1);
      if (team[0]) orgId = team[0].organizationId;
      else {
        const org = await db
          .select()
          .from(organizations)
          .where(eq(organizations.ownerId, row.user.id))
          .limit(1);
        if (org[0]) orgId = org[0].id;
      }

      eligible.push({
        integrationId: row.integration.id,
        userId: row.user.id,
        email: row.integration?.accountType || row.user?.email || '',
        provider: row.integration.provider,
        organizationId: orgId,
        plan: row.user.plan,
        subscriptionTier: row.user.subscriptionTier,
        encryptedMeta: (row.integration as any).encryptedMeta || null,
        warmupLimit: (row.integration as any).warmupLimit ?? null,
      });
    }

    return eligible;
  }

  private async enroll(candidate: {
    integrationId: string;
    userId: string;
    email: string;
    provider: string;
    organizationId: string | null;
    plan: string;
    subscriptionTier: string | null;
    encryptedMeta: string | null;
    warmupLimit: number | null;
  }) {
    let metadata: any = {};
    if (candidate.encryptedMeta) {
      try {
        metadata = JSON.parse(decrypt(candidate.encryptedMeta));
      } catch (e) {
        console.warn(`[Warmup][Enrollment] Failed to decrypt metadata for ${candidate.email}:`, (e as Error).message);
      }
    }

    const poolType = await this.classifyPool(candidate);
    const mailboxEmail =
      metadata.smtp_user ||
      metadata.smtpUser ||
      metadata.user ||
      metadata.email ||
      metadata.accountType ||
      candidate.email;

    const registeredDomain = domainClusterEngine.extractRegisteredDomain(mailboxEmail);

    const [inserted] = await db.insert(warmupMailboxes).values({
      integrationId: candidate.integrationId,
      userId: candidate.userId,
      organizationId: candidate.organizationId,
      email: mailboxEmail,
      provider: candidate.provider as any,
      status: 'paused',  // Default OFF — user toggles via UI
      poolType,
      registeredDomain,
      anchorRole: 'member',
      dailySentCount: 0,
      dailyReceivedCount: 0,
      dailyLimit: candidate.warmupLimit ?? WARMUP_CONFIG.DAILY_SENT_LIMIT,
      metadata,
    }).returning();

    // Set integrations.warmupStatus='inactive' (default OFF — user toggles)
    try {
      await db.update(integrations)
        .set({ warmupStatus: 'inactive' } as any)
        .where(eq(integrations.id, candidate.integrationId));
    } catch (_) {}

    console.log(
      `[Warmup][Enrollment] Enrolled ${mailboxEmail} → domain=${registeredDomain}, pool=${poolType}`
    );

    // Fire-and-forget sent folder scan to copy user's real email subjects
    if (inserted) {
      import('../lib/sent-folder-scanner.js').then(({ scanSentFolder }) => {
        scanSentFolder(inserted.id).catch((err: any) =>
          console.warn(`[Warmup][Enrollment] Sent scan failed for ${mailboxEmail}:`, err.message)
        );
      });
    }
  }

  private async classifyPool(candidate: {
    plan: string;
    subscriptionTier: string | null;
    organizationId: string | null;
  }): Promise<PoolType> {
    const isEnterprise =
      candidate.plan === 'enterprise' || candidate.subscriptionTier === 'enterprise';
    if (!isEnterprise) return 'global';

    return 'enterprise';
  }

  private async cleanupDisconnected(): Promise<void> {
    const orphaned = await db
      .select({
        mbId: warmupMailboxes.id,
        integrationId: warmupMailboxes.integrationId,
      })
      .from(warmupMailboxes)
      .leftJoin(integrations, eq(warmupMailboxes.integrationId, integrations.id))
      .where(
        and(
          isNull(integrations.id),
          not(eq(warmupMailboxes.status, 'unenrolled')),
          not(eq(warmupMailboxes.anchorRole, 'seed'))
        )
      );

    if (orphaned.length > 0) {
      for (const row of orphaned) {
        await db
          .update(warmupMailboxes)
          .set({ status: 'unenrolled', pauseReason: 'integration_disconnected' })
          .where(eq(warmupMailboxes.id, row.mbId));
      }
      console.log(`[Warmup][Enrollment] Cleaned up ${orphaned.length} orphaned mailbox(es).`);
    }

    const disconnected = await db
      .select({
        mbId: warmupMailboxes.id,
      })
      .from(warmupMailboxes)
      .innerJoin(integrations, eq(warmupMailboxes.integrationId, integrations.id))
      .where(
        and(
          eq(integrations.connected, false),
          not(eq(warmupMailboxes.status, 'unenrolled'))
        )
      );

    if (disconnected.length > 0) {
      for (const row of disconnected) {
        await db
          .update(warmupMailboxes)
          .set({ status: 'unenrolled', pauseReason: 'integration_disconnected' })
          .where(eq(warmupMailboxes.id, row.mbId));
      }
      console.log(`[Warmup][Enrollment] Paused ${disconnected.length} mailbox(es) (integration disconnected).`);
    }
  }
}

export const enrollmentEngine = new EnrollmentEngine();