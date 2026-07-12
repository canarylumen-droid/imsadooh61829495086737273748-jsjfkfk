# Audnix AI - Complete Implementation Plan

> Created: July 12, 2026
> Based on comprehensive codebase audit & user feedback
> Execution: 7 batches, tracked by status

---

## BATCH 1: Email Content, Variables, Unsubscribe, MX Validation

### 1.1 Fix {{variables}} showing raw in sent emails
**Problem:** `{{sender_name}}`, `{{firstName}}` etc. appear literally in sent emails instead of being replaced with actual values.
**Files to fix:**
- `shared/lib/queues/campaign-queue.ts` — In `processSendBatch()` and `processFollowUp()`, find where `deliverCampaignEmail()` is called. Ensure variable interpolation happens BEFORE sending. The template variables from campaign templates must be resolved against lead metadata and mailbox sender info.
- `services/email-service/src/email/reply-manager.ts` — Auto-reply also uses `generateAiReply()` which might not interpolate variables correctly.
- Look for where `{{sender_name}}` is supposed to be replaced with the mailbox owner's display name.

**Root cause:** Variable replacement likely happens in the frontend template preview but not in the backend sending pipeline. Need to add a `resolveTemplateVariables()` function that takes the template + lead metadata + mailbox info and replaces all `{{...}}` placeholders.

### 1.2 Fix unsubscribe link (404 / wrong destination)
**Problem:** Unsubscribe link doesn't work - shows 404 or doesn't unsubscribe properly.
**Files:**
- `services/api-gateway/src/routes/unsubscribe-routes.ts` — Current implementation looks up lead by `leadId` from URL param. The link generated in emails likely doesn't include the correct lead ID, or the unsubscribe route isn't handling the request format properly.
- The unsubscribe link in sent emails may be using a wrong base URL or wrong path format.
- Check `email-tracking.ts` `wrapLinksWithTracking()` — it should NOT wrap the unsubscribe link with tracking (or should handle it properly).

**Fix needed:**
- Ensure unsubscribe link in email content points to correct URL: `https://audnixai.com/api/unsubscribe/{leadId}`
- Handle the case where tracking wraps the unsubscribe link — skip tracking for unsubscribe URLs
- The unsubscribe page should show a clean branded page and properly update lead status

### 1.3 Add MX record validation before sending
**Problem:** System sends to email addresses without checking if the domain has valid MX records, causing high bounce rates.
**Files:**
- `services/email-service/src/email/dns-validation-engine.ts` — Already has `validateMX()`. Need to integrate it into the sending pipeline.
- `services/email-service/src/email/email-address-verification.ts` or `email-verifier.ts` — Should call `dnsValidationEngine.validateMX()` before sending.
- `shared/lib/queues/campaign-queue.ts` — In `processSendBatch()`, before calling `deliverCampaignEmail()`, add MX check.

**Fix needed:**
- Add `preValidateEmail()` function that checks MX records before queueing for send
- Skip leads with invalid MX domains and mark them with reason
- Add retry for temporary DNS failures

### 1.4 Fix follow-up sent before initial email
**Problem:** Follow-up emails are sent before or at the same time as initial emails.
**Files:**
- `shared/lib/queues/campaign-queue.ts` — In `processSendBatch()`, check the follow-up scheduling logic. The `scheduleFollowUp()` is called right after `deliverCampaignEmail()` in the same batch. If the batch sends multiple leads, it might schedule follow-ups immediately without waiting for the delay.
- Check that `processFollowUp()` correctly checks if the initial email was actually sent before proceeding.
- The `delayMs` calculation in `scheduleFollowUp()` may be wrong or using 0 delay.

### 1.5 Fix mailbox name used as email subject
**Problem:** Some emails are sent with the mailbox name as the subject line.
**Files:**
- Find where subject defaults to mailbox name — likely in campaign template processing or the email sending pipeline when subject is empty.
- In `processSendBatch()` or `deliverCampaignEmail()`, check if subject is being populated correctly. If the campaign template has no subject, it should use the template's configured subject, not the mailbox name.
- Check `sendEmail()` in `shared/lib/channels/email.js` for subject fallback logic.

### 1.6 Fix HTML raw content showing in emails
**Problem:** Raw HTML content is being sent as the email body rather than rendered HTML.
**Files:**
- `email-tracking.ts` — `injectTrackingIntoEmail()` handles converting plain text to minimal HTML. Check if the content is already HTML and handle both cases properly.
- Check the campaign template content — ensure `isHtml` flag is set correctly based on template content.
- In `deliverCampaignEmail()`, verify the content type is set correctly when sending.

---

## BATCH 2: Tracking System (Pixel, Open, Delivered, Reply)

### 2.1 Fix tracking pixel not working
**Problem:** Open tracking pixel doesn't fire / isn't recorded.
**Files:**
- `services/email-service/src/email/email-tracking.ts` — `generateTrackingPixel()` generates `<img src="${baseUrl}/t/${token}">`. Check that `baseUrl` is correct.
- `services/api-gateway/src/routes/email-tracking-routes.ts` — The stealth router mounts `/t/:token` and `/c/:token` at root level. Check if these routes are actually registered in the main app.
- Check if `injectTrackingIntoEmail()` is being called before sending. If not, the pixel is never injected.
- `generateTrackingPixel()` uses `baseUrl` from `process.env.BASE_URL` — verify this env var is set.

### 2.2 Fix open tracking not updating delivered/opened status
**Problem:** When a recipient opens an email, the "delivered" status doesn't update to "opened".
**Files:**
- `email-tracking.ts` `recordEmailEvent()` — When type is 'open', it updates `leads.metadata.isOpened`, `messages.opened_at`, `campaign_emails.status`. Check if these updates are executing correctly.
- `campaign-queue.ts` `processStatsUpdate()` — Check if it queries for opened count correctly.
- Check `processSendBatch()` — it probably sets initial status to 'delivered' but the tracking pixel update to 'opened' may fail silently.

### 2.3 Fix reply tracking not updating KPI
**Problem:** Reply tracking doesn't update KPI or conversation UI.
**Files:**
- `services/email-service/src/email/reply-manager.ts` — `handleIncomingEmail()` doesn't update KPIs directly. It calls `recordIncomingReply()` in `mailbox-coordinator.ts` but doesn't update campaign stats.
- After a reply is detected, need to call `processStatsUpdate()` or directly update `campaign_emails.status = 'replied'`.
- Also update `leads.status = 'replied'` when reply is detected.
- WebSocket notification for stats refresh after reply.

### 2.4 Fix delivered status never updating
**Problem:** Emails stay in "delivered" state even after open/reply.
**Files:**
- Check `campaign_emails.status` transitions. After sending, status is 'delivered'. On open, should be 'opened'. On click, 'clicked'. On reply, 'replied'.
- In `processSendBatch()`, after successful send, status is set. Need to ensure the tracking event handlers can find and update the correct `campaign_emails` record.
- The `message_id` in `campaign_emails` must match the `token` used in tracking pixel. Verify they use the same ID.

### 2.5 Fix retroactive date tracking
**Problem:** Some tracking events show date 1/1/1970 (epoch 0) — likely from null/undefined dates in the database.
**Files:**
- Search for all places where dates default to epoch 0.
- In `email-tracking.ts` and all tracking-related SQL, add `COALESCE(date_field, NOW())` or similar guards.
- In the inbox UI, filter out dates that are before year 2000.

### 2.6 Fix "opened" filter tracking
**Problem:** The "opened" filter in inbox doesn't correctly show leads who actually opened emails.
**Files:**
- `inbox.tsx` — Filter logic for `filterStatus === "opened"` checks multiple metadata fields but may miss some. Standardize to check `lead.metadata?.isOpened === true || campaign_emails.status === 'opened'`.
- The backend query for leads should also join with tracking data to properly populate `isOpened`.

---

## BATCH 3: KPI & Analytics Consistency

### 3.1 Fix KPI values different across views
**Problem:** Total Sent shows different values on home page vs analytics page vs inbox.
**Files:**
- `shared/lib/analytics/stats-service.ts` — `getKPIStats()` computes KPIs. Check the SQL queries for correctness.
- `client/src/pages/dashboard/home.tsx` — Home page KPI display.
- `client/src/pages/dashboard/analytics.tsx` — Analytics KPI display.
- `client/src/pages/dashboard/inbox.tsx` — Inbox campaign stats.
- All should use the SAME stats service / same queries. If they compute independently, they'll diverge.

**Root cause:** Different pages likely use different API endpoints or compute KPIs differently. Need to create a single source of truth for KPI data.

### 3.2 Remove "STABLE" / "No prior data" text
**Problem:** KPI cards show "STABLE" and "No prior data" text that looks like hardened/placeholder data.
**Files:**
- `client/src/pages/dashboard/home.tsx` — Find where "STABLE" and "No prior data" strings appear and remove them.
- `client/src/pages/dashboard/analytics.tsx` — Check for similar text.
- Replace with cleaner empty state or just the value without comparison text when no prior data exists.

### 3.3 Fix open rate calculation
**Problem:** Open rate shows 23.04% but actual open tracking shows mismatched data.
**Files:**
- `shared/lib/analytics/stats-service.ts` — The `getKPIStats()` function or equivalent calculates open rate. Check if it's using `open_count > 0` or counting unique opens correctly.
- `email-tracking.ts` `getEmailStats()` also computes openRate. Check if this matches what the analytics page uses.
- **Root cause:** Open rate should be `(unique opened emails / total sent) * 100`. If counting duplicates or using wrong denominator, it'll be wrong.

### 3.4 Fix analytics graph date labels
**Problem:** Analytics graph sometimes removes date labels or doesn't show them until clicked.
**Files:**
- `client/src/pages/dashboard/analytics.tsx` — The chart configuration for XAxis. Check `tickFormatter` and data format.
- The timeSeries data may have inconsistent date formats. Normalize all dates to a consistent format.
- Add a `tickFormatter` that always shows dates.

### 3.5 Fix KPI race conditions (UI state mismatches)
**Problem:** Different parts of the UI update at different times showing inconsistent data.
**Files:**
- All KPI display components should use the same WebSocket event (`stats_updated`) to trigger refresh.
- `inbox.tsx` — The `wsSync.notifyStatsUpdated()` is called from backend tracking. Make sure all KPI views listen to this event.
- Use a shared React context or query key invalidation pattern for KPI data.

### 3.6 Fix "Open" vs "Opened" terminology
**Problem:** "Open" is used for both "lead is opened/selected" and "email was opened by recipient". Confusing.
**Files:**
- `leads.status` uses 'open' for leads that have been viewed. Need to differentiate.
- In the inbox filter, "opened" should mean "email was opened by recipient". But the lead status 'open' means "viewed by user".
- Create a separate tracking field `metadata.isOpened` for email opens and keep `lead.status` for workflow status.
- Update filter labels to be clearer: "Viewed" vs "Opened Email".

### 3.7 Fix home page analytics inconsistency
**Problem:** Home overview shows different stats than analytics page.
**Files:**
- `client/src/pages/dashboard/home.tsx` — The stats endpoint used here may be `/api/dashboard/stats` while analytics uses `/api/analytics/stats`.
- Standardize to use the same backend endpoint or ensure both endpoints compute identically.
- Consider creating a shared stats hook `useKPI()` that both pages use.

---

## BATCH 4: Inbox & Conversation UI Redesign

### 4.1 Fix conversation thread ordering (recent last)
**Problem:** Recent messages should come last (bottom of thread), not first. UI shows them in wrong order.
**Files:**
- `client/src/pages/dashboard/inbox.tsx` — In the message thread display, messages are likely sorted by `createdAt ASC`. Check the sort order. Should be chronological (oldest first).
- The `messagesData?.messages` array should be sorted ascending by date.

### 4.2 Fix conversation display showing raw HTML
**Problem:** Raw HTML content shows in conversation view instead of rendered text.
**Files:**
- `inbox.tsx` — The `isHtml()` function detects HTML. The rendering code should strip HTML tags and show clean text.
- Use DOMPurify to sanitize and render HTML safely, or strip tags for preview.
- For the full message view, render HTML in an iframe or sanitized div.

### 4.3 Fix raw variables showing in conversation
**Problem:** `{{firstName}}`, `{{lastName}}` etc. show in conversation UI.
**Files:**
- This means variables weren't resolved before storing the message. Fix in the sending pipeline (Batch 1 item 1.1).
- As a UI-level fix, also strip or show a warning if unresolved variables are detected in displayed messages.

### 4.4 Fix conversation threading (subject grouping)
**Problem:** Messages with same subject/thread aren't grouped together properly.
**Files:**
- Messages should be grouped by `threadId` or by subject (after removing Re:/Fwd: prefixes).
- `inbox.tsx` — The message display needs a thread grouping component.
- Look at how `messages` table stores `threadId` and `inReplyTo` fields. Ensure these are populated correctly.

### 4.5 Fix inbox leads not showing recent messages properly
**Problem:** Lead list doesn't show the most recent message or shows wrong snippet.
**Files:**
- `inbox.tsx` — The `allLeads.snippet` field may not be updated correctly when new messages arrive.
- The WebSocket handler for `messages_updated` updates the snippet but may have a race condition with the query invalidation.
- The lead list sort is by `lastMessageAt` descending — verify this field is updated on new messages.

### 4.6 Fix inbox empty state when messages exist
**Problem:** Clicking a lead with messages shows "no messages" until data loads.
**Files:**
- This is likely a loading state issue. The `messagesLoading` flag may be showing empty state before data arrives.
- Improve loading UX — show skeleton or existing messages while fetching.
- Check optimistic updates — sent messages should appear immediately.

### 4.7 Redesign conversation thread (Gmail-like)
**Problem:** Current conversation UI is not standard — white blocks, no clear threading, no visual hierarchy.
**Files:**
- `inbox.tsx` — The message thread rendering section (the middle pane when a lead is selected).
- Redesign to look like Gmail/Outlook:
  - Show sender avatar, name, timestamp on same line
  - Show subject as header
  - Messages indented by threading level
  - Reply indicator showing "X replied to Y"
  - Clean separating lines between messages
  - "Show trimmed content" for long messages
  - Inline reply box at bottom

### 4.8 Fix archive UI inconsistency
**Problem:** Archiving shows item briefly then it disappears or reappears later.
**Files:**
- `inbox.tsx` — The archive mutation's `onMutate` and `onSettled` handlers. The optimistic removal may be conflicting with query invalidation.
- Ensure optimistic removal matches server response.
- The `showArchived` toggle should properly include/exclude archived leads.

### 4.9 Fix leads list - add CAV column variables
**Problem:** Lead card only shows name/company/email, doesn't show custom CAV (Column Added Value) fields.
**Files:**
- `inbox.tsx` — The lead list item rendering. Should display dynamic fields from `lead.metadata` or `lead.customFields`.
- User-defined columns from lead import should be visible in the inbox lead cards.

### 4.10 Fix "no messages" showing when thread should be empty
**Problem:** Recent conversations container shows even when there are no recent replies, making it look like data is missing.
**Files:**
- `inbox.tsx` — If no recent replies exist (only sent emails with no reply), don't show the "Recent" section, or show a cleaner empty state.
- Only show "Recent" when there are actual replies from the recipient.

---

## BATCH 5: Mailbox Distribution & Scheduling

### 5.1 Fix uneven mailbox distribution
**Problem:** Only one mailbox is used for sending, others remain idle.
**Files:**
- `shared/lib/queues/campaign-queue.ts` — `processSendBatch()` picks leads for a specific mailbox. The query for pending leads per mailbox might be wrong.
- Look at `consumer-distribution.ts` — this is supposed to handle distribution.
- `services/email-service/src/email/mailbox-coordinator.ts` — `shouldYieldInitialSends()` might be blocking all but one mailbox.
- Check the `send-batch` job creation in `startCampaign()` — are per-mailbox jobs being created for all mailboxes?

### 5.2 Fix follow-up scheduling (same time as initial)
**Problem:** Follow-ups are sent immediately after initial, not respecting the configured delay.
**Files:**
- `shared/lib/queues/campaign-queue.ts` — In `processSendBatch()` after `deliverCampaignEmail()`, check where `scheduleFollowUp()` is called.
- The delay days from campaign template aren't being converted to milliseconds correctly.
- The `followUpDelay` in campaign template should be in days. Convert to ms: `delayDays * 24 * 60 * 60 * 1000`.
- Check that the random offset (for human-like timing) isn't overriding the entire delay.

### 5.3 Fix campaign step ordering
**Problem:** Campaign steps aren't followed in order — step 2 (follow-up) runs before step 1 (initial).
**Files:**
- `campaign-queue.ts` — `processSendBatch()` handles initial send (step 0). `processFollowUp()` handles step > 0.
- Check that `campaign_leads.currentStep` increments correctly after initial send.
- The `scheduleFollowUp()` should only schedule step `currentStep + 1`, not all remaining steps.

### 5.4 Fix "one day after" scheduling
**Problem:** Follow-up should be scheduled 1 day after initial, not same day.
**Files:**
- `campaign-queue.ts` — The `scheduleFollowUp()` calculates delay from `followUpTemplate.delayDays`. Verify the unit conversion.
- Add logging to debug actual delay values being scheduled.

### 5.5 Add per-mailbox daily limit enforcement
**Problem:** Some mailboxes send more than others, exceeding daily limits.
**Files:**
- `campaign-queue.ts` — `processSendBatch()` checks `initialSentToday` against `effectiveLimit`. Verify this check works.
- The `effectiveLimit` calculation uses reputation caps. Check if mailboxes without reputation data get an unlimited cap.

### 5.6 Fix queue — follow-up before initial completed
**Problem:** Follow-up queue doesn't check if initial email was successfully sent.
**Files:**
- `campaign-queue.ts` — In `processFollowUp()`, before sending, verify the previous step's `campaign_emails` record exists and was sent successfully.
- Check `campaign_leads.currentStep` matches `stepIndex` to ensure ordering.

---

## BATCH 6: Scoring, Filters, Dates, Mobile, Error Handling

### 6.1 Fix lead scoring (dates showing 1/1/1970)
**Problem:** Lead scores show date 1/1/1970 (Unix epoch 0 — null date).
**Files:**
- `services/brain-worker/src/ai-lib/engines/lead-scoring-engine.ts` — Any date field that defaults to epoch 0.
- All scoring-related SQL queries should use `COALESCE(date_field, NOW())` when inserting/updating dates.
- `client/src/pages/dashboard/inbox.tsx` — The lead list shows "1/1/1970" for null dates. Add display logic: if date year < 2000, show "N/A" or relative time.
- Search entire codebase for `1970` or `epoch` or `new Date(0)` patterns.

### 6.2 Fix scoring randomness/fakeness
**Problem:** Lead scores appear random and not based on actual engagement.
**Files:**
- `services/brain-worker/src/ai-lib/engines/lead-scoring-engine.ts` — Review the scoring algorithm:
  - Firmographic (30 pts) — verify it queries enrichment data
  - Interaction Depth (25 pts) — check message count query
  - Intent Signals (35 pts) — verify buying signal detection
  - Enrichment Quality (10 pts) — verify data confidence calculation
- `services/brain-worker/src/ai-lib/engines/lead-scoring.ts` — Legacy scoring, may conflict.
- Ensure scores are recalculated on meaningful events (message received, email opened, etc.), not just on arbitrary timers.

### 6.3 Fix filter tags (opened, replied, etc.) not working
**Problem:** Filtering by status tags doesn't correctly filter leads.
**Files:**
- `inbox.tsx` — The `filteredLeads` useMemo logic for each filter status:
  - "opened" — check metadata fields correctly
  - "replied" — check lead status and message count
  - "unread" — check `metadata.isUnread`
- The backend `/api/leads` query may also need to support these filters.

### 6.4 Fix "new" to "open" status transition
**Problem:** Leads automatically move from "new" to "open" when imported, which is misleading. "Open" should mean "viewed by user", not "imported".
**Files:**
- `inbox.tsx` — The useEffect that auto-transitions leads from 'new' to 'open' on click. This is correct behavior — only transition when user clicks.
- The lead import code should set status to 'new', not 'open'. Check `lead-import` and CSV import code.
- Backend API: when a lead is created, set status to 'new' by default.

### 6.5 Fix mobile UI (text overflow, horizontal scroll)
**Problem:** On mobile, text overflows horizontally in various places.
**Files:**
- `inbox.tsx` — Check responsive classes. The lead list width `w-full sm:w-72` should adapt better.
- The integration/mailbox count text that shows "5 over infinity" needs text truncation or wrapping.
- Settings page mini tabs should use responsive grid/flex layout.
- Use `truncate`, `break-words`, `overflow-hidden` classes consistently.

### 6.6 Fix network error handling (no file path leak)
**Problem:** When offline, error messages show file paths and URLs, leaking server information.
**Files:**
- `client/src/hooks/use-realtime.ts` — Error handling should not show raw error objects.
- All API error handlers should catch errors and show user-friendly messages, not technical details.
- `inbox.tsx` — Toast error messages should not include file paths or URLs.
- Backend error responses should not include stack traces or internal paths.

### 6.7 Fix push notifications (PWA)
**Problem:** Push notifications don't work or don't show for replies/updates.
**Files:**
- Check `push_subscriptions` table and related service.
- `services/email-service/src/email/push-notification-service.ts` — Verify it's sending notifications correctly.
- Frontend service worker registration in `client/public/` or `client/src/`.
- Check notification permission requests and handling.

### 6.8 Fix toast/banner notification system
**Problem:** Error toasts and success messages don't always show.
**Files:**
- `client/src/hooks/use-toast.ts` — Toast provider setup.
- `inbox.tsx` — All `toast()` calls. Verify they're triggered correctly.
- Add toasts for important events: send success, send failure, import complete, etc.

### 6.9 Fix "Engagement Velocity" count mismatch
**Problem:** Shows 8 in backend but UI displays 4.
**Files:**
- `analytics.tsx` — The recent events section. The count might be limited on frontend but not showing a "show more" option.
- Backend API may paginate results differently from what UI expects.

### 6.10 Fix settings UI mini tabs
**Problem:** Settings tabs don't fit properly, text overflows.
**Files:**
- `client/src/pages/dashboard/settings.tsx` — Tab layout needs responsive fixes.
- Use scrollable tab containers for mobile.
- Ensure proper padding and wrapping.

---

## BATCH 7: Reputation, Autonomous Activity, Polish & Cleanup

### 7.1 Fix reputation score not updating
**Problem:** Reputation score stays static despite bounces and sends.
**Files:**
- `services/email-service/src/email/reputation-monitor.ts` — `calculateReputationScore()` should be triggered on bounce, send, and open events.
- It's called from `bounce-handler.ts` but may not be called from other events.
- Add a reputation refresh trigger in `campaign-queue.ts` after sending batches.

### 7.2 Add decimal precision to reputation score
**Problem:** Reputation score uses integers, needs decimal precision for accurate calculations.
**Files:**
- `services/email-service/src/email/reputation-monitor.ts` — Change score calculation from integer to decimal (float).
- Update the database schema if needed (integrations table reputationScore field).
- Display with 2 decimal places in UI.

### 7.3 Fix autonomous activity empty state
**Problem:** "Autonomous Activity" section shows empty container when no activity exists.
**Files:**
- `client/src/pages/dashboard/home.tsx` — The autonomous activity section should:
  - Show "No autonomous activity yet" message when empty
  - Hide entirely if user has no activity (don't show empty card)
  - Only render the section if there's actual data

### 7.4 Fix "Recent Relay Events" UI on mobile
**Problem:** Recent Relay Events shows hardened text, poor mobile layout.
**Files:**
- `client/src/pages/dashboard/inbox.tsx` or relevant component for relay events.
- Clean up the UI to match the rest of the app design.
- Ensure responsive breakpoints work on mobile.

### 7.5 Fix lead preview / CRM card
**Problem:** Lead preview in inbox doesn't show last sent email, doesn't show CAV columns.
**Files:**
- `inbox.tsx` — The lead detail panel (when a lead is selected, the right side or expanded area).
- Should show: last email sent, last email received, next follow-up date, score, custom fields.
- The card should be clean and informative, like a CRM lead card.

### 7.6 Fix "hardened copy" sending
**Problem:** Sometimes the hardened/fallback copy is sent instead of the actual campaign copy.
**Files:**
- `campaign-queue.ts` — In `deliverCampaignEmail()`, check which copy is selected. There may be a fallback chain that picks the wrong copy.
- The `outreachCampaigns.templates` and `campaignLeads.usedTemplate` should consistently use the chosen template.

### 7.7 Clean up stale data & race conditions
**Problem:** Various race conditions across the app cause flickering and inconsistent states.
**Files:**
- All React query invalidation points — ensure proper `onMutate`/`onError`/`onSettled` patterns.
- WebSocket event handlers — use debouncing for frequent updates.
- Optimistic updates should match server response structure exactly.

### 7.8 Fix graph date consistency
**Problem:** Analytics graph shows dates inconsistently — sometimes no date until clicked.
**Files:**
- `analytics.tsx` — The timeSeries data formatting. Ensure all data points have proper date labels.
- The XAxis tick formatter should display dates in a readable format (e.g., "Jun 11").
- Empty dates in the series should be filled with "0" for continuity.

### 7.9 Audit log / activity stream consistency
**Problem:** Activity feed shows different counts and events than expected.
**Files:**
- `analytics.tsx` — The "Live Interaction Stream" section.
- Make sure `recentEvents` data from backend includes all relevant events (opens, clicks, replies, bounces).
- The count displayed should match the actual event count.

### 7.10 "Don't want to hear from me again? Unsubscribe here" UI
**Problem:** The unsubscribe link in email body shows hardcoded text that looks unprofessional.
**Files:**
- The email template/footer generation. The unsubscribe text and link should be configurable and look cleaner.
- Ensure the unsubscribe HTML in the email footer is rendered properly (not showing raw HTML).

---

## EXECUTION TRACKING

| Batch | Status | Started | Completed | Notes |
|-------|--------|---------|-----------|-------|
| 1: Email Content & Variables | PENDING | — | — | |
| 2: Tracking System | PENDING | — | — | |
| 3: KPI & Analytics | PENDING | — | — | |
| 4: Inbox & Conversation UI | PENDING | — | — | |
| 5: Mailbox Distribution | PENDING | — | — | |
| 6: Scoring, Filters, Mobile | PENDING | — | — | |
| 7: Reputation & Polish | PENDING | — | — | |
