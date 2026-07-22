# Campaigns

## Overview

Campaigns manage bulk email outreach to leads. They handle scheduling, sending, tracking, and real-time statistics.

## Campaign Model

```typescript
Campaign {
  id: UUID
  userId: UUID
  name: string
  status: 'draft' | 'active' | 'paused' | 'completed' | 'archived'
  type: 'sequence' | 'broadcast'
  totalLeads: number
  sentCount: number
  openCount: number
  replyCount: number
  clickCount: number
  bounceCount: number
  dailyLimit: number
  startDate: Date
  endDate: Date
  createdAt: Date
  updatedAt: Date
}
```

## Sending Mechanics

### Daily Limit
- Per-mailbox daily limit set in campaign config
- `initialOutreachLimit` slider: controls day-1 send volume before auto-ramping
- Rates ramp over time (50% → 75% → 100% over days)
- ETA calculation: `Math.ceil(remaining / avgDailyRate)` with fallback to `totalDailyLimit`

### Coexistence with Warmup
- **25% budget reservation**: Warmup reserves 25% of daily limit
- **10-min gap**: Checks bidirectional — if warmup sent recently, campaign waits
- Campaign ETA considers warmup volume in capacity calculation

### Per-Mailbox Round Robin
- Leads distributed evenly across mailboxes
- Smart MX routing: `@gmail.com` → Gmail mailbox, `@outlook.com` → Outlook
- Same-domain → matching `custom_email`
- Fallback: round-robin across remaining
- Mailbox router: `shared/lib/imports/mailbox-router.ts`

## Campaign Types

### Sequences
- Multi-step email sequences (e.g., Email 1 → Wait 3d → Email 2 → Wait 5d → Email 3)
- Each step can be: email, wait (duration), or conditional
- Follow-up conditions: opened but no reply, not opened, replied

### Broadcasts
- Single email sent to all leads at once
- Sent in batches respecting daily limits
- One-shot campaigns

### Creating Sequences
Sequences are multi-step email campaigns. Each step defines:
```typescript
interface CampaignStep {
  type: 'email' | 'wait' | 'conditional';
  // Email step
  subject?: string;
  body?: string;
  delayDays?: number;  // days after previous step
  
  // Wait step
  waitDays?: number;
  
  // Conditional step
  condition?: 'opened_no_reply' | 'not_opened' | 'replied';
  thenStep?: CampaignStep;
  elseStep?: CampaignStep;
}
```

### Step Templates
| Template | Steps | Total Duration |
|---|---|---|
| Cold Outreach | Email → Wait 3d → Follow-up → Wait 5d → Final | 8+ days |
| Re-engagement | Email → Wait 7d → "Haven't heard back" → Wait 7d → Breakup | 14+ days |
| Welcome | Email → Wait 1d → Resource → Wait 3d → Case Study | 4+ days |
| Webinar Follow-up | Email → Wait 1d → Recording → Wait 3d → Q&A Invite | 4+ days |

## Campaign Wizard (UI)

### Steps
1. **Leads**: Select leads (by filter, list, or file upload)
2. **Emails**: Compose email sequence with AI-assisted writing
3. **Mailbox**: Select sending mailboxes, set daily limits
4. **Review**: Confirm all settings before launch

### Mailbox Selection
- Per-mailbox settings within wizard:
  - Daily limit slider
  - `initialOutreachLimit` slider (day-1 throttle)
- Mailbox availability indicator (connected/warming/paused)
- Smart MX routing preview

## Tracking

### Per-Email Tracking
- `email_tracking` table records per-event:
  - `sent` → `delivered` → `opened` → `clicked` → `replied`
  - `bounced` / `spam` / `unsubscribed`
- Open tracking: 1x1 GIF pixel (`/t/:token`)
- Click tracking: URL rewrite (`/c/:token?url=...`)
- Unsubscribe: List-Unsubscribe header + endpoint

### Campaign Stats (Real-Time)
- Socket events: `stats_updated` on every send/open/bounce
- No polling — pure socket-driven
- Stats cache: 500ms server-side TTL (cleared on every event)
- ETA updates via socket (`campaign_eta` event)

### Campaign List Modal
- Real-time progress via socket events
- ETA based on actual send rate
- Pause/Resume campaign controls
- Per-campaign daily progress bar

## Campaign Queue
- BullMQ queue (`campaign-queue` worker)
- Processes leads in batches
- Respects per-mailbox daily limits
- Handles ramp-up scheduling
- `deferToTomorrow()` when daily limit exhausted

## Campaign Analytics

### KPIs
| Metric | Description | Calculation |
|---|---|---|
| Sent | Total emails sent in campaign | Count of sent emails |
| Open Rate | % of sent emails opened | `opened / sent * 100` |
| Reply Rate | % of sent emails replied | `replied / sent * 100` |
| Click Rate | % of sent emails clicked | `clicked / sent * 100` |
| Bounce Rate | % of sent emails bounced | `bounced / sent * 100` |
| Conversion Rate | % of leads converted | `converted / totalLeads * 100` |
| ETA | Estimated time remaining | `remaining / avgDailyRate` |

### Time Series
- Campaign progress chart (sent/opened/replied over time)
- Per-day breakdown for active campaigns
- Comparison to previous campaigns

### Expected vs Actual
- Expected sends: planned daily volume based on limits
- Actual sends: real sent count
- Deviation tracking: alerts when actual < 80% of expected

## Per-Mailbox Campaign Settings

### Outreach Limit
- `initialOutreachLimit`: Day-1 throttle per mailbox
- Controls how many emails to send on first day before auto-ramping
- Configured in campaign wizard per-mailbox section
- Stored in `integrations.initialOutreachLimit`
- Saved via `PATCH /api/integrations/:integrationId/outreach-limit`

### Ramp Schedule
| Day | % of Limit |
|---|---|
| 1 | initialOutreachLimit |
| 2 | 50% of dailyLimit |
| 3 | 75% of dailyLimit |
| 4+ | 100% of dailyLimit |

### Per-Mailbox Stats
- Sent today (already sent)
- Remaining today (dailyLimit - sentToday)
- Warmup reserve (25% of dailyLimit when warmup active)
- Effective available = remaining - warmupReserve

## Campaign Queue Processing

### Queue (outreach-worker)
```typescript
// For each mailbox:
// 1. Check daily limit (sentToday < dailyLimit)
// 2. Check warmup coexistence (10-min gap check)
// 3. Get next lead from campaign
// 4. Send email via SMTP/Gmail/Outlook API
// 5. Record in email_tracking table
// 6. Update campaign stats (sentCount +1)
// 7. Update mailbox daily count
// 8. Fire stats_updated socket event
// 9. Schedule next send (respect per-second rate)
```

### ETA Calculation
```typescript
function calculateETA(
  remainingLeads: number,
  dailyLimit: number,
  sentToday: number,
  warmupReserve: number
): string {
  const availableToday = dailyLimit - sentToday - warmupReserve;
  if (availableToday <= 0) {
    // Defer to tomorrow
    return '24h+ (daily limit reached)';
  }
  
  const days = Math.ceil(remainingLeads / dailyLimit);
  const hours = Math.ceil(remainingLeads / (dailyLimit / 24));
  
  if (days <= 1) return `~${hours}h remaining`;
  return `~${days} days remaining`;
}
```

### Defer Mechanism
```typescript
function deferToTomorrow() {
  // Reset send count
  // Queue remaining leads for next day
  // Fire campaign_eta socket event
  // Wait for midnight reset
}
```

### Concurrent Sending
- Per-mailbox concurrency: 1 email per 2-5 seconds (human-like)
- Multi-mailbox parallelism: each mailbox sends independently
- Across all mailboxes: up to `numMailboxes * rate` emails/sec
- Rate limiting at SMTP level also respected

## Campaign Types

### Automated Sequences
Multi-step sequences with conditions:

```
Step 1: Email "Introduction" → Wait 3 days
  → If replied: move to "Replied" workflow
  → If not opened: Step 2a
  → If opened no reply: Step 2b
  
Step 2a: "Different Subject" follow-up
Step 2b: "Any questions?" follow-up
  → Wait 5 days
  
Step 3: "Breakup" final email
  → If no response: mark lead "cold"
```

### One-Shot Broadcasts
Single email sent to all selected leads at once:
```
- Select leads (filter/list)
- Compose email
- Set daily limit
- Launch: sends in batches until all delivered
- No follow-ups (campaign completed after send)
```

### Smart Sequences (AI-driven)
- AI selects optimal follow-up timing based on lead engagement
- AI personalizes subject lines per lead
- AI determines when to rotate between different sequence templates
- AI identifies best-performing sequences and promotes them

## A/B Testing

### Test Variables
- Subject line (2-5 variants)
- Email body (2-3 variants)
- Send time (morning vs afternoon)
- Sender name (personal vs company)

### Test Execution
1. Split leads into test groups (equal size)
2. Send different variants to each group
3. Measure: open rate, reply rate, click rate per variant
4. After statistical significance reached:
   - Winning variant sent to remaining leads
   - Losing variants discontinued

### Test Results
```typescript
interface ABTestResult {
  variantName: string;
  sent: number;
  opened: number;
  replied: number;
  openRate: number;
  replyRate: number;
  confidence: number;  // Statistical confidence (0-1)
  isWinner: boolean;
}
```

## Campaign Templates

### Built-in Templates
| Template | Steps | Best For |
|---|---|---|
| Cold Outreach | Intro → Follow-up → Breakup | New leads, first contact |
| Warm Introduction | Reference → Value Prop → CTA | Referrals, event follow-ups |
| Re-engagement | "Haven't heard" → "Last try" → Breakup | Cold leads, dormant contacts |
| Webinar Series | Invite → Reminder → Recording → Next event | Event marketing |
| Product Launch | Teaser → Launch → Case study → Offer | New product release |
| Newsletter | Content 1 → Content 2 → Content 3 | Regular nurturing |
| Sales Sequence | Discovery → Demo → Proposal → Close | B2B sales pipeline |

## Dashboard Integration

### Home Page
- Campaign KPIs: Active campaigns, Total sent today, Open rate, Reply rate
- Recent campaign activity feed
- Quick-launch campaign button

### Campaign List Modal
- All campaigns with status badges
- Per-campaign progress bar
- ETA display
- Pause/Resume controls
- Real-time updates via socket events

## API Endpoints

```
GET    /api/campaigns                    → List campaigns
POST   /api/campaigns                    → Create campaign
GET    /api/campaigns/:id                → Campaign details
PATCH  /api/campaigns/:id                → Update campaign
DELETE /api/campaigns/:id                → Delete campaign
POST   /api/campaigns/:id/launch         → Launch campaign
POST   /api/campaigns/:id/pause          → Pause campaign
POST   /api/campaigns/:id/resume         → Resume campaign
GET    /api/campaigns/:id/stats          → Real-time stats
GET    /api/campaigns/:id/leads          → Campaign leads
```
