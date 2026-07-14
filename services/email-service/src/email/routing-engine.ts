/**
 * RoutingEngine v4 — Auto-Balancing Universal Router
 *
 * Priorities:
 *   P1 (domain)          — lead@company.com → sender@company.com
 *   P2 (provider_family) — DNS-detected: MX/SPF google→google, microsoft→microsoft
 *   P3 (best_available)  — highest reputation + most capacity
 *   P4 (fallback)        — any healthy mailbox; never leave a lead unassigned
 *
 * Auto-rebalance:
 *   If >70% of leads resolve to one provider family but matching mailbox
 *   capacity is insufficient, overflow is redistributed across other providers.
 *   match_type is set to 'fallback' for overflow assignments with a clear reason.
 *
 * Redis state:
 *   mailbox:{id}          → { daily_limit, sent_today, health_score, provider_family }
 *   lead:assign:{leadId}  → { email, assigned_mailbox_id, match_type, match_score, reason }
 *   leads:fallback:{campaignId}:{provider} → Set<campaignLeadId>  (for fast reassign on new mailbox)
 */

import dns from 'dns';
import { promisify } from 'util';
import { mailboxHealthService } from './mailbox-health-service.js';
import { emailVerifier, type EmailVerificationResult, type VerificationStatus } from './email-verifier.js';
import {
  ATOMIC_BATCH_ASSIGN,
  PROVIDER_CACHE_GET_OR_LOCK,
} from '@shared/lib/queues/lua-scripts.js';

const resolveMx = promisify(dns.resolveMx);
const resolveTxt = promisify(dns.resolveTxt);
dns.setServers(['1.1.1.1', '8.8.8.8', '208.67.222.222']);

// Redis provider cache TTL: 24h (separate from the 5-min in-memory cache)
const PROVIDER_REDIS_TTL = 24 * 60 * 60;

// ─── Types ────────────────────────────────────────────────────────────────────

export type MatchType = 'domain' | 'provider_family' | 'best_available' | 'fallback';

export interface LeadAssignment {
  lead_id: string;           // campaignLeadId
  lead_email: string;
  assigned_mailbox: string;  // sender email address
  assigned_mailbox_id: string;
  match_type: MatchType;
  match_score: number;       // 1.0=domain, 0.8=family, 0.5=best_available, 0.2=fallback
  reason: string;
  provider_detected: string;
  verification_status: VerificationStatus;
  verification_details: EmailVerificationResult['verification_details'];
}

export interface BatchRoutingResult {
  assignments: LeadAssignment[];
  rebalanced_count: number;
  unassigned_count: number;
  elapsed_ms: number;
}

export interface MailboxInfo {
  id: string;
  email: string;
  provider: string;
  healthStatus: string;
  reputationScore: number;
  dailyLimit: number;
  warmupStatus: string;
  domain: string;
  providerFamily: string;
  capacity: number;
}

// ─── DNS provider detection (MX + SPF signals) ───────────────────────────────

const mxProviderCache = new Map<string, { family: string; expires: number }>();
const MX_TTL = 5 * 60 * 1000;

function detectFamilyFromMx(mxRecords: dns.MxRecord[]): string {
  for (const mx of mxRecords) {
    const ex = mx.exchange.toLowerCase();
    if (ex.includes('google') || ex.includes('googlemail') || ex.includes('gmail'))         return 'google';
    if (ex.includes('outlook') || ex.includes('protection.microsoft') || ex.includes('mail.protection')) return 'microsoft';
    if (ex.includes('yahoo') || ex.includes('yahoodns'))                                    return 'yahoo';
    if (ex.includes('icloud') || ex.includes('apple'))                                      return 'apple';
    if (ex.includes('zoho'))                                                                return 'zoho';
    if (ex.includes('protonmail') || ex.includes('proton.ch') || ex.includes('proton.me')) return 'protonmail';
    if (ex.includes('fastmail'))                                                            return 'fastmail';
    if (ex.includes('tutanota'))                                                            return 'tutanota';
    if (ex.includes('sendgrid'))                                                            return 'sendgrid';
    if (ex.includes('mailgun'))                                                             return 'mailgun';
    if (ex.includes('amazonses') || ex.includes('amazonaws'))                               return 'aws_ses';
    if (ex.includes('sendpulse'))                                                           return 'sendpulse';
    if (ex.includes('mailchimp') || ex.includes('mandrill'))                                return 'mailchimp';
    if (ex.includes('hostinger'))                                                           return 'hostinger';
    if (ex.includes('privateemail.com'))                                                    return 'namecheap_privatemail';
    if (ex.includes('secureserver.net'))                                                    return 'godaddy';
    if (ex.includes('bluehost'))                                                            return 'bluehost';
    if (ex.includes('siteground'))                                                          return 'siteground';
    if (ex.includes('dreamhost'))                                                           return 'dreamhost';
    if (ex.includes('rackspace'))                                                           return 'rackspace';
    if (ex.includes('ionos') || ex.includes('1and1'))                                       return 'ionos';
    if (ex.includes('hover.com'))                                                           return 'hover';
    if (ex.includes('namecheap'))                                                           return 'namecheap';
  }
  return 'custom';
}

function detectFamilyFromSpfRecords(txtRecords: string[][]): string {
  const spfText = txtRecords
    .map(parts => parts.join(''))
    .filter(record => record.toLowerCase().startsWith('v=spf1'))
    .join(' ')
    .toLowerCase();

  if (!spfText) return 'custom';

  if (spfText.includes('_spf.google.com') || spfText.includes('include:google.com')) return 'google';
  if (
    spfText.includes('spf.protection.outlook.com') ||
    spfText.includes('include:outlook.com') ||
    spfText.includes('include:spf.messaging.microsoft.com')
  ) return 'microsoft';
  if (spfText.includes('spf.hostinger.com') || spfText.includes('spf.titan.email')) return 'hostinger';
  if (spfText.includes('secureserver.net') || spfText.includes('spf.em.secureserver.net')) return 'godaddy';
  if (spfText.includes('zoho.com') || spfText.includes('zoho.eu')) return 'zoho';
  if (spfText.includes('protonmail.ch') || spfText.includes('proton.me')) return 'protonmail';
  if (spfText.includes('spf.messagingengine.com')) return 'fastmail';
  if (spfText.includes('mailgun.org')) return 'mailgun';
  if (spfText.includes('sendgrid.net')) return 'sendgrid';
  if (spfText.includes('amazonses.com')) return 'aws_ses';
  if (spfText.includes('spf.privateemail.com')) return 'namecheap_privatemail';
  if (spfText.includes('spf.ionos.com') || spfText.includes('_spf.ionos.com')) return 'ionos';

  return 'custom';
}

export function detectProviderFamilyFromDnsSignals(
  mxRecords: Array<Pick<dns.MxRecord, 'exchange'>>,
  txtRecords: string[][] = []
): string {
  const mxFamily = detectFamilyFromMx(mxRecords as dns.MxRecord[]);
  if (mxFamily !== 'custom') return mxFamily;
  return detectFamilyFromSpfRecords(txtRecords);
}

// ─── Provider family detection: Redis (24h TTL) → in-memory cache → live MX lookup ───

async function detectProviderFamily(domain: string): Promise<string> {
  // 1. In-memory cache (fastest)
  const mem = mxProviderCache.get(domain);
  if (mem && mem.expires > Date.now()) return mem.family;

  // 2. Redis cache with thundering-herd protection
  let redis: any = null;
  try {
    const { redisConnection } = await import('@shared/lib/queues/redis-config.js');
    redis = redisConnection;
  } catch { /* Redis unavailable — fall through */ }

  if (redis) {
    const [status, family] = await redis.eval(
      PROVIDER_CACHE_GET_OR_LOCK,
      2,
      `provider:${domain}`,
      `provider:lock:${domain}`,
      10 // lock TTL: 10s
    ) as [string, string];

    if (status === 'hit') {
      mxProviderCache.set(domain, { family, expires: Date.now() + MX_TTL });
      return family;
    }

    if (status === 'wait') {
      // Another worker is doing the MX lookup — brief pause then retry from cache
      await new Promise(r => setTimeout(r, 150));
      const cached = await redis.get(`provider:${domain}`);
      if (cached) {
        mxProviderCache.set(domain, { family: cached, expires: Date.now() + MX_TTL });
        return cached;
      }
      // Give up waiting, do our own lookup
    }
    // status === 'locked': we hold the lock, do the MX lookup and populate cache
  }

  // 3. Live DNS lookup. MX is primary; SPF is a fallback/confirmation signal
  // for providers such as Google Workspace, Microsoft 365, Hostinger, GoDaddy.
  let family = 'custom';
  try {
    const [mxRecords, txtRecords] = await Promise.all([
      resolveMx(domain).catch(() => [] as dns.MxRecord[]),
      resolveTxt(domain).catch(() => [] as string[][]),
    ]);
    family = detectProviderFamilyFromDnsSignals(mxRecords, txtRecords);
  } catch { /* domain has no MX — custom */ }

  // Populate both caches
  mxProviderCache.set(domain, { family, expires: Date.now() + MX_TTL });
  if (redis) {
    // Release lock + store result atomically
    await redis.pipeline()
      .setex(`provider:${domain}`, PROVIDER_REDIS_TTL, family)
      .del(`provider:lock:${domain}`)
      .exec();
  }

  return family;
}

// ─── Lead info ────────────────────────────────────────────────────────────────

interface LeadInfo {
  leadId: string;
  email: string;
  domain: string;
  providerFamily: string;
  providerDetected: string;
  verificationResult: EmailVerificationResult;
}

async function buildLeadInfo(
  leadId: string,
  email: string,
  verificationResult: EmailVerificationResult
): Promise<LeadInfo> {
  const domain = email.split('@')[1]?.toLowerCase() || '';
  const providerFamily = verificationResult.verification_details.provider_family
    ?? await detectProviderFamily(domain);

  let providerDetected = domain;
  if (providerFamily === 'google') {
    providerDetected = domain === 'gmail.com' ? 'gmail' : 'google_workspace';
  } else if (providerFamily === 'microsoft') {
    const msConsumer = ['outlook.com', 'hotmail.com', 'live.com', 'msn.com'];
    providerDetected = msConsumer.includes(domain) ? domain : 'microsoft_365';
  } else if (providerFamily !== 'custom') {
    providerDetected = providerFamily;
  }

  return { leadId, email, domain, providerFamily, providerDetected, verificationResult };
}

// ─── Scoring function ──────────────────────────────────────────────────────────
//
// score = domain_match(100) + provider_family(50) + health(0-20) + quota(0-10) - bounce_penalty
// Thresholds: >=80 → domain | >=45 → provider_family | >=15 → best_available | <15 → fallback

function computeScore(lead: LeadInfo, mb: MailboxInfo): { score: number; matchType: MatchType } {
  let score = 0;
  if (mb.domain === lead.domain) score += 100;
  else if (lead.providerFamily !== 'custom' && mb.providerFamily === lead.providerFamily) score += 50;
  score += Math.min(20, (mb.reputationScore / 100) * 20);
  if (mb.dailyLimit > 0) score += Math.min(10, (mb.capacity / mb.dailyLimit) * 10);
  const bounceRate: number = (mb as any).bounceRate ?? 0;
  score -= bounceRate * 50;
  if (mb.warmupStatus !== 'active') score -= 10;

  let matchType: MatchType;
  if      (score >= 80) matchType = 'domain';
  else if (score >= 45) matchType = 'provider_family';
  else if (score >= 15) matchType = 'best_available';
  else                  matchType = 'fallback';

  return { score, matchType };
}

function matchScoreToValue(matchType: MatchType): number {
  switch (matchType) {
    case 'domain':           return 1.0;
    case 'provider_family':  return 0.8;
    case 'best_available':   return 0.5;
    case 'fallback':         return 0.2;
  }
}

function buildReason(
  lead: LeadInfo, mb: MailboxInfo,
  matchType: MatchType, score: number,
  overloaded: Set<string>
): string {
  if (matchType === 'domain')         return `Exact domain match (score: ${score.toFixed(0)})`;
  if (matchType === 'provider_family') {
    const tag = overloaded.has(lead.providerFamily) ? ' — overflow capacity' : '';
    return `Provider family match: ${lead.providerFamily}${tag} (score: ${score.toFixed(0)})`;
  }
  if (matchType === 'best_available') return `Best available: ${mb.providerFamily} mailbox (score: ${score.toFixed(0)})`;
  return `Fallback — no ${lead.providerFamily} mailbox available, routed to ${mb.providerFamily} (score: ${score.toFixed(0)})`;
}

// ─── Mailbox selector ─────────────────────────────────────────────────────────

/**
 * Pick the best mailbox for a lead using the scoring function.
 * Returns null only if ALL mailboxes are at capacity.
 */
function selectBest(
  lead: LeadInfo,
  mailboxes: MailboxInfo[]
): { mb: MailboxInfo; score: number; matchType: MatchType } | null {
  // Shuffle mailboxes so ties are broken randomly — prevents the first mailbox
  // from getting all leads when all have equal scores (same domain, same capacity).
  const shuffled = [...mailboxes].sort(() => Math.random() - 0.5);
  let best: { mb: MailboxInfo; score: number; matchType: MatchType } | null = null;

  for (const mb of shuffled) {
    if (mb.capacity <= 0) continue;
    const { score, matchType } = computeScore(lead, mb);
    if (!best || score > best.score) {
      best = { mb, score, matchType };
    }
  }
  return best;
}

// ─── Rebalance threshold ──────────────────────────────────────────────────────

const REBALANCE_THRESHOLD = 0.70; // If >70% leads need one provider → detect overflow

/**
 * Returns a set of provider families that are "overloaded" — meaning leads
 * for that family exceed available matching-mailbox capacity by the threshold.
 */
function detectOverloadedProviders(
  leadInfos: LeadInfo[],
  mailboxes: MailboxInfo[]
): Set<string> {
  const total = leadInfos.length;
  if (total === 0) return new Set();

  // Count leads per provider family
  const leadCount = new Map<string, number>();
  for (const l of leadInfos) {
    leadCount.set(l.providerFamily, (leadCount.get(l.providerFamily) ?? 0) + 1);
  }

  // Count total daily capacity per provider family from mailboxes
  const mbCapacity = new Map<string, number>();
  for (const mb of mailboxes) {
    mbCapacity.set(mb.providerFamily, (mbCapacity.get(mb.providerFamily) ?? 0) + mb.capacity);
  }

  const overloaded = new Set<string>();
  for (const [family, count] of leadCount.entries()) {
    const concentration = count / total;
    const available = mbCapacity.get(family) ?? 0;
    // Overloaded if: concentration >70% AND not enough mailbox capacity to cover
    if (concentration > REBALANCE_THRESHOLD && count > available) {
      overloaded.add(family);
    }
  }
  return overloaded;
}

// ─── Routing Engine ───────────────────────────────────────────────────────────

export class RoutingEngine {

  /**
   * Assign a batch of leads (with leadId+email pairs) to mailboxes.
   * Returns standardized BatchRoutingResult JSON.
   *
   * For 1k leads: target <2s.
   * For 50k leads: target <30s (called in parallel chunks by the queue worker).
   */
  async assignLeadsBatch(
    userId: string,
    leadRows: Array<{ leadId: string; email: string }>,
    campaignId?: string
  ): Promise<BatchRoutingResult> {
    const start = Date.now();
    const total = leadRows.length;
    console.log(`[RoutingEngine] 🚀 Batch assign: ${total} leads (User: ${userId})`);

    // 1. Verify all leads in parallel
    const emails = leadRows.map(r => r.email.toLowerCase().trim());
    const verificationMap = await emailVerifier.verifyBatch(emails);

    // 2. Build lead infos in parallel (MX detection cached)
    const CONCURRENCY = 100;
    const leadInfos: LeadInfo[] = [];
    for (let i = 0; i < leadRows.length; i += CONCURRENCY) {
      const chunk = leadRows.slice(i, i + CONCURRENCY);
      const infos = await Promise.all(chunk.map(({ leadId, email }) => {
        const emailNorm = email.toLowerCase().trim();
        const vResult = verificationMap.get(emailNorm) ?? {
          email: emailNorm, status: 'unknown' as VerificationStatus,
          verification_details: {
            mx_valid: false, smtp_valid: null, catch_all: null, risk_score: 0.1,
            checks: { syntax: true, disposable: false, role: false, domain_exists: false, mx_found: false }
          },
          verified_at: new Date().toISOString()
        };
        if (vResult.status === 'invalid') return null;
        return buildLeadInfo(leadId, emailNorm, vResult);
      }));
      leadInfos.push(...infos.filter((l): l is LeadInfo => l !== null));
    }

    const skipped = total - leadInfos.length;
    if (skipped > 0) console.log(`[RoutingEngine] 🗑️ Skipped ${skipped} invalid leads`);

    // 3. Load mailboxes (with Redis state if available)
    const mailboxes = await this.filterMailboxesForCampaign(
      await this.getProcessedMailboxes(userId),
      campaignId
    );
    if (mailboxes.length === 0) {
      return { assignments: [], rebalanced_count: 0, unassigned_count: leadInfos.length, elapsed_ms: Date.now() - start };
    }

    // 4. Detect overloaded providers (auto-rebalance)
    const overloadedProviders = detectOverloadedProviders(leadInfos, mailboxes);
    if (overloadedProviders.size > 0) {
      console.log(`[RoutingEngine] ⚖️ Rebalancing providers: ${[...overloadedProviders].join(', ')}`);
    }

    // 5. Score-based assignment (replaces priority passes)
    //    Each lead is scored against every mailbox; highest score wins.
    //    If top score < 15 → fallback (but still assigned — never left unassigned).
    const assignments: LeadAssignment[] = [];
    let rebalancedCount = 0;
    const unassigned: LeadInfo[] = [];

    for (const lead of leadInfos) {
      const best = selectBest(lead, mailboxes);
      if (!best) {
        unassigned.push(lead);
        continue;
      }

      const { mb, score, matchType } = best;
      mb.capacity--;

      const isOverflowRebalance = overloadedProviders.has(lead.providerFamily) &&
        matchType !== 'domain' && matchType !== 'provider_family';
      if (isOverflowRebalance) rebalancedCount++;

      const reason = buildReason(lead, mb, matchType, score, overloadedProviders);
      assignments.push(this.makeAssignment(lead, mb, matchType, matchScoreToValue(matchType), reason));
    }

    // Any unassigned (all mailboxes at full capacity) — last-resort pass
    for (const lead of unassigned) {
      const mb = mailboxes.find(m => m.capacity > 0);
      if (mb) {
        mb.capacity--;
        rebalancedCount++;
        assignments.push(this.makeAssignment(
          lead, mb, 'fallback', 0.2,
          `All mailboxes at capacity — assigned to ${mb.providerFamily} (${mb.email})`
        ));
      } else {
        console.warn(`[RoutingEngine] 🚨 No capacity left for ${lead.email}`);
      }
    }

    // 6. Write lead assignments to Redis (pipeline for speed)
    await this.persistAssignments(assignments, campaignId);

    const elapsed = Date.now() - start;
    const result: BatchRoutingResult = {
      assignments,
      rebalanced_count: rebalancedCount,
      unassigned_count: unassigned.length,
      elapsed_ms: elapsed,
    };

    console.log(
      `[RoutingEngine] ✅ ${assignments.length} assigned | ${rebalancedCount} rebalanced | ` +
      `${unassigned.length} unassigned | ${elapsed}ms`
    );
    return result;
  }

  /**
   * Legacy single-email interface (used by existing queue worker).
   * Wraps assignLeadsBatch for backward compatibility.
   */
  async assignLeads(userId: string, leadEmails: string[]): Promise<LeadAssignment[]> {
    const rows = leadEmails.map(e => ({ leadId: e, email: e }));
    const result = await this.assignLeadsBatch(userId, rows);
    return result.assignments;
  }

  /**
   * Smart reassignment when a new mailbox connects.
   * Finds leads in Redis fallback sets that could upgrade to this mailbox.
   * Target: <5s for 50k leads.
   */
  async onNewMailboxConnected(
    userId: string,
    campaignId: string,
    newMailboxId: string
  ): Promise<{ reassigned: number }> {
    const { db } = await import('@shared/lib/db/db.js');
    const { integrations } = await import('@audnix/shared');
    const { eq } = await import('drizzle-orm');

    const [mailbox] = await db.select().from(integrations).where(eq(integrations.id, newMailboxId)).limit(1);
    if (!mailbox) return { reassigned: 0 };
    
    const meta = await decryptMeta(mailbox);
    const email = meta.smtp_user || meta.smtpUser || meta.user || meta.email || mailbox.accountType || (mailbox as any).email || '';
    const newMailboxDomain = email.split('@')[1]?.toLowerCase() || '';
    const newMailboxProviderFamily = await detectProviderFamily(newMailboxDomain);

    console.log(`[RoutingEngine] 🔌 New mailbox connected: ${newMailboxId} (${newMailboxProviderFamily})`);

    // Read fallback set from Redis: leads that used fallback for this provider
    let redis: any = null;
    let candidateLeadIds: string[] = [];

    try {
      const { redisConnection } = await import('@shared/lib/queues/redis-config.js');
      redis = redisConnection;
    } catch { /* Redis unavailable */ }

    if (redis) {
      // Domain-match candidates first (highest upgrade value)
      const domainSet = `leads:fallback:domain:${campaignId}:${newMailboxDomain}`;
      const familySet  = `leads:fallback:family:${campaignId}:${newMailboxProviderFamily}`;

      const [domainIds, familyIds] = await Promise.all([
        redis.smembers(domainSet),
        redis.smembers(familySet),
      ]);

      // Deduplicate; domain candidates first
      const seen = new Set<string>();
      for (const id of [...domainIds, ...familyIds]) {
        if (!seen.has(id)) { seen.add(id); candidateLeadIds.push(id); }
      }

      // Clean up sets
      if (domainIds.length) await redis.del(domainSet);
      if (familyIds.length) await redis.del(familySet);
    }

    if (candidateLeadIds.length === 0) {
      console.log(`[RoutingEngine] No upgrade candidates for new mailbox ${newMailboxId}`);
      return { reassigned: 0 };
    }

    console.log(`[RoutingEngine] ⚡ ${candidateLeadIds.length} leads eligible for upgrade`);

    // Enqueue reassignment (non-blocking — queue handles it)
    const { reassignQueue } = await import('@shared/lib/queues/verification-routing-queue.js');
    if (reassignQueue) {
      await reassignQueue.add(
        `new-mailbox:${newMailboxId}`,
        { type: 'new_mailbox_connect', newMailboxId, newMailboxProviderFamily, candidateLeadIds, campaignId, userId },
        { priority: 0 }
      );
    }

    return { reassigned: candidateLeadIds.length };
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private makeAssignment(
    lead: LeadInfo,
    mb: MailboxInfo,
    matchType: MatchType,
    matchScore: number,
    reason: string
  ): LeadAssignment {
    console.log(`[RoutingEngine] ${matchType.toUpperCase()} | ${lead.email} → ${mb.email} | ${reason}`);
    return {
      lead_id: lead.leadId,
      lead_email: lead.email,
      assigned_mailbox: mb.email,
      assigned_mailbox_id: mb.id,
      match_type: matchType,
      match_score: matchScore,
      reason,
      provider_detected: lead.providerDetected,
      verification_status: lead.verificationResult.status,
      verification_details: lead.verificationResult.verification_details,
    };
  }

  /**
   * Write lead assignments to Redis pipeline + fallback tracking sets.
   * Uses pipeline for throughput — can write 10k assignments in ~100ms.
   */
  private async persistAssignments(
    assignments: LeadAssignment[],
    campaignId?: string
  ): Promise<void> {
    let redis: any = null;
    try {
      const { redisConnection } = await import('@shared/lib/queues/redis-config.js');
      redis = redisConnection;
    } catch { return; }
    if (!redis) return;

    const pipeline = redis.pipeline();
    const KEY_TTL = 7 * 24 * 60 * 60; // 7 days

    for (const a of assignments) {
      // Store assignment
      pipeline.setex(
        `lead:assign:${a.lead_id}`,
        KEY_TTL,
        JSON.stringify({
          email: a.lead_email,
          assigned_mailbox_id: a.assigned_mailbox_id,
          assigned_mailbox: a.assigned_mailbox,
          match_type: a.match_type,
          match_score: a.match_score,
          reason: a.reason,
        })
      );

      // Track fallback leads in sets for fast reassignment on new mailbox connect
      if (campaignId && (a.match_type === 'fallback' || a.match_type === 'best_available')) {
        const domain = a.lead_email.split('@')[1] || '';
        pipeline.sadd(`leads:fallback:domain:${campaignId}:${domain}`, a.lead_id);
        pipeline.expire(`leads:fallback:domain:${campaignId}:${domain}`, KEY_TTL);
        pipeline.sadd(`leads:fallback:family:${campaignId}:${a.provider_detected}`, a.lead_id);
        pipeline.expire(`leads:fallback:family:${campaignId}:${a.provider_detected}`, KEY_TTL);
      }

      // Increment mailbox daily load counter
      const date = new Date().toISOString().slice(0, 10);
      pipeline.incr(`mailbox:load:${a.assigned_mailbox_id}:${date}`);
      pipeline.expire(`mailbox:load:${a.assigned_mailbox_id}:${date}`, 25 * 60 * 60);
    }

    await pipeline.exec();
  }

  protected async getProcessedMailboxes(userId: string): Promise<MailboxInfo[]> {
    const activeIntegrations = await mailboxHealthService.getActiveMailboxes(userId);
    const mbIds = activeIntegrations.map(mb => mb.id);
    const capacities = await mailboxHealthService.getMailboxCapacities(mbIds);

    const results = await Promise.all(
      activeIntegrations.map(mb => buildMailboxInfo(mb, capacities.get(mb.id) ?? 0))
    );
    return results.filter((mb): mb is MailboxInfo => mb !== null);
  }

  private async filterMailboxesForCampaign(mailboxes: MailboxInfo[], campaignId?: string): Promise<MailboxInfo[]> {
    if (!campaignId) return mailboxes;

    try {
      const { db } = await import('@shared/lib/db/db.js');
      const { outreachCampaigns } = await import('@audnix/shared');
      const { eq } = await import('drizzle-orm');
      const [campaign] = await db.select({ config: outreachCampaigns.config })
        .from(outreachCampaigns)
        .where(eq(outreachCampaigns.id, campaignId))
        .limit(1);

      const allowedMailboxIds = (campaign?.config as any)?.mailboxIds;
      if (!Array.isArray(allowedMailboxIds) || allowedMailboxIds.length === 0) return mailboxes;

      const allowed = new Set(allowedMailboxIds);
      return mailboxes.filter(mb => allowed.has(mb.id));
    } catch (err: any) {
      console.warn(`[RoutingEngine] Campaign mailbox filter unavailable for ${campaignId}:`, err.message);
      return mailboxes;
    }
  }
}

export const routingEngine = new RoutingEngine();

// ─── Mailbox builder ──────────────────────────────────────────────────────────

async function buildMailboxInfo(mb: any, capacity: number): Promise<MailboxInfo | null> {
  if (capacity <= 0) return null;
  const repScore = mb.reputationScore ?? null;
  if (repScore !== null && repScore < 40) return null;
  if (mb.healthStatus === 'failed') return null;

  const meta = await decryptMeta(mb);
  const email: string = meta.smtp_user || meta.smtpUser || meta.user || meta.email || mb.accountType || mb.email || '';
  const domain = email.split('@')[1]?.toLowerCase() || '';
  const providerFamily = await detectProviderFamily(domain);

  // Single source of truth: integrations.dailyLimit DB column
  // Treat 0 as provider default (shouldn't happen but defensive), null/undefined as provider default
  const defaultLimit = mb.provider === 'custom_email' ? 250 : 50;
  const dailyLimit = mb.dailyLimit != null && mb.dailyLimit > 0 ? mb.dailyLimit : defaultLimit;

  return {
    id: mb.id, email, provider: mb.provider,
    healthStatus: mb.healthStatus,
    reputationScore: repScore ?? 100,
    dailyLimit,
    warmupStatus: mb.warmupStatus ?? 'active',
    domain, providerFamily, capacity,
  };
}

async function decryptMeta(integration: any): Promise<any> {
  try {
    const { decryptToJSON } = await import('@shared/lib/crypto/encryption.js');
    return decryptToJSON(integration.encryptedMeta) || {};
  } catch {
    return {};
  }
}
