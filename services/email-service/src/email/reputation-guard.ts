import { db } from '@shared/lib/db/db.js';
import { integrations, domainVerifications } from '@audnix/shared';
import { eq, desc } from 'drizzle-orm';
import { verifyDomainDns, DnsVerificationResult } from './dns-verification.js';
import { calculateReputationScore } from './reputation-monitor.js';
import { wsSync } from '@shared/lib/realtime/websocket-sync.js';

export interface SafetyResult {
  isSafe: boolean;
  score: number;
  status: string;
  reason?: string;
}

export class ReputationGuard {
  private static checkCache = new Map<string, { result: SafetyResult; timestamp: number }>();
  private static CACHE_TTL = 15 * 60 * 1000; // 15 minutes safety window

  /**
   * Pre-flight safety check for a mailbox/domain
   */
  static async checkSafety(userId: string, integrationId: string, domain: string): Promise<SafetyResult> {
    const cacheKey = `${integrationId}:${domain}`;
    const cached = this.checkCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
      return cached.result;
    }

    console.log(`[ReputationGuard] 🛡️ Performing pre-flight safety check for ${domain}...`);

    try {
      // 1. Trigger fresh DNS & Blacklist check
      const dnsResult: DnsVerificationResult = await verifyDomainDns(domain, undefined, true);
      
      // 2. Persist the check result
      await db.insert(domainVerifications).values({
        userId,
        domain,
        verificationResult: dnsResult,
      });

      // 3. Recalculate official reputation score (includes recent bounces + new DNS status)
      const officialScore = await calculateReputationScore(integrationId);

      let isSafe = true;
      let reason = undefined;

      if (dnsResult.overallStatus === 'blacklisted') {
        isSafe = false;
        reason = `Domain is BLACKLISTED on: ${dnsResult.blacklist.listedOn.join(', ')}`;
      } else if (officialScore < 40) {
        isSafe = false;
        reason = `Reputation score is CRITICAL (${officialScore}/100)`;
      } else if (!dnsResult.spf.found || !dnsResult.dkim.found) {
        isSafe = false;
        reason = 'Critical DNS records (SPF/DKIM) are missing or invalid';
      }

      const result: SafetyResult = {
        isSafe,
        score: officialScore,
        status: dnsResult.overallStatus,
        reason
      };

      // 4. Action: Automatic Safety Pause
      if (!isSafe) {
        await this.triggerSafetyPause(integrationId, userId, reason || 'Unknown safety risk');
      }

      this.checkCache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
    } catch (error) {
      console.error(`[ReputationGuard] Error during safety check for ${domain}:`, error);
      const result: SafetyResult = {
        isSafe: false,
        score: 0,
        status: 'unknown',
        reason: 'Reputation safety check failed; blocking initial sends until DNS/blacklist status can be verified',
      };
      await this.triggerSafetyPause(integrationId, userId, result.reason || 'Reputation safety check failed');
      return result;
    }
  }

  private static async triggerSafetyPause(integrationId: string, userId: string, reason: string) {
    console.warn(`[ReputationGuard] 🛑 SAFETY INTERLOCK TRIGGERED for ${integrationId}: ${reason}`);
    
    await db.update(integrations).set({
      warmupStatus: 'paused',
      lastHealthError: `Safety Interlock: ${reason}`,
      updatedAt: new Date()
    }).where(eq(integrations.id, integrationId));

    // Notify user via WebSocket
    wsSync.broadcastToUser(userId, {
      type: 'engine_alert',
      payload: {
        severity: 'critical',
        title: 'Safety Interlock Triggered',
        message: `Campaigns for this mailbox have been paused: ${reason}`,
        integrationId
      }
    });

    wsSync.notifyStatsUpdated(userId);
  }
}






