# Audnix AI — Real-Time Sales Outreach Platform

[![CI](https://github.com/canarylumen-droid/imsadooh61829495086737273748-jsjfkfk/actions/workflows/ci.yml/badge.svg)](https://github.com/canarylumen-droid/imsadooh61829495086737273748-jsjfkfk/actions/workflows/ci.yml)
[![Deploy](https://github.com/canarylumen-droid/imsadooh61829495086737273748-jsjfkfk/actions/workflows/deploy.yml/badge.svg)](https://github.com/canarylumen-droid/imsadooh61829495086737273748-jsjfkfk/actions/workflows/deploy.yml)
[![ECS Deploy](https://github.com/canarylumen-droid/imsadooh61829495086737273748-jsjfkfk/actions/workflows/ecs-deploy.yml/badge.svg)](https://github.com/canarylumen-droid/imsadooh61829495086737273748-jsjfkfk/actions/workflows/ecs-deploy.yml)

Production sales outreach platform with AI-powered cold email, real-time IMAP IDLE, inbox placement tracking, spam detection, and per-mailbox domain reputation.

**Live App:** https://audnixai.com

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Client (React + Vite + Tailwind)                           │
│  WebSocket → instant push for spam_detected, new_mail, etc  │
│  React Query → 2s auto-refresh + WS cache invalidation     │
└──────────────┬──────────────────────────────────────────────┘
               │ Socket.IO + REST
┌──────────────▼──────────────────────────────────────────────┐
│  API Gateway (Express) :5000                                │
│  /api/stats/inbox-placement  /api/stats/domain-reputation   │
│  /t/{token} stealth tracking  /c/{token} click tracking    │
└──────────────┬──────────────────────────────────────────────┘
               │ BullMQ + Redis
┌──────────────▼──────────────────────────────────────────────┐
│  Workers (14 processes)                                     │
│  ┌─────────────┐ ┌──────────────┐ ┌────────────────────┐   │
│  │ email-worker │ │ brain-worker │ │ outreach-worker     │   │
│  │ IMAP 5s      │ │ AI scoring   │ │ campaign sends      │   │
│  │ heartbeat    │ │ intent       │ │ drip engine         │   │
│  └─────────────┘ └──────────────┘ └────────────────────┘   │
│  ┌─────────────┐ ┌──────────────┐ ┌────────────────────┐   │
│  │ imap-worker  │ │ social-worker│ │ billing-worker      │   │
│  │ 30s heartbeat│ │ Instagram    │ │ Stripe/webhook      │   │
│  │ 14min recycle│ │ sync         │ │ processing          │   │
│  └─────────────┘ └──────────────┘ └────────────────────┘   │
│  warmup, orchestrator, rag, vector-db, audit, infra-scaler  │
└──────────────┬──────────────────────────────────────────────┘
               │
┌──────────────▼──────────────────────────────────────────────┐
│  PostgreSQL (Drizzle ORM)  │  Redis 7 (BullMQ + PubSub)    │
└─────────────────────────────┴───────────────────────────────┘
```

## Real-Time Performance (Current)

| Component | Setting | Speed |
|-----------|---------|-------|
| IMAP IDLE NOOP | `keepalive.interval` | **5 seconds** |
| IMAP IDLE Re-IDLE | `keepalive.idleInterval` | **10 seconds** |
| Zombie detection | `ZOMBIE_TIMEOUT_MS` | **30 seconds** |
| Watchdog sweep | `watchdogInterval` | **15 seconds** |
| Persistent heartbeat | heartbeat inside IDLE | **5 seconds** |
| Overflow fallback poll | `POLL_INTERVAL_MS` | **5 seconds** |
| Email worker NOOP | `HEARTBEAT_TIME` | **30 seconds** |
| Email worker recycle | `RECYCLE_TIME` | **14 minutes** |
| Inbound sweep | `SWEEP_INTERVAL_MS` | **2 minutes** |
| Spam rescue | `RESCUE_INTERVAL_MS` | **1 hour** |
| IMAP reconnect backoff | `MIN_BACKOFF → MAX_BACKOFF` | **1s → 60s** |
| UI data refresh | React Query `refetchInterval` | **2 seconds** |
| WebSocket events | `spam_detected`, `new_mail` | **instant (priority)** |
| Spam placement detection | IDLE push → DB update | **real-time** |

## Services

| Service | Path | Role |
|---------|------|------|
| **api-gateway** | `services/api-gateway` | REST API, auth, Socket.IO, campaigns, leads |
| **email-service** | `services/email-service` | IMAP IDLE manager, spam monitor, reputation |
| **email-worker** | `services/email-worker` | IMAP connection pool, email sync |
| **outreach-worker** | `services/outreach-worker` | Autonomous email sends, AI copy |
| **brain-worker** | `services/brain-worker` | AI scoring, intent, objection handling |
| **warmup-service** | `services/warmup-service` | 24/7 email warmup |
| **billing-service** | `services/billing-service` | Stripe, subscriptions |
| **social-worker** | `services/social-worker` | Instagram sync |
| **shared** | `shared/lib` | DB, queues, realtime, crypto |

## Core Features

- **Real-time IMAP IDLE** — 5s NOOP heartbeat, 10s re-IDLE, instant mail push via WebSocket
- **Spam detection** — emails in spam folder detected in real-time via IDLE push, matched against `email_tracking` by subject
- **Inbox placement analytics** — per-mailbox inbox/spam/bounce donut charts, stacked progress bars
- **Domain reputation per mailbox** — spam rate, bounce rate, 0-100 score, health badges
- **AI cold outreach** — DeepSeek-powered personalized emails with brand context
- **Campaign automation** — Queue-based drip engine with configurable delays
- **Stealth tracking** — `/t/{token}` pixel opens, `/c/{token}` link clicks
- **Warmup** — 24/7 P2P warmup with seed pools
- **Lead pipeline** — Import CSV, status tracking, deal revenue
- **Multi-provider** — Gmail OAuth, Outlook OAuth, custom SMTP/IMAP

## Quick Start

```bash
# Install dependencies
npm install

# Type check (needs 4GB heap)
NODE_OPTIONS="--max-old-space-size=4096" npx tsc --noEmit

# Build client
npx vite build

# Run tests
npx vitest run

# Start dev server
npm run dev
```

## Docker

```bash
# Start all services
docker compose up -d

# Scale IMAP workers
docker compose up -d --scale imap-worker=3
```

## Environment Variables

Required: `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `ENCRYPTION_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`

See `config.toml` for all configurable intervals.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/stats/inbox-placement` | GET | Per-mailbox inbox/spam/bounce stats |
| `/api/stats/domain-reputation` | GET | Per-mailbox spam rate, bounce rate, score |
| `/api/stats/bounces/stats` | GET | Bounce statistics |
| `/api/stats/sending/limits` | GET | SMTP rate limit status |
| `/api/stats/warmup/status` | GET | Warmup pool status |
| `/t/{token}` | GET | Stealth open tracking (1x1 GIF) |
| `/c/{token}` | GET | Click tracking redirect |

## WebSocket Events

| Event | Priority | Description |
|-------|----------|-------------|
| `spam_detected` | instant | Email detected in spam folder |
| `new_mail` | instant | New email arrived |
| `mailbox_status` | instant | Mailbox health changed |
| `integration_reputation_updated` | instant | Domain reputation recalculated |
| `leads_updated` | throttled 1s | Lead data changed |
| `sync_status` | throttled 1s | IMAP sync progress |

## Tests

```bash
# Run all tests
npx vitest run

# Run specific test file
npx vitest run tests/email-pipeline.test.ts
```

## Cleanup Done

Removed ~105MB of stale files:
- `attached_assets/` (82MB screenshots/logs)
- `HxD-Portable/` (15MB Windows hex editor)
- `dist/` (5MB build output in repo)
- 25 stale markdown files at root
- 30+ one-off scripts (tmp-*, check-*, test-*)
- `.temp/`, `logs/`, `migrations_meta_backup/`

---
© 2026 AUDNIX OPERATIONS CO.
