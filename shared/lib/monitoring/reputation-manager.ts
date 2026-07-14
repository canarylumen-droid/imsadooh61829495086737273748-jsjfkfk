import { db } from '@shared/lib/db/db.js';
import { integrations, domainVerifications, bounceTracker } from '@audnix/shared';
import { eq, and, gte, desc, sql } from 'drizzle-orm';
import { decrypt } from '@shared/lib/crypto/encryption.js';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';
import { pubsubService } from '@shared/lib/realtime/pubsub-service.js';
import { decryptToJSON } from '@shared/lib/crypto/encryption.js';
import { postmasterService } from '@services/email-service/src/email/postmaster-service.js';

export interface ReputationState {
  integrationId: string;
  domain: string;
  reputationScore: number;
  healthLevel: 'healthy' | 'cautious' | 'poor' | 'critical';
  spamRiskScore: number;
  smtpGatewayHealth: boolean;
  lastReputationCheck: Date;
  lastPostmasterCheck: Date;
  source: 'local' | 'postmaster' | 'fbl';
}

export class ReputationManager {
  private static instance: ReputationManager;

  private constructor() {}

  public static getInstance(): ReputationManager {
    if (!ReputationManager.instance) {
      ReputationManager.instance = new ReputationManager();
    }
    return ReputationManager.instance;
  }

  async calculateReputationForAll(): Promise<void> {
    console.log('[ReputationManager] Starting comprehensive reputation check...');

    const activeIntegrations = await this.fetchActiveIntegrations();
    let processedCount = 0;

    for (const integration of activeIntegrations) {
      try {
        await this.processIntegration(integration);
        processedCount++;
        if (processedCount % 10 === 0) {
          console.log(`[ReputationManager] Processed ${processedCount} integrations...`);
        }
      } catch (error) {
        console.error(`[ReputationManager] Error processing ${integration.id}:`, error);
      }
    }

    console.log(`[ReputationManager] Reputation check completed. Processed ${processedCount} integrations.`);
  }

  private async fetchActiveIntegrations() {
    return await db.select().from(integrations)
      .where(
        and(
          eq(integrations.connected, true),
          eq(integrations.healthStatus, 'connected')
        )
      );
  }

  private async processIntegration(integration: any): Promise<void> {
    const domain = await this.extractDomainFromIntegration(integration);
    if (!domain) {
      await this.updateIntegrationWithLocalReputation(integration.id, null);
      return;
    }

    const accessToken = await this.getAccessToken(integration);
    if (accessToken) {
      const postmasterMetrics = await postmasterService.fetchDomainMetrics(domain, accessToken);

      if (postmasterMetrics) {
        await this.updateIntegrationWithPostmasterData(integration.id, domain, postmasterMetrics);
        return;
      }
    }

    await this.updateIntegrationWithLocalReputation(integration.id, domain);
  }

  private async extractDomainFromIntegration(integration: any): Promise<string | null> {
    try {
      const meta = JSON.parse(decrypt(integration.encryptedMeta));
      const emailStr = meta.smtp_user || meta.smtpUser || meta.user || meta.email || integration.accountType;
      if (emailStr && emailStr.includes('@')) {
        return emailStr.split('@')[1];
      }
    } catch (e) {
      console.warn(`[ReputationManager] Could not decrypt meta for integration ${integration.id}`);
    }

    try {
      const oauth2 = await import('googleapis');
      const meta = decryptToJSON(integration.encryptedMeta);
      if (meta.gmailAccessToken) {
        const oauthClient = new oauth2.google.auth.OAuth2();
        oauthClient.setCredentials({ access_token: meta.gmailAccessToken });
        const userInfoResponse = await oauthClient.request({ url: 'https://www.googleapis.com/oauth2/v1/userinfo' }) as any;
        if (userInfoResponse.data.email) {
          return userInfoResponse.data.email.split('@')[1];
        }
      }
    } catch (e) { console.warn('[ReputationManager] Failed to extract domain:', (e as Error)?.message); }

    return null;
  }

  private async getAccessToken(integration: any): Promise<string | null> {
    const meta = decryptToJSON(integration.encryptedMeta);
    return meta.gmailAccessToken || null;
  }

  private async updateIntegrationWithLocalReputation(integrationId: string, domain: string | null): Promise<void> {
    const [result] = await db
      .select()
      .from(integrations)
      .where(eq(integrations.id, integrationId))
      .limit(1);

    if (!result) return;

    const localScore = await this.calculateLocalReputation(integrationId, domain);
    const localHealthLevel = this.classifyLocalReputation(localScore);
    const localSpamRisk = (100 - localScore) / 100;

    await this.persistReputationResult(integrationId, result.userId, domain, localScore, localHealthLevel, localSpamRisk, 'local');
  }

  private async updateIntegrationWithPostmasterData(integrationId: string, domain: string, metrics: any): Promise<void> {
    const localScore = await this.calculateLocalReputationFromMonitor(integrationId, domain);
    const postmasterScore = metrics.reputation;

    const finalScore = this.mergeReputationScores(localScore, postmasterScore, domain);
    const healthLevel = this.classifyReputation(finalScore);
    const spamRiskScore = (100 - finalScore) / 100;

    await this.persistReputationResult(integrationId, null, domain, finalScore, healthLevel, spamRiskScore, 'postmaster');
  }

  private async calculateLocalReputation(integrationId: string, domain: string | null): Promise<number> {
    if (!domain) return 50;

    const result = await db.select().from(integrations).where(eq(integrations.id, integrationId)).limit(1);
    if (!result[0]) return 50;

    return result[0].reputationScore || 50;
  }

  private async calculateLocalReputationFromMonitor(integrationId: string, domain: string): Promise<number> {
    let score = 100;

    if (domain) {
      try {
        const verifications = await db.select().from(domainVerifications)
          .where(eq(domainVerifications.domain, domain))
          .orderBy(desc(domainVerifications.createdAt))
          .limit(1);

        if (verifications.length > 0) {
          const verification = verifications[0];
          const vResult = verification.verificationResult as any;

          if (vResult?.blacklist?.isBlacklisted) score -= 60;
          if (!vResult?.spf?.valid) score -= 40;
          if (!vResult?.dkim?.valid) score -= 45;
          if (!vResult?.dmarc?.valid) score -= 30;
        }
      } catch (e) {
        console.warn(`[ReputationManager] Error checking DNS verification for ${domain}:`, e instanceof Error ? e.message : String(e));
      }
    }

    const bounces = await db.select({ count: sql<number>`count(*)` })
      .from(bounceTracker)
      .where(eq(bounceTracker.integrationId, integrationId));

    const bounceCount = bounces[0]?.count || 0;
    if (bounceCount > 0) {
      const bouncePenalty = Math.min(60, bounceCount * 5);
      score -= bouncePenalty;
    }

    return Math.max(0, Math.min(100, score));
  }

  private classifyReputation(score: number): 'healthy' | 'cautious' | 'poor' | 'critical' {
    if (score >= 85) return 'healthy';
    if (score >= 65) return 'cautious';
    if (score >= 40) return 'poor';
    return 'critical';
  }

  private classifyLocalReputation(score: number): 'healthy' | 'cautious' | 'poor' | 'critical' {
    if (score >= 85) return 'healthy';
    if (score >= 65) return 'cautious';
    if (score >= 40) return 'poor';
    return 'critical';
  }

  private async persistReputationResult(
    integrationId: string,
    userId: string | null,
    domain: string | null,
    score: number,
    healthLevel: string,
    spamRiskScore: number,
    source: string
  ): Promise<void> {
    await db.update(integrations)
      .set({
        reputationScore: score,
        healthLevel: healthLevel as any,
        spamRiskScore,
        lastReputationCheck: new Date() as any,
        sourceOfScore: source as any
      })
      .where(eq(integrations.id, integrationId));

    if (userId) {
      wsSync.broadcastToUser(userId, {
        type: 'reputation_updated',
        payload: {
          integrationId,
          domain,
          score,
          healthLevel,
          spamRiskScore,
          source
        }
      });

      await pubsubService.publishEvent('reputation_changed', {
        integrationId,
        userId,
        domain,
        score,
        healthLevel,
        spamRiskScore,
        source
      });
    }
  }

  private mergeReputationScores(localScore: number, postmasterScore: number, domain: string): number {
    console.log(`[ReputationManager] Merge reputation for ${domain}: local=${localScore}, postmaster=${postmasterScore}`);
    if (!domain) return postmasterScore || localScore || 50;

    if (Math.abs(localScore - postmasterScore) > 30) {
      console.warn(`[ReputationManager] Large discrepancy detected for ${domain}: local=${localScore}, postmaster=${postmasterScore}`);
    }

    return Math.max(localScore, postmasterScore);
  }
}