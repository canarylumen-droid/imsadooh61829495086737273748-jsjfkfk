# Audnix AI — Platform Walkthrough

> **Date:** 2026-07-15  
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
# Endpoint: https://audnixai.com/api/mcp
```

---

*© 2026 AUDNIX OPERATIONS CO. — [Developer Portal](https://audnixai.com/developer)*
