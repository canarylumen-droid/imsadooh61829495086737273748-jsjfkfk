# Memory / Project Context

This file is automatically loaded at the start of every session. Use it to store important context, preferences, and decisions so I never forget.

## How to use
- Add notes below about anything you want me to remember
- I can also update this file when I learn something important about the project
- Keep it organized with sections for different topics

---

## Project Overview

Audnix - email outreach/campaign platform. React SPA client (Vite), Node.js Express API gateway (tsx/PM2), MySQL DB, Supabase/S3 for uploads, Socket.io for real-time.

## Key Files

- `client/src/pages/dashboard/home.tsx` — Dashboard KPIs page
- `client/src/pages/dashboard/insights.tsx` — AI Insights page
- `client/src/pages/dashboard/inbox.tsx` — Inbox/leads page
- `client/src/pages/dashboard/warmup.tsx` — Warmup page
- `client/src/pages/dashboard/integrations.tsx` — Email integrations
- `client/src/pages/dashboard/deals.tsx` — Deals pipeline
- `client/src/pages/dashboard/deliverability.tsx` — Deliverability stats
- `client/src/pages/dashboard/developer.tsx` — API keys page
- `client/src/pages/dashboard/lead-import.tsx` — Lead import page
- `client/src/pages/dashboard/lead-recovery.tsx` — Lead recovery page
- `client/src/pages/dashboard/settings.tsx` — Settings (delete account button)
- `client/src/pages/dashboard/mcp-server.tsx` — MCP server page
- `client/src/pages/developer-docs.tsx` — Developer docs
- `client/src/App.tsx` — Chunk load error handler + auth routing
- `client/src/components/auth-guard.tsx` — AuthGuard redirects on 401/error
- `client/src/components/ErrorBoundary.tsx` — Error boundary with auto-reload on chunk failures
- `client/src/components/outreach/CampaignListModal.tsx` — Campaign list modal
- `client/src/lib/queryClient.ts` — React Query client + 2-strike 401 policy
- `client/src/lib/api-client.ts` — Direct fetch wrapper (immediate 401 redirect)
- `services/api-gateway/src/routes/mcp-routes.ts` — API key CRUD, 16-char keys, JSON-RPC, PATCH rename
- `services/api-gateway/src/routes/user-settings-routes.ts` — Account deletion
- `services/api-gateway/src/middleware/auth.ts` — API key auth sets req.session.userId
- `services/api-gateway/src/routes/lead-recovery-routes.ts` — Lead recovery API
- `services/api-gateway/src/routes/dashboard-routes.ts` — Dashboard stats endpoint
- `services/lead-recovery-worker/src/worker.ts` — Lead recovery worker (event-driven, no polling)
- `shared/lib/mysql.ts` — MySQL lazy connection pool
- `shared/lib/storage/drizzle-storage.ts` — Drizzle ORM storage (includes DashboardStats query)

## Conventions & Preferences

- shadcn/ui + Tailwind design system
- PageWrapper for pipeline-style premium pages
- API keys: 16-char (`audnix_` + hex), shown once masked, no duplicate names, no asterisk mask — show full key once then hide
- Lead import page: always show pipeline usage (even <1%), progress bar min 0.5% width
- Deliverability: uses real `/api/stats/inbox-placement` endpoint (not static integration DB fields)
- mysql2: lazy import with `let mysql: any` pattern
- Lead recovery: event-driven (not polling) via Redis pub/sub

## Key Decisions

- Warmup uses real-time socket events only (no polling)
- Account deletion allowed from UI; blocked for API key MCP tool
- API key has full access except delete_account, username/OTP endpoints
- Client deploys to S3 static, API gateway runs via PM2 with tsx
- ErrorBoundary auto-reloads on `Loading chunk` / `dynamically imported module` errors
- Lead recovery: `recovery_state` table tracks per-lead sync, `recovery_event_logs` for event history
- Auth uses session cookies (PostgreSQL `user_sessions` via connect-pg-simple), no JWT
- DashboardStats rates return `number | null` for insufficient data (null = "—" in UI)
- KPI `calculateRate` returns `null` when denominator < minDen (instead of 0)
- `globalBounceRate` computed from `totalSent` (not `outreachedLeads`) for accuracy

## AWS / Deployment

- EC2: `i-0fc13fe518b5f483e` (54.227.164.241), us-east-1d
- App dir: `/home/ubuntu/app`
- PM2 services: audnix-api-gateway (id 17, port 5000), socket-server, workers (ai, email, imap, warmup, lead-recovery, billing, orchestrator, audit, social, knowledge, vectordb, rag, infra-scaler)
- outreach worker (id 15) is errored — Redis not configured, crash loop (112K+ restarts)
- No CloudWatch log groups — app logs to PM2 locally
- Deploy: `git push github main` then ssh EC2: `cd /home/ubuntu/app && git stash -- package.json package-lock.json 2>/dev/null; git pull && cd client && npm run build && pm2 restart audnix-api-gateway`
- Key scp: use EC2 Instance Connect to push temporary SSH key; `ssh -i <key> ubuntu@54.227.164.241`
- SSH key not available in automated workspace — use EC2 console Instance Connect to push a temp key via AWS SDK v3
- AWS creds in `/home/runner/workspace/opencode.json` (AKIAZUAXW67WM4BNID4G)
- Temp SSH key at `/tmp/aws_temp_key`

## Auth Flow

- Login/Register via `/api/auth/login`, `/api/auth/register` — sets session cookie (audnix.sid)
- Session stored in PostgreSQL `user_sessions` via connect-pg-simple, httpOnly, secure (prod), sameSite: lax, maxAge: 30 days, rolling: true
- Auth middleware at `middleware/auth.ts`: checks session (`req.session.userId`), falls back to API key auth (header `x-api-key` or `authorization: Bearer`)
- API key auth sets `req.session.userId` from key's associated user as side effect
- Client AuthGuard fires `useQuery({ queryKey: ["/api/user/profile"] })` — retries 2x with backoff before redirecting to /auth
- Onboarding: After login, user redirected to `/dashboard/home` (via AuthGuard). If no mailboxes, dashboard shows "Connect Mailbox" / "Create Campaign" empty state
- 2-strike 401 policy in `queryClient.ts`: only redirects to /auth after 2nd 401 within 5s
- `api-client.ts` (used by some components) does immediate redirect on 401 — less forgiving than React Query
- 500ms session propagation delay after login (increased from 150ms to fix race condition)

## Known Issues (Jul 15 2026)

### Build/Type Errors (FIXED)
- `shared/lib/mysql.ts`: Replaced `mysql.RowDataPacket[]` → `any[]`, `mysql.Pool` → `any`, removed type args on `.query<any[]>` for lazy mysql2 import (TS2503, TS2347)
- `lead-recovery-routes.ts`: Cast `objection` as `any` for `synced_at` property (TS2551 — type uses `syncedAt` camelCase but code uses snake_case from DB)
- Build now passes cleanly with `tsc -p tsconfig.json` (both client Vite + server tsc)

### Deployed Fixes This Session (Jul 15 2026)
1. **Dashboard KPIs empty state**: When no mailbox connected, shows "Connect Mailbox" / "Create Campaign" buttons instead of blank graph
2. **AI Insights rewritten**: Matches actual backend shape (`trends`, `predictions`, `recommendations`, `topPerformers`, `summary` — NOT `channels`/`funnel`/`hasData`); three-tier empty state; `hasRealData` checks trend values
3. **Inbox status filter**: `unsubscribed` filter now works; `contacted`/`opened` `statusStyles` added
4. **Warmup KPIs always visible**: Empty state below KPIs; reputation score per-mailbox
5. **Integrations mobile layout**: Stats visible on mobile, larger email truncation (160px), compact padding
6. **Deals pipeline**: Color-coded badges (red/amber/sky/emerald), proper labels (Pending Payment/Booked/Not Interested)
7. **Deliverability real data**: Fetches `/api/stats/inbox-placement` for real spam/bounce/inbox rates; pie chart with zero-data text
8. **API Keys**: Permission level selector (read/read-write); rename/edit; socket refresh; full-key-once banner
9. **Campaign modal**: Socket real-time updates; ETA based on actual send rate
10. **Lead import**: `<1%` pipeline usage; progress bar min width; shorter title
11. **ErrorBoundary**: Auto-reloads on chunk load failures (`Loading chunk` / `dynamically imported module`)
12. **MCP routes PATCH**: Rename endpoint `/api/mcp/key/:id`

### Auth Fixes (Jul 15 2026)
- AuthGuard now retries `/api/user/profile` 2x with backoff (was retry: false) — handles transient 503s
- AuthGuard no longer redirects on error + loading state (only after loading completes) — prevents premature redirect on network blips
- Session propagation delay increased 150ms → 500ms after login to handle DB replica lag
- `api-client.ts` 401 handler: delayed redirect (2s toast before redirect) + throws APIError instead of returning undefined

### KPI Data Fixes (Jul 15 2026)
- `calculateRate()` returns `number | null` instead of `0` when denominator is 0 or below minDen — client shows "—" for insufficient data
- `openRate` minDen=5 preserved (returns null for <5 messages) so users see "—" not "0.0%" 
- Fixed `repliedLeads`/`replied` subqueries: changed `metadata->>'subject'` → direct `subject` column (was always null, making undelivered filter dead)
- `globalBounceRate` now computed against `totalSent` not `outreachedLeads` (fixes inflated bounce rate for low-lead-count users)
- All `DashboardStats` types updated to `number | null` across interface, MemStorage, and DrizzleStorage
- Null checks added: dashboard-routes.ts, reputation-monitor.ts, outreach-worker.ts

### Lead Recovery Fixes (Jul 15 2026)
- `failMailboxSync()` now updates `last_sync_at = NOW()` — prevents infinite retry loops on failed syncs
- `getPendingSyncStates()` now filters by `available_at <= NOW()` — respects 1-hour cooldown
- `claimMailboxForSync()` also checks `available_at` — prevents re-claiming during cooldown
- Worker `processMailbox()` catches errors properly, cooldown respected
- **Remaining issue**: outreach worker (id 15) is in crash loop — Redis not configured (`REDIS_URL`/`REDIS_HOST` env vars missing)

### Lead Recovery UI Fixes (Jul 15 2026)
- Replaced `font-black` (weight 900) → `font-semibold` (weight 600) on all headings
- Replaced `font-bold` → `font-medium` on body text, labels, mailboxes, event items
- KPI numbers kept at `font-bold` (was `font-black`) — still prominent but less aggressive
- Overall readability improved with proper visual hierarchy

### Unused Imports Cleanup (Jul 15 2026)
- 59+ unused imports removed across 13 files
- Files cleaned: home.tsx, inbox.tsx, warmup.tsx, integrations.tsx, deals.tsx, deliverability.tsx, developer.tsx, lead-import.tsx, settings.tsx, CampaignListModal.tsx
- Dead code removed: `getNextPlan()`, `userData`, `hasAnyActivity` (home.tsx), `getOverallSyncHealth()` + empty useEffect (inbox.tsx), `DeletionStatus` + `deleteConfirmText` (settings.tsx)
- Unused types removed: `Integration`, `IntegrationsResponse` (integrations.tsx)

### Other Backend Issues Found (Not Fixed - Env Config)
- **outreach worker crash**: Redis env vars not configured (`REDIS_URL`/`REDIS_HOST` missing)
- **warmup worker**: Redis auth failure (`NOAUTH`); same root cause
- **lead-recovery/imap workers**: Redis pub/sub connection fails
- **knowledge/rag workers**: Port conflict (8089) — both try same health server port
- **audit worker**: `@sentry/node` package broken/cannot find module
- **socket-server + api-gateway**: Intermittent Redis latency spikes (up to 1112ms p99)

### GitHub CI/CD
- 6 workflow files exist: `ci.yml` (CI Pipeline), `deploy.yml` (ECS deploy), `aws-deploy.yml` (EC2 SSH deploy), `vercel-deploy.yml`, `codeql.yml`, `deployment-status.yml`
- `ci.yml` runs `npm ci` + `npm audit` (non-blocking) + `npm run check` + `npm run build:client`
- `npm audit` shows 18 vulnerabilities (9 high, 6 moderate, 3 low) — non-blocking warning
- CI/CD runs on push to main, triggers `aws-deploy.yml` on success (deploys to EC2 via SSH)
- Cannot check workflow run history without GitHub token

## Useful Commands

- Dev server: 
- Tests: 
- Lint: 
- Deploy: `git push github main` then ssh EC2: `cd /home/ubuntu/app && git stash -- package.json package-lock.json 2>/dev/null; git pull && cd client && npm run build && pm2 restart audnix-api-gateway`
- Check PM2: `pm2 list`
- Check logs: `pm2 logs audnix-api-gateway --lines 50`
- SSH deploy temp key: EC2 Instance Connect → `/tmp/aws_temp_key` → `ssh -i /tmp/aws_temp_key ubuntu@54.227.164.241`
