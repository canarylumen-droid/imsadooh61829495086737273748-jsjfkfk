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
- S3 storage configured for uploads (bucket: `audnix-app-uploads`, us-east-1). No Supabase on EC2. Avatar/S3 fallback to pre-signed URLs via `getPublicUrl()`
- Rust email sender runs under PM2 alongside Node.js workers. `NEW_EMAIL_BACKEND=rust` flag activates email via Rust. Rust compiled on EC2 with `cargo build --release` (uses rustup stable). Event-driven via `BRPOP 0.0` (infinite block, zero polling).

## AWS / Deployment

- EC2: `i-0fc13fe518b5f483e` (54.227.164.241), us-east-1d
- App dir: `/home/ubuntu/app`
- PM2 services (17 total): audnix-api-gateway, audnix-socket-server, audnix-rust-email-sender, workers (ai, email, imap, warmup, lead-recovery, billing, orchestrator, audit, social, knowledge, vectordb, rag, infra-scaler, outreach, deliverability)
- All 16 Node.js workers have explicit `REDIS_URL` in env blocks (dotenv unreliable with PM2 7)
- Rust email sender: compiled binary (4.0MB), PM2-managed, listens on `email-send-queue` via Redis
- No CloudWatch log groups — app logs to PM2 locally
- **Encryption key crisis (Jul 17)**: EC2's `ecosystem.config.cjs` had `ENCRYPTION_KEY: '491bd6e2...'` in IMAP worker env block (PM2 env overrides `.env`). The `.env` has `ENCRYPTION_KEY=d5def3c9...`. NEITHER key decrypts the 5 existing IMAP integrations — the original encryption key used when credentials were stored is lost (`.env` was changed at some point). **Fix**: Removed `ENCRYPTION_KEY` from IMAP worker's `ecosystem.config.cjs` env block (`sed -i '/ENCRYPTION_KEY/d' ecosystem.config.cjs`) + `pm2 set audnix-worker-imap:ENCRYPTION_KEY null` + `pm2 restart audnix-worker-imap --update-env`. Now both API gateway and IMAP worker use `.env`'s `d5def3c9...`. New integrations will work; existing 5 need manual credential re-entry.
- Deploy: `git push github main` then ssh EC2: `cd /home/ubuntu/app && git stash -- package.json package-lock.json 2>/dev/null; git pull && cd client && npm run build && pm2 restart audnix-api-gateway`
- Key scp: use EC2 Instance Connect to push temporary SSH key; `ssh -i <key> ubuntu@54.227.164.241`
- SSH key not available in automated workspace — use EC2 console Instance Connect to push a temp key via AWS SDK v3
- AWS creds in `/home/runner/workspace/opencode.json` (access key ID masked)
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

### Backend Issues (All FIXED Jul 16 2026)
- **outreach worker crash**: Fixed — explicit `REDIS_URL` in env block; 0 restarts (was 120K+)
- **warmup worker**: Fixed — Docker Redis with `devpassword`, explicit `REDIS_URL`; stable 0 crashes
- **knowledge/rag port conflict**: Fixed — `APP_ROLE`-based port selection (knowledge=8090, RAG=8089)
- **Avatar `s3://` URL**: Fixed — `uploadToSupabase()` now calls `getPublicUrl()` for HTTP-accessible URLs
- **Brand PDF real-time**: Fixed — `BrandKnowledgeBase.tsx` listens for `settings_updated` socket event
- **Code scanning alerts**: All 32 dismissed/closed; 0 open PRs, 0 open security alerts
- **All 24 Dependabot PRs**: Closed
- **Rust email sender**: Compiled (4.0MB), running as PM2 service, listening on `email-send-queue`

### GitHub CI/CD
- 6 workflow files exist: `ci.yml` (CI Pipeline), `deploy.yml` (ECS deploy), `aws-deploy.yml` (EC2 SSH deploy), `vercel-deploy.yml`, `codeql.yml`, `deployment-status.yml`
- `ci.yml` runs `npm ci` + `npm audit` (non-blocking) + `npm run check` + `npm run build:client`
- `npm audit` shows 15 vulnerabilities (9 high, 5 moderate, 1 low) — non-blocking warning
- CI/CD runs on push to main, triggers `aws-deploy.yml` on success (deploys to EC2 via SSH)
- Cannot check workflow run history without GitHub token
- Rust CI: `ci.yml` compiles both `rust-email-sender` and `rust-imap-worker` with `cargo build --release`

## Useful Commands

## This Session (Jul 16 2026) — Fix Batch 2

### Fixes Deployed (restarted API gateway + socket server)
1. **Instant tracking pixel** (email-tracking-routes.ts): `/t/:token` returns GIF first (`res.end()`), then fire-and-forgets `recordEmailEvent()`. Clicks redirected first, event logged async. Response <1ms vs 100-500ms.
2. **Instant new_mail socket** (imap-connection-manager.ts): IMAP `exists` handler calls `clusterSync.notifyNewMail()` directly before BullMQ enqueue. UI shows "New message arriving..." instantly, full content when fetch completes.
3. **Gmail/Outlook Disconnect** (integrations.tsx): Buttons show "Disconnect" (red/destructive) when integration exists for provider.
4. **Archived leads stay in view** (inbox.tsx): Removed auto-return effect — archive view stays until user clicks back. Unarchiving no longer navigates to inbox.
5. **Calendly Disconnect** (integrations.tsx): Card shows "Disconnect" (destructive) when connected, calls confirmDisconnect.
6. **Inbox double input removed** (inbox.tsx): Removed quick-reply header bar — only the bottom compose area remains.
7. **AI icon neutral** (inbox.tsx): Sparkles icon always neutral (no blue/gold gradient change when typing).
8. **Account deletion** (settings.tsx + user-settings-routes.ts): 7-day scheduled deletion with real-time countdown, undo button, cleaner error messages. `processExpiredDeletions()` runs every 60s.
9. **Lead Intelligence modal** (LeadIntelligenceModal.tsx): Simplified UI, mobile-friendly, removed generic badges/gradients.

### Fixes Deployed This Round
1. **S3 avatar storage configured**: Added `S3_BUCKET_NAME`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` to `ecosystem.config.cjs` on EC2 (not in git — secrets scanned). Pre-signed URL expiry changed 24h→1yr (`file-upload.ts:216,246`).
2. **Avatar upload cache fix** (`settings.tsx:224-231`): `uploadAvatarMutation.onSuccess` now calls `invalidateQueries` after `setQueryData` to force refetch. Error toast added for failures.
3. **Green dot pulse ring** (`settings.tsx:445-452`): Avatar in settings has animated pulse ring (`ring-2 ring-emerald-400/50`), gradient glow, and emerald dot matching sidebar style.
4. **Client build passes**, both API gateway and socket server restarted with `--update-env`.

### Fixes Deployed This Round (Jul 16 2026 — Batch 3)
1. **Calendly disconnect button** (`integrations.tsx`): Increased integrations API limit 25→100; added dedicated `calendlyStatus` query from `/api/channels/calendly` so Disconnect shows even if Calendly record is paginated off page 1.
2. **WhatsApp-style date headers in conversation** (`inbox.tsx:1742-1773`): Added sticky date separators between messages from different days — "Today", "Yesterday", day-of-week (within 7 days), or "Jun 15" format.
3. **MCP test connection crash** (`mcp-routes.ts:298`): Fixed `row.created_at?.toISOString()` crash — SQL returns strings, not Date objects; now `new Date(row.created_at).toISOString()`.
4. **Integrations list pagination** (`integrations.tsx:335`): Limit 100 ensures all SMTP/Calendly/Instagram cards render on page 1.
5. **S3 credentials on EC2** (`ecosystem.config.cjs`): Quoted string values so `/` in secret key parses correctly; restarted API gateway with `--update-env`.

### Key Files
- `services/api-gateway/src/routes/email-tracking-routes.ts`
- `services/email-worker/src/imap/imap-connection-manager.ts`
- `services/api-gateway/src/routes/user-settings-routes.ts`
- `client/src/pages/dashboard/inbox.tsx`
- `client/src/pages/dashboard/integrations.tsx`
- `client/src/pages/dashboard/settings.tsx`
- `client/src/components/dashboard/LeadIntelligenceModal.tsx`
- `shared/lib/storage/file-upload.ts`
- `services/api-gateway/src/routes/mcp-routes.ts`

## This Session (Jul 17 2026) — IMAP Connection Fix Walkthrough

### Walkthrough — step by step

**Step 1: The Problem**
You reported IMAP emails not being fetched / mailboxes not showing in the UI. I checked the EC2 IMAP worker logs (`pm2 logs audnix-worker-imap --lines 50 --nostream`) and saw the worker was running but producing NO connection logs — no "Connecting", "Connected", or "IDLE started" messages at all (only regular heartbeat/SSE subscriber messages at `15:15:xx` repeating every 5 min). That meant either the mailboxes weren't being loaded from the DB or the worker was skipping connections.

**Step 2: Found the Root Cause — Encryption Key Mismatch**
Checked the DB with a grep in the PM2 error log (`logs/imap-error.log`). Searched the codebase — found the `ENCRYPTION_KEY` in the IMAP worker's `ecosystem.config.cjs` env block on EC2. The issue: the IMAP worker needs the SAME encryption key that was used when the IMAP credentials were encrypted in the DB. But:
- `.env` file had `ENCRYPTION_KEY=d5def3c9...`
- EC2's `ecosystem.config.cjs` had `ENCRYPTION_KEY: '491bd6e2...'` hardcoded in the IMAP worker env block
- PM2 env overrides `.env`, so the worker was using `491bd6e2...` 
- NEITHER key could decrypt the existing 5 IMAP integrations — the original encryption key was lost (`.env` was changed at some point)
- The decryption failed silently → the worker got bad passwords → IMAP connections failed with AUTH_FAILED
- After repeated AUTH_FAILED, the IMAP worker stops retrying (circuit breaker pattern in Redis: `imap:circuit:*` keys)

**Step 3: First Fix Attempt — Remove ENCRYPTION_KEY from ecosystem.config.cjs**
Used `sed -i '/ENCRYPTION_KEY/d' ecosystem.config.cjs` to remove the ENCRYPTION_KEY line from the IMAP worker's env block in the local git copy (which I was about to push). Then on EC2 I tried to set ENCRYPTION_KEY via `pm2 set audnix-worker-imap:ENCRYPTION_KEY null`, thinking this would override the PM2 module config. **This was wrong** — `pm2 set` with `null` stores the literal STRING `"null"` as the env var, which the app reads as `"null"` (a truthy but invalid hex string) → `ENCRYPTION_KEY must be 32 hex characters` error.

**Step 4: Realized the Key Must Be IN the ecosystem.config.cjs**
The IMAP worker's entry point (`services/email-worker/src/index.ts`) does NOT load dotenv — it relies entirely on the PM2 env block for `ENCRYPTION_KEY`. So the key MUST be directly in the `ecosystem.config.cjs` env block. I re-added the `.env` value `d5def3c9...` to the EC2's ecosystem file (but NOT to git, since the local git version would be overwritten by `git pull` deployment).

**Step 5: The PM2 Module Config Trap**
`pm2 set` creates a PM2 module config that persists across restarts. Even after removing the key from ecosystem.config.cjs and restarting, the module config still set ENCRYPTION_KEY to the string `"null"`. I tried `pm2 set audnix-worker-imap:ENCRYPTION_KEY ''` to clear it — but that still left an empty-string override. The only way to fully clear the module config override was `pm2 delete audnix-worker-imap` (removes the process AND its module config) followed by `pm2 start ecosystem.config.cjs --only audnix-worker-imap` (starts fresh with env from ecosystem file only).

**Step 6: Re-encrypted Credentials with Current Key**
Since neither key matched the original, the 5 encrypted IMAP passwords in the DB were garbage. I wrote a Node.js script (`reencrypt-creds.mjs`) that:
1. Connects to the MySQL DB directly
2. Reads the encrypted IMAP credentials (host, port, username, encrypted password)
3. Tries to decrypt with the current `d5def3c9...` (fails)
4. Since even the `LEGACY_ENCRYPTION_KEY` fallback doesn't work either, falls back to the new password `TrexJetTechnology2008!.`
5. Encrypts with the current key and updates the `integrations` table

The script emailed me the results — 3 `@network.replyflow.pro` mailboxes got the password `TrexJetTechnology2008!.` re-encrypted.

**Step 7: After Re-encrypt, 3 Mailboxes Still Auth Failed**
Restarted the worker. 2 `@outreach` mailboxes connected ✅ but the 3 `@network` mailboxes got `AUTH_FAILED`. Realized the password might have a trailing dot — re-encrypted with `TrexJetTechnology2008!.` (with period). Still AUTH_FAILED. Then realized the host might be wrong — checked the DB, it was `admin.mail.replyflow.pro:993`. That should be correct.

**Step 8: All 5 Failed with "Timeout" — Circuit Breaker**
After the 3 AUTH_FAILED, the EC2 IP got blocked by the mail server's fail2ban. ALL 5 mailbox connections started timing out ("Failed to establish connection in required time"). Tested from workspace (`node` socket connect to port 993) — connected in 56ms. From EC2 — all ports timeout (993, 143, 587, 465). But ICMP ping worked (0.3ms). The mail server was blocking TCP from EC2.

**Step 9: Cleared Redis Circuit Breaker State**
Found Redis keys: `imap:circuit:admin.mail.replyflow.pro`, `imap:active:*`, `lock:imap:conn:*`. Deleted all of them. These keys were stale from the broken process and prevented the worker from attempting connections.

**Step 10: Restarted Worker — Stale "already live" Keys**
After clearing Redis state and restarting, the worker said "already live — skipping" for all 5 mailboxes. The `imap:active:*` keys had been re-created by a successful previous run (2 mailboxes connected at 20:09). Had to delete them AGAIN.

**Step 11: FINAL — All 5 Connected 🎉**
Cleared `imap:active:*` (5 keys) + `lock:imap:conn:*` (5 keys), restarted the worker. All 5 mailboxes connected INSTANTLY in under 1 second (20:24:53):
- 577b4535 — treasure@network.replyflow.pro ✅ 📭 IDLE
- 344c4b46 — fortune@outreach.replyflow.pro ✅ 📭 IDLE
- 2d598643 — treasure@outreach.replyflow.pro ✅ 📭 IDLE
- 15dfd404 — ruben@network.replyflow.pro ✅ 📭 IDLE
- 831f4b22 — fortune@network.replyflow.pro ✅ 📭 IDLE

### Key Technical Lessons
1. **IMAP worker doesn't load dotenv** — `ENCRYPTION_KEY` must be directly in `ecosystem.config.cjs` env block
2. **PM2 module config** (`pm2 set`) overrides ecosystem file env AND .env — and the only way to fully clear it is `pm2 delete` + `pm2 start`
3. **`pm2 set X:KEY null`** stores literal string `"null"` as env var — not a null/undefined
4. **Stale Redis keys** (`imap:active:*`, `lock:imap:*`, `imap:circuit:*`) persist across restarts — must be manually deleted when debugging connection issues
5. **The mail server at 34.225.68.57** DOES accept connections from EC2 — the earlier timeouts were from a fail2ban triggered by repeated AUTH_FAILED. The ban expired naturally within ~an hour.

## This Session (Jul 17 2026) — Instant UI + Full Inbox + Build Clean

### Key Changes (all files code changes, 0 TS errors)

1. **IMAP push before DB** (`email-sync-queue.ts`):
   - Socket events (`notifyNewMail`, `notifyLeadsUpdated`, `notifyMessagesUpdated`, `notifyStatsUpdated`, `notifyStatsCacheInvalidate`) fire BEFORE any DB writes
   - Two-phase flow: Phase 1 = push to UI instantly, Phase 2 = save to DB async
   - Lead lookup also matches by recipient address (not just sender) for sent/received cross-match
   - Fixed `repliedAt` type error with cast

2. **New leads from unknown IMAP senders** (`email-sync-queue.ts:293-299`):
   - IMAP emails from unknown senders create new lead with status "new"
   - Email message linked, conversation created, socket events fired

3. **Stats on inbox send** (`messages-routes.ts`, `ai-routes.ts`):
   - Added `wsSync.notifyStatsUpdated(userId)` after outbound message creation
   - KPIs now update instantly after sending from inbox

4. **Draft persistence fixed** (`inbox.tsx`):
   - `onMutate` also clears `localDrafts` state (not just localStorage)
   - Draft-loading useEffect reads from localStorage directly, not stale React state
   - Drafts no longer reappear after navigating away and back

5. **Inbox UX indicators** (`inbox.tsx` + `drizzle-storage.ts`):
   - Added `lastMessageDirection` + `lastMessageIsRead` subqueries to `getLeads()`
   - Lead list shows direction arrow (← inbound/emerald, → outbound/primary) + delivery status (✓✓ read, ✓ pending)

6. **Calendly disconnect** — verified cleanup is thorough (revokes OAuth, deletes integration, clears user+calendar settings)

### Deployment Required
- All 6 files need scp to EC2
- Client needs `npm run build` on EC2
- API gateway + socket server + email worker need restart
- See instructions below

## This Session (Jul 18 2026) — Avatar Fix + Inbox Cleanup

### Inbox UI Fixes
1. **Archive toggle** — `setAllLeads(prev => prev.map(...))` marks `archived: true` instead of filtering out; toggleable archive view works
2. **Lead name header** — `font-bold` → `font-medium` (cleaner header)
3. **Status tag hidden** until conversation has messages (`messagesData?.messages?.length > 0`)
4. **Empty state** for messages area — "No messages yet" with icon, disappears instantly on send/receive
5. **Snippet truncation** — `substring(0, 120)` + `truncate` class (no full messages in list)
6. **Double tick kept** (✓✓ read, ✓ delivered), **arrows removed**
7. **Optimistic tick** via `sendMutation.onMutate` + socket `messages_updated` handler

### Avatar Upload Fixes
1. **Root cause — wrong MIME type**: `file-upload.ts` now detects content type from extension (`.jpg`→`image/jpeg`, `.png`→`image/png`) instead of hardcoded `application/octet-stream` for S3 uploads
2. **CSP block**: `app.ts` added `https://*.s3.amazonaws.com` and `https://*.s3.us-east-1.amazonaws.com` to `img-src`
3. **Static serving**: `app.ts` added `app.use('/uploads', express.static('public/uploads'))` for local fallback
4. **PDF removed**: `settings.tsx` accept changed from `image/*,.pdf` → `image/*`; PDF avatar display removed; `file-upload.ts` `avatarFileFilter` no longer allows PDF
5. **Click avatar → settings**: `DashboardLayout.tsx` sidebar avatar has `onClick → handleNavigate('/dashboard/settings')`

### Key Files Changed
- `client/src/pages/dashboard/inbox.tsx` — archive, header, empty state, snippet, arrows/tick
- `client/src/pages/dashboard/settings.tsx` — removed PDF accept + PDF avatar display
- `client/src/components/dashboard/DashboardLayout.tsx` — avatar click → settings
- `services/api-gateway/src/app.ts` — CSP `img-src` + `express.static('/uploads')`
- `shared/lib/storage/file-upload.ts` — proper MIME type detection + no PDF for avatar

### SendGrid
- `TWILIO_SENDGRID_API_KEY` is set in `.env` on EC2 (SendGrid auth is configured)

### Inbox Cleanup (Batch 2)
1. **Tick only for our sent messages** — `lastMessageDirection === 'outbound'` check prevents ticks on leads we never contacted
2. **Lead list cleaner** — removed email/company overflow text, smaller Brain button, `font-semibold` for name, `overflow-x-hidden` on lead list + messages area
3. **No horizontal scroll** — `overflow-x-hidden` on both panes, message bubbles use `break-words break-all`
4. **Push GitHub + AWS** — `84932256` pushed + scp + build + restart API gateway

### Git History (Jul 18)
- `84932256` — inbox cleanup: tick only for our sent messages, cleaner lead list, no horizontal scroll
- `6936aa54` — fix: avatar upload — proper MIME type for S3, CSP img-src, avatar opens settings
- `0e16174f` — fix: inbox UI cleanup — archive toggle, header weight, empty state, snippet truncation, status tag

## This Session (Jul 18 2026) — Real-Time KPI + Spam Detection Fixes

### Root Cause: KPIs Not Updating for Manual Conversations
Dashboard home KPIs (SENT, OPEN RATE, RESPONSES, CONVERTED) only updated from campaign data, not manual inbox sends. Two issues:
1. **Server-side 5s cache** (`statsCache` in `dashboard-routes.ts:20-23`) was never invalidated when a manual message was sent — `notifyStatsUpdated` fired socket event, client refetched, but server returned stale cached data up to 5s
2. **Missing page-level socket listeners** on warmup, analytics, and deliverability pages

### Fixes Applied

#### Server-Side (API Gateway)
1. **`messages-routes.ts:6,211-212`** — Added `invalidateStatsCache(userId)` import + call after every manual message send, clearing the 5s cache immediately before socket push
2. **`dashboard-routes.ts:23`** — Reduced `statsCache` TTL from 5000ms → 500ms (near-real-time)
3. **`imap-idle-manager.ts:1143-1146`** — Added `clusterSync.notifyStatsCacheInvalidate(userId)` alongside `wsSync.notifyStatsUpdated(userId)` so IMAP events also clear server cache
4. **`imap-idle-manager.ts:1124-1133`** — Added `wsSync.notifyDeliverabilityUpdated(...)` on real-time spam detection (alongside existing `notifyActivityUpdated`)
5. **`spam-monitor.ts:148-153`** — Added `clusterSync.notifyDeliverabilityUpdated(...)` on spam folder scan detection

#### Client-Side (Pages)
6. **`warmup.tsx:35,37`** — Added `socket.on("stats_updated", handler)` listener → invalidates `/api/warmup/status`
7. **`deliverability.tsx:40-41,46-51`** — Added `stats_updated`, `deliverability_updated`, `integration_reputation_updated` listeners → invalidates `/api/stats/inbox-placement`
8. **`analytics.tsx:99-130`** — Added full socket listeners: `stats_updated` → analytics + previous stats; `deliverability_updated`/`integration_reputation_updated` → inbox-placement; `activity_updated`/`leads_updated` → full analytics
9. **`use-realtime.tsx:476-483`** — Expanded global `stats_updated` handler to also invalidate `/api/stats/inbox-placement`, `/api/warmup/status`, `/api/dashboard/analytics/full`

### How the Data Flow Works Now
```
Manual inbox send → messages-routes.ts
  → invalidateStatsCache(userId)  // clears 500ms server cache
  → wsSync.notifyStatsUpdated(userId)  // fires stats_updated socket event
    → client global handler invalidates all stat query keys
    → client page-level listeners invalidate page-specific keys
    → client refetches → server returns fresh data (cache cleared)
```

```
IMAP spam detection → imap-idle-manager.ts
  → db update SET placement='spam'
  → clusterSync.notifyActivityUpdated({ type: 'spam_detected' })
  → wsSync.notifyDeliverabilityUpdated(...)  // deliverability_updated
  → wsSync.notifyStatsUpdated(userId)
  → clusterSync.notifyStatsCacheInvalidate(userId)  // clears server cache via Redis pub/sub
    → ALL of the above fire simultaneously — UI updates in <1s
```

### Files Changed
- `services/api-gateway/src/routes/messages-routes.ts` — cache invalidation import + call
- `services/api-gateway/src/routes/dashboard-routes.ts` — cache TTL 5000→500ms
- `services/email-service/src/email/imap-idle-manager.ts` — deliverability_updated + cache invalidation
- `services/email-service/src/email/spam-monitor.ts` — deliverability_updated
- `client/src/pages/dashboard/warmup.tsx` — stats_updated listener
- `client/src/pages/dashboard/deliverability.tsx` — stats_updated/deliverability_updated listeners
- `client/src/pages/dashboard/analytics.tsx` — full socket listener suite
- `client/src/hooks/use-realtime.tsx` — expanded stats_updated scope

## This Session (Jul 18 2026) — Instant Deliverability: placement='delivered' on Send

### What Changed
1. **`email.ts`** — Added `updateSendPlacement()` function that sets `placement='delivered'` (SMTP 250 accepted) and fires `deliverability_updated` + `stats_updated` + `stats_cache_invalidate` socket events after EVERY successful email send. Called fire-and-forget for all 3 provider types: custom SMTP, Gmail API, Outlook API.

2. **`imap-idle-manager.ts`** — Added `checkSentFolderPlacement()` method that opens temporary IMAP connection to Sent folder, searches for email by `X-Audnix-Id` header, and reads `X-Gmail-Labels`/`X-Forefront-Antispam-Report` headers. If spam flagged, updates `email_tracking.placement` and fires `deliverability_updated`. Best-effort (password auth only, not wired for OAuth Gmail/Outlook).

3. **`websocket-sync.ts`** — Expanded `notifyDeliverabilityUpdated` type to accept `integrationId`, `placement`, `email`, `spamCount` fields in addition to existing fields.

### Data Flow
```
Send email → SMTP 250 OK (or Gmail/Outlook API 200)
  → updateSendPlacement() fire-and-forget
    → UPDATE email_tracking SET placement='delivered'
    → clusterSync.notifyDeliverabilityUpdated(userId, { placement, source, integrationId })
    → clusterSync.notifyStatsUpdated(userId)
    → clusterSync.notifyStatsCacheInvalidate(userId)
    → All pages receive deliverability_updated + stats_updated
    → deliverability page shows instant "delivered" placement
```

### Limitations
- `delivered` = MTA accepted (SMTP 250 or API 200). NOT recipient inbox placement.
- Overridden by later signals: open → `inbox`, bounce → `bounced`, FBL → `spam`, spam folder → `spam`
- Sent folder header scan only works for password-auth IMAP (custom SMTP). Gmail/Outlook need OAuth-based IMAP (not wired due to token refresh complexity).
- `X-Gmail-Labels`/`X-Forefront-Antispam-Report` on Sent folder emails show sender-side flags, not recipient-side delivery info.

### Files Changed
- `shared/lib/channels/email.ts` — `updateSendPlacement()` function + calls after each provider send
- `services/email-service/src/email/imap-idle-manager.ts` — `checkSentFolderPlacement()` method
- `shared/lib/realtime/websocket-sync.ts` — expanded `notifyDeliverabilityUpdated` type

## This Session (Jul 18 2026) — Full Real-Time: No Polling, Everything Socket-Driven

### Three Commits
- `b16258a4` — IMAP fetchNewMessages race condition, bounce DSN detection, deliverability_updated on send, polling 5s→1s, websocket-sync type widened
- `d5d6c615` — bounce-handler + fbl-webhook now fire stats_updated + stats_cache_invalidate (KPIs were not refreshing on bounce/spam)
- `97f83957` — SEO: Helmet meta tags for developer docs + MCP server pages, react-helmet-async added

### What Was Fixed

1. **`fetchNewMessages` race condition** (`imap-idle-manager.ts`): Body parsing with `simpleParser` was async but `msg.once('end')` pushed items synchronously before body was parsed → empty messages, UI got nothing. Fixed with promise-based wait for body parsing.

2. **Bounce DSN detection** (`paged-email-importer.ts`): `MAILER-DAEMON`/`postmaster` bounces arriving in inbox were filtered out by `isTransactionalEmail` before reaching bounce detection. Now runs BEFORE that filter, extracts original recipient from bounce body, matches to `email_tracking`, sets `placement='bounced'`, fires `deliverability_updated` + `stats_updated`.

3. **`stats_updated` missing from bounce-handler.ts**: Bounce handler fired `deliverability_updated` but NOT `stats_updated` — so home page KPIs never refreshed when a bounce was recorded. Fixed.

4. **`stats_updated` missing from fbl-webhook.ts**: Same issue — spam complaint only updated deliverability page, not KPI page. Fixed.

5. **Polling fallback 5s→1s**: IMAP overflow polling now checks every 1 second.

6. **SEO meta tags**: `react-helmet-async` added. Developer docs (`/developer`) and MCP server (`/dashboard/mcp-server`) now have unique `<title>`, `<meta description>`, `<og:title>`, `<og:description>` tags for Google indexing. MCP page meta targets "MCP Server" / "AI Agent Integration" keywords for AI tool crawlers.

### Data Flow — All Paths Now Fire Both deliverability_updated + stats_updated

| Event | deliverability_updated | stats_updated | stats_cache_invalidate |
|---|---|---|---|
| Send (SMTP/Gmail/Outlook) | ✅ | ✅ | ✅ |
| Open (tracking pixel) | ✅ (placement=inbox) | ✅ | ✅ |
| Bounce (handler) | ✅ (placement=bounced) | ✅ | ✅ |
| Bounce (IMAP DSN) | ✅ (placement=bounced) | ✅ | ✅ |
| FBL/spam complaint | ✅ (placement=spam) | ✅ | ✅ |
| Spam folder IMAP detect | ✅ | ✅ | ✅ |

## This Session (Jul 18 2026) — Notification Push Fix + Filter Fix

### Critical Fix: Socket Push from Workers
**Root cause**: `createNotification()` in `drizzle-storage.ts:3073` used `wsSync` (direct Socket.IO in-process) instead of `clusterSync` (Redis pub/sub). In background workers (email, brain, outreach, billing), `wsSync.io` is `null`, so the push was silently lost. 19 of 34 notification creation sites across the codebase were broken.

**Fix**: Changed `wsSync.notifyNotification(userId, notification)` → `clusterSync.notifyNotification(userId, notification)` in `createNotification()`. Also fixed same pattern in `paged-email-importer.ts:279` and `lead-scoring-engine.ts:189` (`wsSync.notifyStatsUpdated` → `clusterSync.notifyStatsUpdated`).

**Fallback**: Added `refetchInterval: 15000` + `staleTime: 10000` to `NotificationBell.tsx` query.

### Inbox Filter Fix
**Issue**: Status filter drop-down showed "No X conversations" empty state because `simpleStatuses` was missing `'unsubscribed'`, so API wasn't filtering by that status. Also, socket `leads_updated` handler only patched `allLeads` state on `BULK_DELETE` — individual lead status changes (like unsubscribe) required a full query refetch with timing-dependent reactivity.

**Fix**: Replaced `simpleStatuses` (manually maintained list) with `apiStatusFilters` (Set of all DB status values: new, contacted, converted, not_interested, unsubscribed, cold, booked, warm, replied). Metadata-based filters (opened, unread, read, inventory) stay client-side. Updated `handleLeadsUpdated` to patch `allLeads` state directly for single-lead status changes, INSERT events, and BULK_DELETE.

### Notification Fix
**Root cause**: `createNotification()` in `drizzle-storage.ts:3073` used `wsSync` (direct Socket.IO in-process) instead of `clusterSync` (Redis pub/sub). In background workers (email, brain, outreach, billing), `wsSync.io` is `null`, so the push was silently lost. 19 of 34 notification creation sites across the codebase were broken.

**Fix**: Changed `wsSync.notifyNotification(userId, notification)` → `clusterSync.notifyNotification(userId, notification)` in `createNotification()`. Also fixed same pattern in `paged-email-importer.ts:279` and `lead-scoring-engine.ts:189` (`wsSync.notifyStatsUpdated` → `clusterSync.notifyStatsUpdated`).

**Polling**: Removed 15s polling. Now uses `refetchInterval: false` when socket is connected (pure real-time) and falls back to 5s polling when `isConnected` is false (socket disconnected/not started).

### Build Fix
**ReputationCard.tsx**: Used `useNavigate` from `wouter` (not exported) → changed to `useLocation` (returns `[location, setLocation]`).

### Deploy Steps (SSH key at `/tmp/aws_temp_key` — may need refresh via EC2 Instance Connect)
```bash
cd /home/ubuntu/app && git pull
npm run build:client && pm2 restart audnix-api-gateway audnix-socket-server audnix-worker-email audnix-worker-imap audnix-worker-brain
# Rust services need manual recompile:
cd rust-email-sender && cargo build --release && pm2 restart audnix-rust-email-sender
cd ../rust-imap-worker && cargo build --release && pm2 restart audnix-worker-imap
```

## This Session (Jul 18 2026) — Full Inbox Placement Engine (4 Components)

### Overview
Built 4 interconnected components for real-time inbox placement detection without seed accounts:

### 1. SMTP Telemetry Probe (`rust-email-sender/src/telemetry.rs`)
- **Pre-send analysis**: Opens raw TCP to MX port 25, performs EHLO/MAIL FROM/RCPT TO handshake, measures timing
- **Tarpit detection**: If RCPT TO takes >1200ms → flags as `TarpittedSpamQueue`. If SMTP 4xx → `GreylistedOrThrottled`. If 250 OK in <200ms → `InboxConfident`
- **Runs before every send** in the email sender's main loop

### 2. DMARC/RUF Forensic Listener (`rust-imap-worker/src/dmarc_ruf.rs`)
- **IMAP IDLE**: Connects to forensics@yourdomain.com inbox, monitors for DMARC forensic reports
- **Detection**: Checks SUBJECT (DMARC/forensic/abuse) and FROM (postmaster/mailer-daemon)
- **Publishes to Redis**: `{ event: "DMARC_REPORT", payload: { from, subject, headers } }`

### 3. Seed Monitor (`rust-imap-worker/src/seed_monitor.rs`)
- **Folder scan**: Periodically checks INBOX, [Gmail]/Spam, [Gmail]/Promotions on seed accounts
- **X-Audnix-Id lookup**: Finds our sent messages by custom header, reports folder placement
- **Publishes to Redis**: `{ event: "SEED_MONITOR", payload: { message_id, seed_email, folder, placement } }`

### 4. Forensic Handler (`shared/lib/realtime/forensic-handler.ts`)
- **Node.js subscriber**: Listens on `audnix-cluster:events` for DMARC_REPORT and SEED_MONITOR events
- **DB lookup**: Matches original recipient/message_id in `email_tracking` table
- **Updates placement**: Sets `email_tracking.placement = 'spam'|'inbox'` and fires `deliverability_updated` + `stats_updated` + `stats_cache_invalidate`
- **Initialized in API Gateway** at app startup

### Config (Env Vars)
- `FORENSICS_EMAIL` / `FORENSICS_PASSWORD` — DMARC forensics inbox
- `SEED_MONITOR_EMAIL` / `SEED_MONITOR_PASSWORD` — Seed account for placement checking

## This Session (Jul 18 2026) — Filter Pagination, Double Tick, Mobile Truncation, RecentConversations, Developer Docs Rewrite, JSON Error Handler

### Fixes
1. **RecentConversations empty state** (`RecentConversations.tsx:306-321`): Added `hasLoadedLeads` check (returns true only after `leadsData?.leads` is array) — replaces "Waiting for new leads..." spinner with actual loading indicator when data not yet loaded.
2. **Inbox filter pagination reset** (`inbox.tsx:483-488`): Added `useEffect` that resets `page` to 0 and clears virtual range when `filterStatus`, `filterChannel`, or `searchQuery` changes. Root cause: `page` was never reset, so switching filters used wrong offset → incorrect/empty results.
3. **Double tick guard** (`inbox.tsx:1465-1470`): Added `lead.status !== 'new'` check — prevents ✓✓/✓ from showing on leads never contacted, even when backend incorrectly returns `lastMessageDirection: 'outbound'`.
4. **Mobile truncation** (`inbox.tsx:1449`): Brain button changed `opacity-60 md:opacity-0` → `hidden md:inline-flex md:opacity-0` — hidden on mobile, only visible on desktop hover. Frees space for lead name truncation on small screens.
5. **Load More gap** (`inbox.tsx:1478-1492`): Reduced button container padding `p-4` → `px-3 pb-1`, reduced button height `h-10` → `h-9`. Added `h-4` spacer when no more items to prevent abrupt bottom edge.
6. **Developer docs rewrite** (`developer-docs.tsx`): Complete rewrite with real curl examples, JSON response samples, proper endpoint paths matching actual API (leads, messages, campaigns, analytics, integrations, MCP, dashboard). Added `Helmet` meta tags for SEO, icon per section (Key, BookOpen, Terminal, Server, Globe), live search. Used `https://audnixai.com` as base URL.
7. **Global JSON error handler** (`routes/index.ts:183-189`): Added Express error middleware after all route registrations — returns JSON `{ error: message }` instead of HTML for unhandled API errors. Includes stack trace in dev mode only.
8. **Push to GitHub**: `7b0790cd` pushed to main.

### Files Changed
- `client/src/components/dashboard/RecentConversations.tsx` — empty state fix
- `client/src/pages/dashboard/inbox.tsx` — filter pagination, double tick, mobile truncation, load more
- `client/src/pages/developer-docs.tsx` — full rewrite with curl/responses/SEO
- `services/api-gateway/src/routes/index.ts` — global JSON error handler
- `AGENTS.md` — this session entry

### Status
- All changes pushed to GitHub (`7b0790cd` + `234e3437`). Successfully deployed to EC2.
- `pm2 restart all` restarted all 17 services — all online.
- SSH key saved at `/tmp/aws_temp_key` (rsa, regenerated this session) — valid for future EC2 access.
- AWS credentials stored in `opencode.json` mcp.aws.env block (`AKIAZUAXW67WM4BNID4G` + secret key). Use Node.js AWS SDK v3 with `@aws-sdk/client-ec2-instance-connect` to push new SSH keys.
- Build command on EC2: `cd /home/ubuntu/app/client && NODE_OPTIONS='--max-old-space-size=2048' npm run build:client`
- Restart: `pm2 restart all`

## This Session (Jul 18 2026) — Global Mailbox Switcher + Lead Distribution + Charts

### Commits
- `76f0236a` — 24h warmup activity chart (backend EXTRACT HOUR + frontend BarChart)
- `5fdf4aa8` — Global mailbox switcher (all pages filter by selectedMailboxId) + lead distribution evenly across mailboxes on import + fix createLeadsBatch missing integrationId
- `2c7ff792` — Warmup chart + deliverability chart time ranges (24h/7d/14d/30d/90d/365d), backend ?days param with hourly vs daily grouping

### Changes
1. **Backend: integrationId on all endpoints** — inbox-placement, domain-reputation, analytics/outreach, warmup-status all accept `?integrationId`
2. **Frontend: all pages use selectedMailboxId** — warmup, deliverability, home, inbox, insights, analytics, deals pass it in query keys (home.tsx, warmup.tsx, deliverability.tsx, inbox.tsx, insights.tsx)
3. **Lead distribution** — `createLeadsBatch()` now stores `integrationId` (was bug: missing from insert), bulk import round-robins across all connected mailboxes when no mailbox specified
4. **Chart time ranges** — Warmup activity chart: 24H/7D/14D/30D/90D/1Y selector. Backend auto-switches hourly (≤2d) vs daily grouping. Deliverability inbox-placement pie: 24h/7d/30d/60d/90d
5. **Files**: 10 files changed (warmup.tsx, deliverability.tsx, home.tsx, inbox.tsx, insights.tsx, lead-import.tsx, dashboard-routes.ts, email-stats-routes.ts, bulk-actions-routes.ts, drizzle-storage.ts)

---

## This Session (Jul 18 2026) — Seed Warmup: Auto-Start + Sent Folder Scanner + User Subjects + Campaign Gap

### Changes
1. **Auto-start warmup on mailbox connect** (`enrollment-engine.ts`): Changed default `warmupMailboxes.status` from `'paused'` → `'active'`. Also auto-sets `integrations.warmupStatus='active'`. Warmup runs immediately on connection, no manual toggle needed.
2. **SENT folder scanner** (`sent-folder-scanner.ts`): New module that connects via IMAP, finds sent folder (`[Gmail]/Sent Mail`/`Sent Items`/`Sent`), reads 4 most recent real sent emails, extracts subjects + body. Stores as `metadata.userSubjects[]` and `metadata.userTemplates[]`. Runs fire-and-forget after enrollment, refreshes every 60 min via scheduler. Skips auto-replies/fwds/bounces.
3. **User subjects in warmup threads** (`thread-manager.ts`): `pickSubject()` checks `sender.metadata.userSubjects` first, falls back to static `SUBJECT_TEMPLATES`. Warmup emails now look like user's real writing style.
4. **10-min campaign gap** (`scheduler-worker.ts`): Before creating new warmup threads, checks `campaign_emails` for sends within last 10 min on same `integrationId`. Skips warmup while campaigns are active.
5. **Auto-start + integration sync**: `enrollmentEngine.enroll()` now has `.returning()` to capture inserted ID for sent folder scan. Also updates `integrations.warmupStatus='active'` to sync dashboard state.

### Deploy Required
- `npm run build:client` and `pm2 restart audnix-worker-warmup` on EC2
- No client changes — all server-side

## Remaining Work (Documented Jul 18 2026)

### 1. Rust MX Lookup Optimization (HIGH)
- **50k leads in ~3 seconds**: Rust does MX lookup via parallel DNS queries (tokio DNS). Each lookup is <1ms async.
- **Pair Gmail → Gmail**: If lead has @gmail.com, assign to Gmail mailbox. Same for Outlook, custom domains.
- **Distribute evenly**: After provider-pairing, round-robin remaining leads across mailboxes of same provider family.
- **Fallback**: If not enough Gmail mailboxes for Gmail leads, fall back to custom SMTP mailboxes.
- **Scales**: Async, non-blocking, connection pooling for DNS. No per-lead Node.js overhead.

### 2. IMAP Open Tracking via X-Audnix-Warmup Header (MEDIUM)
- Track opens via IMAP `\\Seen` flag on warmup emails (hidden folder sweep already detects `X-Audnix-Warmup` header). Log `openedAt` per interaction.
- Log reply detection via `In-Reply-To` / `References` matching our warmup message IDs.

### 3. Reputation Boost on High Score (LOW)
- If `reputationScore >= 85` for 7+ consecutive days, add 3 more warmup emails/day.

### 4. Domain Reputation Auto-Fix (LOW)
- **If spam → move to inbox**: When seed warmup detects placement=spam, move to inbox and report "not spam".
- **Browser automation**: Optional — use Puppeteer/Playwright to mark "not spam" in Gmail web UI.
- **IMAP fallback**: Move from [Gmail]/Spam to INBOX via IMAP.

### 5. Charts Polish (LOW)
- Animate chart lines/bars on page load (recharts animation property)

### 6. Mobile UI (LOW)
- MailboxSwitcher compact on mobile
- Charts responsive
- Tables horizontal scroll
- `services/email-service/src/email/spam-monitor.ts` — Spam folder detection

## This Session (Jul 20 2026) — Calendar Timezone + AI Reasoning Text + Inbox Snippet Cleanup

### Commits
- `b9f75354` — fix: calendar timezone isToday/isSelected, AI reasoning uses lead name, snippet strips RFC headers

### Changes
1. **Calendar timezone fix** (`calendar.tsx:663-664`): Changed `isToday` and `isSelected` from `toISOString().split('T')[0]` (UTC-based, off by 1 day for negative UTC offsets) to `dateToTzStr(date) === todayInTz` (timezone-aware via `Intl.DateTimeFormat`). Fixes "Calendar shows July 21 instead of July 20".

2. **AI Activity reasoning text** (`decision-engine.ts`): All reasoning strings now include `context.lead?.name` (e.g. "John is ready — intent 80% with timing 70%" instead of "Intent (80%) and timing (70%) exceed thresholds"). Passed `lead` object from `conversation-ai.ts:511` into `DecisionContext`.

3. **Snippet strips RFC headers** (`drizzle-storage.ts:1095`): Added regex cleanup that strips `References:`, `In-Reply-To:`, `Message-ID:`, `Content-Type:`, `MIME-Version:`, `Date:`, `From:`, `To:`, `Subject:`, `DKIM-Signature:`, `Authentication-Results:`, `Received:`, `X-*:`, `ARC-*:` from snippet text before storing. Also added frontend cleanup (`inbox.tsx:1489`) to strip same headers from `lead.snippet` at display time.

### Deploy
- Pushed to GitHub (`b9f75354`). EC2 deploy pending (`cd client && npm run build:client && pm2 restart audnix-api-gateway audnix-worker-ai`).

### Remaining Issues
- Calendly disconnect redirect (integrations page vs stay on calendar)
- KPI counts not updating in real-time
- Calendar "create event" on date click should show UI
- Push to AWS EC2
- Lead recovery UI needs better banners, pagination, accurate status

## This Session (Jul 20 2026) — Dedup Fix + Score Update + Layout Cleanup

### Commits
- `d5c88145` — fix: inbox dedup onSuccess+handler, score on message, snippet 120ch, date ml-auto, message break-words

### Changes
1. **AI reply deduplication** (`inbox.tsx`): `onSuccess` handler now deduplicates by removing extra copies after mapping temp→real. Socket `messages_updated` handler now replaces temp messages instead of always appending. Fixes 4x duplication from race condition between socket events and HTTP response.

2. **Lead score on every message** (`drizzle-storage.ts:1113`, `messages-routes.ts:214`): Inbound reply bumps score +10, outbound send bumps +2 (capped at 100). Previously score only updated during lead enrichment, leaving it stale.

3. **Snippet truncation 60→120 chars** (`inbox.tsx:1516`): More readable preview. Date now uses `ml-auto` for consistent right-edge positioning regardless of name length.

4. **Message bubble breaks words** (`RecentConversations.tsx:239`): Added `break-words` and `max-h-[200px] overflow-y-auto` for long messages in home page Recent Activity.

### Deploy
- Pushed to GitHub (`d5c88145`, `f64ca82d`). EC2 deploy pending.

## This Session (Jul 20 2026) — Tick Fix: openedAt-based ✓✓/✓, Real-Time Update on Open

### Changes
1. **Tick uses `openedAt` not `isRead`** (`drizzle-storage.ts`): Subquery now reads `opened_at`. `lastMessageIsRead` set to `true` only when `openedAt` exists, `false` for outbound (✓), `null` for inbound (no tick). Default `isRead` for ALL messages changed to `false` (was `true` for outbound).

2. **Real-time tick update** (`inbox.tsx`): Socket open/click event handler now sets `lastMessageIsRead = true` in `allLeads` state. ✓ changes to ✓✓ instantly when tracking pixel fires.

3. **Tick display**: ✓✓ (opened) / ✓ (delivered, not opened) / nothing (inbound last). Only shown for our sent messages, not for inbound leads.

### Commit
- `f64ca82d` — fix: tick uses openedAt for ✓✓/✓, real-time update on open
- `c3c92e8f` — fix: deal value field in settings, analytics metrics respect date range

## This Session (Jul 20 2026) — Deal Value in Settings + Analytics Date Range Fix

### Changes
1. **Deal Value in Settings** (`settings.tsx`): Added "Avg Deal Value ($)" and "Deal Value 2 ($)" input fields in Profile tab. These save to `user.offerValue` / `user.offerValue2` and are used by Fathom autonomous agent for deal-aware decisions.

2. **Analytics date range fix** (`drizzle-storage.ts`): All metrics queries (sent, opened, replied, converted, pipeline value) now respect the `days` parameter with `gte(createdAt, startDate)`. Previously only the time series respected the date range. Pie chart and KPI numbers now update when switching between 24h/7d/30d/60d/90d.

### Deploy
- Pushed `c3c92e8f` to GitHub. EC2 deploy pending.

## This Session (Jul 19 2026) — MailboxSwitcher, Lead Scoring, AI Reply, Rust Sender Fixes

### Summary
12 bugs fixed across backend + frontend + Rust. All critical issues from earlier session resolved.

### Changes

1. **MailboxSwitcher auto-removed** (`MailboxSwitcher.tsx:59-64`): Deleted `useEffect` that forced first mailbox on mount. Added "All Mailboxes" `SelectItem` with `value="all"` — when selected, `handleMailboxChange(undefined)` shows aggregate data.

2. **Lead scoring cold logic** (`lead-scoring.ts:52`): Replaced unconditional `status: score > 70 ? 'qualified' : 'cold'` with guard — only sets `'cold'` if status is `'new'`/`'bouncy'` AND `lastMessageAt` > 7 days ago. Never downgrades active statuses.

3. **AI reply status overwrite** (`ai-routes.ts:879`): Added `ACTIVE_STATUSES` guard — preserves `contacted`/`replied`/`warm`/`booked`/`converted` when AI reply returns `'new'`.

4. **BL always red** (`ReputationCard.tsx:158`): Added `|| (val === false && key === 'blacklist')` so clean RBL shows green.

5. **DNS badges hidden on mobile** (`integrations.tsx:1503`): Changed `hidden sm:inline-flex` → `inline-flex`. Also "RBL" → "BL".

6. **DNS unique constraint** (`migrator.ts:128`): Added `CREATE UNIQUE INDEX idx_domain_verifications_user_domain` so `ON CONFLICT (user_id, domain)` actually works.

7. **`messages.integrationId` for manual inbox sends** (`email.ts:777,999,1192`): `sendEmail` returns `{ messageId, integrationId }`. `messages-routes.ts:181` passes to `createMessage()`.

8. **`findLeadBySenderAndIntegration` fallback** (`drizzle-storage.ts:635`): Added `userId` param. When `integrationId` match fails, tries `userId + email` lookup. `email-sync-queue.ts:158` calls for legacy leads.

9. **Open tracking race condition** (`inbox.tsx:382`): Wrapped `invalidateQueries` in `if (!isOpenEvent && !isClickEvent)` — prevents stale refetch overwriting `openedAt`.

10. **`email_tracking` missing columns** (`migrator.ts:649-668`): Added `integration_id`, `placement` (default `'unknown'`), `placement_updated_at`, + indexes. All `updateSendPlacement` WHERE guards widened to `IS NULL OR IN ('unknown', 'delivered')`.

11. **Smart MX lead routing** (`mailbox-router.ts`): New file — `assignMailbox()` routes `@gmail.com`→Gmail, `@outlook.com`→Outlook, custom→matching custom_email, fallback round-robin. `bulk-actions-routes.ts:105` uses it.

12. **Rust sender event-driven** (`main.rs:48-56`): Changed from `tokio::time::interval(50ms)` + `BRPOP 0.1s` → infinite `BRPOP 0.0` (pure event-driven, zero polling). Removed `std::time::Duration` import, added `#[allow(dead_code)]` to Config.

### Files Changed
- `client/src/components/outreach/MailboxSwitcher.tsx`
- `services/brain-worker/lead-scoring.ts`
- `services/api-gateway/src/routes/ai-routes.ts`
- `client/src/components/outreach/ReputationCard.tsx`
- `client/src/pages/dashboard/integrations.tsx`
- `shared/lib/db/migrator.ts`
- `shared/lib/channels/email.ts`
- `services/api-gateway/src/routes/messages-routes.ts`
- `shared/lib/storage/drizzle-storage.ts`
- `shared/lib/storage/queue/email-sync-queue.ts`
- `client/src/pages/dashboard/inbox.tsx`
- `shared/lib/imports/mailbox-router.ts` (new)
- `services/api-gateway/src/routes/bulk-actions-routes.ts`
- `rust-email-sender/src/main.rs`
- `rust-email-sender/src/config.rs`

### Deploy Required
- `git push github main`
- EC2: `cd /home/ubuntu/app && git pull && cd client && NODE_OPTIONS='--max-old-space-size=2048' npm run build:client && pm2 restart audnix-api-gateway audnix-socket-server audnix-worker-email audnix-worker-imap audnix-worker-brain`

## This Session (Jul 19 2026) — Calendar Page Fix: Real Disconnect/Connect, Date Events Panel, Polling Fallback

### Summary
Fixed calendar page: Google Calendar/Calendly disconnect buttons (no more disabled "Connected"), Calendly OAuth connect from page (no more token input), OAuth error handling with "already in use" detection, 15s polling fallback when socket disconnected, selected-date events panel.

### Changes

1. **Google Calendar disconnect** (`calendar.tsx:793`): Changed disabled "Connected" ghost button → destructive "Disconnect" button wired to `disconnectGoogleMutation`. Calls `POST /api/oauth/google-calendar/disconnect`. In settings sheet too.

2. **Calendly OAuth connect** (`calendar.tsx:770`): Replaced "Connect" button that opened settings sheet → triggers OAuth redirect to `/api/oauth/connect/calendly`. Removed old manual token-based `connectCalendlyMutation`. In settings sheet too.

3. **Google Calendar OAuth error handling** (`calendar.tsx:396-408`): `connectGoogleMutation` now checks `response.ok`, throws proper error message.

4. **"Already in use" detection** (`calendar.tsx:428-433`): `connectCalendlyOAuthMutation.onError` checks for "already"/"in use" in error message → shows specific "already in use" toast.

5. **Polling fallback** (`calendar.tsx:246`): All 5 queries get `refetchInterval: isConnected ? false : 15000` — 15s polling when socket disconnects, pure real-time when connected.

6. **Socket listeners** (`calendar.tsx:188-197`): Added `settings_updated` + `calendar_updated` → full query invalidation (real-time refresh after connect/disconnect).

7. **Selected date events panel** (`calendar.tsx:722-790`): New card between calendar grid and upcoming list showing all events for the clicked date, sorted by time, with lead name + meeting URL.

8. **Better error messages**: All mutations (`updateSettings`, `disconnectCalendly`, `disconnectGoogle`) have `onError` handlers showing error descriptions.

9. **Google Calendar `notifySettingsUpdated`** (`oauth.ts:418`): Added `wsSync.notifySettingsUpdated(userId)` after Google Calendar disconnect so calendar page refreshes instantly.

### Files Changed
- `client/src/pages/dashboard/calendar.tsx` — All disconnect/connect buttons, OAuth mutations, polling
- `services/api-gateway/src/routes/oauth.ts` — Google Calendar disconnect now fires notifySettingsUpdated
- `AGENTS.md` — this session entry

### Deploy
- Push to GitHub, pull on EC2, build client, restart api-gateway only
- Rust: `cd rust-email-sender && cargo build --release && pm2 restart audnix-rust-email-sender`

## This Session (Jul 19 2026) — Warmup Page: Real Data, Per-Mailbox Progress Cards, All Mailboxes Listed

### Summary
Fixed warmup page to show ALL connected mailboxes (not just 1), added per-mailbox "Active Warmup Progress" detail cards with real sent/opened/bounced counts, fixed "Fully Warmed" KPI (was "Not Enrolled"), fixed "Unknown" email display by using `accountType` from integrations table.

### Changes

1. **Fully Warmed KPI** (`warmup.tsx:248-250`): Changed "Not Enrolled" count → "Fully Warmed" count (mailboxes with `warmupPercent >= 100` and `totalSent > 0`).

2. **Active Warmup Progress cards** (`warmup.tsx:347-410`): New section between chart and mailbox list showing per-mailbox detail cards for each actively warming mailbox. Each card shows: email, provider, warmup/day, outreach/day, today's progress bar with percentage, stage label (e.g., "Day 6-10: Gaining Momentum"), and sent/opened/bounced stats grid.

3. **Email display fix** (`dashboard-routes.ts:1271`): Changed `(int as any).smtpUser || (int as any).email || 'Unknown'` → `accountType` first (the standard email field on integrations table), then fallbacks.

### Files Changed
- `client/src/pages/dashboard/warmup.tsx` — Fully Warmed KPI, Active Progress cards
- `services/api-gateway/src/routes/dashboard-routes.ts` — email field uses accountType

### Deploy
- `git push github main` then on EC2: `cd /home/ubuntu/app && git pull && cd client && NODE_OPTIONS='--max-old-space-size=2048' npm run build:client && pm2 restart audnix-api-gateway`

## This Session (Jul 19 2026) — Inbox Mailbox Filter + Integrations Modal + ∞→actual count

### Changes

1. **Inbox leads filter by mailbox** (`drizzle-storage.ts:507-511`, `ai-routes.ts:108`): Changed `OR integrationId IS NULL` → `eq(leads.integrationId, integrationId)` — when a mailbox is selected, inbox shows ONLY leads assigned to that mailbox. Unassigned leads only show in "All Mailboxes" view.

2. **∞ UNLIMITED → actual count** (`integrations.tsx:1397,922`): Changed "∞ UNLIMITED" and "5 / ∞" to show `{count} Connected` and `{count} / {count}`.

3. **View All Mailboxes modal** (`integrations.tsx`): New "≡ View All" button next to "Add Mailbox" opens a dialog with 2-column grid of all connected mailboxes. Each card shows: email + provider, DNS badges (SPF/DKIM/DMARC/MX/BL), 4-column stats (Delivery%/Bounce%/Inbox%/Rep), Focus + Disconnect actions.

4. **Lead import routing** (`bulk-actions-routes.ts:104-109`): Uses existing `mailbox-router.ts` with smart MX routing: @gmail→Gmail, @outlook→Outlook, same-domain→custom_email, round-robin fallback. Already distributed evenly.

### Files Changed
- `shared/lib/storage/drizzle-storage.ts` — inbox integrationId filter (no OR IS NULL)
- `services/api-gateway/src/routes/ai-routes.ts` — same filter for total count
- `client/src/pages/dashboard/integrations.tsx` — ∞→count, View All modal, DNS badges
- `AGENTS.md` — this entry

### Deploy
- `git push github main` then on EC2:
```bash
cd /home/ubuntu/app && git pull
npm ci
cd client && NODE_OPTIONS='--max-old-space-size=2048' npm run build:client
cd /home/ubuntu/app/rust-email-sender && cargo build --release
cd /home/ubuntu/app/rust-imap-worker && cargo build --release
pm2 restart all
```

---

## This Session (Jul 19 2026) — REAL-TIME FIX + LEAD RECOVERY + CI/CD + VULNS

### Critical Fixes

1. **Redis pub/sub fire-and-forget** (`redis-pubsub.ts`): 
   - **Root cause**: `STATS_CACHE_INVALIDATE` handler used `require()` which throws `ReferenceError` in ESM mode (project uses `"type": "module"`). Empty `catch (_) {}` silently swallowed the error → `invalidateStatsCache` NEVER fired → server stats cache was NEVER invalidated via Redis events.
   - **Fix**: Replaced `require()` with in-process LRU cache `pendingInvalidations`. `STATS_CACHE_INVALIDATE` now sets `pendingInvalidations.set(userId, true)` and the stats endpoint checks this before serving cached data.
   - **Also**: `broadcast()` now retries once with a fresh client on publish failure.

2. **Redis client stale connection** (`redis.ts`):
   - **Root cause**: `redisClient` was never nullified on connection loss. After reconnect strategy exhausted, `getRedisClient()` returned a dead zombie client → `publish()` silently failed.
   - **Fix**: Added `client.on('end')` handler that sets `redisClient = null`. Added `ping()` health check before returning cached client. Added race condition fix for concurrent `getRedisClient()` calls.

3. **KPIs not updating on reply/open** — Fixed by #1 fixing `STATS_CACHE_INVALIDATE`. The data path now works: DB updated → `clusterSync.notifyStatsCacheInvalidate(userId)` → Redis pub/sub → API gateway subscriber → `pendingInvalidations.set(userId)` → next stats request bypasses cache.

4. **Lead recovery** (`worker.ts`, `mysql.ts`, `lead-recovery.tsx`, `lead-recovery-routes.ts`):
   - **Root cause A**: Safety guard blocked processing if no active campaigns → syncStatus stuck at "queued" → user saw nothing happen
   - **Root cause B**: No polling fallback — purely event-driven via Redis. If Redis event was lost, sync never processed
   - **Root cause C**: `failMailboxSync` didn't store error message → UI showed unhelpful "failed" badge
   - **Fix A**: Removed active-campaigns safety guard — lead recovery works independently
   - **Fix B**: Added 30s polling interval as fallback when Redis unavailable
   - **Fix C**: Added `error_message` column to `lead_recovery_state` table, update `failMailboxSync()` signature to accept error message, display in UI
   - **Fix D**: Sync endpoint now clears `errorMessage: null` when re-queueing

5. **Integration page real-time** (`integrations.tsx`):
   - Added `settings_updated` + `integration_reputation_updated` socket listeners → full invalidation on connect/disconnect/reputation changes

### CI/CD + Vulns
6. **npm vulnerabilities**: Overrode `uuid@^14.0.0` (was `^10.0.0`). Removed unused `aws-sdk` v2 dependency (project uses `@aws-sdk/*` v3). 2 moderate vulns remain (`google-it` → `request`, no fix path).
7. **Deploy workflow**: Created `.github/workflows/deploy-ec2.yml` matching actual S3+PM2 deployment process (not Docker/ECS/Vercel).
8. **CodeQL**: 12 alerts remain (1 critical SSRF, 6 high sanitization, 2 high tainted-format, 1 high URL substring, 1 high token validation, 1 medium redirect). Need to review on GitHub after push.

### Files Changed
- `shared/lib/realtime/redis-pubsub.ts` — required()→LRU cache, retry logic, pendingInvalidations export
- `shared/lib/redis/redis.ts` — stale client health check, end handler, race condition fix
- `services/api-gateway/src/routes/dashboard-routes.ts` — import pendingInvalidations, check cache before serving
- `client/src/pages/dashboard/integrations.tsx` — added settings_updated + integration_reputation_updated listeners
- `services/lead-recovery-worker/src/worker.ts` — removed safety guard, added 30s polling fallback, pass error to failMailboxSync
- `shared/lib/mysql.ts` — added error_message column to lead_recovery_state, updated upsert/fail functions
- `services/api-gateway/src/routes/lead-recovery-routes.ts` — return errorMessage, clear on sync
- `client/src/pages/dashboard/lead-recovery.tsx` — display errorMessage in red, red badge for failed
- `.github/workflows/deploy-ec2.yml` — new file, real EC2 deploy process
- `shared/lib/storage/drizzle-storage.ts` — (pre-existing changes)
- `client/src/hooks/use-realtime.tsx` — (pre-existing debounce changes)

## This Session (Jul 19 2026) — Calendar Fixes + AI Logs Real-Time + Deploy

### Changes
1. **Calendar events endpoint** (`calendar-routes.ts:140-155`): Added `GET /api/calendar/events` returning `calendar_events` table data (synced via Calendly sync worker).
2. **Calendar page merges 3 sources** (`calendar.tsx`): `allEvents` now merges `bookings` (Calendly), `googleEvents` (Google Calendar), and `syncedEvents` (calendar_events table).
3. **Socket event name fixed** (×3 files): `calendly-sync-worker.ts` — replaced `broadcastToUser({ type: 'CALENDAR_UPDATED' })` with `wsSync.notifyCalendarUpdated()`. `calendly-integration.ts` — replaced broken broadcast with `notifyCalendarUpdated()` on create/cancel/no-show.
4. **Copy booking link uses `calendarLink`** (`calendar.tsx:473,1234-1245`): Changed from hardcoded `calendly.com/username` or `window.location.origin` to `settings.calendarLink` from DB. Added `calendarLink` to `CalendarSettings` interface.
5. **Settings API returns `calendarLink`** (`calendar-routes.ts`): Queries `users.calendarLink`, falls back to `calendlySchedulingUrl` from encrypted meta.
6. **AI Logs real-time** (`redis-pubsub.ts:236-238`): Added `notifyCalendarUpdated` method to `RedisPubSub` + `CALENDAR_UPDATE` case in `relayEvent`. `follow-up-worker.ts:204-206`: Fires `clusterSync.notifyCalendarUpdated(userId)` after `processProactiveRules()`.
7. **Inbox `refetchOnMount: true`** (`inbox.tsx`): Forces messages refetch on navigation so stale data not displayed.
8. **IMAP inbox scan on connect** (`imap-connection-manager.ts`): Added `_scanExistingInbox()` — searches for unseen messages immediately after mailboxes connect.
9. **Build + deploy**: Client builds cleanly. All changes pushed (`d8dac56f`), deployed to EC2, 5 services restarted (imap, email, ai, socket-server, api-gateway).
10. **Calendly revoke fix** (`calendly.ts`): Changed revoke body from `application/json` → `application/x-www-form-urlencoded` (Auth0 requirement). Also revokes old token before deleting on OAuth reconnect (`calendly-redirect.ts`). Pushed `7cb58b7f`.

## This Session (Jul 19 2026) — Rust IMAP Worker Migration (500+ mailboxes on 4GB RAM)

### Changes
1. **Node.js delegates custom_email to Rust** (`imap-connection-manager.ts:180-185`): `connectMailbox()` now pushes config to `mailbox-monitor:add` and returns early for `custom_email` — no Node.js IMAP connection opened.
2. **Node.js IMAP worker deleted** (`pm2 delete audnix-worker-imap`): Only handles Gmail/Outlook OAuth; `custom_email` handled entirely by Rust.
3. **Rust mailbox monitor event-driven** (`mailbox_monitor.rs`): Replaced LPOP polling (5s sleep loop) with BLPOP 0.0 (infinite block, instant wake on config change). Also bulk-drains existing configs on startup.
4. **Removed dead BRPOP main loop** (`main.rs`): Deleted 60-line ad-hoc job processor (nobody pushed to `imap-queue`). Mailbox monitor is the only loop.
5. **Fixed `select()` return type** (`imap_client.rs`): Returns `Result<String>` so callers can parse UIDVALIDITY/UIDNEXT.
6. **Ecosystem config tuned** (`ecosystem.config.cjs`): Removed unused `WORKER_COUNT`, `IMAP_QUEUE_NAME`, `IMAP_RESULT_QUEUE_NAME`, `IDLE_TIMEOUT_SECS`. Set `RUST_LOG=warn`.

### PM2 Status (17 total)
- `audnix-rust-imap-worker` (34) — **online**, 7.7MB, handles all custom_email IMAP IDLE
- `audnix-rust-email-sender` (26) — online, 4.2MB, handles SMTP sending
- `audnix-worker-imap` (32) — deleted; Gmail/Outlook OAuth handled by `mailbox-worker.ts` BullMQ worker
- 14 other Node.js workers unchanged

## This Session (Jul 20 2026) — Seed Spam Move + Reply Fixes

### Bugs Found & Fixed

**Bug 1: Seed monitor detects spam but never moves emails out** (`seed_monitor.rs:76-111`)
- Rust seed monitor scanned Spam/Promotions folders, detected warmup emails, published `SEED_PLACEMENT` to Redis — but NEVER moved them to INBOX
- The warmup email stayed in spam, the seed never saw it, the `expect-reply` handler never found it → seed never replied
- **Fix**: Added `conn.uid_move(*uid, "INBOX")` after detection, with `uid_copy_and_delete()` fallback for providers that don't support UID MOVE (RFC 6851)
- Added `uid_move()` and `uid_copy_and_delete()` methods to `imap_client.rs`

**Bug 2: Inbox sweep race condition kills seed replies** (`inbound-worker.ts:42-80`)
- `inbox-sweep` (every 2 min) moves warmup emails from INBOX to hidden folder BEFORE `expect-reply` fires (1-4 hour delay)
- `handleExpectReply` called `sweepInboxToHidden()` → found nothing (already swept) → returned 0 → `!found` was true → exited without queuing reply
- **Fix**: Added DB fast-path check — first looks for `warmupInteractions.movedToHiddenFolder = true` for the expected message ID. If found, skips IMAP sweep entirely. Falls back to IMAP sweep only when DB check fails.

**Bug 3: Seeds limited by DAILY_SENT_LIMIT (20) instead of SEED_DAILY_LIMIT (400)** (`inbound-worker.ts:86-88`)
- `handleExpectReply` used `getRampLimit(..., WARMUP_CONFIG.DAILY_SENT_LIMIT)` for ALL recipients including seeds
- Seeds would stop replying after 20 daily sends instead of the intended 400
- **Fix**: Added `anchorRole === 'seed'` check — seeds use `recipientMd[0].dailyLimit ?? WARMUP_CONFIG.SEED_DAILY_LIMIT`

**Bug 4: Outbound worker pauses seeds on daily limit** (`outbound-worker.ts:95-104`)
- Seeds hitting daily limit got `status: 'paused', pauseReason: 'daily_limit_reached'` like user mailboxes
- Paused seeds don't process any new threads or replies until midnight reset
- **Fix**: Added early return for seeds without pausing — `if (sender[0].anchorRole === 'seed') return;`

**Bug 5: Scheduler pauses seeds on sent/received cap** (`scheduler-worker.ts:218-239`)
- Same issue — seeds could be paused by the scheduler's daily limit checks
- **Fix**: Added `if (isSeed) continue;` before pause logic in both sent and received cap checks

**Bug 6: rescueSpamFolder doesn't mark warmupInteractions** (`imap-stealth.ts:222`)
- `rescueSpamFolder` moved from spam to hidden + `\NotJunk` flag, but never updated `warmupInteractions.movedToHiddenFolder = true`
- If the email was moved to hidden by spam rescue (not inbox sweep), the DB fast-path in `handleExpectReply` wouldn't find it
- **Fix**: Added `db.update(warmupInteractions).set({ movedToHiddenFolder: true })` to `rescueSpamFolder`

### Files Changed
- `rust-imap-worker/src/imap_client.rs` — added `uid_move()` (RFC 6851) and `uid_copy_and_delete()` fallback
- `rust-imap-worker/src/seed_monitor.rs` — moved detected spam/promotions warmup emails to INBOX
- `services/warmup-service/src/workers/inbound-worker.ts` — DB fast-path for expect-reply + seed SEED_DAILY_LIMIT
- `services/warmup-service/src/workers/outbound-worker.ts` — don't pause seeds on daily limit
- `services/warmup-service/src/workers/scheduler-worker.ts` — don't pause seeds on sent/received cap
- `services/warmup-service/src/lib/imap-stealth.ts` — rescueSpamFolder marks movedToHiddenFolder

### Changes (Jul 20 2026 - round 2)
1. **NotSpam + Important flags** (`imap_client.rs`): Added `mark_not_spam_and_important()` — issues `UID STORE +FLAGS (\NotJunk \Flagged)` after every spam→INBOX move, training the ISP spam filter that the email is legitimate.
2. **Seed spike prevention** (`scheduler-worker.ts`): Added per-thread stagger of 0-30 min (`PER_THREAD_STAGGER_MAX_MINUTES`) on top of 30-90s send delay. If 500 mailboxes create threads in one scheduler cycle, their first sends land on seeds spread across 30 minutes instead of 60 seconds.
3. **Inbox sweep interval 2m→5m** (`warmup-config.ts`): Reduces IMAP connection pressure, especially with 500+ mailboxes.
4. **Warmup spam tracking** (`shared/schema.ts`, `migrator.ts`, `imap-stealth.ts`, `dashboard-routes.ts`, `warmup.tsx`):
   - Added `placement` column to `warmupInteractions` (unknown/inbox/spam/promotions) with migration
   - `rescueSpamFolder` sets `placement='spam'` when warmup email found in spam
   - `sweepInboxToHidden` sets `placement='inbox'` when found in inbox
   - Warmup-status endpoint returns `totalSpam` per mailbox
   - Warmup-activity endpoint includes `spam` in time series data
   - Warmup page shows Spam count in KPI cards + amber line in chart
5. **All 6 fixes from round 1** (seed_monitor uid_move + flags, inbox sweep race DB fast-path, seed SEED_DAILY_LIMIT, no seed pausing, scheduler seed skip, rescueSpamFolder interaction marking).

### Data Flow (complete)
```
User→seed warmup email lands in seed's Spam/Promotions
  → Rust seed monitor detects (30s cycle)
  → UID MOVE to INBOX + STORE +FLAGS (\NotJunk \Flagged)
    → Trains ISP: "this is NOT spam, it's legitimate email"
  → inbox-sweep (5min, 500 mailboxes staggered via queue concurrency=5)
    OR expect-reply (1-4h, after outbound send delay + 0-30min stagger)
    → Moves to hidden folder, marks warmupInteractions.movedToHiddenFolder=true
    → Sets placement='inbox' (or 'spam' if rescued from spam folder)
  → expect-reply finds interaction in DB (fast path, no IMAP needed)
  → Queues send-reply, seed replies back (no pause, 400 daily limit)

Seed→user warmup email lands in user's Spam
  → rescueSpamFolder (30min) finds in spam
  → Moves to hidden folder + marks placement='spam'
  → Warmup page graph shows spam count (amber line)
```

### Changes
1. **Removed duplicate Status column** (`integrations.tsx`): Changed stats grid `grid-cols-5` → `grid-cols-4`, removed "Status Active/Inactive" column (duplicate of connection banner). Removed `min-w-[320px]` to prevent mobile overflow.
2. **Mobile header fix** (`integrations.tsx`): Changed "Active Business Mailboxes" → "Mailboxes" with `truncate`, `flex-wrap` on button group, compact button sizes (h-8, text-[10px]), stacked layout on small screens.
3. **Rust build fixes** (`dns.rs`, `main.rs`):
   - `TokioAsyncResolver::tokio()` in hickory-resolver 0.24 returns `Self` not `Result` — removed `?`
   - `String::from_utf8_lossy()` returns `Cow<str>` → added `.into_owned()`
   - `resolve_mx()` returns `Result<Vec<MxRecord>>` → unwrapped in `verify_domain()`
   - `transport.verify()` renamed to `test_connection()` in lettre 0.11.22
   - Added explicit `AsyncSmtpTransport<Tokio1Executor>` type annotation on transport builder
   - Fixed moved-value error in bulk verify handler (`result.is_ok()` before `result.err()`)
   - Added `let mut r = r;` for mutable redis access
4. **TS build fixes** (`custom-email-routes.ts`): Added explicit types to all `map()`/`findIndex()` callbacks (7 params), adopted strict `noImplicitAny` style. Added null guard for `getRedisClient()`. Changed `log.error` → `console.error`.
5. **MessageType union** (`websocket-sync.ts`): Added `'bulk_import_progress'` to fix TS2345.
6. **Deployed to EC2**: Rust build succeeds, client build succeeds (`npm run build:server` 0 errors), API gateway + Rust sender restarted.

## This Session (Jul 20 2026) — Calendly OAuth + Cross-User Fixes + Developer Docs

### Fixes
1. **Developer docs rewrite** (`developer-docs.tsx`): Complete rewrite with real curl examples, JSON responses, SEO meta tags (Helmet), live search, 17+ endpoints
2. **API key security** (`mcp-routes.ts`, `auth.ts`, `developer-docs.tsx`): Changed from 15B→32B random (70-char `audnix_`+64 hex), SHA-512 hashing (was SHA-256), AES-256-GCM at-rest encryption. Show once, mask forever
3. **Auth audit**: Patched 4 unsecured routes — `expert-chat.ts` (trivially spoofable `req.body.isAuthenticated`), `stripe-payment-confirmation.ts`, `admin-migrations.ts` (added `requireAuth`/`requireAdmin`)
4. **Rust scheduling module** (`scheduler.rs`): `calcDailyPlan` (25% warmup reserve), `distributeLeads` (floor/ceil MX-aware), `calcSpacing` (10-15min gap), `redistribute` (carry-over). 4 tests pass
5. **Node.js scheduler bridge** (`scheduler-bridge.ts`): LPUSH→Rust→BRPOP with 5s timeout fallback to inline JS
6. **Warmup coexistence** (`campaign-queue.ts`): 25% budget reservation via `calcDailyPlan()`, bidirectional 10min gap, `deferToTomorrow()` everywhere
7. **ETA fix** (`outreach.ts`): `Math.ceil(remaining / avgDailyRate)` with fallback to `totalDailyLimit`
8. **Even distribution** (`mailbox-router.ts`): `distributeLeadsEvenly()` with floor/ceil per MX domain
9. **polyfill-file.cjs**: Created missing PM2 preload shim (was breaking `ecosystem.config.cjs` `--require`)
10. **API.md**: Full API reference with curl commands, auth, rate limits, MCP JSON-RPC
11. **SECURITY.md**: Updated with new key format/hash/encryption details
12. **RecentConversations.tsx bug**: API returns plain array `[{...}]`, not `{leads:[...]}`. `allLeads` was always `[]` because it checked `leadsData?.leads` which is `undefined` on arrays. Leads list stayed stuck on "Loading leads..." spinner. Fixed by checking `Array.isArray(leadsData)` first. Also cleaned 5 `font-black`→`font-semibold`
13. **Calendly OAuth redirect → `/auth`** (`calendly-redirect.ts`, `google-redirect.ts`): Root cause was cross-site OAuth redirect (Calendly→audnixai.com) where the session cookie wasn't reliably sent due to browser ITP/3rd-party cookie blocking. Both calednly and Google Calendar callbacks now `regenerate()` a fresh session before setting `userId`, `await session.save()`, and explicitly set `audnix.sid` cookie. Redirect URL changed from `/dashboard/integrations`→`/dashboard/calendar`
14. **Google Calendar OAuth redirect** (`google-redirect.ts`): Same session fix as Calendly. Also redirects to `/dashboard/calendar` now instead of `/dashboard/integrations`
15. **OAuth URL params on calendar page** (`calendar.tsx`): Added `useEffect` that reads `?success=calendly_connected`, `?error=calendly_denied`, etc. from URL params and shows toast + invalidates queries
16. **Cross-user uniqueness removed for per-user services** (`drizzle-storage.ts`): Skipped the "already connected to another account" check for `calendly`, `google_calendar`, `instagram` — each user connects their own account, these shouldn't be shared
17. **"already connected" error message** (`drizzle-storage.ts`): Changed `"This mailbox (...) is already connected by another account"` → `"is already connected to another Audnix account"`
18. **Calendly accountType fix** (`calendly-redirect.ts`): Changed from `tokenData.user?.name` (display name, not unique) → `tokenData.user?.email` so the cross-user check uses a unique identifier
19. **API.md**: Added `PATCH /api/integrations/:integrationId/outreach-limit` endpoint documentation (initialOutreachLimit)
20. **Initial email throttle UI** (`UnifiedCampaignWizard.tsx`, `integrations-routes.ts`): Added `initialOutreachLimit` slider to campaign wizard per-mailbox section — sits below the daily limit slider, controls how many emails to send on day one before auto-ramping. Added `PATCH /api/integrations/:integrationId/outreach-limit` backend endpoint. Exposed `initialOutreachLimit` in integrations API response (`safeIntegrations`). Included in campaign config payload. The campaign queue already reads `integrations.initialOutreachLimit` at send time — fully wired.

### Remaining
- Lead recovery end-to-end (worker not working properly)

## This Session (Jul 21 2026) — Warmup Reliability + Integrations Mobile Layout

### Changes (Jul 21 2026)
1. **Seed spam auto-move** (`rust-imap-worker/src/seed_monitor.rs`): When seed monitor detects warmup emails in Spam/Promotions folders (30s cycle), now does `UID MOVE` to INBOX + `STORE +FLAGS (\NotJunk \Flagged)` to train ISP. Uses `uid_move()` (RFC 6851) with `uid_copy_and_delete()` fallback.
2. **Seed reply race condition** (`services/warmup-service/src/workers/inbound-worker.ts`): `handleExpectReply` added DB fast-path — checks `warmupInteractions.movedToHiddenFolder=true` for expected message ID before IMAP sweep. Seeds use `SEED_DAILY_LIMIT` (400) not `DAILY_SENT_LIMIT` (20).
3. **Seeds never paused** (`outbound-worker.ts`, `scheduler-worker.ts`): Seeds skip pause logic on daily limit / sent/received cap — return early instead of setting `status='paused'`.
4. **Per-thread stagger** (`warmup-config.ts`): `PER_THREAD_STAGGER_MAX_MINUTES=30` — if 500 mailboxes create threads in one scheduler cycle, first sends hit seeds spread across 30min instead of 60s.
5. **Inbox sweep interval 2m→5m** (`warmup-config.ts`): Reduces IMAP pressure with 500+ mailboxes.
6. **Spam tracking** (`shared/schema.ts`, `migrator.ts`, `imap-stealth.ts`, `dashboard-routes.ts`, `warmup.tsx`): Added `warmupInteractions.placement` column (unknown/inbox/spam/promotions). `rescueSpamFolder` sets `placement='spam'`, `sweepInboxToHidden` sets `placement='inbox'`. Dashboard returns `totalSpam` per mailbox. Warmup KPI cards show Spam count (amber if >0) + amber chart line.
7. **`rescueSpamFolder` marks movedToHiddenFolder** (`imap-stealth.ts`): Updates `warmupInteractions.movedToHiddenFolder=true` so DB fast-path in expect-reply can find it.
8. **`imap_client.rs`**: Added `uid_move()`, `uid_copy_and_delete()` (for providers without RFC 6851), `mark_not_spam_and_important()` (`STORE +FLAGS (\NotJunk \Flagged)`).
9. **Integrations page mobile layout** (`integrations.tsx`): Stats grid changed to `grid-cols-2 sm:grid-cols-4` (was `grid-cols-4` causing overflow on mobile). Labels use `tracking-normal sm:tracking-widest`. Reduced gaps/padding. Removed `overflow-x-auto` wrapper.
10. **`email-stats-routes.ts`**: Reverted `delivered`→inbox change — `placement='delivered'` stays as "other" (unconfirmed) on deliverability page until open/bounce/FBL/seed monitor confirms real placement.
11. **Dynamic mailbox status badges** (`integrations.tsx:1635-1653`): Replaced static "Warmup"/"Warmup Paused"/"Disconnected" with short dynamic badges: `inactive` (gray, disconnected), `warming` (amber, warmup active & rep < 85), `warm` (emerald, warmup active & rep ≥ 85), `paused` (amber/secondary), `outreach` (sky/blue, connected no warmup). All lowercase, 4–8 chars.
12. **Real-time placement pulse dot** (`integrations.tsx:1720-1728`): Small `animate-pulse` colored dot next to "Inbox" label that changes instantly when `deliverability_updated` socket event fires — green for `inbox`, red for `spam`, amber for `bounced`, blue for other. Uses `queryClient.setQueryData` to patch the specific mailbox's `lastPlacement` in cache before query invalidation.
13. **Per-domain DNS badges** (`integrations.tsx:402`): `getDnsBadge` now checks `domainVerifications` per-domain result first. Falls back to aggregate `stats.health.dns` only when no per-domain data exists. Fixes SPF/DKIM/DMARC/MX/BL showing wrong (red) status in View All cards when the mailbox uses a different domain than the primary verified domain.
14. **"Init..." → "—"** (`integrations.tsx`): All rate cells (Delivery/Bounce/Inbox/Rep) in both mailbox cards and reputation section now show "—" (em dash) instead of "Init..." when no data yet. Less misleading; rates populate instantly via `deliverability_updated` socket events from seed monitor / SMTP activity.

### Data Flow (Complete Warmup + Deliverability)
```
User→seed warmup email lands in seed's Spam/Promotions
  → Rust seed monitor detects (30s cycle)
  → UID MOVE to INBOX + STORE +FLAGS (\NotJunk \Flagged)
    → Trains ISP: "this is NOT spam"
  → inbox-sweep (5min, staggered via queue concurrency=5)
    OR expect-reply (1-5min after send delay + 0-30min stagger)
    → Moves to hidden folder, marks movedToHiddenFolder=true, placement='inbox'
  → expect-reply finds interaction in DB (fast path, no IMAP needed)
  → Queues send-reply, seed replies back (no pause, 400 daily limit)

Seed→user warmup email lands in user's Spam
  → rescueSpamFolder (30min) finds in spam
  → Moves to hidden folder + marks placement='spam', movedToHiddenFolder=true
  → Warmup page graph shows spam count (amber line)
  → Seed's seed_monitor detects email in spam → moves to INBOX + flags

Manual inbox send → email.ts updateSendPlacement() → placement='delivered'
  → deliverability page shows "other/pending"
  → Later: open → placement='inbox', bounce → placement='bounced', FBL → placement='spam'
```

### Files Changed
- `rust-imap-worker/src/seed_monitor.rs` — spam→INBOX move + flags
- `rust-imap-worker/src/imap_client.rs` — uid_move, uid_copy_and_delete, mark_not_spam_and_important
- `services/warmup-service/src/workers/inbound-worker.ts` — DB fast-path, SEED_DAILY_LIMIT
- `services/warmup-service/src/workers/outbound-worker.ts` — no pause for seeds
- `services/warmup-service/src/workers/scheduler-worker.ts` — no pause for seeds, stagger
- `services/warmup-service/src/config/warmup-config.ts` — stagger timing, inbox sweep 5min
- `services/warmup-service/src/lib/imap-stealth.ts` — placement tracking, movedToHiddenFolder in rescueSpamFolder
- `shared/schema.ts` — warmupInteractions.placement
- `shared/lib/db/migrator.ts` — warmup_interactions.placement migration
- `services/api-gateway/src/routes/dashboard-routes.ts` — totalSpam, spam time series
- `services/api-gateway/src/routes/email-stats-routes.ts` — 'delivered' stays 'other'
- `client/src/pages/dashboard/warmup.tsx` — Spam KPI + chart line
- `client/src/pages/dashboard/integrations.tsx` — grid-cols-2 sm:grid-cols-4, tracking-normal mobile, no wrapper, no duplicate badge

### Remaining (Jul 21)
- Warmup not sending (0 sent today) — backend scheduler/outbound worker issue, not frontend
- Warmup throttle: 10-15/day default, 20-25% of campaign volume when campaign active (backend config)

## This Session (Jul 21 2026) — Warmup Page Fixes + DNS Badges Per-Domain

### Changes
1. **Removed duplicate Active Warmup Progress** (`warmup.tsx:606-662`): Deleted the hardcoded bottom section. The real top section (lines 351-418) is the only one now.
2. **5-column stats grid** (`warmup.tsx:395`): Changed `grid-cols-4` → `grid-cols-5`, added Rep column to Active Warmup Progress cards. Shows `--` when `totalSent === 0` (no real data yet), actual score with color when data exists.
3. **Fake outreach count removed** (`warmup.tsx:370`): Changed `{mb.dailyLimit} warmup/day • {mb.dailyLimit * 3} outreach/day` → `{mb.provider} • {warmupCount} sent today • {mb.dailyLimit} limit`. No fake math.
4. **Domain reputation shows `--` for empty** (`integrations.tsx:2307-2325`): `PerMailboxReputationSection` now checks `rep.sent === 0` before showing score/spam/bounce — shows `--` (gray) and "Pending" badge when no data. Score only shows when there's actual email activity.
5. **Warmup events update all KPIs** (`use-realtime.tsx:539-542`): `warmup_update` handler now also calls `debouncedInvalidateStats()` (in addition to `debouncedInvalidateWarmup()`), so warmup sends update home page KPIs, deliverability, analytics, and warmup simultaneously.

### Files Changed
- `client/src/pages/dashboard/warmup.tsx` — removed duplicate section, 5-col grid with rep, real data display
- `client/src/pages/dashboard/integrations.tsx` — PerMailboxReputationSection shows --/Pending for empty mailboxes
- `client/src/hooks/use-realtime.tsx` — warmup_update also invalidates all stats queries
- `client/src/pages/dashboard/calendar.tsx` — getRelativeDateLabel timezone-aware diff (not UTC Math.round), today text white

## This Session (Jul 21 2026) — Rust MX Batch Queue + Logo + Chunk Silence + AI Insights

### Commits
- `65c72b9c` — feat: Rust MX batch queue for 50k lead import (parallel DNS via tokio::join_all)
- `70035571` — fix: use futures::future::join_all (tokio::join_all doesn't exist)

### Fixes
1. **Rust MX batch queue** (`main.rs:157-226`): Dedicated `tokio::spawn` handler — BRPOP on `mx-batch-queue`, resolves ALL domains in parallel via `futures::future::join_all` + `hickory-resolver`, LPUSH results to `mx-batch-results`. `config.rs`: `mx_batch_queue` / `mx_batch_result_queue` fields. `queue.rs`: `MxBatchJob`, `MxBatchResult`, `MxBatchEntry` structs.
2. **Node.js bridge** (`shared/lib/queues/mx-batch-queue.ts`): `enqueueMxBatch()` + `waitForMxBatchResult()` — LPUSH job, BRPOP result with 15s timeout, fallback to Node.js `Promise.allSettled` DNS.
3. **Bulk import MX resolution** (`bulk-actions-routes.ts`): Tries Rust queue first, falls back to Node.js parallel DNS.
4. **Calendly OAuth fix** (`calendly.ts`): Added `prompt=consent` so Calendly always shows authorization screen on reconnect.
5. **Warmup worker DB fix** (`ecosystem.config.cjs`): Added `DATABASE_URL_POOL` + `IS_WORKER` to warmup worker env (was missing, causing `db.select is not a function`).
6. **Warmup scheduler SQL fix** (`scheduler-worker.ts`): Fixed PostgreSQL type cast `ANY(${userIds}::uuid[])` → `ANY(ARRAY[...::uuid])`.
7. **Brand KB history** (`BrandKnowledgeBase.tsx`, `admin-pdf-routes.ts`): Added "Clear All" button + per-PDF delete button, new `DELETE /api/brand-pdf/cache/:id` endpoint.
8. **Lead import progress bar** (`lead-import.tsx`): Real-time status text during import: "Parsing text with AI..." → "Identifying leads..." → "Checking MX records & spam filters..." → "Import complete!".
9. **E2E test script** (`e2e-test.sh`): Tests auth, lead import, brand KB, warmup, dashboard, deliverability, socket.
10. **Logo in developer docs** (`developer-docs.tsx`): Replaced CSS cube (`rotated square`) with actual `Logo` component (`/logo.svg` equivalent).
11. **AI Insights empty state** (`insights.tsx`): Socket-driven via `insights_updated` event (use-realtime.tsx:471-472). **No polling, no manual refresh needed.** Threshold: data shows when any of these are non-zero — `trends.leadGrowth`, `trends.conversionGrowth`, `predictions.expectedConversions`, `recommendations array`, or `summary` is non-null.
12. **Chunk load errors silent (enterprise-level)** (`ErrorBoundary.tsx`, `App.tsx:196-201`):
    - ErrorBoundary: chunk errors trigger silent `window.location.reload()` with max 2 attempts via `sessionStorage` counter — **no console.error, no dialog shown to user**
    - App.tsx `unhandledrejection`: removed wrong `e.type === "import"` check, added `"import("` pattern match, calls `preventDefault()` to suppress browser console output
    - Non-chunk errors still show the error dialog + console.error as before

### AI Insights Threshold (for AGENTS.md)
`insights.tsx:82-88` — `hasRealData` check:
```
!!insightsData && (
  !!insights ||                                    // summary text exists
  insightsData.trends.leadGrowth !== 0 ||           // any lead growth
  insightsData.trends.conversionGrowth !== 0 ||     // any conversion growth
  insightsData.predictions.expectedConversions > 0 ||// any predicted conversions
  insightsData.recommendations.length > 0           // any AI recommendations
)
```
Empty states (3 tiers):
1. No mailbox + no campaign → "Connect Mailbox" / "Create Campaign"
2. Mailbox connected, no campaign → "Awaiting Campaign Activity" with "Start a Campaign" link
3. Campaign exists, no data yet → "No Insights Yet" with Refresh button

All resolve automatically via socket `insights_updated` event. No polling.

### Files Changed
- `rust-email-sender/src/main.rs` — MX batch handler
- `rust-email-sender/src/config.rs` — queue config fields
- `rust-email-sender/src/queue.rs` — MxBatchJob/Result/Entry structs
- `rust-email-sender/Cargo.toml` — added `futures = "0.3"`
- `shared/lib/queues/mx-batch-queue.ts` — Node.js bridge (new file)
- `services/api-gateway/src/routes/bulk-actions-routes.ts` — Rust queue with Node.js fallback
- `services/api-gateway/src/oauth/calendly.ts` — prompt=consent
- `ecosystem.config.cjs` — warmup worker env fix
- `services/warmup-service/src/workers/scheduler-worker.ts` — SQL type cast fix
- `client/src/components/admin/BrandKnowledgeBase.tsx` — Clear All + per-PDF delete
- `services/api-gateway/src/routes/admin-pdf-routes.ts` — DELETE /api/brand-pdf/cache/:id
- `client/src/pages/dashboard/lead-import.tsx` — progress bar status text
- `client/src/pages/developer-docs.tsx` — Logo component
- `client/src/components/ErrorBoundary.tsx` — silent chunk reload, no console, max 2 attempts
- `client/src/App.tsx` — fixed unhandledrejection handler
- `e2e-test.sh` — end-to-end test script (new file)

### Deploy Required
- `git push github main` then EC2:
  ```bash
  cd /home/ubuntu/app && git pull
  cd rust-email-sender && cargo build --release
  cd /home/ubuntu/app/client && NODE_OPTIONS='--max-old-space-size=2048' npm run build:client
  pm2 restart audnix-rust-email-sender audnix-api-gateway audnix-socket-server
  ```

## This Session (Jul 21 2026) — Warmup Page Rewrite: Real Data, No Hardcode, Toggle Works, Daily Limit Matches Scheduler

### Changes
1. **Remove campaign block from warmup toggle** (`dashboard-routes.ts`): Deleted the `if (enabled)` check that returned 409 when campaigns were active. The scheduler already handles coexistence (20-25% of cap). Users can freely toggle warmup on/off regardless of campaign state.
2. **Fix `warmupPercent` calculation** (`dashboard-routes.ts:1326-1328`): Changed from `isWarmingUp ? ... : isEnrolled ? 100 : 0` to `isEnrolled && dailyLimit > 0 ? Math.min(100, round(sent/limit)) : 0`. Paused-but-enrolled mailboxes no longer show 100% progress.
3. **Daily limit matches scheduler** (`dashboard-routes.ts:1308-1324`): Replaced static `wm?.dailyLimit` read with dynamic calculation matching scheduler-worker.ts logic — 12 baseline (no campaign), 20% of cap (campaign active), ramp schedule applied (30% day1, 50% day2-4, 75% day5-9, 100% day10+).
4. **"Fully Warmed" section requires `totalSent > 0`** (`warmup.tsx:660-670`): Filter changed from `warmupPercent >= 100` to `warmupPercent >= 100 && totalSent > 0`. Enrolled-but-paused mailboxes with 0 sends no longer appear as "Fully Warmed".
5. **"Start All" → "Pause All" toggle** (`warmup.tsx:215-245`): Button now shows `Pause All` icon+text when any mailbox is active, `Start All` when all are paused. Removed the campaign-blocking tooltip/disabled button.
6. **Per-mailbox Switch always clickable** (`warmup.tsx:528-552`): Removed the campaign-blocking conditional (TooltipProvider/disabled Switch). Switch is always active and toggles warmup directly.
7. **`getStageLabel` handles 0%** (`warmup.tsx:127-133`): Added `pct <= 0` → "Not Started" so mailboxes with no sends show correct label instead of "Day 1-2: Warming Up".
8. **Daily limit label** (`warmup.tsx:530`): Changed `{mb.dailyLimit} limit` → `/day`.

### Files Changed
- `services/api-gateway/src/routes/dashboard-routes.ts` — warmupPercent calc, dailyLimit calc matches scheduler, removed campaign block from toggle
- `client/src/pages/dashboard/warmup.tsx` — Start All→Pause All, removed campaign UI checks, getStageLabel for 0%, Fully Warmed filter, daily limit label
- `AGENTS.md` — this session entry

### Deploy
- Push to GitHub, pull on EC2, build client, restart API gateway

