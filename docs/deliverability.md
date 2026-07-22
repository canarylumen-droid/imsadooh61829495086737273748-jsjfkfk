# Deliverability & Email Placement Tracking

## Overview

Deliverability tracking monitors whether sent emails land in the inbox, spam folder, or bounce. It combines real-time tracking pixel, bounce handlers, FBL webhooks, seed monitoring, and SMTP telemetry.

## Placement States

| State | Meaning | Source |
|---|---|---|
| `unknown` | No signal yet | Default initial state |
| `delivered` | SMTP 250 OK / API 200 accepted | Send confirmation |
| `inbox` | Confirmed inbox placement | Open tracking pixel, seed monitor |
| `spam` | Confirmed spam placement | FBL complaint, spam folder detect, DMARC report |
| `bounced` | SMTP bounce / DSN | Bounce handler, IMAP DSN detection |
| `promotions` | Gmail Promotions tab | Seed monitor scan |

## Data Flow

### 1. Send Confirmation (`delivered`)
```
SMTP/Gmail/Outlook send → 250 OK / 200 OK
  → updateSendPlacement(placement='delivered')
  → UPDATE email_tracking SET placement='delivered'
  → clusterSync.notifyDeliverabilityUpdated(userId, { placement: 'delivered', ... })
  → clusterSync.notifyStatsUpdated(userId)
  → clusterSync.notifyStatsCacheInvalidate(userId)
```

### 2. Open Tracking (`inbox`)
```
Recipient clicks tracking link or loads pixel
  → GET /t/:token (GIF pixel)
  → res.end() immediately (<1ms)
  → fire-and-forget: recordEmailEvent({ type: 'open' })
  → UPDATE email_tracking SET placement='inbox', opened_at=NOW()
  → deliverability_updated + stats_updated + stats_cache_invalidate
```

### 3. Click Tracking
```
Recipient clicks tracked link
  → 302 redirect to target URL immediately
  → fire-and-forget: recordEmailEvent({ type: 'click' })
  → deliverability_updated (opened + click count)
```

### 4. Bounce Handling
**SMTP bounce (synchronous)**:
```
SMTP 550/551/552/553/554 during send
  → Catch in sendEmail()
  → SET placement='bounced'
  → deliverability_updated + stats_updated
```

**DSN bounce (asynchronous)**:
```
IMAP receives DSN email (MAILER-DAEMON/postmaster)
  → paged-email-importer.ts checks BEFORE transactional filter
  → Extracts original recipient from bounce body
  → Matches to email_tracking
  → SET placement='bounced'
  → deliverability_updated + stats_updated
```

### 5. FBL / Spam Complaint
```
Feedback Loop webhook (AOL/Yahoo/Outlook)
  → fbl-webhook.ts receives complaint
  → Matches original message via headers
  → SET placement='spam'
  → deliverability_updated + stats_updated
```

### 6. Spam Folder Detection
```
IMAP idle manager scans [Gmail]/Spam folder periodically
  → OR spam-monitor.ts
  → Finds emails with X-Audnix-Id header in spam
  → SET placement='spam'
  → deliverability_updated + stats_updated + stats_cache_invalidate
```

### 7. Seed Monitor Detection
```
Rust seed monitor scans seed mailboxes (5min cycle)
  → Checks INBOX, [Gmail]/Spam, [Gmail]/Promotions
  → Finds warmup emails by X-Audnix-Warmup header
  → If in Spam: UID MOVE to INBOX + mark not spam
  → Publish SEED_PLACEMENT to Redis
  → Forensic handler in API Gateway:
    → Matches message_id in email_tracking
    → SET placement='spam' or 'inbox'
    → deliverability_updated + stats_updated
```

### 8. SENT Folder Check
```
After each send, IMAP checks Sent folder for the sent email
  → Reads X-Gmail-Labels / X-Forefront-Antispam-Report headers
  → If spam flagged → SET placement='spam'
  → Best-effort (password auth IMAP only, not OAuth)
```

## Real-Time Updates

Every placement change fires ALL of:
1. `deliverability_updated` → deliverability page refreshes chart
2. `stats_updated` → home page KPIs refresh
3. `stats_cache_invalidate` → API gateway clears 500ms cache

## API Endpoints

### Inbox Placement Stats
```
GET /api/stats/inbox-placement?integrationId=X&days=30
  → Returns: inboxRate, spamRate, bounceRate, unknownRate
  → Based on REAL email_tracking.placement data
  → NOT static integration DB fields
```

### Domain Reputation
```
GET /api/stats/domain-reputation?integrationId=X&days=30
  → Returns per-domain stats: sent, inbox, spam, bounce
  → DNS verification: SPF, DKIM, DMARC, MX, Blacklist status
```

### Analytics
```
GET /api/dashboard/analytics/full?days=30
  → Time series (sent, opened, replied, bounced, spam)
  → All metrics respect days parameter
  → Pie chart: inbox/spam/bounce/unknown distribution
```

## Tracking Pixel

### Implementation
```
Email body contains:
  <img src="https://audnixai.com/t/TOKEN" width="1" height="1" />

API handler (email-tracking-routes.ts):
  GET /t/:token
    1. res.end() immediately (1×1 GIF, <1ms)
    2. Fire-and-forget: recordEmailEvent({ type: 'open' })
    3. UPDATE email_tracking SET opened_at = NOW()
    4. Fire deliverability_updated + stats_updated + stats_cache_invalidate
```

### Click Tracking
```
Email link rewritten as:
  https://audnixai.com/c/TOKEN?url=https://example.com

API handler:
  GET /c/:token?url=...
    1. 302 redirect to target URL immediately
    2. Fire-and-forget: recordEmailEvent({ type: 'click' })
    3. OPTIONAL: also logs 'open' if not yet opened
```

## Spam Detection Methods (Ranked by Reliability)

| Method | Reliability | Latency | Source |
|---|---|---|---|
| FBL webhook | ★★★★★ | Minutes-hours | ISP feedback loop |
| Bounce handler | ★★★★★ | Seconds-minutes | SMTP response |
| Spam folder scan | ★★★★☆ | 5-30 min | IMAP periodic |
| Seed monitor | ★★★★☆ | 30s-5min | Rust IMAP worker |
| SMTP telemetry | ★★★☆☆ | Pre-send | MX handshake timing |
| SENT folder check | ★★☆☆☆ | Post-send | IMAP headers |

## Placement Update Rules

### `email_tracking.placement` Update Guard
```
WHERE placement IS NULL 
   OR placement IN ('unknown', 'delivered')
```
Once set to 'inbox', 'spam', or 'bounced', it is NOT overwritten by lower-reliability signals.

### Priority Order
1. FBL complaint → `spam` (highest authority)
2. SMTP bounce → `bounced`
3. Open tracking → `inbox`
4. Spam folder detect → `spam`
5. Seed monitor → `spam` or `inbox`
6. SMTP 250 OK → `delivered` (provisional)
7. SENT folder headers → `spam` (least reliable)

## Deliverability Page

### Components
- **Inbox Placement Pie Chart**: Recharts pie with 4 segments
  - green = inbox, red = spam, amber = bounced, gray = unknown
  - Auto-updates via socket events
  - Time range selector: 24h, 7d, 30d, 60d, 90d
- **Domain Reputation Table**: Per-domain breakdown
  - Domain, Sent, Inbox %, Spam %, Bounce %, DNS status
- **Trend Chart**: Time series of placement rates
  - Downloads data from `/api/stats/domain-reputation?days=X`

### Socket Integration
```typescript
// Page-level listeners (deliverability.tsx):
socket.on("stats_updated", () => {
  queryClient.invalidateQueries({ queryKey: ["/api/stats/inbox-placement"] });
});
socket.on("deliverability_updated", () => {
  queryClient.invalidateQueries({ queryKey: ["/api/stats/inbox-placement"] });
  queryClient.invalidateQueries({ queryKey: ["/api/stats/domain-reputation"] });
});
socket.on("integration_reputation_updated", () => {
  queryClient.invalidateQueries({ queryKey: ["/api/stats/domain-reputation"] });
});
```

## Dashboard Integration

### Deliverability Page
- Inbox Placement pie chart (inbox=green, spam=red, bounce=amber, unknown=gray)
- Zero-data state: "No data yet" text (not empty chart)
- Time ranges: 24h, 7d, 30d, 60d, 90d
- Per-domain breakdown cards
- Socket listeners: `stats_updated`, `deliverability_updated`, `integration_reputation_updated`

### Integrations Page
- Per-mailbox stats: Delivery %, Bounce %, Inbox %, Rep Score
- Real-time placement pulse dot:
  - Green pulse → inbox
  - Red pulse → spam  
  - Amber pulse → bounced
  - Blue pulse → other
- DNS badges: SPF ✓/✗, DKIM ✓/✗, DMARC ✓/✗, MX ✓/✗, BL ✓/✗
- Shows "--" (em dash) instead of "Init..." when no data yet
- Rates populate instantly via `deliverability_updated` socket events

## SMTP Telemetry (Rust)

Pre-send MX handshake analysis in `rust-email-sender/src/telemetry.rs`:

| Timing | Classification |
|---|---|
| RCPT TO < 200ms | `InboxConfident` |
| RCPT TO > 1200ms | `TarpittedSpamQueue` |
| SMTP 4xx response | `GreylistedOrThrottled` |
| SMTP 5xx response | `BouncedOrBlocked` |

Data published to Redis for dashboard display.
