import { db } from '../db/warmup-db.js';
import { eq, and, sql, lt, not, isNull, inArray } from 'drizzle-orm';
import {
  warmupSeedAccounts, warmupMailboxes, warmupDomainClusters,
} from '@audnix/shared';
import { WARMUP_CONFIG } from '../config/warmup-config.js';
import { domainClusterEngine } from './domain-cluster.js';
import { detectProvider } from '../lib/provider-utils.js';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { encryptWarmupSecret, decryptWarmupSecret } from '../lib/warmup-crypto.js';

interface SeedConfig {
  email: string;
  provider?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  imapHost?: string;
  imapPort?: number;
  imapUser?: string;
  imapPass?: string;
  oauthUserId?: string;
  dailyLimit?: number;
  maxPartners?: number;
  source?: string;
  seedAccountId?: string;
}

export class SeedFleetManager {
  async provisionFromEnv(): Promise<number> {
    const raw = process.env.WARMUP_SEEDS;
    if (!raw) {
      console.log('[Warmup][Seeds] No WARMUP_SEEDS env var');
      return 0;
    }

    let seeds: SeedConfig[];
    try {
      seeds = JSON.parse(raw);
      if (!Array.isArray(seeds)) throw new Error('must be a JSON array');
    } catch (err: any) {
      console.error('[Warmup][Seeds] Failed to parse WARMUP_SEEDS:', err.message);
      return 0;
    }

    let provisioned = 0;
    for (const config of seeds) {
      if (!config.email || !config.smtpPass) {
        console.warn(`[Warmup][Seeds] Skipping ${config.email || 'unknown'} — missing email or smtpPass`);
        continue;
      }

      const existing = await db
        .select()
        .from(warmupSeedAccounts)
        .where(eq(warmupSeedAccounts.email, config.email))
        .limit(1);

      const provider = (config.provider || detectProvider(config.email)) as any;
      const mappedProvider = provider === 'custom_email' ? 'gmail' : provider;

      if (existing.length > 0) {
        await db
          .update(warmupSeedAccounts)
          .set({
            metadata: { ...(existing[0].metadata as any || {}), ...config },
            dailyLimit: config.dailyLimit || WARMUP_CONFIG.SEED_DAILY_LIMIT,
            maxPartners: config.maxPartners || WARMUP_CONFIG.SEED_MAX_PARTNERS,
            status: 'active',
          })
          .where(eq(warmupSeedAccounts.id, existing[0].id));

        await this.verifySeedConnection(existing[0].id, config);
        continue;
      }

      const [seed] = await db
        .insert(warmupSeedAccounts)
        .values({
          email: config.email,
          provider: mappedProvider,
          status: 'active',
          dailyLimit: config.dailyLimit || WARMUP_CONFIG.SEED_DAILY_LIMIT,
          maxPartners: config.maxPartners || WARMUP_CONFIG.SEED_MAX_PARTNERS,
          metadata: {
            ...config,
            smtpPass: config.smtpPass ? encryptWarmupSecret(config.smtpPass) : undefined,
            imapPass: config.imapPass ? encryptWarmupSecret(config.imapPass) : undefined,
            source: 'env_provisioned',
          },
        })
        .returning();

      await this.verifySeedConnection(seed.id, config);
      console.log(`[Warmup][Seeds] Provisioned seed: ${config.email} (${mappedProvider})`);
      provisioned++;
    }

    if (provisioned > 0) {
      console.log(`[Warmup][Seeds] ${provisioned} new seed(s) provisioned`);
    }
    return provisioned;
  }

  async verifySeedConnection(seedId: string, config: SeedConfig): Promise<boolean> {
    console.log(`[Warmup][Seeds] Verifying ${config.email}...`);

    const smtpOk = await this.testSmtp(config);
    if (!smtpOk) {
      console.error(`[Warmup][Seeds] ❌ SMTP FAILED for ${config.email} — check credentials`);
      await db
        .update(warmupSeedAccounts)
        .set({ status: 'error', metadata: sql`jsonb_set(${warmupSeedAccounts.metadata}, '{lastError}', '"SMTP connection failed"')` })
        .where(eq(warmupSeedAccounts.id, seedId));
      return false;
    }

    const imapOk = await this.testImap(config);
    if (!imapOk) {
      console.warn(`[Warmup][Seeds] ⚠️ IMAP failed for ${config.email} — spam rescue disabled but SMTP is OK`);
      await db
        .update(warmupSeedAccounts)
        .set({ metadata: sql`jsonb_set(${warmupSeedAccounts.metadata}, '{lastError}', '"IMAP connection failed — spam rescue disabled"')` })
        .where(eq(warmupSeedAccounts.id, seedId));
    }

    console.log(`[Warmup][Seeds] ✅ ${config.email} — SMTP: OK, IMAP: ${imapOk ? 'OK' : 'FAILED'}`);
    return true;
  }

  private async testSmtp(config: SeedConfig): Promise<boolean> {
    const host = config.smtpHost || (config.provider === 'outlook' ? 'smtp.office365.com' : 'smtp.gmail.com');
    const port = config.smtpPort || (config.provider === 'outlook' ? 587 : 587);
    const secure = parseInt(String(port)) === 465;
    const user = config.smtpUser || config.email;

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass: config.smtpPass },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
    });

    try {
      await transporter.verify();
      await transporter.close();
      return true;
    } catch {
      try { await transporter.close(); } catch {}
      return false;
    }
  }

  private async testImap(config: SeedConfig): Promise<boolean> {
    const host = config.imapHost || (config.provider === 'outlook' ? 'outlook.office365.com' : 'imap.gmail.com');
    const port = config.imapPort || 993;
    const user = config.imapUser || config.email;
    const pass = config.imapPass || config.smtpPass;

    const client = new ImapFlow({
      host,
      port,
      secure: true,
      auth: { user, pass },
      logger: false,
      connectionTimeout: 15000,
      greetingTimeout: 15000,
    });

    try {
      await client.connect();
      await client.logout();
      return true;
    } catch {
      try { await client.logout(); } catch {}
      return false;
    }
  }

  async assignSeedToDomain(domain: string, orgId: string | null, preferredProvider?: string): Promise<string | null> {
    const availableSeed = await this.findAvailableSeed(preferredProvider);
    if (!availableSeed) return null;

    const cluster = await domainClusterEngine.getClusterByDomain(domain, orgId);
    if (!cluster) return null;

    const meta = (availableSeed.metadata as any) || {};
    const config = meta as SeedConfig;

    const rawSmtpPass = config.smtpPass ? decryptWarmupSecret(config.smtpPass) : '';
    const rawImapPass = config.imapPass ? decryptWarmupSecret(config.imapPass) : (rawSmtpPass || '');

    const [seedMailbox] = await db
      .insert(warmupMailboxes)
      .values({
        integrationId: null,
        userId: 'system',
        organizationId: orgId,
        email: availableSeed.email,
        provider: availableSeed.provider,
        status: 'active',
        poolType: orgId ? 'enterprise' : 'global',
        registeredDomain: domain,
        anchorRole: 'seed',
        dailyLimit: availableSeed.dailyLimit,
        metadata: {
          smtpHost: config.smtpHost,
          smtpPort: config.smtpPort,
          smtpUser: config.smtpUser || availableSeed.email,
          smtpPass: rawSmtpPass ? encryptWarmupSecret(rawSmtpPass) : '',
          imapHost: config.imapHost,
          imapPort: config.imapPort,
          imapUser: config.imapUser || availableSeed.email,
          imapPass: rawImapPass ? encryptWarmupSecret(rawImapPass) : '',
          oauthUserId: config.oauthUserId,
          seedAccountId: availableSeed.id,
          source: 'warmup_seed',
        },
      })
      .returning();

    await db
      .update(warmupSeedAccounts)
      .set({
        partnerCount: sql`${warmupSeedAccounts.partnerCount} + 1`,
        assignedDomainClusterIds: sql`array_append(${warmupSeedAccounts.assignedDomainClusterIds}, ${domain})`,
      })
      .where(eq(warmupSeedAccounts.id, availableSeed.id));

    await domainClusterEngine.assignSeedToCluster(seedMailbox.id, domain, orgId);

    console.log(`[Warmup][Seeds] Assigned ${availableSeed.email} → domain ${domain}`);
    return seedMailbox.id;
  }

  async findAvailableSeed(preferredProvider?: string): Promise<typeof warmupSeedAccounts.$inferSelect | null> {
    if (preferredProvider) {
      const preferred = await this.findLeastLoadedSeed(preferredProvider);
      if (preferred) return preferred;
    }

    const strategies: Array<(p?: string) => Promise<typeof warmupSeedAccounts.$inferSelect | null>> = [
      this.findLeastLoadedSeed,
      this.findCooledDownSeed,
      this.findAnyActiveSeed,
    ];

    for (const strat of strategies) {
      const seed = await strat.call(this);
      if (seed) return seed;
    }

    return null;
  }

  private async findLeastLoadedSeed(providerFilter?: string): Promise<typeof warmupSeedAccounts.$inferSelect | null> {
    const conditions: any[] = [
      eq(warmupSeedAccounts.status, 'active'),
      sql`${warmupSeedAccounts.partnerCount} < ${warmupSeedAccounts.maxPartners}`,
      sql`${warmupSeedAccounts.dailySentCount} < ${warmupSeedAccounts.dailyLimit}`,
    ];
    if (providerFilter) {
      conditions.push(eq(warmupSeedAccounts.provider, providerFilter as any));
    }

    const seeds = await db
      .select()
      .from(warmupSeedAccounts)
      .where(and(...conditions))
      .orderBy(sql`${warmupSeedAccounts.partnerCount} ASC`)
      .limit(1);

    return seeds[0] || null;
  }

  private async findCooledDownSeed(): Promise<typeof warmupSeedAccounts.$inferSelect | null> {
    const cooldownThreshold = new Date(Date.now() - WARMUP_CONFIG.SEED_COOLDOWN_AFTER_EXHAUSTED_MS);
    const seeds = await db
      .select()
      .from(warmupSeedAccounts)
      .where(
        and(
          eq(warmupSeedAccounts.status, 'cooling'),
          lt(warmupSeedAccounts.updatedAt, cooldownThreshold),
          sql`${warmupSeedAccounts.partnerCount} < ${warmupSeedAccounts.maxPartners}`
        )
      )
      .limit(1);

    if (seeds[0]) {
      await db
        .update(warmupSeedAccounts)
        .set({ status: 'active', dailySentCount: 0 })
        .where(eq(warmupSeedAccounts.id, seeds[0].id));
      return seeds[0];
    }
    return null;
  }

  private async findAnyActiveSeed(): Promise<typeof warmupSeedAccounts.$inferSelect | null> {
    const seeds = await db
      .select()
      .from(warmupSeedAccounts)
      .where(
        and(
          eq(warmupSeedAccounts.status, 'active'),
          sql`${warmupSeedAccounts.dailySentCount} < ${warmupSeedAccounts.dailyLimit}`
        )
      )
      .orderBy(sql`${warmupSeedAccounts.partnerCount} ASC`)
      .limit(1);

    return seeds[0] || null;
  }

  async markExhausted(seedId: string): Promise<void> {
    await db
      .update(warmupSeedAccounts)
      .set({ status: 'exhausted' })
      .where(eq(warmupSeedAccounts.id, seedId));
  }

  async handleSeedFailure(seedMailboxId: string): Promise<void> {
    const mb = await db
      .select()
      .from(warmupMailboxes)
      .where(eq(warmupMailboxes.id, seedMailboxId))
      .limit(1);

    if (!mb[0]) return;

    const meta = mb[0].metadata as any;
    const seedAccountId = meta?.seedAccountId;
    if (!seedAccountId) return;

    await db
      .update(warmupSeedAccounts)
      .set({ status: 'error' })
      .where(eq(warmupSeedAccounts.id, seedAccountId));

    const domain = mb[0].registeredDomain;
    const orgId = mb[0].organizationId;

    if (domain) {
      await db
        .update(warmupMailboxes)
        .set({ status: 'paused', pauseReason: 'seed_unavailable', anchorMailboxId: null })
        .where(eq(warmupMailboxes.anchorMailboxId, seedMailboxId));

      const cluster = await domainClusterEngine.getClusterByDomain(domain, orgId);
      if (cluster) {
        const remainingSeeds = cluster.seedMailboxIds.filter(id => id !== seedMailboxId);
        await db
          .update(warmupDomainClusters)
          .set({
            seedMailboxIds: remainingSeeds,
            isHealthy: remainingSeeds.length >= WARMUP_CONFIG.ANCHORS_PER_DOMAIN,
          })
          .where(
            and(
              eq(warmupDomainClusters.registeredDomain, domain),
              orgId ? eq(warmupDomainClusters.organizationId, orgId) : isNull(warmupDomainClusters.organizationId)
            )
          );
      }
    }

    await db
      .update(warmupMailboxes)
      .set({ status: 'error', pauseReason: 'seed_connection_failed' })
      .where(eq(warmupMailboxes.id, seedMailboxId));

    console.warn(`[Warmup][Seeds] Seed ${mb[0].email} failed — members paused, requesting replacement`);
    await this.assignSeedToDomain(domain || '', orgId);
  }

  async rotateExhaustedSeeds(): Promise<void> {
    const exhausted = await db
      .select()
      .from(warmupSeedAccounts)
      .where(eq(warmupSeedAccounts.status, 'exhausted'));

    for (const seed of exhausted) {
      const cooledAt = new Date(seed.updatedAt.getTime() + WARMUP_CONFIG.SEED_COOLDOWN_AFTER_EXHAUSTED_MS);
      if (new Date() >= cooledAt) {
        await db
          .update(warmupSeedAccounts)
          .set({ status: 'cooling', updatedAt: new Date() })
          .where(eq(warmupSeedAccounts.id, seed.id));
      }
    }
  }

  async incrementSeedSentCount(seedMailboxId: string): Promise<void> {
    const mb = await db
      .select()
      .from(warmupMailboxes)
      .where(eq(warmupMailboxes.id, seedMailboxId))
      .limit(1);

    if (!mb[0]) return;
    const meta = mb[0].metadata as any;
    const seedAccountId = meta?.seedAccountId;
    if (!seedAccountId) return;

    // Atomic increment + exhaust check in single query to eliminate race condition.
    // Using a CTE: increment dailySentCount, then update status to exhausted
    // IF the new dailySentCount >= dailyLimit, all in one transaction.
    await db.execute(sql`
      WITH incremented AS (
        UPDATE warmup_seed_accounts
        SET daily_sent_count = daily_sent_count + 1
        WHERE id = ${seedAccountId}::uuid
        RETURNING id, daily_sent_count, daily_limit
      )
      UPDATE warmup_seed_accounts
      SET status = 'exhausted'
      FROM incremented
      WHERE warmup_seed_accounts.id = incremented.id
      AND incremented.daily_sent_count >= COALESCE(incremented.daily_limit, ${WARMUP_CONFIG.SEED_DAILY_LIMIT})
    `);
  }

  async resetSeedDailyCounters(): Promise<void> {
    await db
      .update(warmupSeedAccounts)
      .set({ dailySentCount: 0, lastResetAt: new Date() })
      .where(not(eq(warmupSeedAccounts.status, 'retired')));

    await db
      .update(warmupSeedAccounts)
      .set({ status: 'active' })
      .where(sql`${warmupSeedAccounts.status} IN ('exhausted', 'cooling')`);
  }

  async assignSeedToDomainWithFallback(domain: string, orgId: string | null): Promise<string | null> {
    const cluster = await domainClusterEngine.getClusterByDomain(domain, orgId);
    if (!cluster) return null;

    const existingSeedIds = [...cluster.seedMailboxIds, ...cluster.anchorMailboxIds];
    const existingSeeds = existingSeedIds.length > 0
      ? await db.select().from(warmupMailboxes).where(inArray(warmupMailboxes.id, existingSeedIds))
      : [];

    const hasGoogle = existingSeeds.some(s => s.provider === 'gmail');
    const hasMicrosoft = existingSeeds.some(s => s.provider === 'outlook');

    let assigned: string | null = null;

    if (!hasMicrosoft) {
      assigned = await this.assignSeedToDomain(domain, orgId, 'outlook');
    }
    if (!assigned && !hasGoogle) {
      assigned = await this.assignSeedToDomain(domain, orgId, 'gmail');
    }
    if (!assigned) {
      assigned = await this.assignSeedToDomain(domain, orgId);
    }
    if (!assigned && (!hasGoogle || !hasMicrosoft)) {
      assigned = await this.assignSeedToDomain(domain, orgId);
      if (!assigned) {
        console.warn(`[Warmup][Seeds] No seeds available for domain ${domain}`);
      }
    }

    return assigned;
  }

  async getSeedMetrics(): Promise<{
    total: number; active: number; exhausted: number; cooling: number;
    avgPartnerLoad: number; googleSeeds: number; msSeeds: number;
  }> {
    const seeds = await db.select().from(warmupSeedAccounts);
    return {
      total: seeds.length,
      active: seeds.filter(s => s.status === 'active').length,
      exhausted: seeds.filter(s => s.status === 'exhausted').length,
      cooling: seeds.filter(s => s.status === 'cooling').length,
      avgPartnerLoad: seeds.length > 0
        ? seeds.reduce((sum, s) => sum + s.partnerCount, 0) / seeds.length
        : 0,
      googleSeeds: seeds.filter(s => s.provider === 'gmail').length,
      msSeeds: seeds.filter(s => s.provider === 'outlook').length,
    };
  }
}

export const seedFleetManager = new SeedFleetManager();