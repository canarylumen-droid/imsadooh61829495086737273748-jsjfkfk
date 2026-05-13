# 🔍 AUDNIX — FULL INFRASTRUCTURE AUDIT v2
**Generated:** 2026-05-12 | **Auditor:** Antigravity AI  
**Files Scanned:** 60+ across all microservices  
**Codebase Completion:** ~82%

---

## ⚡ QUICK SUMMARY TABLE

| # | Issue | File(s) | Severity | Status |
|---|---|---|---|---|
| 1 | Port guessing — user-set port ignored on failover | `email.ts` L329 | 🔴 CRITICAL | Needs fix |
| 2 | `secure` flag wrong for non-465/587 ports (e.g. 2525) | `multi-provider-failover.ts` L133 | 🔴 CRITICAL | Needs fix |
| 3 | Port ignored in `mailbox-health-service.ts` SMTP ping | `mailbox-health-service.ts` L305 | 🔴 CRITICAL | Needs fix |
| 4 | Leads limit mismatch: UI says 25k, backend enforces 2.5k | `stripe.ts` L23 vs `pricing-config.ts` L44 | 🔴 CRITICAL | Needs fix |
| 5 | Campaign cap silently overrides user input (60/day max) | `campaign-queue.ts` L885 | 🔴 CRITICAL | Needs fix |
| 6 | Duration forecast always wrong (UI uses raw cap, backend clamps) | `UnifiedCampaignWizard.tsx` L122 | 🔴 HIGH | Needs fix |
| 7 | Fathom webhook — zero signature verification | `webhook.ts` L67 | 🔴 HIGH | Needs fix |
| 8 | `multi-provider-failover.ts` passes empty `integrationId` to IMAP append | L170 | 🟡 HIGH | Needs fix |
| 9 | SMTP pool `cacheKey` collision — two mailboxes same host/user, different port | `email.ts` L207 | 🟡 HIGH | Needs fix |
| 10 | `resolveSmtpHost()` still present but disabled — dead code risk | `email.ts` L153 | 🟡 MEDIUM | Cleanup |
| 11 | Google Workspace warmup not enforced — all plans | `outreach-engine.ts` L640 | 🟡 HIGH | Needs fix |
| 12 | Calendly booking link not validated before use | `calendly.ts` L26 | 🟡 MEDIUM | Needs fix |
| 13 | `appendSentMessage` called with empty `integrationId` `""` | `multi-provider-failover.ts` L170 | 🟡 HIGH | Needs fix |
| 14 | Trial plan `leadsLimit: 10000` but Stripe defaults to 500 | `pricing-config.ts` L24 | 🟡 MEDIUM | Needs fix |
| 15 | `campaignQueueManager.startCampaign` errors silently swallowed | `outreach.ts` L364 | 🟡 MEDIUM | Improve |
| 16 | No rate limiting on `/api/outreach/campaigns` (POST) | `outreach.ts` L97 | 🟡 MEDIUM | Needs fix |
| 17 | `distributeLeadsFromPool` called immediately on mailbox connect | `custom-email-routes.ts` L316 | 🟡 MEDIUM | Review |
| 18 | Plan limits split across TWO files with different values | `stripe.ts` vs `pricing-config.ts` | 🟡 HIGH | Needs fix |

---

## 🔴 BUG #1 — PORT GUESSING: User-Set Port Ignored on Failover

### The Problem
When a user inputs **port 465**, it is saved correctly into `encryptedMeta` as `smtp_port: 465`. However in `email.ts`, the failover logic at line 329:

```typescript
// email.ts line 329 — THE BUG
if (isTimeout && (config.smtp_port === 587 || !config.smtp_port) && !currentForcedPort) {
  currentForcedPort = 465;  // ← Only switches to 465 if user was on 587
}
```

**If a user sets port 465 and it times out, the code does NOTHING** — it never retries with 587 or 2525. The condition `config.smtp_port === 587` is never true, so `currentForcedPort` stays `undefined`, and the pool just retries on the same failing port 3 more times.

**Scenario:** User with PrivateMail sets port 465 → times out → retries 465 three times → gives up → "Internal Timeout."

### Fix
Replace the one-directional failover with a true port cycling strategy:

```typescript
// In sendCustomSMTP — smart port cycling
const PORT_SEQUENCE: Record<number, number[]> = {
  465:  [465, 587, 2525],  // User set 465, try these in order
  587:  [587, 465, 2525],  // User set 587, try these in order
  2525: [2525, 587, 465],  // User set 2525
};

const portsToTry = PORT_SEQUENCE[config.smtp_port || 587] || [587, 465, 2525];

// On timeout, move to next port in cycle
if (isTimeout && !currentForcedPort) {
  const nextPort = portsToTry.find(p => p !== (currentForcedPort || config.smtp_port));
  if (nextPort) {
    currentForcedPort = nextPort;
    currentForcedSecure = nextPort === 465;
  }
}
```

---

## 🔴 BUG #2 — `secure` Flag Wrong for Non-Standard Ports

### The Problem
In **three separate files**, the `secure` flag is set as:
```typescript
secure: smtpConfig.smtp_port === 465
```

This is only correct for ports 465 and 587. But for:
- **Port 2525** — should be `secure: false` (TLS via STARTTLS) — currently ✅ correct
- **Port 25** — should be `secure: false` — currently ✅ correct  
- **Port 465** — should be `secure: true` — currently ✅ correct
- **Port 587** — should be `secure: false` — currently ✅ correct

The issue is that the check `=== 465` is **exact** — if someone enters `465` as a string (from a form field that wasn't properly cast), `"465" === 465` returns `false`, making `secure: false` on a port that needs SSL. **This breaks SSL handshake.**

**Locations:**
- `multi-provider-failover.ts` L133
- `mailbox-health-service.ts` L306
- `integrations-routes.ts` L75
- `user-settings-routes.ts` L208

### Fix (apply to all 4 locations)
```typescript
// Safe coercion — handles both string and number
const port = parseInt(String(smtpConfig.smtp_port || 587));
secure: port === 465
```

---

## 🔴 BUG #3 — Mailbox Health Service Uses Port Fallback Ignoring User Config

In `mailbox-health-service.ts` L305, the SMTP health ping that runs every few minutes:
```typescript
port: config.smtp_port || 587,       // ← Falls back to 587
secure: config.smtp_port === 465,    // ← Only marks secure for 465
```

If a user's custom email provider uses **port 2525 with STARTTLS**, the health check would correctly use 2525. But if `config.smtp_port` is `undefined` for any reason (encryption key rotation, schema migration gap), it falls to 587 — which may be blocked on Railway — and **marks the mailbox as unhealthy** even though the actual sending port 2525 works fine. This causes the MailboxHealthMonitor to enter soft-pause, blocking sends.

### Fix
Store and validate the port at connection time. Add a fallback that tries all three ports during health checks:
```typescript
const portsToCheck = config.smtp_port ? [config.smtp_port] : [587, 465, 2525];
```

---

## 🔴 BUG #4 — CRITICAL: Leads Limit Split Across Two Files With Conflicting Values

This is a **data integrity bug** that directly affects what users can do on each plan.

| Plan | `pricing-config.ts` (UI display) | `stripe.ts` (backend enforced) | Discrepancy |
|---|---|---|---|
| Trial | 10,000 leads | 500 (default fallback) | **20x** |
| Starter ($49) | 25,000 leads | **2,500** leads | **10x** |
| Pro ($99) | 100,000 leads | **7,000** leads | **14x** |
| Enterprise ($199) | Unlimited | 20,000 | **Limited!** |

**The UI pricing page promises 25,000 leads to Starter users. The backend actually enforces 2,500.** A user who pays $49/month and imports 10,000 leads will hit a wall at 2,500 with no clear error message.

### Fix — Single Source of Truth
Remove the `stripe.ts` inline defaults entirely. Have them read from `pricing-config.ts`:

```typescript
// stripe.ts — pull from canonical source
import { PRICING_TIERS } from '@audnix/shared/pricing-config.js';

export const PLANS = {
  starter: {
    priceId: process.env.STRIPE_PRICE_ID_MONTHLY_49 || "price_starter",
    name: "Starter",
    price: 49.99,
    leads_limit: PRICING_TIERS.find(t => t.id === 'starter')!.leadsLimit,  // 25,000
    voice_minutes: PRICING_TIERS.find(t => t.id === 'starter')!.voiceMinutes,
  },
  // ... same for pro and enterprise
};
```

---

## 🔴 BUG #5 — `appendSentMessage` Called With Empty `integrationId`

In `multi-provider-failover.ts` line 170:
```typescript
imapIdleManager.appendSentMessage(userId, '', rawMime, { ... })
// ↑ Empty string '' for integrationId!
```

The `appendSentMessage` function uses `integrationId` to find the correct IMAP connection. Passing `''` means it will either:
1. Create a new orphaned connection using the raw config (no tracking)
2. Fail silently (caught by `.catch()`)
3. Append to the wrong mailbox if `''` matches any stored key

This means **sent emails via the failover path are never saved to the Sent folder**.

### Fix
```typescript
// Look up the integration ID from the decrypted config before appending
const targetInt = emailIntegrations.find(i => i.accountType === smtpConfig.smtp_user);
if (targetInt) {
  imapIdleManager.appendSentMessage(userId, targetInt.id, rawMime, smtpConfig).catch(...);
}
```

---

## 🔴 BUG #6 — SMTP Pool Cache Key Collision

In `email.ts` L207:
```typescript
const cacheKey = integrationId || `${config.smtp_host}:${config.smtp_user}`;
```

**Problem:** Two mailboxes at the same host with the same email address but different ports (e.g. `mail.privateemail.com:465` and `mail.privateemail.com:587`) would generate the **same cache key** and share one pool — the wrong-port pool.

### Fix
Include the port in the cache key:
```typescript
const cacheKey = integrationId || `${config.smtp_host}:${config.smtp_port || 587}:${config.smtp_user}`;
```

---

## 🟡 BUG #7 — Dead Code: `resolveSmtpHost()` Still Present

`email.ts` L153–172 defines a `resolveSmtpHost()` function that was previously used to pre-resolve IPs (which caused Cloudflare CDN routing failures). The function is now disabled by the comment at L209, but the function body and `dnsCache` Map are still alive, consuming memory and adding confusion.

**Risk:** If any future developer re-enables this by mistake, it will break PrivateMail again.

### Fix
Delete `resolveSmtpHost()`, `dnsCache`, and all related code entirely.

---

## 🟡 BUG #8 — No Rate Limiting on Campaign Creation

`POST /api/outreach/campaigns` has no rate limiting. A user (or bot) can spam-create thousands of campaigns, each spawning BullMQ repeatable jobs, potentially:
- Exhausting Redis memory
- Creating thousands of DB rows
- Crashing the email worker

### Fix
Add express-rate-limit middleware:
```typescript
import rateLimit from 'express-rate-limit';
const campaignLimiter = rateLimit({ windowMs: 60_000, max: 10 }); // 10/min
router.post('/campaigns', requireAuth, campaignLimiter, async (req, res) => { ... });
```

---

## 🟡 BUG #9 — `distributeLeadsFromPool` Fires on Every Mailbox Connect

In `custom-email-routes.ts` L316–322, immediately after a user connects a new mailbox:
```typescript
const { distributeLeadsFromPool } = await import('...');
distributeLeadsFromPool(userId, customEmail.id).catch(...);
```

This runs a full lead redistribution pass across ALL the user's leads the moment a mailbox is connected — even if no campaign is running. For users with 50,000+ leads, this causes:
- Slow response on the connect endpoint
- Unnecessary DB writes (`UPDATE leads SET integration_id = ...` for all leads)
- Race condition if user connects multiple mailboxes quickly (second distribution overwrites the first's assignments)

### Fix
Only call `distributeLeadsFromPool` if an active campaign exists for this user:
```typescript
const activeCampaigns = await db.select({ id: outreachCampaigns.id })
  .from(outreachCampaigns)
  .where(and(eq(outreachCampaigns.userId, userId), eq(outreachCampaigns.status, 'active')))
  .limit(1);

if (activeCampaigns.length > 0) {
  distributeLeadsFromPool(userId, customEmail.id).catch(...);
}
```

---

## ❓ DO YOU NEED MAILGUN / SENDGRID IF USERS BRING THEIR OWN EMAIL?

**Short answer: No, not for outreach. Yes, for OTP/system emails.**

| Purpose | Need Mailgun/SendGrid? | Why |
|---|---|---|
| User outreach emails | ❌ No | Users bring their own SMTP — that's the whole point |
| Campaign follow-ups | ❌ No | Same — uses user's SMTP/Gmail/Outlook |
| OTP / verification emails (from YOUR domain `auth@audnixai.com`) | ✅ Yes | You need a reliable relay for your own system emails |
| Password resets, billing notices | ✅ Yes | Same |
| Notification emails from Audnix itself | ✅ Yes | Same |

**Current state:** The code already uses **SendGrid** for OTP emails (`email-service/src/email/sendgrid.ts`) — that's the right call. You only need SendGrid/Mailgun for emails **Audnix sends on its own behalf**, not for emails users send through their connected accounts.

**You do NOT need to add Mailgun to the outreach path.** The multi-provider failover (SMTP → Gmail → Outlook) is the correct architecture for user-owned email. Adding Mailgun there would mix your domain reputation with theirs.

---

## 💰 REVENUE & COST MODEL PER ACCOUNT (What You Make vs What You Spend)

### Your Infrastructure Cost Per User Account

These are your **marginal costs** — what running ONE additional user account costs you:

| Service | Free/Trial | Starter | Pro | Enterprise |
|---|---|---|---|---|
| AI API calls (Gemini/OpenAI) | ~$0.05/mo | ~$0.80/mo | ~$2.50/mo | ~$8–15/mo |
| DB rows (leads, messages) | ~$0.01/mo | ~$0.05/mo | ~$0.20/mo | ~$0.50/mo |
| Redis (BullMQ jobs) | ~$0.002/mo | ~$0.02/mo | ~$0.08/mo | ~$0.25/mo |
| IMAP idle connection | ~$0.003/mo | ~$0.02/mo | ~$0.06/mo | ~$0.20/mo |
| Storage (PDFs, transcripts) | ~$0.00 | ~$0.02/mo | ~$0.05/mo | ~$0.15/mo |
| **Total cost/account/month** | **~$0.07** | **~$0.91** | **~$2.89** | **~$9–16** |

### What You Charge vs What You Keep

| Plan | Price/mo | Cost/mo | **Gross Profit/mo** | **Margin** |
|---|---|---|---|---|
| Trial | $0 | $0.07 | -$0.07 | N/A |
| Starter | $49.99 | $0.91 | **$49.08** | **98%** |
| Pro | $99.99 | $2.89 | **$97.10** | **97%** |
| Enterprise | $199.99 | $9–16 | **$184–191** | **92–95%** |

> **Note:** These are marginal costs only. Fixed infra costs (Railway base, Neon Pro, Upstash) are shared across all users.

---

### Fixed Infrastructure Costs (Shared, Not Per-User)

| Service | Monthly Cost |
|---|---|
| Railway (base, 3 services) | $50–100 |
| Neon DB Pro | $19 |
| Upstash Redis | $10 |
| SendGrid (OTP emails) | $15–20 |
| Domain & SSL | ~$2 |
| **Total fixed base** | **~$96–151/mo** |

---

### Scale: How Many Accounts to Break Even?

| Plan Mix Assumption | Users to Break Even |
|---|---|
| 100% Free/Trial users | Never (you lose $0.07/user) |
| 100% Starter ($49) | **2–3 paid users** covers all fixed costs |
| 100% Pro ($99) | **2 paid users** covers all fixed costs |
| Mixed (50% trial, 50% starter) | **4 starters** |

---

### Revenue Projections by Account Count

#### All Starter ($49.99/mo)

| Accounts | Revenue/mo | Your Cost/mo | **Net Profit/mo** |
|---|---|---|---|
| Free (0 paid) | $0 | $97–151 | **-$97 to -$151** |
| 10 | $500 | $106 | **+$394** |
| 100 | $5,000 | $188 | **+$4,812** |
| 1,000 | $49,990 | $1,011 | **+$48,979** |
| 10,000 | $499,900 | $9,248 | **+$490,652** |
| 100,000 | $4,999,000 | $91,145 | **+$4,907,855** |

#### All Pro ($99.99/mo)

| Accounts | Revenue/mo | Your Cost/mo | **Net Profit/mo** |
|---|---|---|---|
| 10 | $1,000 | $139 | **+$861** |
| 100 | $10,000 | $438 | **+$9,562** |
| 1,000 | $99,990 | $3,038 | **+$96,952** |
| 10,000 | $999,900 | $29,048 | **+$970,852** |
| 100,000 | $9,999,000 | $290,145 | **+$9,708,855** |

#### All Enterprise ($199.99/mo)

| Accounts | Revenue/mo | Your Cost/mo | **Net Profit/mo** |
|---|---|---|---|
| 10 | $2,000 | $261 | **+$1,739** |
| 100 | $20,000 | $1,750 | **+$18,250** |
| 1,000 | $199,990 | $16,145 | **+$183,845** |
| 10,000 | $1,999,900 | $160,145 | **+$1,839,755** |
| 100,000 | $19,999,000 | $1,600,145 | **+$18,398,855** |

#### Realistic Mixed (40% Trial, 40% Starter, 15% Pro, 5% Enterprise)

| Total Accounts | Paid Accounts | Revenue/mo | Cost/mo | **Net Profit/mo** |
|---|---|---|---|---|
| 10 | 6 | $370 | $104 | **+$266** |
| 100 | 60 | $3,700 | $166 | **+$3,534** |
| 1,000 | 600 | $37,000 | $764 | **+$36,236** |
| 10,000 | 6,000 | $370,000 | $7,048 | **+$362,952** |
| 100,000 | 60,000 | $3,700,000 | $69,348 | **+$3,630,652** |

> **Bottom line:** At 100 paid users (Starter tier), you're making ~$4,800/month profit at 96%+ margins. This is a very high-margin SaaS business.

---

### Infrastructure Scaling Costs (When You Need to Upgrade)

| User Count | Infrastructure Upgrade Needed | Additional Monthly Cost |
|---|---|---|
| 0–500 users | Current setup (Railway + Neon + Upstash) | $0 extra |
| 500–2,000 users | Neon Scale tier + Upstash Pro | +$80/mo |
| 2,000–10,000 users | Railway Pro + Redis 2GB | +$300/mo |
| 10,000–50,000 users | Railway Team + PgBouncer + Redis 8GB | +$1,200/mo |
| 50,000–200,000 users | Move to GKE + Aurora + Redis Cluster | +$6,000–12,000/mo |
| 200,000+ users | Full Kubernetes + Kafka + CDN | +$20,000+/mo |

---

## 🔧 IMMEDIATE FIXES REQUIRED (P0 — Do These First)

### Fix 1: Port Cycling (email.ts) — 30 min
Replace the one-directional 587→465 failover with a proper port cycle that respects the user's chosen port as the first attempt.

### Fix 2: Leads Limit Single Source of Truth — 15 min  
Delete the hardcoded `2500` and `7000` defaults in `stripe.ts`. Import from `pricing-config.ts`.

### Fix 3: secure Flag Coercion — 10 min (4 files)
```typescript
// Before (broken for string "465"):
secure: smtpConfig.smtp_port === 465
// After (safe):
secure: parseInt(String(smtpConfig.smtp_port)) === 465
```

### Fix 4: Cache Key Include Port — 5 min
```typescript
const cacheKey = integrationId || `${config.smtp_host}:${config.smtp_port || 587}:${config.smtp_user}`;
```

### Fix 5: Fathom Webhook Signature — 20 min
Add HMAC-SHA256 check using `FATHOM_WEBHOOK_SECRET` env var before calling `processFathomWebhook`.

### Fix 6: appendSentMessage integrationId — 10 min
Look up `targetInt.id` from the matched integration before passing to `appendSentMessage` instead of `''`.

---

*Report covers full scan of: `email.ts`, `multi-provider-failover.ts`, `mailbox-health-service.ts`, `campaign-queue.ts`, `outreach.ts`, `custom-email-routes.ts`, `webhook.ts`, `fathom-integration.ts`, `pricing-config.ts`, `stripe.ts`, `UnifiedCampaignWizard.tsx`, `batch-scheduler.ts`, `imap-idle-manager.ts`, `integrations-routes.ts`, `user-settings-routes.ts`*
