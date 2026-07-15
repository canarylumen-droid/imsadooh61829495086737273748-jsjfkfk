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
- `client/src/pages/dashboard/settings.tsx` — Settings (delete account button)
- `client/src/pages/dashboard/mcp-server.tsx` — MCP server page
- `client/src/pages/developer-docs.tsx` — Developer docs
- `client/src/App.tsx` — Chunk load error handler + auth routing
- `client/src/components/ErrorBoundary.tsx` — Error boundary with auto-reload on chunk failures
- `client/src/components/outreach/CampaignListModal.tsx` — Campaign list modal
- `services/api-gateway/src/routes/mcp-routes.ts` — API key CRUD, 16-char keys, JSON-RPC, PATCH rename
- `services/api-gateway/src/routes/user-settings-routes.ts` — Account deletion
- `services/api-gateway/src/middleware/auth.ts` — API key auth sets req.session.userId
- `services/api-gateway/src/routes/lead-recovery-routes.ts` — Lead recovery API
- `shared/lib/mysql.ts` — MySQL lazy connection pool

## Conventions & Preferences

- shadcn/ui + Tailwind design system
- PageWrapper for pipeline-style premium pages
- API keys: 16-char (`audnix_` + hex), shown once masked, no duplicate names, no asterisk mask — show full key once then hide
- Lead import page: always show pipeline usage (even <1%), progress bar min 0.5% width
- Deliverability: uses real `/api/stats/inbox-placement` endpoint (not static integration DB fields)
- mysql2: lazy import with `let mysql: any` pattern

## Key Decisions

- Warmup uses real-time socket events only (no polling)
- Account deletion allowed from UI; blocked for API key MCP tool
- API key has full access except delete_account, username/OTP endpoints
- Client deploys to S3 static, API gateway runs via PM2 with tsx
- ErrorBoundary auto-reloads on `Loading chunk` / `dynamically imported module` errors
- Lead recovery: `recovery_state` table tracks per-lead sync, `recovery_event_logs` for event history

## AWS / Deployment

- EC2: `i-0fc13fe518b5f483e` (54.227.164.241), us-east-1d
- App dir: `/home/ubuntu/app`
- PM2 services: audnix-api-gateway (id 17, port 5000), socket-server, workers (ai, email, imap, warmup, lead-recovery, billing, orchestrator, audit, social, knowledge, vectordb, rag, infra-scaler)
- outreach worker (id 15) is errored — needs investigation
- Deploy: `git push github main` then ssh EC2: `cd /home/ubuntu/app && git stash -- package.json package-lock.json 2>/dev/null; git pull && cd client && npm run build && pm2 restart audnix-api-gateway`
- Key scp: use EC2 Instance Connect to push temporary SSH key; `ssh -i <key> ubuntu@54.227.164.241`
- SSH key not available in automated workspace — use EC2 console Instance Connect to push a temp key
- AWS creds in `/home/runner/workspace/opencode.json` (AKIAZUAXW67WM4BNID4G)
- Temp SSH key at `/tmp/aws_temp_key`

## Auth Flow

- Login/Register via `/api/auth/login`, `/api/auth/register` — sets session cookie
- Auth middleware at `middleware/auth.ts`: checks session, falls back to API key auth (header `x-api-key` or `authorization: Bearer`)
- API key auth sets `req.session.userId` from key's associated user
- Onboarding: After login, user is sent to `/dashboard/home` — if no mailboxes, dashboard KPIs show "Connect Mailbox" / "Create Campaign" empty state buttons
- Potential issue for new users: if API fails silently during initial load, dashboard shows blank. Need to check auth token/session persistence on page reload.

## Known Issues (Jul 15 2026)

### Build/Type Errors (FIXED)
- `shared/lib/mysql.ts`: Replaced `mysql.RowDataPacket[]` → `any[]`, `mysql.Pool` → `any`, removed type args on `.query<any[]>` for lazy mysql2 import (TS2503, TS2347)
- `lead-recovery-routes.ts`: Cast `objection` as `any` for `synced_at` property (TS2551 — type uses `syncedAt` camelCase but code uses snake_case from DB)
- Build now passes cleanly with `tsc -p tsconfig.json`

### Deployed Fixes This Session
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

### Pending/Affecting Issues
- **Auth for new users**: Some users report dashboard not loading after signup — possibly auth session not persisting, or API returning 401 on initial load before cookie is set. Check `App.tsx` auth guard + `/api/user/profile` behavior when no session
- **KPIs data**: Some KPIs showing 0/null when data exists — check `/api/stats/dashboard` endpoint queries for missing joins or wrong date filters
- **Lead recovery showing 'failed'**: Debug lead-recovery-worker logic — check `recovery_state` transitions and error handling
- **Lead recovery UI**: Bold font not good — check lead-import/recovery UI styles
- **Backend workers**: outreach worker errored (id 15), others need health check. Real-time socket events may not be reaching client for some pages
- **Unused imports/components**: Lint/type-check may reveal dead code
- **GitHub CI/CD**: Check if workflow runs are failing
- **GitHub vulnerabilities**: 18 reported (9 high, 6 moderate, 3 low)

## Useful Commands

- Dev server: 
- Tests: 
- Lint: 
- Deploy: `git push github main` then ssh EC2: `cd /home/ubuntu/app && git stash -- package.json package-lock.json 2>/dev/null; git pull && cd client && npm run build && pm2 restart audnix-api-gateway`
- Check PM2: `pm2 list`
- Check logs: `pm2 logs audnix-api-gateway --lines 50`
