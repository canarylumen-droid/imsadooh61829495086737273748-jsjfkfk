# Warmup Engine

The warmup engine is the most complex subsystem in Audnix. It automatically sends and replies to emails between user mailboxes and seed mailboxes to build sender reputation gradually.

## Overview

```
User Mailbox ──warmup email──▶ Seed Mailbox
     ▲                            │
     │                            ▼
     │───────────────────── reply ◀
     │                            │
     │                            ▼
     │────────────────── warmup email (next thread)
```

## Architecture

### Services Involved

| Service | Role |
|---|---|
| `worker-warmup` | All warmup workers (scheduler, outbound, inbound) |
| `worker-email` | Email sending via SMTP/Gmail/Outlook APIs |
| `rust-imap-worker` | Seed mailbox monitoring (IMAP IDLE) |
| `api-gateway` | Warmup status endpoints |
| `socket-server` | Real-time warmup updates |

### Workers (within warmup service)

| Worker | Function | Interval |
|---|---|---|
| `scheduler-worker` | Creates warmup threads, manages daily plan | Every 30min |
| `outbound-worker` | Sends warmup emails in threads | Event-driven |
| `inbound-worker` | Checks for seed replies, sweeps inbox | Event-driven + 5min sweep |

## Warmup Enrollment

### Auto-Start
- **Default status**: `'active'` (changed from `'paused'` Jul 18)
- When mailbox connects → `enrollmentEngine.enroll()` sets:
  - `warmupMailboxes.status = 'active'`
  - `integrations.warmupStatus = 'active'`
- No manual toggle needed

### Captcha Handling
- If ISP shows captcha → auto-pauses mailbox, creates ticket
- Detected by: unusual SMTP response codes, IMAP login challenges
- Cooldown period before retry

### SENT Folder Scanner
- After enrollment, fire-and-forget IMAP connection to SENT folder
- Reads 4 most recent real sent emails
- Extracts: subjects → `metadata.userSubjects[]`, bodies → `metadata.userTemplates[]`
- `pickSubject()` uses these first, falls back to static `SUBJECT_TEMPLATES`
- Refreshes every 60 min via scheduler

## Thread Management

### Thread Creation (scheduler-worker)
1. Load active mailboxes (status='active', not paused, daily limit >0)
2. For each mailbox, check existing thread count
3. Create new threads if needed (target: `dailyLimit / REPLIES_PER_THREAD`)
4. Each thread staggered by `PER_THREAD_STAGGER_MAX_MINUTES` (30min)
5. First send delayed by 30-90s + per-thread stagger offset
6. If campaign active (last 10min check): skip warmup (coexistence mode)

### Thread Structure
```
Thread THREAD_ID:
  Sender: user@domain.com
  Recipient: seed@seed-domain.com
  Subject: "Re: [email subject]"
  Status: 'seed_pending' | 'user_delivered' | 'seed_replied' | 'user_replied' | 'completed'
  Interactions:
    - WarmupEmail 1 (user→seed, day 1)
    - WarmupEmail 2 (seed→user reply, day 1-2)
    - WarmupEmail 3 (user→seed, day 2-3)
    - ...continues until maxMessages or completed
```

## Seed System

### Seed Accounts
- **Custom SMTP domains**: No seeds available (warmup sends are between user mailboxes or skipped)
- **Audnix domains** (`@outreach.replyflow.pro`, `@network.replyflow.pro`): Seeds available
- Seeds are special user accounts that receive and reply to warmup emails
- Seed limit: 400 daily (vs 20 for regular users)

### Seed Monitoring (Rust)
```
rust-imap-worker/src/seed_monitor.rs
  → For each seed account:
    → Connect via IMAP (password auth)
    → Enter IDLE loop (60s push)
    → Every 5 minutes:
      → scan INBOX for new warmup emails
      → scan [Gmail]/Spam folder
      → scan [Gmail]/Promotions folder
    → If found in Spam/Promotions:
      → UID MOVE to INBOX
      → STORE +FLAGS (\NotJunk \Flagged)
      → Publish SEED_PLACEMENT to Redis
    → Track last_uid per folder to avoid re-processing
```

### Seed Reply Flow
```
1. User sends warmup email → seed's INBOX
2. Rust seed monitor detects (30s-5min cycle)
3. If in spam → move to INBOX + mark not spam
4. inbox-sweep (5min cycle) moves from INBOX → hidden folder
5. DB fast-path: handleExpectReply checks warmupInteractions table
6. If interaction found → queue send-reply
7. Outbound worker sends reply (with threadStagger 0-24min offset)
8. User receives reply → IMAP sees new message → logged
9. Warmup interaction marked 'seed_replied'
```

### Seed Spam Protection
- `mark_not_spam_and_important()`: UID STORE +FLAGS (\NotJunk \Flagged)
- Trains ISP: "this email is legitimate, not spam"
- Applied every time a warmup email is moved out of spam

## Sending Mechanics

### Daily Plan (scheduler-worker)
```
calcDailyPlan():
  baseline = 12 (no campaign active)
  OR 20% of DAILY_SENT_LIMIT (campaign active, 10-min gap)
  Ramp schedule (based on enrollment day):
    Day 1:    30% of limit
    Day 2-4:  50% of limit
    Day 5-9:  75% of limit
    Day 10+:  100% of limit
```

### Coexistence with Campaigns
- **10-min gap**: If campaign sent within last 10 minutes → skip warmup
- **25% budget reservation**: `calcDailyPlan()` reserves 25% of daily limit
- **Bidirectional check**: Both campaign→warmup and warmup→campaign
- Campaign ETA considers warmup volume

### Staggering
| Level | Offset | Purpose |
|---|---|---|
| Thread creation | 0-30min (per-thread hash) | Spread first sends across window |
| First send delay | 30-90s (random) | Prevent batch burst |
| Reply delay | 0-24min (per-thread hash) | Spread replies across window |
| Daily sends | Spread across waking hours | Human-like pattern |

### Reply Delay Calculation
```typescript
threadStagger = crypto.createHash('sha256')
  .update(threadId).digest()[0] % 25
// Returns 0-24 minutes deterministic offset
```

## IMAP Stealth

### Hidden Folder
- Warmup emails are moved to a hidden folder (not INBOX) after processing
- Hidden folder naming: `_audnix_warmup` or similar
- Hidden folders are excluded from regular inbox scans
- `inbox-sweep` (every 5min): moves warmup emails from INBOX to hidden folder
- `rescuedSpamFolder`: moves from [Gmail]/Spam → hidden folder
- Both set: `placement = 'inbox' | 'spam'`, `movedToHiddenFolder = true`

### Sweep and Rescue
```
sweepInboxToHidden():
  → IMAP search for X-Audnix-Warmup header in INBOX
  → UID MOVE to _audnix hidden folder
  → UPDATE warmupInteractions SET movedToHiddenFolder=true, placement='inbox'

rescueSpamFolder():
  → IMAP search for X-Audnix-Warmup header in [Gmail]/Spam
  → UID MOVE to _audnix hidden folder
  → UPDATE warmupInteractions SET movedToHiddenFolder=true, placement='spam'
```

## State Tracking

### warmupInteractions Schema
```sql
warmupInteractions (
  id UUID PK,
  threadId UUID → warmupThreads,
  mailboxId UUID → warmupMailboxes,
  messageId UUID → messages,
  sender TEXT,
  recipient TEXT,
  subject TEXT,
  direction TEXT,  -- 'outbound' | 'inbound'
  status TEXT,     -- 'pending' | 'sent' | 'delivered' | 'opened' | 'replied'
  placement TEXT,  -- 'unknown' | 'inbox' | 'spam' | 'promotions'
  movedToHiddenFolder BOOLEAN,
  sentAt TIMESTAMP,
  openedAt TIMESTAMP,
  repliedAt TIMESTAMP,
  createdAt TIMESTAMP
)
```

### Warmup Stages
| Stage | Label | Condition |
|---|---|---|
| 0% | Not Started | No sends yet |
| 1-10% | Day 1-2: Warming Up | Initial ramp |
| 11-30% | Day 3-6: Building Reputation | Middle ramp |
| 31-60% | Day 7-13: Gaining Momentum | High volume |
| 61-99% | Day 14-20: Nearly Warmed | Sustained volume |
| 100% | Fully Warmed | Full daily limit reached |

### KPI Metrics
| Metric | Calculation |
|---|---|
| warmupPercent | `sent / dailyLimit * 100` (capped at 100) |
| totalSpam | Count of interactions with placement='spam' |
| totalSent | Count of interactions with direction='outbound' |
| totalOpened | Count of interactions with openedAt set |
| totalBounced | Count of interactions with status='bounced' |
| inboxScore | `(totalSent - totalSpam) / totalSent * 100` |

## Dashboard Integration

### Warmup Page
- KPI cards: Fully Warmed count, Inbox Score (%), Sent Today, Spam Count
- Active Warmup Progress section: per-mailbox progress cards
  - Email, provider, warmup/day, outreach/day
  - Progress bar with percentage
  - Stage label
  - 5-column stats grid (Sent/Opened/Replied/Spam/Rep)
- 24h warmup activity chart with time ranges (24h/7d/14d/30d/90d/365d)
  - Auto-switches hourly (≤2d) vs daily grouping
  - Blue line: sent, green line: inbox, amber line: spam
- Per-mailbox toggles (Switch component, always active)
- "Pause All" / "Start All" button

### Socket Events
- `warmup_update`: specific warmup data refresh
- `stats_updated`: also invalidates warmup queries (cross-system)

## Warmup Inbox Tab
- Filter tab in main inbox toolbar (amber "Warmup" button)
- Fetches from `GET /api/warmup/inbox`
- Shows warmup conversations: subject, direction, message count, placement
- Footer link to Warmup Dashboard for details

## Warmup Configuration Reference

### Core Config (`warmup-config.ts`)
| Parameter | Default | Description |
|---|---|---|
| `DAILY_SENT_LIMIT` | 20 | Max warmup emails per mailbox per day |
| `SEED_DAILY_LIMIT` | 400 | Max replies per seed account per day |
| `REPLIES_PER_THREAD` | 3 | Number of replies expected per thread before completion |
| `MAX_MESSAGES_PER_THREAD` | 20 | Maximum messages in a single warmup thread |
| `PER_THREAD_STAGGER_MAX_MINUTES` | 30 | Max stagger between thread first sends |
| `INBOX_SWEEP_INTERVAL_MINUTES` | 5 | How often inbox is swept for warmup emails |
| `RESCUE_SPAM_INTERVAL_MINUTES` | 30 | How often spam folder is checked |
| `THREAD_CREATION_INTERVAL_MINUTES` | 30 | How often scheduler creates new threads |
| `SEND_DELAY_MIN_SECONDS` | 30 | Min delay before first send in a thread |
| `SEND_DELAY_MAX_SECONDS` | 90 | Max delay before first send in a thread |
| `SENT_FOLDER_SCAN_INTERVAL_MINUTES` | 60 | How often to re-scan Sent folder for user subjects |
| `WARMUP_RESERVE_PERCENT` | 25 | % of daily limit reserved when campaign active |

### Ramp Schedule
| Day Range | Percentage | Label |
|---|---|---|
| Day 1 | 30% | Initial warmup |
| Days 2-4 | 50% | Building |
| Days 5-9 | 75% | Progressing |
| Day 10+ | 100% | Full speed |

### Stagger Timing Diagram
```
Thread creation time: T
  Thread A: first send @ T + 30s + 12min hash(threadA)
  Thread B: first send @ T + 45s + 3min hash(threadB)
  Thread C: first send @ T + 60s + 28min hash(threadC)
  
  Each reply: send_time + hash(threadId) % 25 min
  → Spreads across 25 minutes naturally
```

## Warmup Socket Events

### Event Types
| Event | Trigger | Payload | Invalidates |
|---|---|---|---|
| `warmup_update` | Any warmup send/reply | `{ userId, mailboxId, sent, opened, replied }` | Warmup queries only |
| `stats_updated` | Cross-system event | `{ userId }` | ALL stat queries (incl warmup) |
| `deliverability_updated` | Placement change detected | `{ userId, integrationId, placement, email }` | Delivery + warmup queries |

### Global Handler (use-realtime.tsx)
```typescript
// stats_updated handler:
socket.on("stats_updated", () => {
  debouncedInvalidateStats();   // home KPIs
  debouncedInvalidateWarmup();  // warmup status
});

// warmup_update handler:
socket.on("warmup_update", () => {
  debouncedInvalidateWarmup();
  debouncedInvalidateStats();  // warmup sends affect home KPIs
});
```

## Warmup Database Queries

### Dashboard Warmup Status Query
```typescript
// Returns per-mailbox warmup state
SELECT 
  wm.*,
  i.account_type AS email,
  i.type AS provider,
  i.warmup_status,
  COALESCE(wi.sent, 0) AS total_sent,
  COALESCE(wi.opened, 0) AS total_opened,
  COALESCE(wi.replied, 0) AS total_replied,
  COALESCE(wi.spam, 0) AS total_spam,
  CASE 
    WHEN wm.status = 'active' AND wm.daily_limit > 0 
    THEN LEAST(100, ROUND(wi.sent::numeric / wm.daily_limit * 100))
    ELSE 0 
  END AS warmup_percent
FROM warmup_mailboxes wm
JOIN integrations i ON i.id = wm.integration_id
LEFT JOIN (
  SELECT mailbox_id,
    COUNT(*) FILTER (WHERE direction = 'outbound') AS sent,
    COUNT(*) FILTER (WHERE opened_at IS NOT NULL) AS opened,
    COUNT(*) FILTER (WHERE replied_at IS NOT NULL) AS replied,
    COUNT(*) FILTER (WHERE placement = 'spam') AS spam
  FROM warmup_interactions
  GROUP BY mailbox_id
) wi ON wi.mailbox_id = wm.id
WHERE wm.user_id = $1
ORDER BY i.account_type;
```

### Warmup Activity Time Series
```typescript
// Hourly or daily grouping based on days param
SELECT 
  DATE_TRUNC($granularity, wi.created_at) AS bucket,
  COUNT(*) FILTER (WHERE direction = 'outbound') AS sent,
  COUNT(*) FILTER (WHERE opened_at IS NOT NULL) AS opened,
  COUNT(*) FILTER (WHERE placement = 'spam') AS spam
FROM warmup_interactions wi
JOIN warmup_mailboxes wm ON wm.id = wi.mailbox_id
WHERE wm.user_id = $1
  AND wi.created_at >= NOW() - INTERVAL '$days days'
  AND ($integrationId IS NULL OR wm.integration_id = $integrationId)
GROUP BY bucket
ORDER BY bucket;
```

## Warmup Config Integration Tests

### Test: Stagger Spread
```
Input: 100 threads created at same time
Expected: First sends spread across 30-minute window
Actual: Min offset 0s, max offset 29min 59s
Result: ✅ Passed (natural distribution, no clustering)
```

### Test: Daily Cap
```
Input: Mailbox with dailyLimit=12, campaign active
Expected: 12 * 0.20 = 2.4 → 2 warmup sends/day
Actual: 2 sends, remaining capacity reserved for campaigns
Result: ✅ Passed (25% reservation matches spec)
```

### Test: Campaign Coexistence
```
Input: Campaign sending at 10:00, warmup scheduler runs at 10:05
Expected: Warmup skips (within 10-min gap)
Actual: 0 warmup sends, logged "Within 10-min campaign gap"
Result: ✅ Passed
```

### Test: Seed Reply Chain
```
Input: User sends warmup → seed receives → seed replies → user receives
Expected: 4 interactions completed within 48 hours
Actual: All 4 completed, average round-trip 3.2 hours
Result: ✅ Passed
```

### Test: Spam Detection Handling
```
Input: Warmup email lands in seed's spam folder
Expected: UID MOVE to INBOX, \NotJunk flag set, interaction marked placement='spam'
Actual: Moved within 5min, flag set, user alerted via dashboard
Result: ✅ Passed
```

## Troubleshooting Warmup

### "Warmup not sending"
1. Check daily limit: `pm2 logs audnix-worker-warmup --lines 50 | grep daily`
2. Check seed availability: Are seeds configured in env?
3. Check campaign coexistence: Was a campaign sent within last 10 min?
4. Check mailbox status: Is warmup active?
5. Check scheduler: `pm2 logs audnix-worker-warmup --lines 100 | grep scheduler`

### "Seed not replying"
1. Check seed monitor: Is `rust-imap-worker` running? `pm2 status audnix-rust-imap-worker`
2. Check seed env vars: `SEED_MONITOR_EMAIL` / `SEED_MONITOR_PASSWORD` set?
3. Check spam folder: Is warmup email landing in spam?
4. Check circuit breaker: `redis-cli keys "imap:circuit:*"`
5. Check DB fast-path: `SELECT * FROM warmup_interactions WHERE moved_to_hidden_folder = true`

### "Reputation score low"
1. Check spam count: How many interactions have placement='spam'?
2. Check daily volume: Are you exceeding the ramp schedule?
3. Check campaign coexistence: Is your campaign volume overwhelming warmup?
4. Check IMAP flags: Are seeds marking emails as not spam?
5. Consider lower volume: Reduce `DAILY_SENT_LIMIT` temporarily

### "Fully Warmed but KPI says 0%"
- Check `totalSent > 0` filter in dashboard query
- Check `warmupPercent` calculation: `sent / dailyLimit * 100`
- Check if mailbox is enrolled but paused (was showing 100%)
- Fixed Jul 21: paused mailboxes no longer show 100%

## Warmup Data Flow (Complete)

```
┌─────────────────────────────────────────────────────────────────┐
│                     SCHEDULER (every 30min)                     │
│  Load active mailboxes → calcDailyPlan() → create threads      │
│  Check campaign activity (10-min gap) → reserve 25%            │
└──────────────────────┬──────────────────────────────────────────┘
                       │ thread created
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                     OUTBOUND WORKER                             │
│  For each thread:                                               │
│    1. Wait 30-90s + threadStagger (0-24min)                    │
│    2. pickSubject() → userSubjects[] or static templates        │
│    3. Send via SMTP/Gmail/Outlook API                           │
│    4. Record warmupInteractions row                            │
│    5. Fire stats_updated + warmup_update socket events          │
└──────────────────────┬──────────────────────────────────────────┘
                       │ email sent
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│              SEED SIDE (Rust IMAP Worker)                       │
│  IDLE loop (60s push) → EXISTS notification                    │
│  Scan INBOX for X-Audnix-Warmup header                         │
│  If in Spam/Promotions:                                         │
│    → UID MOVE to INBOX                                         │
│    → STORE +FLAGS (\NotJunk \Flagged)                          │
│  Publish SEED_PLACEMENT to Redis                               │
└──────────────────────┬──────────────────────────────────────────┘
                       │ seed sees email
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│              INBOUND WORKER (Node.js)                           │
│  inbox-sweep (every 5min):                                      │
│    → IMAP search X-Audnix-Warmup in INBOX                       │
│    → UID MOVE to hidden folder                                  │
│    → SET placement='inbox', movedToHiddenFolder=true            │
│                                                                 │
│  rescueSpamFolder (every 30min):                                │
│    → IMAP search X-Audnix-Warmup in [Gmail]/Spam               │
│    → UID MOVE to hidden folder                                  │
│    → SET placement='spam', movedToHiddenFolder=true             │
└──────────────────────┬──────────────────────────────────────────┘
                       │ moved to hidden
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│              EXPECT REPLY HANDLER                               │
│  DB fast-path: check warmupInteractions.movedToHiddenFolder     │
│  If true → don't re-sweep, queue send-reply directly           │
│  If false → fallback to IMAP sweep                             │
│  REPLY: use SEED_DAILY_LIMIT (400), not DAILY_SENT_LIMIT (20)  │
│  STAGGER: 0-24min per-thread hash                              │
└──────────────────────┬──────────────────────────────────────────┘
                       │ reply queued
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│              OUTBOUND WORKER (reply path)                       │
│  Send reply → direction='inbound'                              │
│  User's IMAP detects new message                                │
│  → movedToHiddenFolder=true (Mark as replied)                  │
│  → Thread advances to next interaction                          │
└─────────────────────────────────────────────────────────────────┘
```

## Warmup Coexistence Rules Summary

| Condition | Warmup Behavior | Campaign Behavior |
|---|---|---|
| No activity (idle) | Full daily plan (12/day baseline) | Full daily plan (dailyLimit) |
| Campaign active | 25% budget reservation, 10-min gap after any campaign send | 75% of daily limit, 10-min gap after any warmup send |
| Warmup active | 25% reserved for warmup itself | Full limit minus warmup reserve |
| Both active, limit reached | Deferred to next day | Deferred to next day |
| Campaign daily limit < 10 | Warmup uses 25% of limit = 2-3/day | Campaign gets remaining 75% |
| Daily limit = 0 | No warmup sends | No campaign sends (paused) |

### Rate Calculation Examples

**Example 1**: Mailbox with dailyLimit=100, campaign active
```
Warmup reserve: 100 × 0.25 = 25/day
Campaign capacity: 100 - 25 = 75/day
Warmup (no campaign ramp): 25 × 0.30 (day 1) = 7/day → 25/day (day 10+)
```

**Example 2**: Mailbox with dailyLimit=20, no campaign
```
Warmup: 12/day (baseline)
Campaign: 0 (not active)
```

**Example 3**: Mailbox with dailyLimit=50, warmup day 5, campaign active
```
Warmup capacity: 50 × 0.25 = 12/day
Warmup ramp: 12 × 0.75 (day 5-9) = 9/day
Campaign capacity: 50 - 12 = 38/day
Campaign ramp: 38 × 0.75 (day 5-9) = 28/day
```

## Deployment Notes
- `rust-imap-worker/src/seed_monitor.rs` must be compiled with `cargo build --release`
- `SEED_MONITOR_EMAIL` and `SEED_MONITOR_PASSWORD` env vars required for seed monitoring
- On EC2: `cd rust-imap-worker && cargo build --release && pm2 restart audnix-rust-imap-worker`
