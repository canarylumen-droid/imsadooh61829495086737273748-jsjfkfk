# Lead Recovery System

## Overview

The lead recovery system automatically re-engages leads who have gone cold. It monitors IMAP inboxes for replies from dormant leads and uses AI to generate personalized re-engagement emails.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌───────────────┐
│ lead-recovery   │────▶│ Redis Pub/Sub    │────▶│ MySQL DB      │
│ worker          │     │ (event-driven)    │     │ (recovery_*)  │
└────────┬────────┘     └──────────────────┘     └───────────────┘
         │                                                      
         ▼                                                      
┌─────────────────┐                                             
│ Filter Engine    │────▶ Noise email classifier                
│ (filter.ts)      │────▶ 40+ rules, 13 categories             
└─────────────────┘                                             
```

## Key Design Decisions

- **Event-driven** (not polling): Redis pub/sub triggers processing
- **30s polling fallback**: When Redis unavailable, worker polls every 30s
- **No active campaign guard removed**: Recovery works independently (Jul 19 fix)
- **Circuit breaker**: Mailbox sync paused after repeated failures (1-hour cooldown)

## Database Tables

### lead_recovery_state
```sql
lead_recovery_state (
  id UUID PK,
  userId UUID,
  integrationId UUID,
  status TEXT,       -- 'queued' | 'syncing' | 'synced' | 'paused' | 'failed' | 'idle'
  syncStatus TEXT,   -- overall sync status
  errorMessage TEXT, -- error details if failed
  syncedAt TIMESTAMP,
  lastSyncAt TIMESTAMP,
  availableAt TIMESTAMP, -- cooldown until next retry
  createdAt TIMESTAMP,
  updatedAt TIMESTAMP
)
```

### recovery_event_logs
```sql
recovery_event_logs (
  id UUID PK,
  stateId UUID → lead_recovery_state,
  leadId UUID,
  eventType TEXT,   -- 'noise_filtered' | 'ai_analyzed' | 'recovery_sent' | 'reopened' | etc.
  metadata JSON,
  createdAt TIMESTAMP
)
```

## Worker Processing

### Step 1: Load Pending Mailboxes
- Queries `lead_recovery_state` WHERE status='queued' AND availableAt <= NOW()
- Claims mailbox: UPDATE SET status='syncing'
- Error message cleared on re-queue

### Step 2: Sync Mailbox via IMAP
- Connects to mailbox via IMAP
- Fetches unseen messages since last sync
- Processes each message through filter

### Step 3: Filter Noise Emails
`classifyEmail()` in `filter.ts`:
- 40+ detection rules across 13 noise categories:
  - Newsletters (unsubscribe links, "View in browser")
  - Notifications (LinkedIn, Twitter, GitHub)
  - Marketing/Sales (limited-time offers, promotions)
  - Billing/Receipts
  - Social media (friend requests, likes)
  - System/Admin (password resets, verification)
  - Spam (common spam phrases)
  - Calendar invites
  - Shipping/tracking notifications
  - Job applications/recruiting
  - Forum/discussion group digests
  - Survey/feedback requests
  - Automated DSN/bounce messages
- Any match → filtered out before AI analysis

### Step 4: Skip Dead Statuses
- Lead status checked: `converted`, `booked`, `not_interested`, `unsubscribed`, `no_show`
- Matching leads skipped: event logged as `SkippedDeadStatus`

### Step 5: AI Analysis
- Remaining messages analyzed by AI for:
  - Intent (buying/signaling/neutral/negative)
  - Urgency
  - Re-engagement opportunity score
- Low-score leads filtered out

### Step 6: Queue Recovery Drafts
- High-score leads → recovery drafts queued
- Drafts stored in `recovery_event_logs` with type 'pending_send'

## Send Recovery Email

### Endpoint
```
POST /api/lead-recovery/send/:leadId
  → Sends as thread reply to original conversation
  → Sets isPriorityReply: true
  → Creates message record
  → Updates lead status to 'contacted'
```

### UI (Draft Modal)
- "Send Recovery Email" button → calls POST endpoint
- "Open in Inbox" button → navigates to inbox with lead selected
- Draft preview with AI-generated subject and body
- Allow editing before sending

## API Endpoints

```
GET    /api/lead-recovery/status                   → Recovery status per-mbox
POST   /api/lead-recovery/sync                     → Start sync for mailbox
GET    /api/lead-recovery/events                   → Event history
POST   /api/lead-recovery/send/:leadId             → Send recovery email
DELETE /api/lead-recovery/draft/:draftId           → Discard draft
```

## Recovery Draft Generation

### AI Analysis Input
```typescript
interface RecoveryAnalysis {
  originalConversation: Message[];
  leadProfile: { name, company, role, previousInteractions };
  emailContent: string;
  intent: 'buying' | 'signaling' | 'neutral' | 'negative';
  urgency: number;
  opportunity: number;
}
```

### Draft Generation
```typescript
interface RecoveryDraft {
  subject: string;
  body: string;
  confidence: number;
  suggestedAction: 'send' | 'review' | 'discard';
}
```

Drafts stored in `recovery_event_logs` with type='pending_send'.

## Worker Details (worker.ts)

### Main Loop
```typescript
async function processMailbox(stateId: string) {
  const state = await getRecoveryState(stateId);
  if (state.status !== 'syncing') return;
  
  try {
    const imap = await connectIMAP(state.integrationId);
    const messages = await fetchMessagesSince(imap, state.lastSyncAt);
    const meaningful = messages.filter(m => !classifyEmail(m).isNoise);
    const activeLeads = meaningful.filter(l => !isDeadStatus(l.status));
    const drafts = await analyzeForRecovery(activeLeads);
    
    for (const draft of drafts) {
      await createRecoveryDraft(stateId, draft);
    }
    
    await updateRecoveryState(stateId, { 
      status: 'synced', 
      syncedAt: new Date(),
      errorMessage: null
    });
  } catch (error) {
    await failMailboxSync(stateId, error.message);
  }
}
```

## Failure Handling

- `failMailboxSync()`: Updates status to 'failed', sets `errorMessage`, sets `last_sync_at = NOW()`
- Cooldown: `availableAt = NOW() + 1 hour`
- Respects `available_at` in `getPendingSyncStates()` query
- `claimMailboxForSync()` also checks `available_at` — prevents re-claiming during cooldown
- Worker `processMailbox()` catches errors properly

## UI

### Lead Recovery Page
- Per-mailbox sync cards with status badges:
  - `synced` (green) — up to date
  - `queued` (blue) — waiting for processing
  - `syncing` (amber) — actively syncing
  - `failed` (red) with error message
  - `paused` (gray) — disabled
- Event history timeline per mailbox
- Pagination for event logs
- "Sync Now" button per mailbox
