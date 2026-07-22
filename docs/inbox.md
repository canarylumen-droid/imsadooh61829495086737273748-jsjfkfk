# Inbox / Lead Management

## Overview

The inbox manages email conversations (messages) with leads. It integrates with the IMAP sync engine, AI features, and the campaign sending system.

## Lead Model

### Lead States
```
new → contacted → replied → warm → booked → converted
  ↘           ↗                          ↗
  cold ──────↗                          │
  ↗                                      │
  bouncy ────────────────────────────────┤
  unsubscribed ──────────────────────────┤
  not_interested ────────────────────────┘
```

- `new`: Fresh import, never contacted
- `contacted`: At least one outbound message sent
- `opened`: Has opened at least one message
- `replied`: Has replied to at least one message  
- `warm`: Engaged, high score
- `booked`: Meeting scheduled
- `converted`: Deal closed / goal achieved
- `cold`: No engagement, paused outreach
- `bouncy`: Spam trap detected or no MX records
- `unsubscribed`: Opted out
- `not_interested`: Explicitly declined

### Lead Score
- Updated on every message interaction:
  - Inbound reply: +10 (capped at 100)
  - Outbound send: +2 (capped at 100)
- Updated during lead enrichment (AI-based timezone/geolocation)

## Inbox View

### Lead List
- Left pane: scrollable lead list with infinite scroll (virtualized)
- Each lead shows: name (font-semibold), snippet (120 char truncation), date (ml-auto)
- Delivery indicators:
  - ✓✓ (opened at) — double tick when `lastMessageIsRead = true`
  - ✓ (sent, not opened) — single tick when `lastMessageDirection = 'outbound'`
  - (nothing) — inbound last message
  - Ticks only show when `lead.status !== 'new'` (never contacted)
- Direction arrows removed (kept cleaner)
- Status tag hidden until conversation has messages
- Brain button: `hidden md:inline-flex md:opacity-0` — hidden on mobile

### Messages Area
- Right pane: full conversation with threaded messages
- Empty state: "No messages yet" with Envelope icon (disappears on first send/receive)
- WhatsApp-style date headers between messages from different days:
  - "Today", "Yesterday", day-of-week (within 7 days), "Jun 15" (older)
- Message bubbles: `break-words break-all` (no horizontal scroll)
- Messages area: `overflow-x-hidden`

### Filter and Search
- **Status filter**: All DB status values (new, contacted, converted, not_interested, unsubscribed, cold, booked, warm, replied)
  - Metadata-based filters (opened, unread, read) handled client-side
  - `apiStatusFilters`: dynamically from DB status values (not hardcoded)
- **Channel filter**: Filter by mailbox/integration
- **Search**: Full-text search across lead names and email addresses
- **Archive toggle**: Toggle archived leads in/out of view
  - `setAllLeads` maps `archived: true` instead of filtering out
  - Archived view stays until user clicks back (no auto-return)

### Compose
- Bottom compose area (no double input — quick-reply header removed)
- Optimistic send: `sendMutation.onMutate` adds temp message to list
- Socket `messages_updated` handler replaces temp messages instead of appending
- Dedup: `onSuccess` handler removes extra copies after mapping temp→real

## Real-Time Updates

### Socket Events
| Event | Handler |
|---|---|
| `leads_updated` | Patches `allLeads` state (INSERT, UPDATE status, BULK_DELETE) |
| `messages_updated` | Replaces temp messages, updates ticks, appends new |
| `open_click_event` | Sets `lastMessageIsRead = true` instantly (✓→✓✓) |
| `stats_updated` | Invalidates inbox queries |

### Fetch Strategy
- `refetchOnMount: true` — forces fresh data on navigation
- No polling — pure socket-driven updates
- Infinite scroll with virtual list

## AIM (AI Features)

### AI Reply Button
- Generates reply text based on conversation context
- Led by AI model (Gemini/OpenAI) with brand knowledge base
- Reply text inserted into compose area (not auto-sent)
- Sparkles icon stays neutral (no color change during typing)

### Lead Intelligence Modal
- Simplified UI, mobile-friendly
- Shows: engagement history, score, status, AI-generated insights
- No generic badges/gradients

## Drafts

- Drafts stored in localStorage (`draft:leadId`)
- `onMutate` clears both `localDrafts` state and localStorage
- Draft-loading useEffect reads from localStorage directly
- Drafts do NOT reappear after navigating away and back

## IMAP Sync Engine

### How Inbox Messages Arrive
```
Remote sender sends email to user@domain.com
  → Mail server accepts (MX)
  → IMAP IDLE or periodic fetch detects new message
  → paged-email-importer.ts:
    1. Parse headers (From, To, Subject, Message-ID, References)
    2. Check References/In-Reply-To for existing conversation
    3. If reply → append to existing thread
    4. If new → create lead (if sender unknown) or new thread
    5. Filter transactional/social emails
    6. Detect bounces (MAILER-DAEMON, postmaster)
    7. Extract body text (prefer plain text, fallback HTML)
    8. Store in messages table
  → Two-phase push:
    Phase 1 (before DB write): socket events for instant UI
    Phase 2: save to DB async
  → Fire socket events: leads_updated, messages_updated
  → Fire stats_updated (increment reply count)
```

### IMAP Sync for Custom Email (Rust)
```
User has custom SMTP/IMAP mailbox
  → Rust IMAP worker connects via IMAP IDLE
  → Blocks on IDLE (60s push), wakes on EXISTS notification
  → Fetches new unseen messages
  → Publishes to Redis: { event: "NEW_EMAIL", payload: { ... } }
  → Node.js subscriber on "audnix-cluster:events"
    → Processes through paged-email-importer.ts
    → Matches to existing leads or creates new
```

### IMAP Sync for Gmail/Outlook OAuth (Node.js)
```
User connected via Gmail API / Outlook API
  → Node.js IMAP worker connects (OAuth2 tokens)
  → Uses mailbox-worker.ts / BullMQ for queuing
  → Token refresh handled by OAuth2 client
  → Same processing pipeline as custom email
```

### Two-Phase Push (Instant UI)
```typescript
// Phase 1: Socket events before DB write
clusterSync.notifyNewMail(userId, { leadId, subject, from });
clusterSync.notifyLeadsUpdated(userId, { type: 'UPDATE', lead });
clusterSync.notifyMessagesUpdated(userId, { type: 'new_message', message });
clusterSync.notifyStatsUpdated(userId);
clusterSync.notifyStatsCacheInvalidate(userId);

// Phase 2: Save to DB
await db.insert(messages).values(message);
await db.update(leads).set({ snippet, lastMessageAt, lastMessageDirection, ... });
```

### Fetch New Messages (Race Condition Fix)
- `imap-idle-manager.ts`: Body parsing with `simpleParser` was async
- `msg.once('end')` pushed items synchronously before body parsed → empty messages
- Fixed with promise-based wait for body parsing completion
- Now guarantees full message content before socket push

## Lead Scoring

### Score Updates
- Every message interaction updates lead score:
  - **Inbound reply**: +10 score (capped at 100)
  - **Outbound send**: +2 score (capped at 100)
  - **Open**: +1 score (capped at 100)
  - **Click**: +3 score (capped at 100)
- Score updated in `drizzle-storage.ts` on message creation
- Also updated in `messages-routes.ts` on manual send

### Score Thresholds
| Score Range | Behavior |
|---|---|
| 0-20 | Cold, low priority |
| 21-50 | Warm, moderate priority |
| 51-80 | Hot, high priority |
| 81-100 | Very hot, immediate follow-up recommended |

## Snippet Management

### Database Storage
- Stored in `leads.snippet` column
- Updated on each new message
- Cleaned before storage:
  ```regex
  RFC headers stripped: References:, In-Reply-To:, Message-ID:,
  Content-Type:, MIME-Version:, Date:, From:, To:, Subject:,
  DKIM-Signature:, Authentication-Results:, Received:, X-*:, ARC-*
  ```
- 120 character truncation at display time

### Frontend Display
```tsx
// Double cleanup at render time
const cleanSnippet = lead.snippet?.replace(
  /(?:References|In-Reply-To|Message-ID|Content-Type|MIME-Version|Date|From|To|Subject|DKIM-Signature|Authentication-Results|Received):.*(?:\n|$)/gi, ''
).substring(0, 120);
```

## Archive

- Archive/unarchive via `PATCH /api/leads/:id` with `{ archived: boolean }`
- Archived leads excluded from inbox by default
- Toggle in toolbar shows/hides archived leads
- View stays stable (no auto-redirect after archiving/unarchiving)
