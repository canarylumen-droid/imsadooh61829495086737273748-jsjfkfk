# Audnix AI — Intelligent Sales Automation

Audnix is a production sales outreach platform that automates email engagement, tracks lead pipeline status, and uses AI to generate and send personalized messages on your behalf.

## Architecture

| Layer | Technology |
|---|---|
| Frontend | React + Vite + TailwindCSS (Wouter routing) |
| API | Express (api-gateway service) |
| Queue | campaign-queue (shared lib) running inside api-gateway |
| Outreach Worker | Separate Node service — sends emails, generates AI copy |
| Brain Worker | Separate Node service — AI scoring, intent, objection handling |
| Database | PostgreSQL via Drizzle ORM |
| Realtime | Socket.IO (api-gateway process only) |
| AI | DeepSeek via Replit AI proxy |

## Key Services

- **api-gateway** (`services/api-gateway`) — REST API, auth, campaigns, leads, socket server
- **outreach-worker** (`services/outreach-worker`) — autonomous email sends, priority queue
- **brain-worker** (`services/brain-worker`) — AI message generation, lead scoring, objection handling
- **shared** (`shared/lib`) — DB, storage, queue, template vars, realtime (shared across services)

## Core Features

- **AI-generated cold outreach** — generates personalized emails using brand context, lead industry, and procedural memory
- **Campaign automation** — queue-based drip engine with configurable delays and follow-up rules
- **Inbox** — unified message thread view with inbound/outbound tracking
- **Analytics** — open rate, response rate, bounce rate, and per-campaign stats
- **Mailbox integration** — Gmail OAuth, Outlook OAuth, custom SMTP/IMAP
- **Lead import** — CSV bulk import with email validation
- **Pipeline** — deal tracking with status and revenue

## Email Safety Rules (enforced in outreach-worker)

1. **Mailer Daemon suppression** — Any lead whose email matches `mailer-daemon`, `noreply`, `postmaster`, `abuse`, `bounce`, or `donotreply` is automatically paused (`aiPaused: true`) and never contacted.
2. **AI JSON sanitization** — `sanitizeEmailBody()` runs before every send. If the AI output contains a JSON reasoning blob (`{action, reasoning, delayDays, ...}`) the body is extracted from the `body` field only. If extraction fails, the send is blocked entirely.
3. **Template variable resolution** — `resolveTemplateVars()` replaces `{{senderName}}`, `{{firstName}}`, `{{company}}` etc. in both subject and body before sending.

## Quickstart

1. Connect a mailbox: **Integrations** → Gmail / Outlook / Custom SMTP
2. Upload brand guidelines (PDF) in **Settings**
3. Import leads via **Import Leads** (CSV)
4. Create a campaign: **Inbox** → New Campaign
5. Engine sends automatically; monitor in **Analytics** and **Inbox**

## Admin Endpoints

| Endpoint | Description |
|---|---|
| `POST /api/admin/reset-all-users` | Deletes non-admin user accounts (keeps data) |
| `POST /api/admin/clear-data` | Wipes all leads, mailboxes, campaigns, messages. Requires `{ confirm: "CONFIRM_CLEAR_ALL_DATA" }` |

## Known Limitations

- **WebSocket events are api-gateway-only** — the outreach worker runs in a separate process and cannot push real-time events directly. Clients poll for updates. A Redis pub/sub bridge would fix this.
- **Stats update on campaign completion** — queued/pending/failed counts are now persisted on each stats update cycle.
- **No prospecting page** — the lead-prospecting tool has been removed from the nav.

---
© 2026 AUDNIX OPERATIONS CO.
