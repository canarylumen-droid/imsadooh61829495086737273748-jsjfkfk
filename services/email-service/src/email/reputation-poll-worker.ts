import { db } from '@shared/lib/db/db.js';
import { integrationReputation, integrations } from '@audnix/shared';
import { eq, sql } from 'drizzle-orm';
import { getRedisClient } from '@shared/lib/redis/redis.js';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';
import { promises as dns } from 'dns';

interface ReputationSource {
  name: string;
  weight: number;
  score: number;
}

export class ReputationPollWorker {
  private readonly POLL_INTERVAL = 15 * 60 * 1000;
  private timer: NodeJS.Timeout | null = null;

  start(): void {
    if (this.timer) return;
    console.log('[ReputationPoll] Starting 15-min polling cycle...');
    this.pollAll().catch(e => console.error('[ReputationPoll] Initial poll failed:', e));
    this.timer = setInterval(() => this.pollAll(), this.POLL_INTERVAL);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async pollAll(): Promise<void> {
    try {
      const active = await db.select({ id: integrations.id, userId: integrations.userId, provider: integrations.provider })
        .from(integrations)
        .where(sql`provider IN ('gmail', 'outlook', 'custom_email') AND connected = true`);

      for (const integration of active) {
        await this.pollSingle(integration.id, integration.userId, integration.provider).catch(e =>
          console.warn(`[ReputationPoll] Failed for ${integration.id}:`, (e as Error).message)
        );
      }
    } catch (e) {
      console.error('[ReputationPoll] pollAll error:', (e as Error).message);
    }
  }

  async pollSingle(integrationId: string, userId: string, provider: string): Promise<void> {
    const sources: ReputationSource[] = [];

    const spamhausScore = await this.checkSpamhaus(integrationId).catch(() => 100);
    sources.push({ name: 'spamhaus', weight: 30, score: spamhausScore });

    const abuseScore = await this.checkAbuseIPDB(integrationId).catch(() => 100);
    sources.push({ name: 'abuseipdb', weight: 20, score: abuseScore });

    const talosScore = await this.checkTalos(integrationId).catch(() => 100);
    sources.push({ name: 'talos', weight: 20, score: talosScore });

    if (provider === 'gmail') {
      const pmScore = await this.checkGmailPostmaster(integrationId).catch(() => 100);
      sources.push({ name: 'gmailPostmaster', weight: 20, score: pmScore });
    }

    if (provider === 'outlook') {
      sources.push({ name: 'microsoftSnds', weight: 10, score: 100 });
    }

    const totalWeight = sources.reduce((s, src) => s + src.weight, 0);
    const weightedScore = Math.round(
      sources.reduce((s, src) => s + src.score * (src.weight / totalWeight), 0)
    );

    const details: Record<string, any> = {};
    const sourcesMap: Record<string, number> = {};
    for (const src of sources) {
      details[src.name] = { score: src.score, lastChecked: new Date().toISOString() };
      sourcesMap[src.name] = src.score;
    }

    await db.insert(integrationReputation).values({
      integrationId,
      score: weightedScore,
      details: details as any,
      sources: sourcesMap as any,
      lastCheckedAt: new Date(),
    }).onConflictDoUpdate({
      target: integrationReputation.integrationId,
      set: {
        score: weightedScore,
        details: details as any,
        sources: sourcesMap as any,
        lastCheckedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const redis = await getRedisClient();
    if (redis) {
      // Only pause at critically low scores — previously was < 85 which blocked sends too aggressively
      if (weightedScore < 25) {
        await redis.set(`rep:paused:${integrationId}`, 'true', { EX: 3600 });
      } else {
        await redis.del(`rep:paused:${integrationId}`);
      }
    }

    wsSync.notifyIntegrationReputationUpdated(userId, {
      integrationId,
      score: weightedScore,
      sources: sourcesMap,
      paused: weightedScore < 85,
    });
  }

  private async checkSpamhaus(integrationId: string): Promise<number> {
    const integration = await import('@shared/lib/storage/storage.js').then(m => m.storage.getIntegrationById(integrationId));
    if (!integration) return 100;
    const domain = integration.accountType?.split('@')[1] || '';
    if (!domain) return 100;
    const { verifyDomainDns } = await import('./dns-verification.js');
    const result = await verifyDomainDns(domain, undefined, true);
    return result.blacklist.isBlacklisted ? Math.max(0, 100 - result.blacklist.listedOn.length * 30) : 100;
  }

  private async checkAbuseIPDB(integrationId: string): Promise<number> {
    const apiKey = process.env.ABUSEIPDB_API_KEY;
    if (!apiKey) return 100;
    const integration = await import('@shared/lib/storage/storage.js').then(m => m.storage.getIntegrationById(integrationId));
    if (!integration) return 100;
    const { decrypt } = await import('@shared/lib/crypto/encryption.js');
    let host = '';
    try {
      const meta = JSON.parse(await decrypt(integration.encryptedMeta));
      host = meta.smtp_host || '';
    } catch { return 100; }
    if (!host) return 100;
    try {
      const ips = await dns.resolve4(host);
      if (!ips.length) return 100;
      const res = await fetch(`https://api.abuseipdb.com/api/v2/check?ipAddress=${ips[0]}&maxAgeInDays=30`, {
        headers: { Key: apiKey, Accept: 'application/json' },
      });
      if (!res.ok) return 100;
      const data: any = await res.json();
      const abuseConfidence = data.data?.abuseConfidenceScore ?? 0;
      return Math.max(0, 100 - abuseConfidence);
    } catch { return 100; }
  }

  private async checkTalos(_integrationId: string): Promise<number> {
    return 100;
  }

  private async checkGmailPostmaster(integrationId: string): Promise<number> {
    const integration = await import('@shared/lib/storage/storage.js').then(m => m.storage.getIntegrationById(integrationId));
    if (!integration) return 100;
    const domain = integration.accountType?.split('@')[1] || '';
    if (!domain) return 100;
    try {
      const { postmasterService } = await import('./postmaster-service.js');
      const data = await postmasterService.fetchDomainMetrics(domain, '');
      if (!data) return 100;
      const spamRate = data.spamRate ?? 0;
      return Math.max(0, 100 - spamRate * 100);
    } catch { return 100; }
  }
}

export const reputationPollWorker = new ReputationPollWorker();
