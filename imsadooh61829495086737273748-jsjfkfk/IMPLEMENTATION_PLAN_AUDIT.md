# IMPLEMENTATION PLAN: AUDNIX INFRASTRUCTURE HARDENING (SECTIONS 6-17)

This document outlines the execution phases to resolve all bugs, safety issues, and architectural flaws identified in Sections 6 through 17 of the `AUDIT_REPORT_FULL.md`.

---

## PHASE 6 — PAYMENT LINK PIPELINE & NGA-1 COMPLIANCE
**Source: SECTION 6 — PAYMENT LINK FLOW AUDIT**

### Bugs & Issues
- **[BUG #1] Invalid PDF Payment Links:** Payment links extracted from PDFs are injected into emails without validation.
- **[BUG #2] NGA-1 $5k Rule Failure:** Regex-based amount detection is unreliable; system automates high-ticket checkouts if amount detection fails.
- **[BUG #3] Missing Expiry Logic:** No TTL tracking for payment links; AI sends expired Stripe links to leads.
- **[BUG #4] Stale `pendingPayments`:** Old pending rows pause campaigns unnecessarily because they are never cleaned up.

### Tasks
- [ ] Implement URL validation for `payment_link` before storage in `brand_profiles`.
- [ ] Refine `extractDealSignals` to use a more robust parser for deal value.
- [ ] Update `fathom-integration.ts` to default to "Manual Handoff" if amount detection is ambiguous.
- [ ] Add `expiresAt` column to `pending_payments` and implement a 7-day cleanup cron job.

---

## PHASE 7 — LEAD ISOLATION & MULTI-POD STABILITY
**Source: SECTION 7 — LEAD CROSS-CONTAMINATION BETWEEN ACCOUNTS**

### Bugs & Issues
- **[BUG #1] Global Lock Scan:** `FOR UPDATE SKIP LOCKED` doesn't strictly filter by `userId` at the DB level.
- **[BUG #2] Double-Send Risk:** Redis lock TTL (3 mins) is too short for slow AI/SMTP operations, allowing other pods to claim the lead.
- **[BUG #3] Inventory Leak:** `distributeLeadsFromPool` can fetch all users' leads if `userId` is undefined in some paths.

### Tasks
- [ ] Update all `SKIP LOCKED` queries to explicitly include `userId` in the locked set.
- [ ] Increase Redis lock TTL to 600 seconds (10 mins) in `outreach-engine.ts`.
- [ ] Add a `processingPodId` column to `campaign_leads` to track ownership per replica.
- [ ] Add strict `userId` null-checks to `distributeLeadsFromPool`.

---

## PHASE 8 — AI CONTINUITY & SUBSCRIPTION VERIFICATION
**Source: SECTION 8 — WHAT HAPPENS WHEN AI SUBSCRIPTION/CREDITS RUN OUT**

### Bugs & Issues
- **[BUG] Paid Plan Verification:** System assumes all paid plans are active and never checks Stripe subscription status.
- **[BUG] Silent AI Quota Failure:** No user notification when AI providers are degraded; outreach skips leads silently.

### Tasks
- [ ] Update `isPlanActive()` to perform a real-time (cached) Stripe subscription status check.
- [ ] Implement `aiDegradedUntil` timestamp in user configuration.
- [ ] Create a dashboard warning banner for "AI Service Interruption" status.

---

## PHASE 9 — GMAIL OUTREACH RESILIENCE
**Source: SECTION 9 — GMAIL FOR OUTREACH: FULL ANALYSIS**

### Bugs & Issues
- **[BUG] Token Refresh Race:** Multiple workers refresh OAuth tokens simultaneously, causing stale credentials.
- **[RISK] Threading:** Follow-up emails are sent as new messages rather than threaded replies in Gmail.

### Tasks
- [ ] Implement Redis-backed token refresh lock (`SETNX gmail:refresh:{userId}`).
- [ ] Update Gmail send logic to include `In-Reply-To` and `References` headers.

---

## PHASE 10 — WORKER HEALTH & JOB INTEGRITY
**Source: SECTION 10 — WORKERS & JOBS: FULL MAP**

### Bugs & Issues
- **[BUG] RAG Worker Visibility:** `rag-worker` has no health monitor registration.
- **[BUG] Billing Silence:** Stripe webhook failures are swallowed with no alerting.
- **[BUG] Social Worker Inefficiency:** Instagram polling runs for accounts with no Instagram connected.
- **[BUG] Silent Deletion:** BullMQ jobs are removed after failure with no audit trail entry.

### Tasks
- [ ] Register `rag-worker` with `workerHealthMonitor`.
- [ ] Add `onFailed` BullMQ handlers to create `audit_trail` records for all failed jobs.
- [ ] Add `WHERE EXISTS` integration guard to the Instagram polling query.

---

## PHASE 11 — SETTINGS & VALIDATION HARDENING
**Source: SECTION 11 — SETTINGS PAGE AUDIT**

### Bugs & Issues
- **[BUG #1] Encryption Mismatch:** Settings update doesn't re-encrypt existing credentials when only the port changes.
- **[BUG #2] Identity Spoofing:** No validation that the "From" address matches the SMTP username.
- **[BUG #3] Slider Mismatch:** UI max limit (500) differs from backend cap (1000).

### Tasks
- [ ] Ensure full credential re-encryption on any integration setting update.
- [ ] Add SMTP/Email identity validation to the `integrations-routes.ts`.
- [ ] Synchronize UI slider max with the backend 1000-lead cap.

---

## PHASE 12 — INTELLIGENCE & ENGAGEMENT OPTIMIZATION
**Source: SECTION 12 — HOW TO MAKE YOUR SYSTEM SMARTER**

### Features & Enhancements
- **Thread-aware follow-ups:** Add headers to group emails in lead inboxes.
- **Timezone-aware scheduling:** Schedule outreach during 9am–5pm in lead's local time.
- **AI Learning:** Extract patterns from positive replies into `proceduralMemory`.
- **Competitor Detection:** Auto-tag leads when competitors are mentioned in replies.

### Tasks
- [ ] Implement `In-Reply-To` header logic for all follow-up steps.
- [ ] Integrate lead timezone data into the `outreach-engine` scheduling tick.
- [ ] Build the `objection-loop` worker to update system prompts weekly.

---

## PHASE 13 — LEGACY INFRASTRUCTURE FIXES
**Source: SECTION 13 — BUGS FOUND IN PREVIOUS AUDIT (STILL OPEN)**

### Open P0/P1 Issues
- **Port Cycling:** User port ignored on retry in `email.ts`.
- **Secure Flag Coercion:** String ports breaking SSL in 4 files.
- **Leads Limit:** UI (25k) vs Backend (2.5k) mismatch.
- **Fathom Security:** Missing HMAC signature on webhooks.

### Tasks
- [ ] Implement the `PORT_CYCLE` array logic in `email.ts`.
- [ ] Apply `parseInt()` to all SMTP port checks.
- [ ] Standardize leads limit to 25k across the stack.

---

## PHASE 14 — FINANCIAL INFRASTRUCTURE
**Source: SECTION 14 — COST/REVENUE PER ACCOUNT**

### Tasks
- [ ] Audit `billing-service` to ensure accurate plan usage reporting.
- [ ] Verify Stripe webhook consistency for `subscription_deleted` events.

---

## PHASE 15 & 16 — MAILBOX ASSIGNMENT & CAMPAIGN ORCHESTRATION
**Source: SECTION 15 & 16 — NEW MAILBOX ASSIGNMENT BUGS**

### Bugs & Issues
- **[BUG M5] Pause Broken (P0):** BullMQ jobs keep running after pause due to colon-remapping mismatch.
- **[BUG X8] Infinite Jobs (P0):** Campaigns never auto-complete; jobs run forever on empty leads.
- **[BUG M1] Load Ignored:** Assignment ignores how many emails a mailbox already sent today.
- **[BUG M8] Capacity Calculation:** Calculation uses total leads ever assigned rather than "Sent Today."
- **[BUG X7] Duration Lie:** Estimate ignores the time offsets of follow-up steps.

### Tasks
- [ ] Standardize BullMQ `jobId` generation to prevent pause failures.
- [ ] Implement the `auto-complete` check at the end of `processSendBatch`.
- [ ] Update `remainingCapacity` to be `limit - emailsSentToday`.
- [ ] Update UI duration calculation: `initial_days + last_followup_offset`.

---

## PHASE 17 — AUTONOMOUS MODE & REPLY SAFETY
**Source: SECTION 17 — AUTONOMOUS TOGGLE & AUTO-REPLY LOGIC**

### Bugs & Issues
- **[BUG A1] DB Infinite Loop (P0):** Worker hammers DB when AI toggle is OFF.
- **[BUG A4] Intent Safety Violation (P0):** Campaign auto-replies ignore AI negative sentiment detection.
- **[BUG A2] Dead Code:** AI Draft mode checks wrong metadata field.
- **[BUG A5] 3 AM Sends:** AI follow-up worker ignores "Night Watch" restrictions.

### Tasks
- [ ] Add 1-hour `scheduledAt` delay when reverting jobs if AI is OFF.
- [ ] Implement "Safety Guard" check to block campaign auto-replies on `negative` or `unsubscribe` intent.
- [ ] Fix metadata mapping for `isAutonomous` vs `autonomousMode`.
- [ ] Apply `isNight` checks to the `follow-up-worker`.

---

## THE GOOD RESULT

Once these 10 phases are completed, the Audnix infrastructure will transition to a **Production-Hardened State**:

1. **Safety First:** The system will never again "accidentally" email an angry lead or a high-ticket prospect without human review.
2. **Infrastructure Resilience:** Campaigns will pause and complete reliably; workers will self-heal from connectivity blips using intelligent port cycling.
3. **Multi-Tenant Integrity:** Leads will remain strictly isolated, and no pod will ever double-send to a lead due to expired locks.
4. **Intelligent Automation:** Outreach will be timezone-aware and thread correctly, resulting in significantly higher engagement and conversion rates.
5. **Operational Transparency:** The health dashboard will provide 100% visibility into every worker and job, with a clear audit trail for any failures.

---
**Plan generated on:** 2026-05-12
**Status:** Ready for Execution
