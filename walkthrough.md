# Audnix AI — Platform Walkthrough

> **Date:** 2026-07-16  
> **App:** [https://audnixai.com](https://audnixai.com)  
> **Developer Docs:** [https://audnixai.com/developer](https://audnixai.com/developer)  
> **MCP Skill:** `.opencode/skills/audnix-mcp.md`

---

## 1. Architecture Overview

### 1.1 Microservices

| # | Service | Path | Port | Purpose |
|---|---------|------|------|---------|
| 1 | **api-gateway** | `services/api-gateway` | 5000 | REST API, auth, Socket.IO, all routes |
| 2 | **email-service** | `services/email-service` | — | IMAP IDLE manager, spam monitor, DNS validation, bounce handler |
| 3 | **email-worker** | `services/email-worker` | — | IMAP connection pool, email sync (multi-replica) |
| 4 | **outreach-worker** | `services/outreach-worker` | — | Campaign execution, AI copy, autonomous sends |
| 5 | **brain-worker** | `services/brain-worker` | 8082 | AI scoring, intent detection, objection handling, lead enrichment |
| 6 | **warmup-service** | `services/warmup-service` | 3101 | 24/7 P2P email warmup with seed pools |
| 7 | **billing-service** | `services/billing-service` | — | Stripe subscriptions, webhooks |
| 8 | **social-worker** | `services/social-worker` | — | Instagram sync, DM automation |
| 9 | **socket-service** | `services/socket-service` | 8087 | Standalone Socket.IO (split mode) |
| 10 | **deliverability** | `audnix-deliverability-service/` | 3100 | Seed inbox checking, Postmaster/SNDS polling |
| 11 | **shared** | `shared/lib` | — | DB, queues, realtime, crypto (shared across all) |

### 1.2 Shared Libraries

| Library | Path | Purpose |
|---------|------|---------|
| `campaign-queue` | `shared/lib/queues` | BullMQ campaign send engine |
| `deletion-queue` | `shared/lib/queues` | Delayed account deletion (24-48h randomized) |
| `websocket-sync` | `shared/lib/realtime` | Socket.IO with Redis adapter |
| `redis-pubsub` | `shared/lib/redis` | Cross-service pub/sub |
| `encryption` | `shared/lib/crypto` | AES-256-GCM encrypt/decrypt |
| `drizzle-storage` | `shared/lib/storage` | All DB operations (Drizzle ORM) |
| `dns-health-checker` | `shared/lib/deliverability` | SPF/DKIM/DMARC/RBL checks |

### 1.3 Rust Workers

| Worker | Lines | Purpose |
|--------|-------|---------|
| `rust-email-sender/` | 357 | Tokio async, MX caching, connection pooling — replaces Nodemailer path |
| `rust-imap-worker/` | 1095 | TLS IMAP with IDLE, zombie detection, auto-recycle — replaces node-imap |

### 1.4 Email Backend & Fallback Strategy

| Backend | Status | Role |
|---------|--------|------|
| **Rust Email Sender** | ✅ **PRIMARY** | Handles SMTP sending via user-provided SMTP credentials. Runs as a Redis-backed async worker. Tokio-based, zero GC pauses, connection pooling. |
| **Rust IMAP Worker** | ✅ **PRIMARY** | Handles 10K+ IMAP IDLE connections with 50KB per connection, zero GC pauses. Replaces node-imap. |
| **NodeMailer** | ✅ FALLBACK | Used automatically if Rust binary is unavailable (>50ms timeout or missing binary). No manual intervention needed. |
| **KumoMTA** | ❌ **INACTIVE** | KumoMTA requires us to host DKIM and send from our domain. Users only add IMAP/SMTP — Kumo does not fit. Do not use. |

#### Global 50ms Fallback System
Every slow operation across the project auto-fallbacks in **<50ms**:
- **Sending email**: Push job to Redis → Rust picks it up → wait 50ms for result → if timeout/error, fallback to NodeMailer
- **IMAP operations**: Rust IMAP Worker via Redis → fallback to node-imap with warning
- **MX lookup, importing leads, API calls, deletions**: Same Rust-first, 50ms-timeout pattern

Logic: `try Rust → if timeout >50ms or error → instantly switch to Node/TS version`
No manual restarts. Fallback is automatic everywhere via the `withRustFallback()` wrapper.

#### DKIM
Users add their own IMAP and SMTP credentials. DKIM is handled by their email provider (e.g., Gmail). We do NOT manage DKIM. KumoMTA would require us to manage DKIM — kept INACTIVE.

#### Required Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NEW_EMAIL_BACKEND` | `rust` | Email backend: `rust` (default) or `node` (force fallback) |
| `RUST_EMAIL_SENDER_PATH` | `/usr/local/bin/audnix-email-sender` | Path to compiled Rust email sender binary |
| `RUST_IMAP_WORKER_PATH` | `/usr/local/bin/audnix-imap-worker` | Path to compiled Rust IMAP worker binary |
| `EMAIL_QUEUE_NAME` | `email-send-queue` | Redis queue name for email jobs |
| `IMAP_QUEUE_NAME` | `imap-idle-tasks` | Redis queue name for IMAP jobs |
| `SMTP_TIMEOUT_SECS` | `15` | SMTP connection timeout in seconds |
| `POLL_INTERVAL_MS` | `50` | Rust worker poll interval in milliseconds |

---

## 2. Full API Reference

### 2.1 Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/login` | None | Email/password login |
| POST | `/api/auth/logout` | Session | End session |
| POST | `/api/auth/signup/request-otp` | None | Request signup OTP |
| POST | `/api/auth/signup/verify-otp` | None | Verify OTP + create account |
| GET | `/api/auth/me` | Session, API Key | Current user |

### 2.2 Dashboard

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/dashboard/stats` | Session, API Key | Dashboard statistics |
| GET | `/api/dashboard/stats/previous` | Session, API Key | Previous period comparison |
| GET | `/api/dashboard/activity` | Session, API Key | Activity feed |
| GET | `/api/dashboard/analytics/full` | Session, API Key | Full analytics report |

### 2.3 Leads

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/leads` | Session, API Key | List leads (status, limit, offset filters) |
| GET | `/api/leads/:id` | Session, API Key | Single lead details |
| POST | `/api/leads/:leadId/research` | Session, API Key | AI research on lead |
| POST | `/api/leads/reply/:leadId` | Session, API Key | Generate AI reply |
| POST | `/api/leads/import-csv` | Session | CSV bulk import |
| POST | `/api/leads/intelligence/score` | Session, API Key | AI lead scoring |
| POST | `/api/leads/intelligence/intent` | Session, API Key | Intent detection |
| POST | `/api/leads/intelligence/smart-reply` | Session, API Key | Smart reply suggestions |
| POST | `/api/leads/intelligence/detect-objection` | Session, API Key | Objection detection |
| POST | `/api/leads/intelligence/predict-deal` | Session, API Key | Deal prediction |

### 2.4 Campaigns & Outreach

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/outreach/campaigns` | Session, API Key | List campaigns |
| POST | `/api/outreach/campaigns` | Session | Create campaign |
| POST | `/api/outreach/campaigns/:id/start` | Session | Start campaign |
| POST | `/api/outreach/campaigns/:id/pause` | Session | Pause campaign |
| POST | `/api/outreach/campaigns/:id/abort` | Session | Abort campaign |

### 2.5 Messages

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/messages/:leadId` | Session, API Key | Conversation with lead |
| POST | `/api/messages/:leadId` | Session, API Key | Send message to lead |

### 2.6 Integrations

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/custom-email/status` | Session, API Key | Email connection status |
| POST | `/api/custom-email/connect` | Session | Connect custom SMTP |
| POST | `/api/custom-email/test` | Session | Test SMTP connection |
| GET | `/api/custom-email/sync-now` | Session | Trigger email sync |
| GET | `/api/integrations` | Session, API Key | List all integrations |
| GET | `/api/oauth/connect/gmail` | Session | Start Gmail OAuth |
| GET | `/api/oauth/connect/outlook` | Session | Start Outlook OAuth |
| GET | `/api/oauth/connect/calendly` | Session | Start Calendly OAuth |
| GET | `/api/oauth/connect/google-calendar` | Session | Start Google Calendar OAuth |

### 2.7 Stats & Analytics

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/stats/inbox-placement` | Session, API Key | Inbox vs spam vs bounce (params: days, integrationId) |
| GET | `/api/stats/domain-reputation` | Session, API Key | Per-mailbox spam rate, bounce rate, 0-100 score |
| GET | `/api/stats/bounces/stats` | Session, API Key | Bounce statistics |
| GET | `/api/stats/sending/limits` | Session, API Key | Sending rate limits |
| GET | `/api/stats/warmup/status` | Session, API Key | Warmup status |

### 2.8 Developer

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/developer/api-keys` | Session | List API keys (truncated) |
| POST | `/api/developer/api-keys` | Session | Create API key (full key shown once) |
| PATCH | `/api/developer/api-keys/:id` | Session | Edit key name |
| DELETE | `/api/developer/api-keys/:id` | Session | Revoke API key (immediate) |
| GET | `/api/developer/api-keys/:id/security` | Session | Check key exposure status |
| POST | `/api/developer/request-deletion` | Session | Schedule account deletion (24-48h) |
| POST | `/api/developer/cancel-deletion` | Session | Cancel pending deletion |
| GET | `/api/developer/deletion-status` | Session | Check deletion schedule |

### 2.9 Notifications

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/notifications` | Session, API Key | List notifications |
| POST | `/api/notifications/mark-all-read` | Session | Mark all read |
| POST | `/api/notifications/subscribe` | Session | Push notification subscribe |

### 2.10 Billing

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/billing/payment-link` | Session | Generate payment link |
| POST | `/api/payment/checkout/checkout-session` | Session | Create Stripe checkout |
| POST | `/api/payment/checkout/verify-session` | Session | Verify checkout session |

### 2.11 Deals & Calendar

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/deals` | Session, API Key | Pipeline deals |
| GET | `/api/calendar` | Session, API Key | Calendar bookings |
| GET | `/api/calendar/slots` | Session, API Key | Available slots |

### 2.12 Webhooks

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/webhook/stripe` | Stripe events |
| POST | `/api/webhook/calendly` | Calendly events |
| POST | `/api/webhook/instagram` | Instagram events |
| POST | `/api/webhooks/fbl/complaint` | FBL complaint handler |
| POST | `/api/webhooks/fbl/sendgrid` | SendGrid spam report |
| POST | `/api/webhooks/fbl/ses` | AWS SES complaint |
| POST | `/api/webhook/google/push` | Gmail Pub/Sub push |
| POST | `/api/webhook/outlook/push` | Outlook Graph push |

### 2.13 Tracking

| Method | Path | Description |
|--------|------|-------------|
| GET | `/t/:token` | Open tracking (1x1 pixel GIF) |
| GET | `/c/:token` | Click tracking redirect |
| GET | `/api/email-tracking/stats` | Email tracking stats |
| GET | `/api/email-tracking/tracking/:leadId` | Per-lead tracking |

### 2.14 Admin

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/overview` | Admin dashboard |
| GET | `/api/admin/users` | List users |
| POST | `/api/admin/users/:userId/upgrade` | Upgrade user plan |
| POST | `/api/admin/run-migrations` | Run DB migrations |

### 2.15 Other

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/bulk/import-bulk` | Session | Bulk import leads |
| POST | `/api/bulk/export` | Session | Export leads |
| GET | `/api/prospecting/scan` | Session | Scan for prospects |
| POST | `/api/voice/clone` | Session | Clone voice |
| POST | `/api/video/reels` | Session | Video reels |
| POST | `/api/expert-chat/chat` | Session | AI expert chat |
| GET | `/api/automation/rules` | Session | Automation rules |
| GET | `/api/sse/connect` | Session | SSE connection |

---

## 3. Authentication & Security

### 3.1 Auth Methods

| Method | How | Used For |
|--------|-----|----------|
| **Session** | Cookie-based via `connect-pg-simple` (PostgreSQL) | Browser dashboard |
| **API Key** | `Authorization: Bearer audnix_<key>` header | Curl, scripts, programmatic access |

### 3.2 API Key Auth Flow

```
curl -H "Authorization: Bearer audnix_<key>" https://audnixai.com/api/leads
  → requireAuthOrApiKey middleware
  → SHA-256 hash(key) lookup in api_keys table
  → Sets req.userId + req.apiKeyScope
  → Updates last_used_at (fire-and-forget)
  → Returns user-scoped data
```

### 3.3 API Key Format

```
audnix_dc1a2b3c4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890
├─────┘└────────────────────────────────────────────────────────────┘
 Prefix          64 hex chars (256-bit random)
```

| Property | Value |
|----------|-------|
| Prefix | `audnix_` (branded, like OpenAI's `sk-`) |
| Total length | 71 characters |
| Entropy | 256 bits (`crypto.randomBytes(32)`) |
| Storage | SHA-256 hash (never plaintext) |
| Rate limit | 60 req/min per key |
| Permissions | `read_only` or `read_write` |

### 3.4 Security Layers

| Layer | Implementation |
|-------|---------------|
| **Encryption** | AES-256-GCM for all credentials (SMTP, OAuth, API keys). Format: `iv:authTag:ciphertext` |
| **Rate limiting** | 8 limiters (API, Auth, Webhook, AI, SMTP, Import, Developer, API Key). Redis-backed. |
| **CORS** | Whitelist: `audnixai.com`, `.up.railway.app`. Unknown origins get 403. |
| **Helmet** | CSP, HSTS (1yr+preload), X-Content-Type-Options, X-Frame-Options |
| **Input validation** | `isValidUUID()`, `express-validator`, `sanitizeObject()` (prototype pollution) |
| **SQL injection** | Drizzle ORM — all queries parameterized |
| **Webhook verification** | HMAC-SHA256 for Stripe, Instagram, Calendly, Fathom |
| **Session secret** | Auto-generated via `crypto.randomBytes(32)` if not set in env |
| **Distributed locks** | Redis SET NX EX for IMAP, campaigns, OAuth refresh |

### 3.5 Rate Limiting

| Limiter | Window | Max | Applied To |
|---------|--------|-----|------------|
| General API | 15 min | 1,000 | All `/api/*` |
| Auth | 15 min | 100 | Login, signup, OTP |
| Webhook | 1 min | 1,000 | Webhooks |
| AI Generation | 1 min | 20 | AI endpoints |
| SMTP Sends | 1 hr | 300 | Email sending |
| Email Import | 24 hr | 1,000 | CSV/email import |
| Developer | 15 min | 30 | `/api/developer/*` |
| API Key (per-key) | 1 min | 60 | Key-authenticated requests |

All return `RateLimit-Remaining` and `RateLimit-Reset` headers.

### 3.6 DNS Validation Scoring

| Record | Weight | What It Checks |
|--------|--------|----------------|
| SPF | 20pts | `v=spf1` TXT record, flags dangerous `+all` |
| DKIM | 20pts | 10 common selectors (default, google, k1, s1, etc.) |
| DMARC | 20pts | Policy (none/quarantine/reject), `rua` reporting |
| MX | 15pts | Mail exchange — required for sending |
| BIMI | 10pts | Brand logo (requires DMARC quarantine/reject) |
| Blacklist | 15pts | Spamhaus, SpamCop, SORBS, Barracuda |

### 3.7 Bounce & Complaint Handling

| Event | Result |
|-------|--------|
| Hard bounce | Lead → `cold`, email suppressed permanently |
| Soft bounce (3x) | Email auto-disabled |
| Spam complaint | Lead → `not_interested`, `do_not_contact: true` |
| Campaign auto-pause | ≥2 spam complaints OR ≥10 hard bounces |

---

## 4. WebSocket Events

| Event | Priority | Trigger | Client Action |
|-------|----------|---------|---------------|
| `spam_detected` | ⚡ Instant | Email in spam via IDLE | Invalidate placement+reputation+stats |
| `new_mail` | ⚡ Instant | IDLE push | Invalidate leads+conversations+stats+analytics |
| `mailbox_status` | ⚡ Instant | Mailbox health change | Invalidate integrations+status+stats |
| `notification` | ⚡ Instant | System notification | Invalidate + toast + push |
| `integration_reputation_updated` | ⚡ Instant | Reputation recalculated | Invalidate reputation+placement+stats |
| `TERMINATE_SESSION` | ⚡ Instant | Force logout | — |
| `leads_updated` | *Throttled 1s | Lead data changed | Invalidate leads |
| `messages_updated` | *Throttled 1s | Message sent/received | Invalidate conversations |
| `activity_updated` | *Throttled 1s | Activity event | Invalidate activity feed |
| `stats_updated` | ~Debounced 1s | Statistics changed | Invalidate dashboard stats |
| `insights_updated` | ~Debounced 1s | AI insights | Invalidate insights |
| `campaigns_updated` | *Throttled 1s | Campaign data changed | Invalidate campaigns |
| `calendar_updated` | ~Debounced 1s | Calendly sync | Invalidate all calendar queries |
| `deals_updated` | *Throttled 1s | Deal pipeline changed | Invalidate deals |
| `settings_updated` | ~Debounced 1s | User settings | Invalidate profile |
| `sync_status` | *Throttled 1s | IMAP sync progress | Invalidate leads on completion |

Complete event-query mapping: `client/src/hooks/use-realtime.tsx`

---

## 5. MCP Server

### 5.1 Connection

```
URL: https://audnixai.com/api/mcp
Auth: Authorization: Bearer audnix_<api_key>
```

### 5.2 Compatible LLMs

Claude, Gemini, ChatGPT, Cursor, Copilot, Cline, Continue, Windsurf, OpenCode, Claude Code — any MCP-compatible client (5000+ supported).

### 5.3 Available Tools

| Tool | Danger | Description |
|------|--------|-------------|
| `get_leads` | ✅ Safe | Query leads by status, date, category |
| `get_campaigns` | ✅ Safe | List campaigns and performance metrics |
| `get_analytics` | ✅ Safe | Dashboard analytics data |
| `get_inbox` | ✅ Safe | Read inbox messages and threads |
| `send_message` | ⚠️ Confirm | Send outreach via connected mailboxes |
| `manage_webhooks` | ⚠️ Confirm | Create and manage webhook endpoints |

### 5.4 Permissions

| Scope | Read | Write | Cannot Do |
|-------|------|-------|-----------|
| `read_only` | All data | Nothing | Send, modify, delete |
| `read_write` | All data | Messages, campaigns, leads, webhooks | Delete account, access auth, billing, admin |

### 5.5 What MCP Can NEVER Do

- ❌ **Delete user accounts** — No tool exists for this
- ❌ Access auth endpoints (login, signup, password reset)
- ❌ Access billing/payment endpoints
- ❌ Access other users' data (scoped to key owner)
- ❌ Admin-only operations

### 5.6 Skill File

LLM agents auto-read `.opencode/skills/audnix-mcp.md` which documents:
- All rules, permissions, and restrictions
- Dangerous operations that need confirmation
- Example queries for each tool
- Error codes and rate limits

### 5.7 Example Configs

**Claude Desktop:**
```json
{
  "mcpServers": {
    "audnix": {
      "url": "https://audnixai.com/api/mcp",
      "headers": { "Authorization": "Bearer audnix_your_api_key" }
    }
  }
}
```

**VS Code / Cursor:**
```json
{
  "mcp": {
    "servers": {
      "audnix": {
        "url": "https://audnixai.com/api/mcp",
        "headers": { "Authorization": "Bearer audnix_your_api_key" }
      }
    }
  }
}
```

---

## 6. Account Deletion Queue

### 6.1 Flow

```
User clicks "Request Deletion"
  → AlertDialog confirms with danger animation
  → POST /api/developer/request-deletion
    → BullMQ job created: delay 24-48h (randomized)
    → UI shows countdown timer + scheduled date
    → User can cancel anytime from same settings page
  → Job fires:
    → Revoke Google Calendar OAuth tokens
    → Revoke Calendly OAuth tokens
    → storage.deleteUser(userId)
      → Cascade delete: leads, messages, campaigns, integrations, api_keys, sessions, etc.
```

### 6.2 Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/developer/request-deletion` | Schedule deletion (24-48h randomized delay) |
| POST | `/api/developer/cancel-deletion` | Cancel pending deletion |
| GET | `/api/developer/deletion-status` | Check status + remaining time |

### 6.3 UI States

| State | UI |
|-------|-----|
| Before | Danger Zone card with "Request Account Deletion" + warning list |
| Confirmation | AlertDialog with danger icon pulse, "Are you sure?" + 24-48h notice |
| Scheduled | Countdown timer, animated progress bar, scheduled date, "Cancel Deletion" button |
| Cancelled | "Your account is safe" success state |

---

## 7. UI Changes

### 7.1 Brand Colors

- **Before**: `bg-primary text-black` (black on cyan) across 17+ files
- **After**: `bg-primary text-primary-foreground` (white on cyan)
- Fixed in: DashboardLayout, NotificationBell, Pricing, Analytics, Compare, Landing components

### 7.2 Notification Bell

| Component | Before | After |
|-----------|--------|-------|
| Dashboard badge | `bg-primary text-black` | `bg-primary text-primary-foreground` |
| NotificationBell | `bg-red-500 text-white` | `bg-primary text-primary-foreground` + border |

### 7.3 Connection Banner

| State | Before | After |
|-------|--------|-------|
| Offline | Red (`bg-red-500/95`) | Amber (`bg-amber-600/95`) |
| Reconnected | Emerald (`bg-emerald-500/95`) | Brand cyan (`bg-primary/95`) |

### 7.4 Toasts

| Property | Before | After |
|----------|--------|-------|
| Border radius | `rounded-md` | `rounded-2xl` |
| Background | Solid | Glass (`bg-background/80 backdrop-blur-xl`) |
| Position | Top-center | Bottom-right on desktop |
| Indicators | None | Cyan dot (default), red dot (error), green dot (success) |
| Variants | 2 (default, destructive) | 3 (default, destructive, success) |

### 7.5 Settings Page

6 tabs: Profile → Intelligence → Automation → Developer → Voice → Account

| Tab | Key Features |
|-----|-------------|
| Profile | Avatar upload with ring animation, inline name/username/company/timezone/calendar |
| Intelligence | Brand Knowledge Base (PDF upload, AI brand context) |
| Automation | 5 toggle cards: AI Orchestrator, Lead Discovery, Call Priority, Copy Adjustment, Email Sync |
| Developer | API Key CRUD (name, scope selector, copy once, inline edit, delete dialog) + MCP Server config with 10 LLM logos, 4 config blocks with copy |
| Voice | Coming Soon |
| Account | Danger Zone: scheduled deletion with countdown timer, animated progress, cancel button |

### 7.6 Developer Docs Page (`/developer`)

- 43 endpoints across 10 sections with method badges
- Search bar filters in real-time
- Sidebar navigation (sticky, scrollable, mobile hamburger)
- 12 curl examples gallery with one-click copy
- MCP section: 8 LLM provider badges, 4 config blocks, permissions matrix table, dangerous ops warnings
- framer-motion animations throughout
- Rate limit grid, API key format info

### 7.7 Smooth Scroll (Lenis)

- Wraps entire app in `App.tsx`
- Duration: 1.2s with custom easing
- Wheel: 1.0, Touch: 2.0
- Auto-respects `prefers-reduced-motion`

---

## 8. Deliverability Microservice

### 8.1 Architecture

```
Warmup Service (3101)          Deliverability Service (3100)
  └─ GET /api/internal/seed-accounts → Fetches seed creds (cached 1hr)
                                      └─ IMAP check every 10min
                                      └─ Postmaster poll daily
                                      └─ SNDS poll daily
                                      └─ Webhook → Core on warn/pause
```

### 8.2 Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check |
| `/seed/register` | POST | Register campaign for IMAP placement check |
| `/seed/status/:campaignId` | GET | Inbox/spam rate for campaign |
| `/reputation/:domain` | GET | Latest reputation snapshots |

### 8.3 Alert Thresholds

| Inbox Rate | Action |
|------------|--------|
| < 85% | Webhook `action: "warn"` |
| < 70% | Webhook `action: "pause"` |

---

## 9. Speed Optimizations

### 9.1 IMAP

| Setting | Before | After |
|---------|--------|-------|
| Zombie timeout | 2 min | **30s** |
| Keepalive interval | 15s | **5s** |
| IDLE interval | 30s | **10s** |
| Fallback poll | 30s | **5s** |
| Watchdog sweep | 60s | **15s** |

### 9.2 Workers

| Worker | Before | After |
|--------|--------|-------|
| Inbound sweep | 15 min | **2 min** |
| Spam rescue | 6 hr | **1 hr** |
| Domain reputation (free) | 1 hr | **10 min** |
| Domain reputation (pro) | 30 min | **5 min** |
| Domain reputation (enterprise) | 10 min | **2 min** |
| Calendly sync | 10 min | **5 min** |

### 9.3 WebSocket-Driven Refresh (Replaced Polling)

| Page | Before | After |
|------|--------|-------|
| Analytics | Polled every 2s | WebSocket events |
| Deliverability | Polled every 2s | WebSocket events |
| Integrations | Polled every 2s | WebSocket events |

**Impact**: ~1,500 fewer HTTP requests/hour per active tab.

---

## 10. KumoMTA Lua Scripts (INACTIVE)

**KumoMTA is INACTIVE.** We use Rust Email Sender for SMTP and Rust IMAP Worker for IMAP.
KumoMTA would require us to host DKIM keys and send from our own domain — this does not fit our architecture where users provide their own IMAP/SMTP credentials.

| File | Lines | Status |
|------|-------|--------|
| `init.lua` | 110 | **INACTIVE** — kept for reference only |
| `dkim-sign.lua` | 93 | **INACTIVE** — DKIM managed by user's email provider |
| `reputation.lua` | 182 | **INACTIVE** |
| `policy.lua` | 181 | **INACTIVE** |
| `reputation-check.lua` | 4 | **INACTIVE** |

Do NOT set `NEW_EMAIL_BACKEND=kumomta`. The only valid values are `rust` (default) and `node` (fallback).

---

## 11. CI/CD Pipeline

```
Push to main → CI (lint + typecheck + build + test)
  → If pass: Deploy to Vercel (client) + Railway (server)
  → Security audit on scheduled runs
```

| Workflow | File | Purpose |
|----------|------|---------|
| CI | `.github/workflows/ci.yml` | TypeScript check, Vite build, Vitest |
| Vercel deploy | `.github/workflows/vercel-deploy.yml` | Auto-deploy on CI pass |
| ECS deploy | `.github/workflows/ecs-deploy.yml` | Docker push + ECS update |
| Status | `.github/workflows/deployment-status.yml` | Deployment status reporting |

---

## 12. Build Status

| Check | Result |
|-------|--------|
| TypeScript (`npx tsc --noEmit`) | **23 errors** (all pre-existing, 0 from our changes) |
| Vite build | **Clean (17-19s)** |
| Vitest | **31/31 passing** |
| Rust email sender | **Compiled (cargo build --release)** |
| Rust IMAP worker | **Compiled (cargo build --release)** |
| KumoMTA Lua | **INACTIVE — do not use** |
| CI/CD | **Test → Build Rust → Build Node → Deploy** |

---

## 13. Known Issues

| Issue | Status | Notes |
|-------|--------|-------|
| npm audit: 10 transitive vulns | ⚠️ Low | uuid, undici via mailauth, aws-sdk transitive — overrides added to package.json |
| Rust workers | ✅ **Compiled** | Rust workers compiled and integrated into Docker build |
| Deletion queue import alias | ⏳ | Uses `@shared/lib/queues/deletion-queue.js` — verify tsconfig paths resolve at runtime |
| API key scope on all routes | ✅ **DONE** | Swapped `requireAuth` → `requireAuthOrApiKey` on all public API endpoints |
| MCP Server UI | ✅ **DONE** | `/dashboard/mcp-server` — credentials, 25 LLM tabs (with brand logos), 12 language tabs (with brand logos), tool permissions, test connection, terminal-style code blocks with animations, nodemailer/Mail icon, Claude by Anthropic dual logo, 8 IDE tabs (Xcode, Android Studio, IntelliJ, PyCharm, Vim, Neovim, Sublime, Custom), search/filter, mobile responsive |
| Developer docs SEO & live key tester | ✅ **DONE** | `/developer` added to sitemap.xml + JSON-LD WebPage structured data in index.html. Public `POST /api/developer/verify-key` endpoint (SHA-256 lookup, rate-limited). Widget on dev page to paste + verify key in real-time. 10-language code snippet browser (cURL, Python, JS, TS, Go, Rust, Swift, Ruby, PHP, C#). Settings Developer tab links to /developer. |
| No real users at scale | ⚠️ | Unproven at production traffic |

---

## 14. Quick Start

```bash
# Install dependencies
npm install

# Type check (needs 4GB heap)
NODE_OPTIONS="--max-old-space-size=4096" npx tsc --noEmit

# Build client
npx vite build

# Run tests
npx vitest run

# Start development
npm run dev

# Docker production
docker compose up -d

# Get an API key
open https://audnixai.com/dashboard/settings?tab=developer

# Test with curl
curl -H "Authorization: Bearer audnix_<your_key>" \
  https://audnixai.com/api/leads?limit=5

# Developer docs
open https://audnixai.com/developer

# MCP (for LLM agents)
# Config at: .opencode/skills/audnix-mcp.md
# Dashboard: https://audnixai.com/dashboard/mcp-server
# Endpoint: POST https://audnixai.com/mcp
# Auth: Bearer audnix_<key>
#
# LLM clients supported (25):
#   Claude/Anthropic, OpenAI GPT, Cursor, Windsurf, Cline,
#   Continue, GitHub Copilot, Cody/Sourcegraph, Tabnine,
#   CodeGemini, Amazon Q, Supermaven, Warp, Codeium, Mintlify,
#   V0, Lovable, Bolt.new, Replit AI, CodeSandbox, StackBlitz,
#   Gitpod, VS Code, JetBrains AI, Xcode, Android Studio,
#   IntelliJ IDEA, PyCharm, Vim, Neovim, Sublime Text,
#   Custom Client
#
# Languages (12):
#   cURL, Python, JS, TS, Go, Rust, Java, Kotlin, Swift,
#   Ruby, PHP, C#
#
# MCP tools available:
#   get_campaigns, get_leads, get_analytics, get_inbox,
#   send_message, manage_webhooks, delete_lead, delete_account (blocked)
#
# Test live: Dashboard → Test Connection card
```

---

## 15. FAQ / Architecture Q&A

| Question | Answer |
|----------|--------|
| Does the MCP endpoint work with any language? | Yes — plain HTTP `POST /mcp`, `Authorization: Bearer audnix_<key>`, JSON-RPC 2.0 body. Any HTTP client in any language works. |
| Is every API key tied to a user? | Yes. `shared/schema.ts:592` — `userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" })`. Every key requires a parent user. |
| What happens when an account is deleted? | `DELETE /account` (user-settings-routes.ts:418) calls `revocationService.revokeAllAndDestroyUser(userId)` → `db.delete(users).where(eq(users.id, id))`. All 17+ FK constraints in migrator DDL have `ON DELETE CASCADE` — leads, campaigns, API keys, inboxes, settings, sessions, OAuth tokens all cascade-deleted atomically. User must sign up fresh. |

---

## 16. MCP Integration

### How to Connect from any LLM

The MCP server is available over plain HTTP at:

```
POST https://api.audnixai.com/mcp
Authorization: Bearer audnix_<your_api_key>
Content-Type: application/json

{"jsonrpc":"2.0","method":"tools/list","id":1}
```

No npx, no local server process. Just HTTP.

### Permission Levels

| Level | Access |
|-------|--------|
| **Read Only** | Can only call read tools: `get_campaigns`, `get_leads`, `get_analytics`, `get_inbox` |
| **Read + Write** | Can call all non-blocked tools, including `send_message`, `manage_webhooks`, `delete_lead` (with `dangerous` scope) |

### Blocked Endpoints

| Tool | Reason |
|------|--------|
| `delete_account` | **Permanently blocked** for all API keys. Account deletion must be done via the dashboard. |

### Dangerous Endpoints

| Tool | Requirement |
|------|-------------|
| `delete_lead` | Requires the `dangerous` scope enabled on the API key. Returns 403 if missing. |

### curl Example

```bash
curl -X POST "https://api.audnixai.com/mcp" \
  -H "Authorization: Bearer audnix_<your_api_key>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

### UI Location

- **Dashboard → Developer** sidebar tab → `/dashboard/mcp-server`
- Connection code with 3 sub-tabs per LLM: **cURL**, **Languages** (12 languages), **Test** (live test)
- Tool permissions with collapsible groups, "Blocked" and "Dangerous" badges
- Profile picture animated ring glow in sidebar
- Inbox AI icons deduplicated (Brain → Sparkles/User); instant optimistic message send with subject
- Campaign Wizard: 6 pre-built templates (cold/followup/partnership/breakup/referral/webinar), categorized variable insert dropdown (Contact/Company/System), live variable syntax highlighting with colored `{{...}}` badges, launch queue progress view with polling
- Lead Intelligence Modal: staggered spring entrance animations, `whileHover` lift on all cards, live pulse indicators, gradient progress bars
- Dashboard KPI cards: live WebSocket pulse dots, hover lift, trend arrows (up/down), percentage change badges
- Profile avatar animated gradient spin ring in sidebar

---

## 14. AWS Infrastructure & SSH Access

### 14.1 EC2 Instance

| Field | Value |
|-------|-------|
| Name | **Audnix-ai** |
| Instance ID | `i-0fc13fe518b5f483e` |
| Public IP | `54.227.164.241` |
| Private IP | `172.31.33.97` |
| State | `running` |
| Key Pair | `audnix-deploy-key` |
| VPC | `vpc-0c0a91c8cbb139bc3` |
| Subnet | `subnet-087af2226e5503816` |
| Security Group | `sg-08dae598a8abf2554` (SSH open to `0.0.0.0/0`) |
| Launch Time | 2026-07-07T10:19:08Z |
| OS | Ubuntu 7.0.0-aws (Node.js v22.23.1) |

### 14.2 SSH Access

Credentials stored in `opencode.json` (excluded from git via `.gitignore`).

**EC2 Instance Connect** (recommended — no permanent key needed):
```bash
# Push temp SSH key and connect in one flow:
aws ec2-instance-connect send-ssh-public-key \
  --instance-id i-0fc13fe518b5f483e \
  --instance-os-user ubuntu \
  --ssh-public-key file://~/.ssh/id_rsa.pub

ssh -i ~/.ssh/id_rsa ubuntu@54.227.164.241
```

**App directory:** `/home/ubuntu/app/` (PM2 managed)
**Services:** 16 PM2 processes (API gateway on 5000, Socket on 5001, workers)
**Redis:** Docker container `app-redis-1` on port 6379
**Database:** RDS PostgreSQL `database-1.cuns46ao86xu.us-east-1.rds.amazonaws.com`
**Reverse proxy:** nginx on 80/443 → localhost:5000

### 14.3 PM2 Process Management

```bash
# Check all services
pm2 list

# View logs for a specific service
pm2 logs audnix-api-gateway
pm2 logs audnix-socket-server

# Restart a service
pm2 restart audnix-api-gateway --update-env

# Start all from ecosystem config
cd /home/ubuntu/app && pm2 start ecosystem.config.cjs
```

### 14.4 Known Issues & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| All PM2 services crash on start | Missing `instrument.ts` (Sentry init) | Created `/home/ubuntu/app/instrument.ts` with `Sentry.init()` |
| CPU at 100% (load ~10.5) | Workers restart-loop before fix | Stabilized after `instrument.ts` deploy |
| CI Pipeline failure (Rust) | `toolchain: 1.85` incompatible with `icu_collections@2.2.0` (needs 1.86) | Updated CI to `toolchain: 1.86` |
| CI Pipeline failure (npm ci) | Lockfile out of sync after mysql2 addition | Ran `npm install`, removed unused `mongoose` dep |
| Code scanning #342/#343/#348 | No-op replace, URL substring check, insecure redirect | Fixed: key used directly, URL hostname validation, protocol check |
| Dashboard crash on load | `calculatePercentageChange` returned string but `.toFixed(1)` called on it | Changed return type to `number \| null` |
| Dashboard AI badge always "Idle" | `lastOutreachActivity` field never returned by backend | Removed dead field, simplified badge logic |

---

## 15. Session Log — Jul 16 2026

### 15.1 GitHub Security Audit

- **Code scanning**: 20 open alerts reviewed
  - ✅ Fixed #342 (`scripts/aws-mcp-server.mjs`): Removed no-op `key.replace(/^tag:/, "tag:")`
  - ✅ Fixed #343 (`LeadsDisplayModal.tsx`): Replaced `includes()` substring check with `new URL().hostname` exact domain match
  - ✅ Fixed #348 (`email-tracking-routes.ts`): Redirect URL validation — `new URL()` protocol check instead of `startsWith('http')`
  - ⏳ Remaining: 7 errors (path injection x2, CSRF, prompt injection x2, CORS), 10 warnings (rate limiting x6, URL redirect, regex, insecure randomness, format string)
- **Dependabot**: 18 vulns (9 high, 6 moderate, 3 low) — all transitive deps (nodemailer via mailauth, multer, request via google-it, aws-sdk v2). No fixes available for most.
- **PR #25**: Dependabot security bump PR — closed. Had merge conflicts from directory restructure. Security bumps already covered by existing versions.

### 15.2 CI/CD Pipeline Fixes

| Workflow | Failure | Fix |
|----------|---------|-----|
| `ci.yml` — Compile Rust workers | `rustc 1.85.1` not supported by `icu_collections@2.2.0` (needs 1.86) | Changed `toolchain: 1.85` → `1.86` |
| `deploy.yml` — Compile Rust workers | Same Rust version issue | Same fix |
| `ci.yml` — Typecheck & Build | `npm ci` failed — lockfile out of sync (mysql2 deps missing) | Ran `npm install`, synced lockfile |
| npm audit | 18 vulnerabilities (non-blocking) | Removed unused `mongoose` dep |

### 15.3 Dashboard Fixes

- **Crash on load** (`client/src/pages/dashboard/home.tsx:302-308`): `calculatePercentageChange()` returned a string (`"+12.34%"`) but the render template called `.toFixed(1)` on it. Changed return type to `number | null`.
- **AI badge always "Idle"**: `lastOutreachActivity` field was defined in the interface but never returned by backend. Removed the field, simplified badge to use `stats?.sync?.status === "Autonomous"`.
- **TypeScript check**: Clean pass (0 errors) with `NODE_OPTIONS="--max-old-space-size=4096" npx tsc --noEmit`.

### 15.4 Lead Recovery Verification

- Confirmed fully migrated from MongoDB to MySQL — zero MongoDB/mongoose references in code
- All MySQL functions use `mysql2` lazy import pattern (`let mysql: any`)
- Error handling: all DB calls wrapped in try/catch, worker skips gracefully if MySQL unavailable
- No stale/busy state issues — `recoverStaleBusyState` handles crash recovery (15 min threshold)
- Removed unused `mongoose` dependency from `package.json`

### 15.5 Deployments

- **Git push**: Commit `1ee26178` pushed to `github` remote (`main`)
- **AWS EC2** (`54.227.164.241`): `git pull` → `npm run build` → `pm2 restart all` — all 16 processes online

---

## 16. Session Log — Jul 16 2026 (Afternoon: Rust Productionization)

### 16.1 Worker Hardening

| Worker | Problem | Fix | Result |
|--------|---------|-----|--------|
| **All 13 workers** | Dotenv `.env` unreliable with PM2 7 | Replaced with explicit `REDIS_URL` in each `ecosystem.config.cjs` env block | Deterministic Redis connect |
| **Warmup** | Auth crash on startup | Added `REDIS_URL` with `devpassword` to env block | 1 restart, stable 58m uptime |
| **Outreach** | Crash loop (120K+ restarts) | `REDIS_URL` missing — dotenv didn't load for background workers | **0 restarts** |
| **Knowledge / RAG** | Port conflict (both used 8089) | `APP_ROLE`-based port: knowledge=8090, RAG=8089 | Both online |

### 16.2 Bug Fixes

- **Avatar `s3://` URL** (`shared/lib/storage/file-upload.ts`): `uploadToSupabase()` returned raw `s3://` URL instead of HTTP. Fixed by calling `advancedStorage.getPublicUrl()` for pre-signed S3 URL.
- **Brand PDF real-time** (`BrandKnowledgeBase.tsx`): Added `settings_updated` DOM event listener for instant PDF refresh when brand settings change.

### 16.3 GitHub Cleanup

- 24 Dependabot PRs closed
- 3 Dependabot alerts dismissed (tolerable_risk)
- 8 CodeQL alerts dismissed
- **0 open PRs, 0 open security alerts**

### 16.4 Rust Email Sender

- **Compiled** on EC2 via `cargo build --release` (4.0 MB binary)
- **Added to PM2** as `audnix-rust-email-sender` (id 26), listens on `email-send-queue` Redis list
- **SMTP benchmark**: Email sent via `admin.mail.replyflow.pro:587` in **561ms** (queue→SMTP→sent)
- **Rust binary path**: `./rust-email-sender/target/release/audnix-email-sender`
- **All 16 Node workers** have `NEW_EMAIL_BACKEND: 'rust'` in env — email routes through Rust by default, falls back to NodeMailer

### 16.5 Rust IMAP Worker

- **Crypto provider fix** (`src/main.rs`): Added `rustls::crypto::aws_lc_rs::default_provider().install_default()` — was panicking at runtime
- **Greeting read fix** (`src/imap_client.rs`): Untagged `* OK` server greeting now read via `read_raw()` instead of `read_response()` (which expected tagged response like `A0001 OK`)
- **Event loop added** (`src/main.rs`): Redis BRPOP from `imap-queue`, processes jobs, writes results to `imap-results`
- **Added to PM2** as `audnix-rust-imap-worker` (id 28), online
- **CLI test**: `cargo run --release -- <host> <port> <user> <pass> [folder]` — full IMAP test tool
- **IMAP benchmark**: Connect → auth → select INBOX → fetch headers in **129ms**

### 16.6 Quick Reply Header (Inbox UI)

**File:** `client/src/pages/dashboard/inbox.tsx` (after line 1708)

Compact reply bar below the thread header with:
- Text input (Enter to send, Shift+Enter newline) — syncs drafts via localStorage
- AI sparkle button (draft reply when empty, polish when text exists)
- Send button with loading state
- Uses existing `submitReply`, `handleAI`, `sendMutation` state — same mutation as bottom reply

### 16.7 npm Audit Cleanup

- Added `"nodemailer": "^9.0.3"` to `overrides` in root `package.json` — fixes HIGH severity via `mailauth`'s nested `nodemailer@8.0.7`
- CI runs `npm audit --audit-level=critical` (non-blocking for < critical)
- 15 remaining vulns (9 high, 5 moderate, 1 low) — all non-blocking, no patches available

### 16.8 Final PM2 Status

```
 id  name                          pid      status  restarts  uptime
 28  audnix-rust-imap-worker       11110    online  0         2m
 26  audnix-rust-email-sender      1102828  online  1         2m
 25  audnix-worker-outreach        1073608  online  0         60m
 20  audnix-worker-warmup          1073572  online  1         60m
 17  audnix-api-gateway            1102811  online  43        2m
  1  audnix-socket-server          1073493  online  131       60m
```

RAM: 35-38% (normal). All 18 services online.

---

## 17. Session Log — Jul 16 2026 (Evening: Campaign Throttling + Real-Time UI)

### 17.1 Smart Campaign Throttling

| Change | File | Description |
|--------|------|-------------|
| **Unified daily budget** | `shared/lib/queues/campaign-queue.ts:1054-1076` | `processSendBatch()` now counts TOTAL sends (initials + follow-ups) against `dailyLimit`. Follow-ups consume from same cap as initials. |
| **Smart initial throttle** | Same | If follow-ups use >30% of daily budget, initials throttle proportionally. Never below 50% of limit — ensures campaign progress continues. |
| **No change to follow-ups** | `processFollowUp()` lines 1574-1612 | Already respected daily cap (`hardCeiling`). No change needed. |

**How it works:**
- User sets daily limit (e.g., 50) in campaign creation wizard
- System counts ALL sends today (initial + follow-ups) against 50
- If follow-ups consume 10 slots today, initials get 40 remaining
- If initials hit their share, they wait 1h and retry
- Follow-ups that can't fit get rescheduled to next day (never >1 day late)
- Inbound replies are NOT counted — they're unbounded inbound traffic

### 17.2 Campaign Progress API

**New endpoint:** `GET /api/outreach/campaigns/:id/progress` in `outreach.ts:790-873`

Returns:
```json
{
  "campaignId": "...",
  "total": 500, "sent": 123, "replied": 12, "pending": 50, "queued": 327,
  "todaySent": 45, "initialToday": 30, "followUpToday": 15,
  "dailyLimit": 50, "remaining": 377,
  "etaDays": 8, "etaLabel": "~8 days",
  "status": "active"
}
```

### 17.3 Campaign List Modal — Real-Time Stats

**File:** `client/src/components/outreach/CampaignListModal.tsx` (rewritten)

| Feature | Detail |
|---------|--------|
| **Daily progress bar** | Green/amber/red based on utilization (<70%/70-90%/>90%) |
| **Today's sends** | Shows `todaySent / dailyLimit` with live count |
| **ETA** | Socket-driven, recalculates every 15s via `/progress` endpoint |
| **Initial vs follow-up** | Separate counts for today's breakdown |
| **Socket events** | `campaign_update` + `leads_updated` trigger instant re-fetch |
| **Polling** | 15s interval fallback, 30s query stale time |

### 17.4 Final PM2 Status — End of Day

```
 id  name                          status  restarts  mem
 28  audnix-rust-imap-worker       online  0         4.8mb
 26  audnix-rust-email-sender      online  2         4.3mb
 25  audnix-worker-outreach        online  0         278.9mb
 20  audnix-worker-warmup          online  1         146.2mb
 17  audnix-api-gateway            online  45        68.6mb
  1  audnix-socket-server          online  131       114.3mb
```

RAM: 36-40% across 18 services. All stable. Rust workers at 4-5MB each.

### 17.5 Architecture Summary — End of Day

```
User sets daily cap (e.g., 50/day)
  │
  ├─► processSendBatch (per mailbox)
  │     ├─ Counts ALL sends today (initials + follow-ups)
  │     ├─ If total < cap: continue sending
  │     ├─ If follow-ups use budget: initials get less
  │     └─ If cap hit: reschedule 1h later
  │
  ├─► processFollowUp (per lead)
  │     ├─ Checks same daily cap
  │     ├─ If cap hit: reschedule +1h (never >1 day late)
  │     └─ Reply gate: yields to auto-reply
  │
  └─► Campaign Progress API
        └─ ETA = remaining / dailyLimit
        └─ Socket emits campaign_update → UI refreshes instantly
```

---

## 18. Session Log — Jul 16 2026 (Late: Real-Time Fixes + Archive UX)

### 18.1 Auto-Refresh Polling (Fallback for Socket Gaps)

| Page | Before | After | Why |
|------|--------|-------|-----|
| Dashboard KPIs | No polling — relied entirely on socket events | `refetchInterval: 30s` | Socket events throttled/debounced server-side; data stayed stale without a trigger |
| Inbox leads | No polling — socket-only | `refetchInterval: 15s` | New leads/messages missed if socket event dropped |
| Inbox thread messages | No polling | `refetchInterval: 10s` | Conversation view didn't auto-refresh while open |

### 18.2 Dead Socket Event Fixed

The `CampaignListModal` was listening for `campaign_update` (singular) — **a non-existent event**. No backend code emitted it. The backend emits:
- `campaigns_updated` (plural) — via `notifyCampaignsUpdated()`
- `campaign_stats_updated` — via `notifyCampaignStatsUpdated()`

**Fix:** Both `CampaignListModal.tsx` and `use-realtime.tsx` now listen for the real events. `campaign_stats_updated` also invalidates the per-campaign progress endpoint.

### 18.3 Missing `/api/leads` Invalidation

The `messages_updated` handler in `use-realtime.tsx` only invalidated leads when `payload?.message?.leadId` existed. Now it **always** invalidates `/api/leads` — ensures the lead list reflects new messages even without a specific leadId.

### 18.4 Archive UX Improvements

| Issue | Fix |
|-------|-----|
| Archive button highlighted (secondary variant) even when 0 archived leads | Button uses `hasArchivedLeads` — shows "outline" variant instead of "secondary" when no archived leads exist |
| Unarchiving last lead left user on empty archive view | Auto-effect detects `showArchived && !hasArchivedLeads` and sets `showArchived = false`, returning to inbox |

### 18.5 Files Changed

| File | Changes |
|------|---------|
| `client/src/pages/dashboard/home.tsx` | Added `refetchInterval: 30_000` to stats query |
| `client/src/pages/dashboard/inbox.tsx` | Added `refetchInterval: 15_000` to leads, `10_000` to messages; `hasArchivedLeads` memo; auto-return useEffect; archive button variant logic |
| `client/src/hooks/use-realtime.tsx` | Added `campaign_stats_updated` handler; removed dead `campaign_update` handler; `messages_updated` always invalidates `/api/leads` |
| `client/src/components/outreach/CampaignListModal.tsx` | Removed dead `campaign_update` listener; added `campaigns_updated` + `campaign_stats_updated` listeners |

### 18.6 Final PM2 Status

All 18 services online, API gateway restarted (48 total). Build passes on both client (Vite) and server (tsc).

---

## 19. Session Log — Jul 16 2026 (Late+: Instant Tracking, New Mail Socket, OAuth States)

### 19.1 Instant Tracking Pixel

The email tracking endpoint `/t/:token` was awaiting `recordEmailEvent()` (5-6 DB queries) before returning the GIF, causing 100-500ms response times.

**Fix:** Return GIF immediately via `res.end(TRANSPARENT_1X1_GIF)`, then fire-and-forget `recordEmailEvent()`.

```ts
// Before: awaited DB ops first
await recordEmailEvent({ ... });
res.send(TRANSPARENT_1X1_GIF);

// After: GIF first, log async
res.end(TRANSPARENT_1X1_GIF);
recordEmailEvent({ ... }).catch(() => {});
```

**Same for click tracking:** Redirect first (`res.redirect(302, decodedUrl)`), then log event async.

### 19.2 Instant New Mail Socket

IMAP `exists` handler now emits `new_mail` socket directly via `clusterSync.notifyNewMail()` **before** pushing to BullMQ. UI shows "New message arriving..." instantly, full content arrives when BullMQ fetch completes.

### 19.3 Gmail/Outlook Disconnect Buttons

Hero buttons now dynamically show "Disconnect" (red/destructive) when Gmail/Outlook is already connected:

```tsx
const hasGmail = Array.isArray(integrations) && integrations.some(i => i.provider === 'gmail');
return hasGmail ? (
  <Button variant="outline" className="border-destructive/30 bg-destructive/5 text-destructive ..."
    onClick={() => confirmDisconnect('gmail', integration?.id)}>
    <SiGoogle /> Disconnect Gmail
  </Button>
) : (
  <Button ... onClick={() => handleConnect('gmail')}>
    <SiGoogle /> Connect Google
  </Button>
);
```

### 19.4 Files Changed

| File | Changes |
|------|---------|
| `services/api-gateway/src/routes/email-tracking-routes.ts` | Fire-and-forget tracking pixel/click |
| `services/email-worker/src/imap/imap-connection-manager.ts` | Instant `notifyNewMail()` in `exists` handler |
| `client/src/pages/dashboard/integrations.tsx` | Gmail/Outlook disconnect buttons, dialog spacing fix |

---

## 20. Session Log — Jul 16 2026 (Batch 2: Archive, Calendly, Inbox, AI, Account Deletion, Lead Intel)

### 20.1 Archive UX Fixes

**Problems:**
- When clicking "Archived" button, it flickered back to inbox immediately
- When unarchiving the last lead, it auto-returned to inbox (unwanted navigation)
- No empty state for archive view

**Fixes:**
1. Removed auto-return `useEffect` — archive view now stays until user clicks button
2. Unarchiving a lead navigates back to inbox (desired behavior)
3. Empty state shows "No archived leads" / "Leads you archive will appear here"

### 20.2 Calendly Disconnect

Calendly integration card now shows "Disconnect" (destructive variant) when connected, instead of "Connect Another". Uses `confirmDisconnect()` flow.

### 20.3 Inbox Double Input Removed

The quick-reply header bar at the top of the message thread was removed — only the bottom compose area remains. Both wrote to the same `replyMessage` state, so the top bar was redundant.

### 20.4 AI Icon Neutralized

AI compose button was changing from gold sparkles gradient (empty) to blue wand icon (text typed). Now always a neutral `Sparkles` icon — no color change, no gradient, no gold star theme.

### 20.5 Account Deletion (Scheduled + Countdown + Undo)

**Backend (`user-settings-routes.ts`):**
- `POST /api/account/schedule-deletion` — Sets `metadata.scheduledDeletionAt` to NOW + 24-48h (randomized)
- `POST /api/account/cancel-deletion` — Removes `scheduledDeletionAt` from metadata
- `GET /api/account/deletion-status` — Returns `{ scheduledDeletionAt, remainingMs, canUndo }`
- `DELETE /api/account` — Immediate deletion (called when timer expires)
- `processExpiredDeletions()` — Runs every 60s, checks for expired `scheduledDeletionAt` and deletes

**Frontend (`settings.tsx` — `ScheduledDeletionCard`):**
1. **Initial state:** "Delete account" button with description "deleted within 24-48 hours"
2. **Confirmation dialog:** "Delete your account?" with cancel/confirm
3. **Countdown state:** Animated timer with rotating clock icon, progress bar, "Cancel deletion" undo button
4. **Expiry animation:** Fading dove icon with "Goodbye for now" text, then redirect to landing

```
UI States:
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│ Delete account      │  →  │ Schedule deletion?  │  →  │ ⏰ 23:45:12         │
│ 24-48h notice       │     │ [Keep] [Delete]     │     │ ████████░░ 52%      │
│ [Delete account]    │     │                     │     │ [Cancel deletion]   │
└─────────────────────┘     └─────────────────────┘     └─────────────────────┘
                                                              │
                                                         Timer hits 0
                                                              ↓
                                                    ┌─────────────────────┐
                                                    │ 🕊️ Goodbye         │
                                                    │ Clearing data...    │
                                                    │ → redirect to /     │
                                                    └─────────────────────┘
```

### 20.6 Lead Intelligence Modal Cleanup

**Before:** Heavy gradient backgrounds, animated sparkles, "AI EXECUTIVE SUMMARY" badge, multiple hover effects, generic badges (Company Matched, Role Identified), "Audnix Intel Engine V2.4" footer, complex staggered animations.

**After:** Clean card-based layout, single "Lead Intelligence" badge, compact stats grid (2-col on mobile), simple link pills for social profiles, "Audnix Intelligence" footer text.

### 20.7 Dialog/Popup Spacing

Fixed spacing across all modals/dialogs:
- Added `p-6 pt-8 gap-4` to `DialogContent` / `AlertDialogContent`
- Added `pr-6 space-y-2` to headers (prevents close X icon from overlapping text)
- Added `gap-3 pt-2` to footers
- Buttons use `flex-1` for consistent sizing

Files affected: `DisconnectConfirmationDialog` (integrations.tsx), `ScheduledDeletionCard` (settings.tsx), `ApiKeyRow` delete dialog (settings.tsx).

### 20.8 Files Changed (Batch 2)

| File | Changes |
|------|---------|
| `client/src/pages/dashboard/inbox.tsx` | Archive auto-return removed, unarchive->inbox navigation, empty state, double input removed, AI icon neutral |
| `client/src/pages/dashboard/integrations.tsx` | Calendly disconnect button, dialog spacing |
| `client/src/pages/dashboard/settings.tsx` | `ScheduledDeletionCard` component, dialog spacing, 24-48h countdown |
| `client/src/components/dashboard/LeadIntelligenceModal.tsx` | Simplified UI, mobile-friendly |
| `services/api-gateway/src/routes/user-settings-routes.ts` | Schedule/cancel/status/deletion endpoints, `processExpiredDeletions()` |

---

*© 2026 AUDNIX OPERATIONS CO. — [Developer Portal](https://audnixai.com/developer)*
