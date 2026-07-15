# Memory / Project Context

This file is automatically loaded at the start of every session. Use it to store important context, preferences, and decisions so I never forget.

## How to use
- Add notes below about anything you want me to remember
- I can also update this file when I learn something important about the project
- Keep it organized with sections for different topics

---

## Project Overview

Audnix - email outreach/campaign platform.

## Key Files

- `client/src/pages/dashboard/developer.tsx` — API keys page (redesigned pipeline style)
- `client/src/pages/dashboard/mcp-server.tsx` — MCP server page (redesigned)
- `client/src/pages/developer-docs.tsx` — Developer docs (redesigned)
- `client/src/pages/dashboard/warmup.tsx` — Warmup page (socket-based, no polling)
- `client/src/pages/dashboard/settings.tsx` — Settings (delete account button)
- `client/src/App.tsx` — Chunk load error handler
- `services/api-gateway/src/routes/mcp-routes.ts` — API key CRUD, 16-char keys, JSON-RPC support
- `services/api-gateway/src/routes/user-settings-routes.ts` — Account deletion
- `services/api-gateway/src/middleware/auth.ts` — API key auth sets req.session.userId

## Conventions & Preferences

- shadcn/ui + Tailwind design system
- PageWrapper for pipeline-style premium pages
- API keys: 16-char (`audnix_` + hex), shown once masked, no duplicate names, no asterisk mask — show full key once then hide

## Key Decisions

- Warmup uses real-time socket events only (no polling)
- Account deletion allowed from UI; blocked for API key MCP tool
- API key has full access except delete_account, username/OTP endpoints
- Client deploys to S3 static, API gateway runs via PM2 with tsx

## AWS / Deployment

- EC2: `i-0fc13fe518b5f483e` (54.227.164.241), us-east-1d
- App dir: `/home/ubuntu/app`
- PM2 runs `audnix-api-gateway` (id 17) on port 5000 via tsx
- Deploy: `git push github main` then ssh EC2: `cd /home/ubuntu/app && git pull && cd client && npm run build && pm2 restart audnix-api-gateway`
- Key scp: use EC2 Instance Connect to push temporary SSH key; `ssh -i <key> ubuntu@54.227.164.241`
- SSH key not available in automated workspace — use EC2 console Instance Connect to push a temp key

## Recent Fixes (Jul 15 2026)

- Dashboard KPIs: Added empty state when no mailbox connected — shows "Connect Mailbox" / "Create Campaign" buttons
- AI Insights page: Rewritten to match actual backend response (trends, predictions, recommendations, topPerformers — NOT channels/funnel/hasData/timeSeries which backend doesn't return); three-tier empty state with smart messaging; `hasData` replaced with real `hasRealData` check based on trend values
- Deals pipeline: Status badges now color-coded (red=lost, amber=pending, sky=open, emerald=booked/closed); "Pending Payment" only shown for `pending` status; "Not Interested" for `closed_lost`; "Booked" for `converted`
- Inbox: `statusStyles` now handles `contacted` and `opened` (previously missing, causing blank badge); reply on new lead sets `contacted` not `opened`; "Contacted" filter added
- Avatar upload: `POST /api/user/avatar` route added with Supabase/S3 → local disk fallback; `/uploads/` static serving
- CalendarLink: Saved to `users.calendarLink` column instead of `metadata` JSONB
- Calendly real-time: `settings_updated` socket handler invalidates `/api/user/profile` query
- mysql2: Lazy import so API gateway starts without the package
- Warmup: Summary KPIs (Total/Warming/Warmed/Rep) always visible even before warmup starts; empty state now sits below KPIs; added reputation score to per-mailbox grid; explained what happens after warmup starts
- Integrations: Mobile layout — removed `max-sm:hidden` on reputation/bounce/status stats so they show on mobile; increased email truncation from 120px→160px; reduced padding from p-8→p-4 on mobile

## Useful Commands

- Dev server: 
- Tests: 
- Lint: 
- Deploy: `git push github main` then ssh EC2: `cd /home/ubuntu/app && git pull && cd client && npm run build && pm2 restart audnix-api-gateway` 
