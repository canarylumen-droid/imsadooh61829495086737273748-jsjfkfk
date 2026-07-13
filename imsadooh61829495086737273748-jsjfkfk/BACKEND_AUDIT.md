# Audnix AI — Backend Audit Report

**Audit Date:** 2025  
**Scope:** All backend services, workers, routes, and shared libraries  
**Method:** File-by-file manual read of every key backend file  

---

## Table of Contents
1. [Critical Security Issues](#1-critical-security-issues)
2. [Bugs](#2-bugs)
3. [Incomplete Implementations](#3-incomplete-implementations)
4. [Architectural Concerns](#4-architectural-concerns)
5. [Minor / Low-Priority Issues](#5-minor--low-priority-issues)
6. [Files Audited](#6-files-audited)
7. [Summary](#7-summary)

---

## 1. Critical Security Issues

### 1.1 Hardcoded Admin OTP Bypass — `admin-auth.ts:220`
**File:** `services/api-gateway/src/routes/admin-auth.ts`  
**Severity:** 🔴 CRITICAL

```ts
// line 220
const isBypass = otp === '000000';
if (isBypass) {
  console.log(`ℹ️ [Admin Bypass] Admin login bypassed for ${normalizedEmail} using master code`);
}
```

A hardcoded master OTP code `'000000'` allows any admin-whitelisted email to skip OTP verification entirely. If any admin email is compromised or the whitelist is leaked, an attacker gains full admin access with zero friction. This bypass has no expiry, no IP restriction, and no audit trail flag distinguishing it from a real OTP verification.

**Recommendation:** Remove the `000000` bypass entirely, or gate it behind a dedicated `ADMIN_MASTER_OTP` environment variable that is rotated regularly. Log it as a distinct audit event with a `bypass: true` flag.

---

### 1.2 Hardcoded Default Worker Secret — `worker-routes.ts:15` & `worker.ts:201`
**File:** `services/api-gateway/src/routes/worker-routes.ts`  
**File:** `services/api-gateway/src/routes/worker.ts`  
**Severity:** 🔴 CRITICAL

```ts
// worker-routes.ts line 15
const expectedToken = process.env.WORKER_SECRET || 'audnix-internal-token-42';

// worker.ts line 201
const expectedToken = process.env.WORKER_SECRET || 'audnix-internal-token-42';
```

The fallback token `'audnix-internal-token-42'` is hardcoded and publicly visible in the codebase. Any attacker with access to the source (or anyone who guesses it) can trigger the outreach engine tick endpoint in production if `WORKER_SECRET` is not set in the environment.

**Recommendation:** Remove the hardcoded fallback. If `WORKER_SECRET` is missing in production, the request should be rejected with 500/503, not silently permitted.

---

### 1.3 Unauthenticated `/mark-pending` Payment Endpoint — `payment-approval.ts:184`
**File:** `services/api-gateway/src/routes/payment-approval.ts`  
**Severity:** 🔴 CRITICAL

```ts
// line 184 — no requireAuth middleware
router.post("/mark-pending", async (req: Request, res: Response) => {
  const { userId, plan, amount, sessionId, subscriptionId } = req.body;
  ...
  await storage.updateUser(userId, { paymentStatus: "pending", plan, ... });
  await storage.createPayment({ userId, plan, amount, ... });
```

This endpoint accepts an unauthenticated POST request and updates any user's plan/payment status to "pending". It then triggers the auto-approval worker that upgrades the user within 5 seconds. Any anonymous actor can craft a request to upgrade any user's plan for free.

**Recommendation:** Add `requireAuth` middleware immediately. The `userId` should be extracted from the session, not the request body.

---

### 1.4 Unauthenticated Admin Stripe Bypass Check — `stripe-payment-confirmation.ts:105`
**File:** `services/api-gateway/src/routes/stripe-payment-confirmation.ts`  
**Severity:** 🟠 HIGH

```ts
// line 105 — no auth middleware
router.post('/admin/bypass-check', async (req: Request, res: Response): Promise<void> => {
```

The `/admin/bypass-check` endpoint accepts any Stripe session ID and returns full fraud indicator details and payment amounts. This is sensitive information that should be admin-only but has no authentication guard.

**Recommendation:** Add `requireAuth` + `requireAdmin` middleware.

---

### 1.5 `x-vercel-cron: true` Header Bypass in Cron Route — `cron-routes.ts:18`
**File:** `services/api-gateway/src/routes/cron-routes.ts`  
**Severity:** 🟠 HIGH

```ts
// line 18
const isVercelCron = req.headers['x-vercel-cron'] === 'true';

if (cronSecret && authHeader !== `Bearer ${cronSecret}` && !isVercelCron) {
  return res.status(401).json({ error: 'Unauthorized' });
}
```

The cron secret check is bypassed if the `x-vercel-cron: true` header is present. This header can be set by anyone making an HTTP request. An attacker can bypass authentication and trigger the outreach engine tick, email sync, and follow-up processing from any location.

**Recommendation:** Remove the `x-vercel-cron` header bypass or validate it using Vercel's OIDC token instead. The header alone is not a security control.

---

### 1.6 Worker Start/Stop Endpoints — No Admin Role Enforcement — `worker.ts:13-20`
**File:** `services/api-gateway/src/routes/worker.ts`  
**Severity:** 🟠 HIGH

```ts
// line 13 — comment says "Check if user is admin" but only checks for userId
router.post('/worker/start', async (req: Request, res: Response) => {
  // Check if user is admin (implement your auth logic)
  const userId = (req as any).session?.userId || req.body.user_id;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  followUpWorker.start(); // Any authenticated user can start workers
```

Any authenticated user — not just admins — can start, stop, or trigger workers via these endpoints.

**Recommendation:** Add `requireAdmin` middleware and remove the `user_id` from `req.body` as a fallback for session userId.

---

## 2. Bugs

### 2.1 Broken SQL Filter in Re-Engagement Worker — `re-engagement-worker.ts:51`
**File:** `services/brain-worker/workers/re-engagement-worker.ts`  
**Severity:** 🔴 CRITICAL BUG

```ts
// line 51
eq(leads.userId, sql`leads.user_id`), // Just checking for existence
```

This Drizzle ORM condition compares the `leads.userId` column to itself via a raw SQL expression `leads.user_id`. It is always true — it functions as a complete no-op filter. The comment "Just checking for existence" confirms it was meant to do something but was left in a broken state.

**Impact:** The worker queries leads across **all users** with no user scoping, meaning it could re-engage leads from all accounts in a single tick. This is both a data leak and an unsolicited outreach risk for every user on the platform.

**Recommendation:** This line should either be removed entirely (query is already scoped by `lastMessageAt` and `re_engagement_sent`) or replaced with a proper user filter such as `eq(leads.userId, someUserIdVar)`.

---

### 2.2 Closing Prompt Never Passed to AI — `closing-worker.ts:82`
**File:** `services/brain-worker/workers/closing-worker.ts`  
**Severity:** 🟠 HIGH BUG

```ts
// line 82 — closingPrompt is defined but never used
const closingPrompt = "STALL DETECTION: This lead is high-value but hasn't replied in 48h...";

const reply = await generateAIReply(lead, history, 'email', {
  businessName: user?.businessName || 'Audnix',
  brandVoice: 'High-urgency closing advisor'  // closingPrompt NOT injected
});
```

The `closingPrompt` string is constructed but never passed to `generateAIReply`. The AI generates a standard reply without any closing instructions, completely defeating the purpose of the `ClosingWorker`.

**Recommendation:** Pass `closingPrompt` as a `systemOverride` or `injectedPrompt` parameter in the options object of `generateAIReply`.

---

### 2.3 Re-Engagement Prompt Never Passed to AI — `re-engagement-worker.ts:83`
**File:** `services/brain-worker/workers/re-engagement-worker.ts`  
**Severity:** 🟠 HIGH BUG

```ts
// line 83-88 — reEngagementPrompt defined but never used
const reEngagementPrompt = "REACTIVATION: This lead has been cold for 90 days...";

const reply = await generateAIReply(lead, history, 'email', {
  businessName: user?.businessName || 'Audnix',
  brandVoice: 'Helpful strategic advisor'  // reEngagementPrompt NOT injected
});
```

Identical pattern to `closing-worker.ts`. The AI ignores the re-engagement instruction and generates a generic reply.

**Recommendation:** Same as 2.2 — inject the prompt into the AI call options.

---

### 2.4 `PostMortemWorker` Has No `start()` Method — `post-mortem-worker.ts`
**File:** `services/brain-worker/workers/post-mortem-worker.ts`  
**Severity:** 🟡 MEDIUM BUG

```ts
export class PostMortemWorker {
  // No start() method, no setInterval, no scheduler
  async tick(): Promise<void> { ... }
}
```

The `PostMortemWorker` exposes only a `tick()` method with no internal scheduler. In `brain-worker/index.ts`, the module is imported but no `startWorker('Post-mortem', ...)` call is made. The post-mortem analysis (analyzing lost leads to extract strategic pivots) **never runs**.

**Recommendation:** Add a `start()` method with a `setInterval` (e.g., every 6 hours), register it with `workerHealthMonitor`, and add the startup call in `brain-worker/index.ts`.

---

### 2.5 `ClosingWorker` Targets Only `score === 100` — `closing-worker.ts:45`
**File:** `services/brain-worker/workers/closing-worker.ts`  
**Severity:** 🟡 MEDIUM BUG

```ts
// line 45
eq(leads.score, 100), // Category A is represented as score 100 in our engine
```

The Drizzle query uses strict equality `eq(leads.score, 100)`. If the scoring engine ever assigns 99 or 98 to a high-value lead (e.g., due to the scoring algorithm producing floats or capping at 98), they will be silently excluded. The comment acknowledges this is a proxy for "Category A" — a range-based concept — but the implementation uses exact equality.

**Recommendation:** Use `gte(leads.score, 85)` to reflect the comment in `closing-worker.ts` line 11 which says "Score A (>85)".

---

## 3. Incomplete Implementations

### 3.1 `alertAdmin()` Is a No-Op — `worker-health.ts:177`
**File:** `shared/lib/monitoring/worker-health.ts`  
**Severity:** 🟡 MEDIUM

```ts
// line 177-180
private async alertAdmin(workerName: string, error: string): Promise<void> {
  console.error(`🚨 WORKER FAILURE: ${workerName} - ${error}`);
  // Using Neon database for admin notifications - no Supabase needed
}
```

When a worker fails permanently (after 3 errors), `alertAdmin` is called. The comment implies a database notification should be created, but the method only logs to `console.error`. No notification is persisted, no WebSocket event is emitted, and no admin dashboard entry is created.

**Recommendation:** Add a `db.insert(notifications)` call (like the pattern used in `brain-worker/index.ts` `reportPermanentFailure`), or call `wsSync.notifyIntegrationError` to surface the failure in the admin panel.

---

### 3.2 Worker Status Endpoint — Admin Check Incomplete — `worker-routes.ts:33`
**File:** `services/api-gateway/src/routes/worker-routes.ts`  
**Severity:** 🟡 MEDIUM

```ts
// line 33-39
router.get('/status', requireAuth, async (req, res) => {
  // Only admins can see status
  // For now just allow authenticated users
  res.json({
    status: 'running',
    timestamp: new Date().toISOString(),
  });
});
```

The admin check is explicitly noted as deferred ("For now just allow authenticated users"). Additionally, the response is hardcoded to `{ status: 'running' }` regardless of actual worker health — it doesn't query `workerHealthMonitor` at all.

**Recommendation:** Enforce admin role, and return `workerHealthMonitor.getDetailedStatus()` as the response.

---

### 3.3 `postMortemWorker` Imported But Never Started — `brain-worker/index.ts:83`
**File:** `services/brain-worker/index.ts`  
**Severity:** 🟡 MEDIUM

```ts
// line 83 — postMortemWorker imported but startWorker never called for it
{ postMortemWorker },    // ← imported
...
await startWorker('Lead Enrichment',    () => leadEnrichmentWorker.start());
await startWorker('Autonomous Closing', () => closingWorker.start());
// Post-mortem is never started
```

The `postMortemWorker` is destructured from its import but there is no corresponding `startWorker('Post-mortem', ...)` call. The worker is entirely dead.

---

### 3.4 `getConnectedUsers()` Always Returns Empty Array — `websocket-sync.ts:315`
**File:** `shared/lib/realtime/websocket-sync.ts`  
**Severity:** 🟡 MEDIUM

```ts
// line 315
getConnectedUsers(): string[] {
  return [];
}
```

This method is a stub that always returns an empty array. Any caller relying on knowing which users are currently connected will receive incorrect data.

**Recommendation:** Implement by tracking socket-to-userId mappings in a `Map`, populated in the `connection` and `disconnect` handlers.

---

### 3.5 Payment Auto-Approval Triggers on Unvalidated User Input — `payment-approval.ts:184`
*(Combined with Security Issue 1.3)*  
In addition to missing authentication, the `mark-pending` endpoint directly accepts `plan` from the request body and passes it to `storage.updateUser`. There is no validation that `plan` is a valid tier from the pricing config. An attacker can set any string as the plan value.

**Recommendation:** Validate `plan` against `Object.keys(PLANS)` before any database write.

---

## 4. Architectural Concerns

### 4.1 `ServiceRegistry` Uses a Separate `ioredis` Connection — `service-registry.ts:21`
**File:** `shared/lib/monitoring/service-registry.ts`  
**Severity:** 🔵 LOW-MEDIUM

```ts
// line 21 — raw ioredis, not the shared client
this.redis = new Redis(redisUrl);
```

The entire codebase uses `@shared/lib/redis/redis.ts` (node `redis` v4 client) as the centralized Redis connection with TLS handling, telemetry, and reconnect strategies. `ServiceRegistry` creates its own raw `ioredis` client, bypassing all of that infrastructure. This creates a second TCP connection to Redis per service instance and misses latency telemetry.

**Recommendation:** Refactor `ServiceRegistry` to accept a Redis client instance via its constructor (dependency injection) or use `getRedisClient()` from the shared module.

---

### 4.2 `AiBudgetWorker` Iterates All Users Every 15 Minutes — `ai-budget-worker.ts:42`
**File:** `services/brain-worker/workers/ai-budget-worker.ts`  
**Severity:** 🔵 LOW-MEDIUM

```ts
// line 42
const users = await storage.getUsers();
// Loops over all users every 15 minutes
for (const user of users) { ... }
```

`storage.getUsers()` fetches all users in the system. At scale (thousands of users), this N+2 query pattern (one for all users, then one `updateUser` per user) will be increasingly expensive. There is no pagination or batch processing.

**Recommendation:** Add pagination to `storage.getUsers()` and process in batches of 100-500. Alternatively, use a SQL-level batch update for the midnight reset case.

---

### 4.3 Legacy MongoDB Module Still Present — `shared/lib/mongo.ts`
**File:** `shared/lib/mongo.ts`  
**Severity:** 🔵 LOW

The project uses PostgreSQL (Neon) + Drizzle as the database layer, but a `mongo.ts` legacy module still exists. If any code accidentally imports from it, it could introduce a silent no-op or connection error that is hard to trace.

**Recommendation:** Verify the file has no active imports across the codebase. If unused, delete it to eliminate confusion.

---

### 4.4 Dual `closingPrompt` / `reEngagementPrompt` Pattern — Dead Variable Risk
**Files:** `closing-worker.ts`, `re-engagement-worker.ts`  
**Severity:** 🔵 LOW (covered above in §2.2 and §2.3 as bugs)

Both workers follow the same broken pattern of constructing a strategy prompt and then ignoring it. This suggests the `generateAIReply` function's API may not support injecting a system prompt override at the call site. If so, the underlying function signature should be extended.

---

### 4.5 `admin-auth.ts` Failed Attempts Counter Is In-Memory Only — `admin-auth.ts:32`
**File:** `services/api-gateway/src/routes/admin-auth.ts`  
**Severity:** 🔵 LOW

```ts
// line 32
const failedAttempts = new Map<string, FailedAttemptRecord>();
```

The brute-force protection for admin login uses an in-memory `Map`. On process restart (Railway redeploy, crash), all block records are lost, resetting attacker lockout state. In a multi-instance deployment, blocks are not shared across instances.

**Recommendation:** Persist block records in Redis with a TTL matching `blockedUntil` for crash-safe, multi-node protection.

---

### 4.6 `payment-approval.ts` Plan Field Not Validated — `payment-approval.ts:93`
**File:** `services/api-gateway/src/routes/payment-approval.ts`  
**Severity:** 🔵 LOW

```ts
// line 93
const plan = user.pendingPaymentPlan as any;
await storage.updateUser(userId, { plan, ... });
```

The `plan` value pulled from `user.pendingPaymentPlan` is cast with `as any` and passed directly to `updateUser` without type validation. If `pendingPaymentPlan` contains a corrupted or unexpected value (e.g., set by the unauthenticated `mark-pending` endpoint), it could persist an invalid plan.

---

## 5. Minor / Low-Priority Issues

### 5.1 `worker-routes.ts` Tick Has Hardcoded Fallback Secret (Duplicate of §1.2)
Both `worker-routes.ts` and `worker.ts` contain the same `'audnix-internal-token-42'` fallback. Even if fixed in one file, the other still needs updating.

---

### 5.2 `deals-routes.ts` POST `/sync` Has No Concurrency Limit Comment — `deals-routes.ts:167`
```ts
// line 166 — comment acknowledges sequential as a workaround
// Run in parallel with a concurrency limit if needed, for now just sequential for safety
for (const lead of leads) {
  await evaluateLeadDealValue(userId, lead.id.toString());
}
```
This is acknowledged as a temporary sequential loop. For users with thousands of leads, this sync endpoint could time out. No parallel processing or pagination is implemented.

---

### 5.3 `re-engagement-worker.ts` Incorrectly Sets Status to `'replied'` — Line 146
```ts
await storage.updateLead(lead.id, {
  status: 'replied', // Move back to active conversation
```
Marking a re-engaged lead as `'replied'` means the AI will immediately treat them as having responded, potentially triggering follow-up logic for a message the lead has not actually replied to.

**Recommendation:** Use a dedicated status like `'re-engaged'` or `'open'` until a real reply arrives.

---

### 5.4 `cron-routes.ts` Only Triggers 3 of Many Workers
```ts
// Only outreach engine, email sync, and follow-up are triggered
await outreachEngine.tick();
await emailSyncWorker.syncAllUserEmails();
await followUpWorker.processQueue();
```
Workers like `LeadEnrichment`, `ClosingWorker`, `ReEngagementWorker`, and `PostMortemWorker` are not covered by the cron tick. In serverless deployments, these workers will never run unless separately scheduled.

---

### 5.5 `notification-routes.ts` Uses Both `req.session` and `req.user` for `userId`
```ts
const userId = req.session?.userId || (req.user as any)?.id;
```
Inconsistent userId resolution — should use the centralized `getCurrentUserId(req)` helper already available in `auth.ts`.

---

### 5.6 `deals-routes.ts` `/sync` Makes N+1 Queries
```ts
for (const lead of leads) {
  const messages = await storage.getMessagesByLeadId(lead.id);
  if (messages && messages.length > 0) {
    await evaluateLeadDealValue(userId, lead.id.toString());
  }
}
```
Two sequential DB queries per lead. For users with 1000+ leads this is a severe performance issue.

---

## 6. Files Audited

| File | Lines | Status |
|---|---|---|
| `services/api-gateway/src/core/bootstrap.ts` | 77 | ✅ Clean |
| `services/api-gateway/src/middleware/auth.ts` | 245 | ✅ Clean |
| `services/api-gateway/src/routes/index.ts` | 186 | ✅ Clean |
| `services/api-gateway/src/routes/user-auth.ts` | 44K | ✅ Mostly clean |
| `services/api-gateway/src/routes/admin-auth.ts` | 371 | 🔴 OTP bypass |
| `services/api-gateway/src/routes/billing-routes.ts` | 75 | ✅ Clean |
| `services/api-gateway/src/routes/health-routes.ts` | 46 | ✅ Clean |
| `services/api-gateway/src/routes/ai-routes.ts` | 1725 | ✅ Mostly clean |
| `services/api-gateway/src/routes/integrations-routes.ts` | 341 | ✅ Clean |
| `services/api-gateway/src/routes/worker-routes.ts` | 43 | 🔴 Hardcoded secret, incomplete admin check |
| `services/api-gateway/src/routes/worker.ts` | 218 | 🔴 Hardcoded secret, no admin enforcement |
| `services/api-gateway/src/routes/cron-routes.ts` | 50 | 🟠 Header bypass |
| `services/api-gateway/src/routes/stripe-payment-confirmation.ts` | 153 | 🟠 Unauth endpoint |
| `services/api-gateway/src/routes/payment-approval.ts` | 254 | 🔴 Unauth endpoint |
| `services/api-gateway/src/routes/pending-payments.ts` | 151 | ✅ Clean |
| `services/api-gateway/src/routes/deals-routes.ts` | 190 | 🟡 N+1, sequential sync |
| `services/api-gateway/src/routes/notification-routes.ts` | 176 | 🟡 Inconsistent userId |
| `services/api-gateway/src/routes/organization-routes.ts` | 105 | ✅ Clean |
| `services/api-gateway/src/routes/channel-status-routes.ts` | 117 | ✅ Clean |
| `services/api-gateway/src/core/unified-worker-starter.ts` | 110 | ✅ Clean |
| `services/brain-worker/index.ts` | 190 | 🟡 postMortemWorker never started |
| `services/brain-worker/workers/lead-enrichment-worker.ts` | 262 | ✅ Clean |
| `services/brain-worker/workers/closing-worker.ts` | 167 | 🟠 Prompt unused, score exact-match bug |
| `services/brain-worker/workers/re-engagement-worker.ts` | 168 | 🔴 SQL no-op filter, prompt unused |
| `services/brain-worker/workers/post-mortem-worker.ts` | 109 | 🟡 No start() method, never scheduled |
| `services/brain-worker/workers/ai-budget-worker.ts` | 109 | 🟡 Full user scan at scale |
| `services/outreach-worker/index.ts` | 143 | ✅ Clean |
| `services/lead-recovery-worker/index.ts` | 32 | ✅ Clean |
| `services/rag-worker/index.ts` | 83 | ✅ Clean |
| `services/billing-service/src/billing/index.ts` | 115 | ✅ Clean |
| `services/social-worker/src/social/index.ts` | 97 | ✅ Clean |
| `services/socket-service/index.ts` | 44 | ✅ Clean |
| `shared/lib/redis/redis.ts` | 208 | ✅ Clean |
| `shared/lib/queue.ts` | 57 | ✅ Clean |
| `shared/lib/realtime/websocket-sync.ts` | 321 | 🟡 getConnectedUsers() stub |
| `shared/lib/monitoring/worker-health.ts` | 184 | 🟡 alertAdmin() is no-op |
| `shared/lib/monitoring/quota-service.ts` | 146 | ✅ Clean |
| `shared/lib/monitoring/memory-watchdog.ts` | 34 | ✅ Clean |
| `shared/lib/monitoring/service-registry.ts` | 99 | 🔵 Separate ioredis connection |

---

## 7. Summary

### Issue Count by Severity

| Severity | Count |
|---|---|
| 🔴 Critical | 4 |
| 🟠 High | 5 |
| 🟡 Medium | 6 |
| 🔵 Low / Architectural | 6 |

### Top 5 Must-Fix Items (Priority Order)

1. **Unauthenticated `/mark-pending` endpoint** (`payment-approval.ts`) — allows free plan upgrades by any anonymous user
2. **Broken SQL filter in Re-Engagement Worker** (`re-engagement-worker.ts`) — worker runs against ALL users' leads
3. **Hardcoded OTP bypass `'000000'`** (`admin-auth.ts`) — allows admin takeover if whitelist email is known
4. **Hardcoded fallback worker secret `'audnix-internal-token-42'`** (`worker-routes.ts`, `worker.ts`) — allows outreach engine manipulation
5. **Closing/Re-Engagement prompts never passed to AI** (`closing-worker.ts`, `re-engagement-worker.ts`) — autonomous workers send generic AI replies instead of their intended strategy

### Architecture Is Solid
The overall codebase architecture is production-grade: proper session auth with timing attack prevention, Redis-backed distributed locking, BullMQ for reliable job processing, Sentry for error monitoring, quota service for DB protection, WebSocket throttling/debouncing, and graceful shutdown handlers throughout. The issues found are concentrated in a small number of specific files and are all fixable.
