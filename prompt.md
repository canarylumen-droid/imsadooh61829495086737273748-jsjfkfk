AI Activity
Acted
09:07 PM
Good timing (80%) with moderate intent (50%) - opportune moment for DM

Acted
09:51 PM
Autonomous outreach dispatch triggered

Acted
09:46 PM
Autonomous outreach dispatch triggered

Acted
09:45 PM
Autonomous outreach dispatch triggered

This is it anywhere in calendar page 


Warmup
0 warming

ruben@network.replyflow.pro

4 warmup/day • 100 rep

Off

treasure@network.replyflow.pro

4 warmup/day • 100 rep

Off

fortune@network.replyflow.pro

4 warmup/day • 100 rep

Off

treasure@advisory.replyflow.pro

4 warmup/day • 100 rep


This section in deliverability page doesn't check if warm-up running to update real time


Toggle theme


Deliverability & Reputation
Per-mailbox spam score, blacklist status, DNS health, and bounce monitoring. Updates every 2 minutes.

Refresh
Average Reputation

87.50/100

Healthy

3 mailboxes

At Risk

1 mailboxes

Critical

0 mailboxes

Warmup
0 warming

ruben@network.replyflow.pro

4 warmup/day • 100 rep

Off

treasure@network.replyflow.pro

4 warmup/day • 100 rep

Off

fortune@network.replyflow.pro

4 warmup/day • 100 rep

Off

treasure@advisory.replyflow.pro

4 warmup/day • 100 rep

Off
Inbox Placement (90d)
24h
7d
30d
60d
90d
No emails tracked this period.

Send emails to see placement breakdown.

treasure@network.replyflow.pro

SMTP

100.00/100
Healthy
47/day
Sent

0

Inbox Rate

—

Bounce Rate

—

Spam Rate

—

DNS

Issues

Pacing

1/31min

ruben@network.replyflow.pro

SMTP

100.00/100
Healthy
47/day
Sent

0

Inbox Rate

—

Bounce Rate

—

Spam Rate

—

DNS

Issues

Pacing

1/31min

fortune@network.replyflow.pro

SMTP

100.00/100
Healthy
47/day
Sent

0

Inbox Rate

—

Bounce Rate

—

Spam Rate

—

DNS

Issues

Pacing

1/31min

treasure@advisory.replyflow.pro

SMTP

50.00/100
At Risk
50/day
Sent

0

Inbox Rate

—

Bounce Rate

—

Spam Rate

—

DNS

Issues

Pacing

1/29min
And this place in deliverability page mustn't wait for campaign even manual sending should check cuz I've used the mailbox even if once or 10 billion times should still show naa


And lastly lead recovery page still not working

Lead Recovery Unavailable

503: {"error":"Request Timeout","message":"The request took too long to complete. Please try again.","code":"REQUEST_TIMEOUT"}
And the UI there shouldn't mention mongodb technical stuff tells them what it does when they recover leads etc

## 2. Interval Between Sends

Every send calculates the exact interval to spread emails evenly across 24 hours:

```
intervalMs = 86,400,000 / max(1, effectiveDailyLimit)
```

| Daily Limit | Per Hour | Interval Between Sends |
|-------------|----------|----------------------|
| 5/day       | 0.21/hr  | 4h 48min |
| 10/day      | 0.42/hr  | 2h 24min |
| 15/day      | 0.63/hr  | 1h 36min |
| 20/day      | 0.83/hr  | 1h 12min |
| 35/day      | 1.46/hr  | 41min |
| 48/day      | 2/hr     | 30min |
| 60/day      | 2.5/hr   | 24min |
| 120/day     | 5/hr     | 12min |
| 250/day     | 10.4/hr  | 5min 46s |
| 500/day     | 20.8/hr  | 2min 53s |

The interval is clamped: min **1 minute**, max **6 hours**.

**Jitter**: ±25% random variation (`0.75 + Math.random() × 0.5`) so sends look human.

**Night Watch** (10 PM – 6 AM UTC): interval doubles (half speed).

**Same-minute guard**: Never sends 2 emails in the same calendar minute. If the next send would land in the same minute, it pushes to the start of the next minute + random 0-10s.

## 3. Interleaving Campaign + Warmup (Spacing)

When both campaign initials, follow-ups, and warmup need to send from the same mailbox, they're interleaved:

```
activeMinutes = hoursActive × 60
totalSends    = campaignInitials + followUps + warmupSends
idealInterval = max(minGapMinutes, activeMinutes / totalSends)
// Clamped to max 120 minutes
```

**Bidirectional 10-minute gap**:
- Before a campaign send: checks if any warmup was sent in the last 10 minutes. If so, defers by 10 min.
- Before a warmup send: checks if any campaign was sent in the last 10 minutes. If so, skips.
- When a warmup sends, it **also updates the campaign's last-send time** to that moment — so campaign won't fire within 10 min of warmup.

**Deadline flush**: In the last `gap × 2` minutes of the active window, forces remaining campaign sends through regardless of gap (ensures daily budget is met).

## 4. Catch-up / Coast

Every send checks how the mailbox is pacing against its expected hourly rate:

```
hoursElapsed   = max(1, currentHour)
expectedByNow  = round((dailyLimit / 24) × hoursElapsed)
sentToday      = actual count from DB
behindBy       = expectedByNow - sentToday
threshold      = max(3, round(dailyLimit × 0.2))

if (behindBy > threshold):
    // Behind — speed up (reduce interval by up to 25%)
    interval *= max(0.75, 1 - (behindBy / dailyLimit))
else if (behindBy < -threshold):
    // Ahead — coast (increase interval by up to 25%)
    interval *= min(1.25, 1 + (abs(behindBy) / dailyLimit))
```

This naturally smooths out bursts without hard resets.

## 5. Follow-Up Budget Reservation

Follow-ups reserve up to 30% of the daily budget:

```
followUpReserve = min(followUpSentToday, round(effectiveLimit × 0.3))
initialLimit    = effectiveLimit - followUpReserve
if (initialLimit < round(effectiveLimit × 0.5)):
    initialLimit = round(effectiveLimit × 0.5)
```

At least 50% of the daily budget is always available for initial outreach. Follow-ups fill the rest.

## 6. Redistribution on Cap Hit

When a mailbox hits its daily cap mid-day:

1. **Follow-ups NEVER redistribute** — they stay on the original mailbox
2. **Initials redistribute** to mailboxes with spare capacity
3. Capacity is floor/ceil distributed across available mailboxes
4. If ALL mailboxes hit cap, everything defers to tomorrow

## 7. Initial Throttle (Ramp-Up)

The `initialOutreachLimit` controls day-one send volume. The reputation system auto-ramps it toward `dailyLimit`:

| Reputation Score | Health Level | Throttle Behavior |
|-----------------|--------------|-------------------|
| 85-100 | healthy | Full speed — no throttle |
| 65-84 | cautious | 20% safety throttle |
| 40-64 | poor | 50% safety throttle |
| 0-39 | critical | Drastic reduction |

The effective daily cap at any moment is `min(dailyLimit, initialOutreachLimit)`.

## 8. Warmup Thread Scheduling

Warmup runs independently from campaigns but respects the same mailbox:

**Thread creation interval**: `randomBetween(4h, 12h)` — new warmup threads are created at most every 4-12 hours.

**Messages per thread**: `randomBetween(2, 3)` — each thread is 2-3 message volleys (send + reply).

**Delay between messages in a thread**: `randomBetween(2h, 6h)`.

**Reply expectation delay**: `randomBetween(1h, 4h)` — how long to wait for a paired mailbox to reply.

**Ramp schedule for new mailboxes** (non-seed):

| Day Range | % of Base Limit | Example (20 base) |
|-----------|----------------|-------------------|
| Day 1-2 | 10% | 2/day |
| Day 3-5 | 25% | 5/day |
| Day 6-10 | 50% | 10/day |
| Day 11-14 | 75% | 15/day |
| Day 15+ | 100% | 20/day |

**Seed mailboxes**: fixed at 400/day (can handle 500+ seed email accounts).

**Reputation recovery** modifies warmup limits:
- Score 0-39 (critical): max 40/day
- Score 40-64 (poor): max 30/day
- Score 65-84 (cautious): max 25/day
- Score 85-100 (healthy): full base limit

## 9. Defer to Tomorrow

When a mailbox hits its daily cap (or all mailboxes hit cap), remaining sends are NOT executed same-day. Instead:

1. The send is marked as "deferred" in the queue
2. At midnight UTC (daily reset), the scheduling recalculates
3. New day formula: `remainingLeads / dailyLimit` → fresh plan
4. Carry-over leads are re-added to the queue naturally
5. No same-day catch-up — prevents spammy bursts

This also handles the edge case where `initialOutreachLimit` is low on day 1. The app sends that many, then defers the rest to day 2 (and so on) until the ramp is complete.

## 10. Deliverability Tracking

**Deliverability page** (`/dashboard/deliverability`):
- Fetches `/api/stats/inbox-placement` for real spam/bounce/inbox rates
- Shows per-mailbox stats grid (Delivery %, Bounce %, Inbox %, Rep Score)
- Pie chart with spam vs inbox vs bounce breakdown
- Real-time via `deliverability_updated` + `stats_updated` socket events
- Time range selector (24h/7d/30d/60d/90d)

**Warmup progress page** (`/dashboard/warmup`):
- Per-mailbox progress cards with sent/opened/bounced counts
- Stage labels (e.g. "Day 6-10: Gaining Momentum")
- Today's progress bar with percentage
- KPI: Fully Warmed count (mailboxes with warmupPercent >= 100)
- 24h/7d/14d/30d/90d/1Y activity chart
- Real-time via `stats_updated` socket events (no polling)

## 11. Spam Detection (Seed Monitor)

**Seed monitor** (`rust-imap-worker/src/seed_monitor.rs`):
- Scans INBOX, [Gmail]/Spam, [Gmail]/Promotions on seed accounts
- Looks for `X-Audnix-Id` header in our sent messages
- Reports folder placement via Redis event: `SEED_MONITOR`
- `forensic-handler.ts` receives the event, matches to `email_tracking`, sets `placement='spam'|'inbox'`
- Fires `deliverability_updated` + `stats_updated` + `stats_cache_invalidate`

**Current status**: Detection works end-to-end. The system knows which folder (inbox/spam/promotions) each email landed in. Auto-removal from spam ("report not spam") is NOT yet implemented — the seed monitor detects but doesn't move emails out of spam.

## 12. ETA Calculation

```
ETA = ceil(remainingEmails / avgDailyRate)
```

- `avgDailyRate` = actual sends per day over recent history (not configured cap)
- If no history, falls back to `totalDailyLimit`
- Updates in real-time as sends complete (socket events)
- Multiplier for weekends if `excludeWeekends` is enabled

## 13. Key Formulas Summary

| What | Formula | Source |
|------|---------|--------|
| Base interval | `86400000 / dailyLimit` ms | `campaign-queue.ts:873` |
| Interval bounds | min 1min, max 6hr | `campaign-queue.ts:875,910` |
| Jitter | `× (0.75 + random × 0.5)` | `campaign-queue.ts:898` |
| Night Watch | `× 2` (10PM-6AM) | `campaign-queue.ts:893` |
| Warmup budget | `25% of dailyCap` | `campaign-queue.ts:1100` |
| Campaign-warmup gap | 10 min bidirectional | `campaign-queue.ts:1231`, `scheduler-worker.ts:261` |
| Follow-up reserve | 30% of budget, min 50% for initials | `campaign-queue.ts:1213` |
| Warmup thread interval | `random(4h, 12h)` | `scheduler-worker.ts:253` |
| Warmup ramp | 10%→25%→50%→75%→100% over 14 days | `warmup-config.ts:52` |
| Redistribution | floor/ceil, follow-ups excluded | `scheduler.rs:319` |
| Defer to tomorrow | when cap hit, no same-day catch-up | `campaign-queue.ts:1130` |
| Defer recalculation | midnight UTC, fresh plan = remaining/dailyLimit | — |
