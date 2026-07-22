import { getRedisClient } from "@shared/lib/redis/redis.js";
import { verifyDomainDns } from "@services/email-service/src/email/dns-verification.js";

const DNS_VERIFY_QUEUE = process.env.DNS_QUEUE_NAME || "dns-verify-queue";
const DNS_VERIFY_RESULT_QUEUE = process.env.DNS_RESULT_QUEUE_NAME || "dns-verify-results";
const DNS_VERIFY_TIMEOUT = parseInt(process.env.DNS_VERIFY_TIMEOUT || "10000", 10);

export interface SpfResult {
  found: boolean;
  valid: boolean;
  record: string | null;
  issues: string[];
}

export interface DkimResult {
  found: boolean;
  valid: boolean;
  selector: string | null;
  record: string | null;
  issues: string[];
}

export interface DmarcResult {
  found: boolean;
  valid: boolean;
  policy: string | null;
  record: string | null;
  issues: string[];
}

export interface MxRecord {
  exchange: string;
  priority: number;
}

export interface BlacklistResult {
  is_blacklisted: boolean;
  listed_on: string[];
}

export interface DnsVerificationResult {
  domain: string;
  spf: SpfResult;
  dkim: DkimResult;
  dmarc: DmarcResult;
  mx: MxRecord[];
  mx_found: boolean;
  blacklist: BlacklistResult;
  overall_score: number;
  overall_status: string;
}

export async function verifyDnsViaRust(
  jobId: string,
  userId: string,
  domain: string,
  dkimSelector?: string
): Promise<DnsVerificationResult | null> {
  try {
    const redis = await getRedisClient();
    if (!redis) return null;

    const job = JSON.stringify({
      job_id: jobId,
      user_id: userId,
      domain,
      dkim_selector: dkimSelector || null,
    });

    await redis.lPush(DNS_VERIFY_QUEUE, job);

    const deadline = Date.now() + DNS_VERIFY_TIMEOUT;
    while (Date.now() < deadline) {
      const result = await redis.brPop(DNS_VERIFY_RESULT_QUEUE, 1);
      if (result && result.element) {
        try {
          const data = JSON.parse(result.element);
          if (data.job_id === jobId) {
            return data.result || data;
          }
        } catch {
          // skip
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function verifyDnsWithFallback(
  userId: string,
  domain: string,
  dkimSelector?: string
): Promise<DnsVerificationResult | null> {
  const jobId = `dns_${userId}_${domain}_${Date.now()}`;

  const rustResult = await verifyDnsViaRust(jobId, userId, domain, dkimSelector);
  if (rustResult) return rustResult;

  try {
    const nodeResult = await verifyDomainDns(domain, dkimSelector, false);
    if (nodeResult) {
      return {
        domain,
        spf: {
          found: nodeResult.spf?.found ?? false,
          valid: nodeResult.spf?.valid ?? false,
          record: nodeResult.spf?.record ?? null,
          issues: nodeResult.spf?.issues ?? [],
        },
        dkim: {
          found: nodeResult.dkim?.found ?? false,
          valid: nodeResult.dkim?.valid ?? false,
          selector: nodeResult.dkim?.selector ?? null,
          record: nodeResult.dkim?.record ?? null,
          issues: nodeResult.dkim?.issues ?? [],
        },
        dmarc: {
          found: nodeResult.dmarc?.found ?? false,
          valid: nodeResult.dmarc?.valid ?? false,
          policy: nodeResult.dmarc?.policy ?? null,
          record: nodeResult.dmarc?.record ?? null,
          issues: nodeResult.dmarc?.issues ?? [],
        },
        mx: (nodeResult.mx ?? []).map((m: any) => ({
          exchange: m.exchange ?? m,
          priority: m.priority ?? 0,
        })),
        mx_found: nodeResult.mx_found ?? !!nodeResult.mx?.length,
        blacklist: {
          is_blacklisted: nodeResult.blacklist?.isBlacklisted ?? false,
          listed_on: nodeResult.blacklist?.listedOn ?? [],
        },
        overall_score: nodeResult.overallScore ?? 0,
        overall_status: nodeResult.overallStatus ?? 'unknown',
      };
    }
  } catch {
    // fallback failed
  }
  return null;
}
