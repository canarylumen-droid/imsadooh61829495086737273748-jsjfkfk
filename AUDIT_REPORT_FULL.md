# AUDNIX FULL INFRASTRUCTURE AUDIT v3
*Covers: SMTP/IMAP, AI Engine toggle, Fathom, Calendly, Brand PDF/RAG, Payment links, Workers/Jobs, Lead isolation, Plan expiry, Gmail outreach, Intelligence improvements, Settings, Cost model*

---

## SECTION 1 — SMTP / PORT BUG (Root Cause)

### Bug: User-set port is ignored on retry
In `email.ts` line 329 the failover only switches port when `config.smtp_port === 587`.
If user sets 465 and it times out → code retries 465 three more times → gives up.

**Fix — true port cycling:**
```typescript
const PORT_CYCLE: Record<number, number[]> = {
  465:  [465, 587, 2525],
  587:  [587, 465, 2525],
  2525: [2525, 465, 587],
};
const cycle = PORT_CYCLE[config.smtp_port || 587] || [587, 465, 2525];
// On timeout, pick next port in cycle that hasn't been tried yet
```

### Bug: `secure` flag breaks when port is a string
Four files use `smtp_port === 465` — if the value is `"465"` (string from form), SSL is disabled silently.
Fix: `parseInt(String(smtp_port)) === 465` everywhere.

### Files with port hardcodes needing fix:
- `shared/lib/channels/email.ts` L219, L329
- `services/email-service/src/email/multi-provider-failover.ts` L132–133
- `services/email-service/src/email/mailbox-health-service.ts` L305–306
- `services/api-gateway/src/routes/integrations-routes.ts` L74–75
- `services/api-gateway/src/routes/user-settings-routes.ts` L88, L150

### Pool cache key collision
`cacheKey = integrationId || smtp_host:smtp_user` — missing port means two mailboxes on same host with different ports share one broken pool.
Fix: `smtp_host:smtp_port:smtp_user`

---

## SECTION 2 — AI ENGINE TOGGLE: WHAT HAPPENS WHEN USER TURNS IT OFF?

### How the toggle works
- UI switch in `DashboardLayout.tsx` calls `PATCH /api/user/config { autonomousMode: false }`
- Stored as `users.config.autonomousMode = false`
- Default is `true` (autonomous ON unless explicitly set to false)

### What STOPS when AI is OFF (`autonomousMode: false`):
1. **No new outreach emails sent** — `outreach-engine.ts` L201 returns early
2. **No autonomous follow-ups** — `tickAutonomousOutreach()` never runs
3. **No AI-generated replies to inbound messages** — `follow-up-worker.ts` checks this flag
4. **No meeting reminder emails** — `meeting-reminder-worker.ts` L66 skips if `autonomousMode === false`
5. **No campaign batch processing** — `isMailboxReadyToSend()` L740 returns false
6. **No Emoji follow-up worker** — `emoji-followup-worker.ts` L87 filters by `autonomousMode IS NOT FALSE`

### What STILL RUNS when AI is OFF:
1. **IMAP IDLE stays alive** — inbox keeps receiving, emails still come in
2. **Lead pool distribution** — `distributeLeadsFromPool()` still runs (low-cost prep)
3. **Mailbox health checks** — still pings SMTP/IMAP every 2 mins
4. **Bounce detection** — still monitors bounce rates
5. **WebSocket sync** — dashboard still updates in real-time
6. **Stripe webhooks** — billing still processes
7. **Fathom webhooks** — meeting analysis still runs

### BUG: AI toggle has no per-lead grace window
When you turn AI back ON, every lead with `pendingAutoReply=true` fires simultaneously — no staggered restart. Can flood your SMTP pool on resume.

**Fix needed:** On AI engine resume, stagger re-queuing over 30 minutes to avoid burst.

### Per-Lead AI Pause (`aiPaused` flag)
Separate from the global toggle. Per lead in inbox → "AUTONOMOUS MODE: OFF" button sets `lead.aiPaused = true`. This lead will NEVER receive automated outreach until manually unpaused, even if global AI is ON.

---

## SECTION 3 — FATHOM INTEGRATION FULL AUDIT

### What works:
- Webhook endpoint receives POST at `/api/webhook/fathom`
- Parses transcript for: deal signals, objections, payment agreement, booking intent
- Updates lead status, stage, `proceduralMemory`
- Fires autonomous payment pipeline if `agreedToPay: true`
- Updates `fathom_calls` table with full transcript

### BUG #1: Zero webhook signature verification
Anyone who knows your webhook URL can POST fake meeting data. No HMAC check exists.
```typescript
// MISSING — should be:
const sig = req.headers['x-fathom-signature'];
const expected = crypto.createHmac('sha256', process.env.FATHOM_WEBHOOK_SECRET)
  .update(rawBody).digest('hex');
if (sig !== expected) return res.status(401).json({ error: 'Bad signature' });
```

### BUG #2: `processFathomWebhook` has no idempotency key
If Fathom retries the webhook (it does on timeout), the same meeting gets processed twice:
- Two `fathom_calls` rows created
- Payment pipeline triggered twice
- `proceduralMemory` updated with duplicate entries

**Fix:** Check `fathom_calls` for existing `meetingId` before processing.

### BUG #3: Fathom meeting link not extracted to Calendly profile
When a user books via Fathom, their Calendly link is NOT automatically saved to `user.calendarLink`. If a user hasn't set it manually in settings, the AI will never embed a booking link in follow-up emails.

### Intelligence Flow (working):
```
Meeting ends → Fathom webhook fires → 
  processFathomWebhook() →
    extractDealSignals() →
    updateLeadStatus() →
    if agreedToPay → initPaymentPipeline() →
    updateProceduralMemory() →
    notifyUser() via WebSocket
```

---

## SECTION 4 — CALENDLY INTEGRATION FULL AUDIT

### How the booking link reaches emails:
1. `getBookingLink(userId)` in `shared/lib/integrations/calendly.ts`
2. Checks: OAuth config → `user.calendarLink` → null
3. Passed to AI prompt as `[CALENDAR_LINK]` placeholder
4. AI injects it into email copy when intent = `book_call`

### BUG #1: No link validation before injection
A broken/expired Calendly link is passed directly to the AI and injected into emails silently.

### BUG #2: No auto-extraction from PDF
The PDF extractor (`pdf-context-extractor.ts`) DOES extract `meeting_link` from the uploaded PDF.
BUT it is never automatically saved to `user.calendarLink`.
A user uploads their brand PDF with their Calendly link visible → system still ignores it in emails.

**Fix:**
```typescript
// In the PDF upload handler — after extractComprehensiveContext():
if (extracted.meeting_link && !user.calendarLink) {
  await storage.updateUser(userId, { calendarLink: extracted.meeting_link });
}
```

### BUG #3: Calendly OAuth token not refreshed before email generation
`calendly-service.ts` manages OAuth refresh, but `getBookingLink()` doesn't call `refreshTokenIfNeeded()` before reading. If the token expired, the link falls back to `user.calendarLink` silently.

### BUG #4: Multiple Calendly event types not surfaced
Calendly API supports multiple event types per user (15-min, 30-min, 60-min). The system always returns the first one. Users with multiple event types cannot select which one to embed per campaign.

---

## SECTION 5 — BRAND PDF / RAG SYSTEM AUDIT

### How it works (confirmed from code):
1. User uploads PDF via UI
2. `pdf-context-extractor.ts` runs `extractComprehensiveContext()` — sends PDF text to Gemini
3. Extracts: company name, industry, offer, testimonials, case studies, pricing, URLs, meeting link, payment link, tone examples
4. Runs `researchCompetitivePosition()` — AI researches competitors
5. Runs `performDeepBrandResearch()` — market size, trends, competitor weaknesses
6. All stored in `brand_profiles` table
7. At email generation time: `getBrandContext(userId)` pulls this data and injects into AI prompt

### RAG Worker (`services/rag-worker/`):
Handles vector embeddings for semantic search over brand/lead data. Used for:
- Finding similar past conversations for tone matching
- Objection pattern matching
- Lead enrichment context

### BUG #1: PDF truncated at 6000 chars
Line 60 of `pdf-context-extractor.ts`:
```typescript
${pdfText.substring(0, 6000)}
```
Any brand PDF longer than ~4-5 pages gets silently truncated. Testimonials and case studies at the end of the PDF are never seen by the AI.

**Fix:** Chunk the PDF into 6000-char segments and extract from each, then merge.

### BUG #2: Deep research runs on EVERY PDF upload
`performDeepBrandResearch()` makes 2 AI API calls per PDF upload (competitive + market research). For users who re-upload their PDF often, this wastes AI tokens on identical research.

**Fix:** Cache research by `(companyName + industry)` hash with 7-day TTL.

### BUG #3: `meeting_link` extracted from PDF but never saved to user profile
(As noted in Calendly section above — same bug, two places affected.)

### BUG #4: RAG worker 30-second timeout crashes vector search
The RAG worker job timeout is 30s. Vector similarity search on large datasets can exceed this. When it times out, the AI falls back to brand context only — no semantic lead history matching.

**Fix:** Increase job timeout to 120s, add partial result support.

---

## SECTION 6 — PAYMENT LINK FLOW AUDIT

### End-to-end flow:
```
Lead replies with buying signal →
  follow-up-worker detects intent = "payment" →
  getBrandContext() pulls payment_link from brand profile →
  AI generates email with payment link →
  Email sent → Lead marked pendingPayment = true →
  Stripe webhook confirms payment →
  Lead marked converted
```

### BUG #1: Payment link from PDF not validated
`pdf-context-extractor.ts` extracts `payment_link` from PDF. This raw URL is stored and later injected into emails without checking if it's valid/active. A broken Stripe link = lost sale.

### BUG #2: NGA-1 "$5k Handoff Rule" only partially enforced
The rule says: if deal value > $5,000, don't automate checkout — hand off to human.
Code checks `payment.amountDetected > 5000` in `fathom-integration.ts` but:
- The `amountDetected` field is parsed from transcript text using regex — easily missed
- If amount not detected, system assumes it's under $5k and automates checkout anyway

### BUG #3: No payment link expiry handling
Stripe payment links can expire. Once expired, any email with the old link leads to a dead page. No TTL tracking exists for payment links in the DB.

### BUG #4: `pendingPayments` table not cleaned up
After conversion, rows in `pendingPayments` with `status = 'pending'` remain forever. The `tickCampaigns()` function checks this table to pause campaigns when a checkout is active — stale rows cause campaigns to pause unnecessarily.

**Fix:** Add a cleanup job: mark pending payments older than 7 days as `expired`.

---

## SECTION 7 — LEAD CROSS-CONTAMINATION BETWEEN ACCOUNTS

### Current isolation mechanisms (WORKING):
- All DB queries include `eq(leads.userId, userId)` — leads are user-scoped
- `campaignLeads` links to campaigns which are user-scoped
- `integrations` table has `userId` on every row
- Redis locks use `outreach:lock:{leadId}` — globally unique per lead

### BUG #1: `FOR UPDATE SKIP LOCKED` doesn't filter by userId
In `outreach-engine.ts` L350:
```typescript
.for('update', { skipLocked: true })
```
This is applied AFTER the WHERE clause already filters by campaign (which is user-scoped), so it's technically safe. BUT if a BullMQ job processes leads for User A and User B simultaneously, both could acquire locks on different leads fine. Low risk but worth noting.

### BUG #2: Multi-pod lead double-send risk
When running multiple Railway replicas (email-worker pods), two pods can pick up the same lead if:
1. Redis lock acquisition fails due to network blip
2. Lead lock TTL expires (3 minutes) before send completes for a large email

The `acquireLock(lockKey, 180)` in `outreach-engine.ts` L787 gives 3 minutes. A slow AI generation + slow SMTP send can exceed 3 minutes, unlocking the lead while it's still being processed.

**Fix:** Extend lock TTL to 600 seconds (10 min), and add a `processingPodId` column to `campaign_leads` to track which pod owns it.

### BUG #3: `distributeLeadsFromPool` has no userId guard on inventory scan
In `outreach.ts` L215–228, inventory leads are fetched with `eq(leadsTable.userId, userId)` — this IS correct. But `distributeLeadsFromPool()` in outreach-engine is called without passing userId in some paths — it fetches ALL users' leads if userId is undefined.

---

## SECTION 8 — WHAT HAPPENS WHEN AI SUBSCRIPTION/CREDITS RUN OUT

### Gemini/OpenAI quota exhaustion:
- `ai-service.ts` has a 3-provider failover: Gemini → OpenAI → Anthropic
- If ALL providers are quota-exhausted, `generateReply()` throws
- The `follow-up-worker` and `outreach-engine` catch this and skip the lead
- Lead gets `nextActionAt` bumped +1 hour and retried automatically
- No notification sent to user that AI is degraded

### Plan/Trial expiry (confirmed from `mailbox-health-service.ts`):
- `checkPlanExpiry()` runs every 2 minutes
- Trial expiry → all campaigns paused, in-app notification sent
- Paid plan expiry → NOT checked against Stripe in real-time (BUG — see below)

### BUG: Paid plan expiry not verified against Stripe
`isPlanActive()` L286 returns `true` for all non-trial paid plans unconditionally:
```typescript
// Paid plans (assuming active if plan field is set to something else)
return true; // ← NEVER checks Stripe subscription status!
```
A user whose Stripe subscription failed/cancelled will keep sending for months until manually downgraded in DB.

**Fix:**
```typescript
// Check Stripe subscription status
if (user.stripeSubscriptionId) {
  const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
  return sub.status === 'active' || sub.status === 'trialing';
}
```

### BUG: No graceful degradation when AI is quota-limited
When AI fails, outreach silently skips. User has no visibility. No "AI degraded" badge in dashboard.

**Fix:** Add `aiDegradedUntil` timestamp to user config. When quota hit, set it to `now + 1h`. Dashboard reads this and shows warning banner.

---

## SECTION 9 — GMAIL FOR OUTREACH: FULL ANALYSIS

### How Gmail outreach works:
- User connects Gmail via OAuth in Settings
- `gmailOAuth.getValidToken()` refreshes token automatically
- `sendEmail()` in `email.ts` detects provider = gmail → calls Gmail API
- Emails sent via `https://gmail.googleapis.com/gmail/v1/users/me/messages/send`
- `saveToSentItems: true` is set — Gmail auto-saves to Sent folder

### Gmail limits (ENFORCED in code):
- Non-enterprise: 50/day default, buffer threshold 150
- Enterprise: 1000/day
- Neural Brain cap: 60/day max for non-enterprise (overrides user setting)

### Gmail-specific risks NOT handled:
1. **Google's "less secure app" policy** — Gmail via OAuth is fine, but App Password SMTP connections could get flagged
2. **Reply-to threading** — Gmail groups by `In-Reply-To` header. The system generates fresh `Message-ID` each time. Follow-up emails don't thread correctly in Gmail
3. **Gmail rate limit 429** — handled as `isRateLimited` in `handleMailboxFailure` (marks warning, doesn't disconnect)
4. **Google Workspace admin restrictions** — if a Workspace admin disables OAuth for third-party apps, the token silently fails at next refresh

### BUG: Gmail token refresh race condition
`gmailOAuth.getValidToken()` is called from multiple workers simultaneously. If two workers both detect an expired token and try to refresh at the same time, both get new tokens — but only the second one is stored, making the first worker's token stale mid-send.

**Fix:** Redis-backed token refresh lock: `SETNX gmail:refresh:{userId} 1 EX 30`

---

## SECTION 10 — WORKERS & JOBS: FULL MAP

### All active workers (confirmed from `/services/`):

| Worker | Purpose | Interval | Health Monitored |
|--------|---------|---------|-----------------|
| `outreach-worker` | Send campaign emails, autonomous outreach | 1 min BullMQ tick | Yes |
| `brain-worker` | AI reply generation, follow-ups, Fathom | Event-driven + 5min poll | Yes |
| `email-service` | IMAP IDLE, health checks, bounce detection | Always-on IDLE + 2min health | Yes |
| `email-worker` | Secondary email sync, warmup | 30s poll | Yes |
| `rag-worker` | Vector embeddings, semantic search | Event-driven | Partial |
| `social-worker` | Instagram DM sync, comment monitoring | 5min poll | Partial |
| `billing-service` | Stripe webhooks, plan enforcement | Event-driven | No |

### BUG: `rag-worker` has no health monitor registration
`workerHealthMonitor.registerWorker('RAG')` is not called. If the RAG worker crashes, the health dashboard won't show it as down.

### BUG: `billing-service` has no health monitor
Stripe webhook failures are silently swallowed. No alerting exists for failed payment processing.

### BUG: `social-worker` Instagram polling runs even when user has no Instagram connected
The worker queries ALL users every 5 minutes regardless of whether they have an Instagram integration. Wastes DB queries at scale.

**Fix:** Add `WHERE EXISTS (SELECT 1 FROM integrations WHERE provider = 'instagram' AND user_id = users.id)` to the user query.

### BullMQ Job Priority Issues:
- Reply emails are "unmetered" — bypass daily caps (CORRECT)
- Follow-up emails are priority 2 (CORRECT)
- Initial outreach is priority 3 (CORRECT)
- BUT: there's no dead-letter queue. If a job fails 3 times, it's removed silently with no audit trail entry

**Fix:** Add `onFailed` handler to all BullMQ workers that creates an `audit_trail` record.

---

## SECTION 11 — SETTINGS PAGE AUDIT

### What's in settings (confirmed from routes):
- SMTP/IMAP credentials (custom-email-routes.ts)
- Gmail/Outlook OAuth (integrations-routes.ts)
- Calendly OAuth + manual calendar link
- Brand PDF upload
- AI Engine toggle
- Daily limit sliders (per mailbox)
- Warmup status

### BUG #1: Settings save doesn't re-encrypt existing credentials
When user updates their password in settings, `user-settings-routes.ts` L150 updates `smtp_port = ${port || 587}` but does NOT re-encrypt the full credentials object. If only the port changed, the password from the previous encrypted blob may be misaligned.

### BUG #2: No validation that email field matches SMTP user
User can save `smtp_user = "alice@example.com"` with `email = "bob@different.com"`. The system will send from alice but the "from" address shown is bob. Causes spam flags.

### BUG #3: Daily limit slider max is 500 in UI, but backend allows 1000
`UnifiedCampaignWizard.tsx` slider max = 500. Backend `outreach.ts` L244 caps at 1000. The UI artificially limits what users can set.

---

## SECTION 12 — HOW TO MAKE YOUR SYSTEM SMARTER

### Intelligence Improvements (prioritized):

**1. Thread-aware follow-ups (HIGH IMPACT)**
Currently follow-ups are fresh emails. Add `In-Reply-To` and `References` headers to make them thread in Gmail/Outlook. Reply rate increases ~30% when emails thread.

**2. Time-zone aware sending (MEDIUM)**
Lead enrichment worker syncs timezone (`brain-worker/workers/lead-enrichment-worker.ts` L230). But the outreach engine doesn't use it for scheduling. Add: schedule initial outreach between 9am–5pm in the LEAD's timezone.

**3. AI learning from reply sentiment (HIGH IMPACT)**
When a lead replies positively, extract what in the email caused the response (subject line? opening hook? CTA?). Store in `proceduralMemory`. Use these patterns to generate better copy for similar leads.

**4. Competitor mention detection (EXISTS, partial)**
`competitor-detection.ts` exists but is only triggered manually. Wire it to the IMAP sync: when an inbound email mentions a competitor, auto-tag the lead and adjust next follow-up to address that competitor.

**5. Price negotiation AI (EXISTS)**
`price-negotiation.ts` exists with discount approval logic. Not wired to the main reply pipeline — it only runs if explicitly called. Wire it to trigger when lead mentions "too expensive" / "can you do better".

**6. Weekly insights reports (EXISTS)**
`weekly-insights-worker.ts` exists. Ensure it's running on a cron (Sunday 8pm) and emailing users their weekly campaign stats.

**7. Lead scoring from engagement (PARTIAL)**
Lead scoring exists in `lead-scoring.ts` but only uses static rules. Add: boost score when lead opens email multiple times (tracking pixel data), clicks links, or visits your website.

**8. Objection library self-improvement**
`autonomous-objection-responder.ts` L398 logs learning when an objection handler improves. But it never feeds back into the base prompts. Add a weekly job that reviews the top-performing objection responses and updates the AI system prompt.

---

## SECTION 13 — BUGS FOUND IN PREVIOUS AUDIT (STILL OPEN)

1. Port cycling bug — user port ignored on retry — NOT FIXED
2. `secure` flag string coercion — 4 files — NOT FIXED
3. Leads limit mismatch (25k UI vs 2.5k backend) — NOT FIXED
4. Fathom webhook signature — NOT FIXED
5. `appendSentMessage` empty integrationId — NOT FIXED
6. SMTP pool cache key missing port — NOT FIXED
7. Duration forecast mismatch (UI vs backend effective cap) — NOT FIXED
8. No rate limiting on campaign creation — NOT FIXED
9. `distributeLeadsFromPool` fires on every mailbox connect — NOT FIXED

---

## SECTION 14 — COST/REVENUE PER ACCOUNT (CORRECTED)

*"Per account" = what you earn/spend for each paying customer*

### Your marginal cost to serve one account per month:
- Trial: ~$0.07/mo | Starter: ~$0.91/mo | Pro: ~$2.89/mo | Enterprise: ~$9–16/mo

### What you earn per account per month (after costs):
- Starter ($49.99): keep ~$49.08 (98% margin)
- Pro ($99.99): keep ~$97.10 (97% margin)
- Enterprise ($199.99): keep ~$184–191 (92–95% margin)

### Fixed infra cost (shared, not per-user):
Railway + Neon + Redis + SendGrid = ~$96–151/mo fixed regardless of user count

### Break-even (fixed costs covered by):
- 2 Starter accounts OR 2 Pro accounts OR 1 Enterprise account

### Revenue at scale (Starter plan):
- 10 accs: $500 revenue, ~$106 cost → **+$394/mo**
- 100 accs: $5,000 revenue, ~$188 cost → **+$4,812/mo**
- 1,000 accs: $49,990 revenue, ~$1,011 cost → **+$48,979/mo**
- 10,000 accs: $499,900 revenue, ~$9,248 cost → **+$490,652/mo**
- 100,000 accs: $4,999,000 revenue, ~$91,145 cost → **+$4,907,855/mo**

### Revenue at scale (Pro plan):
- 10 accs → **+$861/mo**
- 100 accs → **+$9,562/mo**
- 1,000 accs → **+$96,952/mo**
- 10,000 accs → **+$970,852/mo**
- 100,000 accs → **+$9,708,855/mo**

### Revenue at scale (Enterprise):
- 10 accs → **+$1,739/mo**
- 100 accs → **+$18,250/mo**
- 1,000 accs → **+$183,845/mo**
- 10,000 accs → **+$1,839,755/mo**

### When infra needs upgrading:
- 0–500 users: current setup, $0 extra
- 500–2,000: Neon Scale + Redis Pro, +$80/mo
- 2,000–10,000: Railway Pro + Redis 2GB, +$300/mo
- 10,000–50,000: Railway Team + PgBouncer + Redis 8GB, +$1,200/mo
- 50,000+: Move to GKE/AWS, +$6,000–12,000/mo

---

## PRIORITY FIX LIST (All Issues Combined)

### P0 — Fix immediately (production broken):
1. Port cycling in `email.ts` — user port ignored
2. `secure` flag string coercion — 4 files
3. Leads limit single source of truth (25k not 2.5k)
4. `isPlanActive()` must check Stripe, not assume true

### P1 — Fix this week:
5. Fathom webhook HMAC signature
6. `appendSentMessage` empty integrationId
7. SMTP pool cache key missing port
8. Duration forecast UI vs backend mismatch
9. PDF truncated at 6000 chars — chunk it
10. `meeting_link` from PDF not saved to `user.calendarLink`

### P2 — Fix this sprint:
11. Gmail token refresh race condition (Redis lock)
12. BullMQ dead-letter queue + audit trail on failure
13. Payment link validation before injection
14. `pendingPayments` stale row cleanup job
15. `distributeLeadsFromPool` only on active campaigns
16. Calendly link HTTP validation on settings save
17. Fathom webhook idempotency key

### P3 — Intelligence roadmap:
18. Thread-aware follow-ups (`In-Reply-To` headers)
19. Timezone-aware send scheduling
20. Competitor mention → auto-adjust follow-up
21. Price negotiation wired to reply pipeline
22. AI learning from positive reply patterns
23. Lead score from email open frequency
24. Objection library self-improvement loop

---

## SECTION 15 — MAILBOX ASSIGNMENT TO CAMPAIGNS: FULL LOGIC

### The 5-Step Flow

**Step 1 — User picks mailboxes in the Campaign Wizard**
Wizard collects:
- `config.mailboxIds` — which mailbox IDs to use
- `config.mailboxLimits` — per-mailbox daily cap (e.g. `{ "int_abc": 100, "int_xyz": 50 }`)
Stored in `outreach_campaigns.config` as JSON.

**Step 2 — Campaign launch proportionally pre-assigns leads to mailboxes (`outreach.ts` L254–305)**
```
All leads for this campaign
    → Proportional split: (lead index / total leads) × totalDailyCapacity → picks mailbox
    → Each campaign_lead row gets integrationId = assigned mailbox
    → Each lead row also gets integrationId = same mailbox
    → BullMQ jobs created: one per mailbox (send-batch, repeating every 5 min)
```
Example: 300 leads, 3 mailboxes at 100/day each → Leads 0–99 → MB-A, 100–199 → MB-B, 200–299 → MB-C.

**Step 3 — Each mailbox has its OWN independent BullMQ job (`campaign-queue.ts` L126)**
```typescript
for (const mbId of mailboxIds) {
  campaignQueue.add(`send-batch_${campaign.id}_${mbId}`, {
    campaignId, userId,
    integrationId: mbId,  // This job only touches leads for THIS mailbox
    dailyLimit,
  }, { repeat: { every: 5min } });
}
```

**Step 4 — processSendBatch fetches only leads for THIS mailbox**
```typescript
WHERE campaignLeads.integrationId = ${integrationId}  // this mailbox only
OR campaignLeads.integrationId IS NULL                 // unassigned fallback
```

**Step 5 — On mailbox failure, leads return to pool**
`returnLeadsToPool()` sets `integrationId = null`, `status = 'queued'`. The IS NULL fallback in Step 4 lets another mailbox pick them up.

---

### What happens when user adds a NEW mailbox mid-campaign?
**Nothing.** `distributeLeadsFromPool()` only touches the global inventory (leads not in campaigns). Campaign's `config.mailboxIds` is never updated. No BullMQ job is created for the new mailbox. It sits idle while the existing mailboxes carry all the load.

### What happens when user removes/disconnects a mailbox mid-campaign?
**Leads get orphaned.** Their `integrationId` still points to the deleted mailbox. `returnLeadsToPool()` is only triggered by health failures — NOT by manual disconnects. Those leads are stuck forever with no mailbox to process them.

---

## SECTION 16 — NEW MAILBOX ASSIGNMENT BUGS

### BUG M1: Proportional assignment ignores current mailbox load
`outreach.ts` L267 splits leads by position in array, NOT by available capacity. If MB-A already sent 80/100 today from another campaign, it still gets assigned its full proportional share. Result: MB-A hits limit by noon, its leads queue until midnight.

**Fix:** Subtract today's `sent_count` from each mailbox's limit before assigning.

### BUG M2: IS NULL fallback causes cross-mailbox lead contamination
Any of 5 mailbox jobs can claim unassigned leads simultaneously. The winning mailbox may be completely different from the one the lead previously replied to — breaking email threading and sender consistency.

### BUG M3: No mailbox ownership validation in send-batch
The `integrationId` baked into the BullMQ job data at launch time is never re-verified to belong to `userId`. Low risk today; critical if job IDs become guessable or if a multi-tenant bug leaks an integration ID.

### BUG M4: Two different daily-limit fields — wizard vs pool distributor
- Campaign wizard stores limits in `campaign.config.mailboxLimits[mbId]`
- `distributeLeadsFromPool()` reads `integration.metadata.dailyLimit`
These are different fields. User setting 200/day in the wizard has zero effect on how leads are distributed from the inventory pool.

### BUG M5 (P0): Campaign pause is broken — jobs never actually removed
`campaign-queue.ts` L132: job key `send-batch_${campaign.id}_${mbId}`
L143: `jobId: jobKey.replace(/:/g, '-')` — replaces colons in the jobId.
But the repeatable key BullMQ generates internally still uses the raw key. When `removeRepeatableByKey()` is called during pause/abort, the key doesn't match — **the job keeps running after the campaign is "paused."**

### BUG M6: Stats job not removed on pause
Stats job added as `stats:${campaign.id}` with colon. Pause logic looks for `job.key.includes(campaignId)` which would match, BUT the jobId is `stats-${campaign.id}` with a dash. Key mismatch → stats keep running.

### BUG M7: Round-robin mailbox rotation resets on every worker restart
`userMailboxIndex: Map<string, number>` lives in memory. Every deployment, crash, or scale event resets all indices to 0. MB-A always gets the first leads after restart — unfair distribution.

**Fix:** Store index in Redis: `SET outreach:mailbox_idx:{userId} {index} EX 86400`

### BUG M8: Capacity calculation uses total assigned leads, not today's sent count
`distributeLeadsFromPool()` L347–357:
```typescript
const currentLeads = await db.select().from(leads)
  .where(and(eq(leads.integrationId, mb.id), eq(leads.archived, false)));
remainingCapacity: Math.max(0, limit - currentLeads.length)
```
A mailbox with 500 total leads ever assigned shows 0 remaining capacity — even if all 500 were sent months ago. The pool distributor thinks it's full and stops giving it new leads.

**Fix:** Capacity = daily limit − count of emails sent TODAY for this mailbox.

### BUG X8 (P0): Campaigns never auto-complete
When all leads reach terminal status (`sent`, `replied`, `booked`, `converted`, `not_interested`), campaign stays `active`. BullMQ jobs run every 5 minutes forever finding 0 leads. Fix:
```typescript
// At end of processSendBatch:
const pending = await db.select().from(campaignLeads)
  .where(and(eq(campaignLeads.campaignId, campaignId),
    inArray(campaignLeads.status, ['pending', 'queued']))).limit(1);
if (pending.length === 0) {
  await db.update(outreachCampaigns).set({ status: 'completed' })
    .where(eq(outreachCampaigns.id, campaignId));
  await campaignQueueManager.pauseCampaign(campaignId);
}
```

### BUG X1: Pre-craft job runs at UTC 1AM for all users
`repeat: { pattern: '0 1 * * *' }` — for US West Coast users this is 6 PM the previous evening. Pre-crafted copies are generated hours before they're needed and may go stale.

### BUG X2: Gmail daily limit is defined in 3 different places with 3 different values
- `SAFETY_GUARDRAILS.gmailMaxPerDay = 100` (sales-engine/outreach-engine.ts)
- `defaultLimit = 50` for gmail (workers/outreach-engine.ts L561)
- `bufferThreshold = 150` for gmail (workers/outreach-engine.ts L576)
None are synchronized. Actual limit depends on which code path runs — unpredictable.

### BUG X3: `validateCampaignSafety()` generates warnings that go nowhere
This function exists and works, but is never called from the campaign launch route. A user can launch a 1M lead campaign with zero friction or warnings shown.

### BUG X7: Campaign duration estimate ignores follow-up steps
UI shows: `days = total_leads / daily_sends`. This only counts initial sends. With 3–5 follow-up steps (3d, 7d, 14d offsets), the real duration is `initial_days + 14`. A "2-day campaign" actually runs 16 days.

---

## WHICH AUDIT FILE IS THE REAL ONE?

**`AUDIT_REPORT_FULL.md` is the definitive file. Use only this one.**

| File | Status |
|---|---|
| `AUDIT_REPORT.md` | ⚠️ Outdated first draft — subset of bugs only |
| `AUDIT_REPORT_FULL.md` | ✅ This file — complete, all systems, 36 bugs |

You can delete `AUDIT_REPORT.md`.

---

## FINAL BUG PRIORITY LIST (All 36 Issues)

### P0 — Fix immediately (system is broken):
1. Port cycling — user-set port ignored on retry
2. `secure` flag string coercion (4 files)
3. Leads limit: UI shows 25k, backend enforces 2.5k
4. `isPlanActive()` never checks Stripe
5. Campaign pause broken — BullMQ jobs keep running after pause (M5)
6. Campaigns never auto-complete — dead jobs run forever (X8)

### P1 — Fix this week:
7. Fathom webhook: no HMAC signature
8. Fathom webhook: no idempotency key (double processes same meeting)
9. `appendSentMessage` called with empty integrationId
10. SMTP pool cache key missing port
11. PDF context truncated at 6000 chars
12. Meeting link from PDF not saved to user.calendarLink
13. Paid plan expiry not verified against Stripe in real time

### P2 — Fix this sprint:
14. Leads orphaned when mailbox manually disconnected (M2)
15. Proportional assignment ignores current mailbox load (M1)
16. IS NULL fallback → wrong mailbox claims leads (M2)
17. No mailbox ownership validation in send-batch (M3)
18. Two different limit fields — wizard vs pool distributor (M4)
19. Round-robin resets on worker restart (M7)
20. Capacity uses total assigned count not today's sent (M8)
21. Gmail token refresh race condition
22. Payment link not validated before injection
23. Stale pendingPayments rows pause campaigns unnecessarily
24. `distributeLeadsFromPool` fires on mailbox connect with no active campaign
25. Pre-craft job UTC timing wrong for non-UTC users (X1)
26. Gmail limit defined in 3 places with 3 values (X2)
27. Duration estimate ignores follow-up step offsets (X7)
28. validateCampaignSafety never called at launch (X3)

### P3 — Intelligence / UX improvements:
29. Thread-aware follow-ups (In-Reply-To headers)
30. Timezone-aware send scheduling per lead
31. Competitor mention → auto-adjust follow-up
32. Price negotiation wired to inbound reply pipeline
33. AI learning from positive reply sentiment
34. Lead scoring from email open frequency
35. Objection library self-improvement loop
36. Staggered AI engine resume (prevent burst on toggle-ON)

---

## SECTION 17 — AUTONOMOUS TOGGLE & AUTO-REPLY LOGIC

### How the Global AI Toggle (`autonomousMode`) Works

The `autonomousMode` flag acts as the master kill switch for the entire outreach engine.

**1. Do campaigns still send when OFF?**
**No.** In `outreach-engine.ts` L740, the `isMailboxReadyToSend()` function strictly checks if `isAutonomousMode` is `true`. If it is `false`, the mailbox is marked as "not ready" and the campaign batch loop skips processing leads. No emails go out. (However, the BullMQ polling jobs keep running in the background doing nothing).

**2. What happens to inbound replies when OFF?**
When a lead replies, the system correctly imports the email and triggers the `inbound-message-analyzer`. It then drops a job into the `followUpQueue` for the AI to handle the reply.
In `follow-up-worker.ts` L327, it checks `globalAutonomousMode`. If the toggle is OFF, the system refuses to process the reply.

**3. How does user Auto-Reply / Intent work?**
There are two layers of auto-replies:
- **Campaign-level Auto-Reply:** Set in the sequence wizard. If a lead replies to a campaign, the campaign queue intercepts it and schedules this specific pre-written response.
- **Global AI Auto-Reply:** If there is no campaign auto-reply, the AI takes over. The `inbound-message-analyzer` determines the `intent` (e.g., `booking`, `payment`, `objection`). The `conversation-ai.ts` engine then crafts a bespoke response based on that intent, injecting the user's Calendly or Payment link automatically.

---

### NEW BUGS: AI TOGGLE & AUTO-REPLIES

### BUG A1: Infinite Database Loop when AI is OFF
In `follow-up-worker.ts` L327:
```typescript
if (!globalAutonomousMode) {
  await db.update(followUpQueue).set({ status: 'pending' }).where(eq(followUpQueue.id, job.id));
  return;
}
```
If the AI toggle is OFF, the job is reverted to `pending` but its `scheduledAt` time remains in the past. The worker will pick up this exact same job on its very next tick (2 minutes later), see the toggle is still OFF, and revert it again. If a user turns off AI for a week and receives 100 replies, the database will be hammered with thousands of useless queries a day infinitely looping those jobs.
**Fix:** Delay the `scheduledAt` by 1 hour when reverting to pending, or pause the worker completely.

### BUG A2: Draft Mode is Dead Code (Config vs Metadata Mismatch)
At the bottom of `follow-up-worker.ts` L564, there is logic intended to handle the AI toggle being OFF by saving the AI's generated response as a `DRAFT` instead of sending it:
```typescript
const isAutonomous = (userDetail?.metadata as any)?.isAutonomous !== false;
if (isAutonomous) { send() } else { saveAsDraft() }
```
**BUG:** It checks `metadata.isAutonomous` instead of `config.autonomousMode`. Furthermore, because of Bug A1 (the check at the top of the file), the code never even reaches this draft logic. Replies are never drafted when the system is OFF; they are just frozen in the queue.

### BUG A3: Global Custom Auto-Reply is completely ignored
The database `users` table has an `autoReplyBody` column for users to set their own global auto-reply template. However, in `paged-email-importer.ts` L536, when an inbound email arrives, it queues the job with:
```typescript
context: { autoReplyBody: null // purely AI generated now }
```
The user's saved global auto-reply template is never fetched or passed to the worker. `follow-up-worker.ts` looks for `customAutoReply` in the context, finds nothing, and always forces the AI to generate a response from scratch.

### BUG A4: Campaign Auto-Replies blindly override AI Intent Safety
If a campaign has an `autoReplyBody` defined, `paged-email-importer.ts` L374 intercepts the reply and schedules the pre-written campaign auto-reply to send in 2-4 minutes.
**BUG:** This bypasses the AI completely. If the lead replied with "Fuck off, remove me from your list", the `inbound-message-analyzer` correctly identifies the negative intent, but the campaign queue ignores the AI and blindly fires the pre-written auto-reply ("Thanks for getting back to me, here is my calendar link!").

### BUG A5: 24/7 Mode Night Watch Comment Disconnect
`follow-up-worker.ts` L273 claims:
```typescript
// 24/7 MODE: Night Watch blocking removed. The system will now deliver messages autonomously at any hour including midnight.
```
But `campaign-queue.ts` (which handles all campaign sending) DOES respect `isNight` via the Timezone intelligence and avoids sending. The AI follow-up worker ignores the night, meaning AI replies will happily send at 3:00 AM local time, exposing the bot.

---

### PRIORITY UPDATE: NEW BUGS ADDED TO THE LIST

**P0 — System Freezing / Safety**
* **BUG A1:** Infinite database retry loop when `autonomousMode` is OFF (hammering DB).
* **BUG A4:** Campaign auto-replies trigger blindly on negative intents/unsubscribes.

**P1 — UX / Logic Breaks**
* **BUG A2:** AI Draft mode is completely dead code due to config location mismatch.
* **BUG A3:** Global `users.autoReplyBody` setting is completely ignored by the importer.
* **BUG A5:** AI follow-up worker sends replies at 3:00 AM, blowing the bot's cover.
