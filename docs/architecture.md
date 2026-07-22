# Architecture

## Overall System Design

Audnix is built as a monorepo with three main packages:

```
audnix/
├── client/                          # React SPA (Vite)
│   ├── src/
│   │   ├── pages/dashboard/          # 15 dashboard pages
│   │   ├── components/               # Shared UI components
│   │   ├── hooks/                    # Custom hooks (use-realtime, etc.)
│   │   └── lib/                      # API client, query client
│   └── dist/                         # Built static files → S3
├── services/
│   ├── api-gateway/                  # Express HTTP API (PM2)
│   ├── socket-server/                # Socket.IO (PM2)
│   └── *-worker/ (16 workers)        # Background workers (PM2)
├── shared/
│   ├── lib/                          # Shared libraries
│   │   ├── storage/                  # Drizzle ORM, file upload
│   │   ├── channels/                 # Email providers (SMTP/Gmail/Outlook)
│   │   ├── realtime/                 # Socket.IO + Redis cluster
│   │   ├── redis/                    # Redis client
│   │   └── db/                       # Migrator, MySQL pool
│   └── schema.ts                     # Drizzle schema definitions
├── rust-email-sender/                # Rust SMTP sender (PM2)
├── rust-imap-worker/                 # Rust IMAP IDLE (PM2)
└── ecosystem.config.cjs              # PM2 config (all 18 services)
```

## Communication Patterns

### Client ↔ Server (HTTP)
- Client makes React Query or fetch calls to `api-gateway`
- React Query: auto-retry (2 retries), cache, refetch on focus
- Direct fetch (`api-client.ts`): used for non-cached operations

### Client ↔ Server (WebSocket)
- Socket.IO connection to `socket-server`
- Server pushes events: `stats_updated`, `leads_updated`, `messages_updated`, `deliverability_updated`, `settings_updated`, `warmup_update`, `insights_updated`, `calendar_updated`
- Client hooks in `use-realtime.tsx` maintain query cache via `invalidateQueries`

### Server ↔ Workers (Redis)
- **Redis pub/sub** (`audnix-cluster:events`): Cross-process events
  - Stats cache invalidation, notifications, real-time updates
  - `clusterSync.*()` methods publish, `redis-pubsub.ts` subscribes
- **BullMQ**: Job queues for AI enrichment, email sending, billing
- **Redis BRPOP/LPUSH**: Rust interop queues
  - `email-send-queue` → Rust email sender
  - `mailbox-monitor:add/remove` → Rust IMAP worker
  - `mx-batch-queue` → Rust MX resolver

### Server → Workers (Cluster Events)
```
API Gateway or any Worker
  → clusterSync.notify*()
    → Redis pub/sub "audnix-cluster:events"
      → redis-pubsub.ts subscriber in ALL processes
        → If API Gateway: invalidates stats cache
        → If Socket Server: relays to client via Socket.IO
```

## Real-Time Data Flow (Login → Dashboard)

```
1. User logs in
2. /api/user/profile returns data
3. AuthGuard confirms session
4. Socket.IO connects (useSocket hook)
5. Home page fetches KPI + conversation data
6. use-realtime.tsx registers socket listeners
7. Background workers process emails/campaigns
8. Workers fire clusterSync.notifyStatsUpdated()
9. Redis pub/sub delivers to Socket server
10. Socket server emits stats_updated to client
11. use-realtime handler invalidates React Query cache
12. Pages re-render with fresh data
```

## Database Design

### Schema Strategy
- MySQL 8 with Drizzle ORM (type-safe queries)
- All tables defined in `shared/schema.ts`
- Migrations in `shared/lib/db/migrator.ts`
- Connection pool via `mysql2` lazy import (`shared/lib/mysql.ts`)

### Key Tables
| Table | Purpose |
|---|---|
| `users` | User accounts |
| `user_sessions` | Session store (PostgreSQL, connect-pg-simple) |
| `integrations` | Email mailboxes (SMTP, Gmail API, Outlook API) |
| `leads` | Contacts/prospects |
| `campaigns` | Email campaigns |
| `campaign_emails` | Campaign email queue |
| `messages` | Inbox message threads |
| `email_tracking` | Email events (sent, opened, clicked, bounced) |
| `warmup_mailboxes` | Warmup enrollment per mailbox |
| `warmup_interactions` | Warmup email records |
| `warmup_threads` | Warmup conversation threads |
| `calendar_events` | Calendly/Google Calendar events |
| `deals` | Sales pipeline deals |
| `domain_verifications` | DNS records (SPF, DKIM, DMARC, MX, BL) |
| `lead_recovery_state` | Lead recovery sync state |
| `recovery_event_logs` | Recovery event history |
| `deleted_accounts_log` | Track deleted accounts for login messages |

## Worker Responsibilities (Detailed)

### worker-email
- Sends emails via SMTP, Gmail API, Outlook API
- Handles retry logic (3 retries with exponential backoff)
- Applies daily rate limits per mailbox
- Manages open/click tracking token injection
- Fires `stats_updated` + `deliverability_updated` on every send

### worker-imap
- Handles Gmail/Outlook OAuth IMAP connections (custom_email handled by Rust)
- Monitors INBOX for new messages using IDLE
- Processes incoming emails: parse, match to lead/conversation, create new leads
- Detects bounces (DSN), spam complaints, replies
- Two-phase push: socket events BEFORE DB write for instant UI

### worker-ai
- AI enrichment: timezone/geolocation per lead
- AI reply generation (conversation context + brand knowledge)
- Lead scoring updates
- Decision engine: when to send follow-ups
- Activity reasoning (includes lead name in output)

### worker-outreach
- Campaign email queue processing
- Per-lead sending with rate limiting
- Tracks campaign progress (sent, opened, replied)
- Campaign ETA calculation
- Coexistence with warmup (checks 10-min gap)

### worker-warmup
- 3 sub-workers: scheduler, outbound, inbound
- Scheduler: creates warmup threads, manages daily plan
- Outbound: sends warmup emails in threads
- Inbound: checks for seed replies, sweeps inbox to hidden folder
- See [warmup.md](warmup.md) for full detail

### worker-lead-recovery
- Event-driven (Redis pub/sub), 30s polling fallback
- Noise filter: 40+ rules across 13 categories
- AI analysis: intent, urgency, re-engagement scoring
- Sends recovery emails as thread replies

### worker-billing
- Subscription management (trial/starter/pro/enterprise)
- Stripe integration (webhooks, invoicing, payment confirmation)
- Plan downgrade/upgrade handling
- Usage tracking against plan limits

### worker-deliverability
- Inbox placement tracking
- Domain reputation monitoring
- DMARC/DKIM/SPF validation
- Blacklist checking

### Rust Services

### rust-email-sender
- **Language**: Rust (tokio async runtime)
- **Binary**: ~4.0MB compiled
- **Queue**: Redis BRPOP on `email-send-queue` (infinite block, zero polling)
- **SMTP**: lettre crate with TLS
- **MX Telemetry**: Pre-send MX handshake timing (EHLO/MAIL FROM/RCPT TO)
  - RCPT >1200ms → `TarpittedSpamQueue`
  - SMTP 4xx → `GreylistedOrThrottled`
  - RCPT <200ms → `InboxConfident`
- **Config**: Reads from env vars passed via PM2 ecosystem.config.cjs

### rust-imap-worker
- **Language**: Rust (tokio + async-imap)
- **Binary**: ~7.7MB compiled
- **Queue**: Redis BRPOP on `mailbox-monitor:add/remove`
- **Monitor**: One tokio task per custom_email mailbox
  - IDLE loop with `wait_for_idle_push(60s)` — blocks until EXISTS notification
  - Breaks IDLE every 5min to scan Spam + Promotions folders
  - Tracks `last_uid` per seed per folder
  - `scan_spam_promotions()`: checks for warmup emails in spam
  - `process_messages()`: processes new unseen messages
- **Seed Monitor**: Scans seed mailboxes for warmup emails in Spam/Promotions
  - UID MOVE to INBOX + STORE +FLAGS (\NotJunk \Flagged) to train ISP
  - `uid_move()`: RFC 6851 with `uid_copy_and_delete()` fallback
