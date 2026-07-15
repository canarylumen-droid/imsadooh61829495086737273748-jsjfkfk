# Audnix Email Stack — Walkthrough

## Architecture

```
User Integration (UI)
        │
        ├── Add Mailbox ────────────────────────────── auto-discover flow
        │     │
        │     ├── User enters email
        │     │     └── POST /api/custom-email/discover ─→ EmailDiscoveryService
        │     │           ├── Known provider map (Gmail, Outlook, Yahoo, etc.)
        │     │           └── Custom domain probe (TCP port scan smtp./imap./mail.)
        │     │
        │     ├── Auto-fills: SMTP host, port, IMAP host, port, display name
        │     ├── IMAP host derived from SMTP host (smtp. → imap.) when empty
        │     └── User adds → SMTP verify + IMAP verify → saved
        │
        ▼
  shared/lib/channels/email.ts   ← sendEmail()
        │
        ├── Custom SMTP ─────────────────────────────────────┐
        │     │                                               │
        │     ├── NEW_EMAIL_BACKEND=rust (default, 50ms)      │
        │     │     └── Rust email sender (Redis queue)       │
        │     │           ├── 4 workers, 100 concurrent       │
        │     │           └── lettre + rustls → STARTTLS :587 │
        │     │
        │     └── NEW_EMAIL_BACKEND=node (fallback)           │
        │           └── Nodemailer (connection pool, 5 conn)  │
        │                 └── multi-provider-failover.ts       │
        │                       ├── Rust SMTP (1st, 3s timeout)
        │                       ├── Custom SMTP (2nd, nodemailer)
        │                       ├── Gmail API  (3rd)
        │                       └── Outlook API (4th)
        │
        ├── Gmail OAuth ── Gmail REST API                    │
        └── Outlook OAuth ── Microsoft Graph API              │

  IMAP IDLE Sync (connected forever)
        │
        ├── Rust IMAP worker ── standalone test mode          │
        │     └── tokio-rustls → IMAP :993 TLS, IDLE + FETCH │
        │
        └── Node.js IMAP (production default, 24/7)           │
              └── imap-idle-manager.ts
                    ├── Persistent IDLE connections (NOOP 5s, re-IDLE 10s)
                    ├── Zombie detection (30s → auto-recycle)
                    ├── Auto-reconnect on any disconnect
                    ├── Proactive recycle (29min per RFC 2177)
                    ├── OAuth token refresh before expiry
                    ├── Polling fallback (>500 connections)
                    ├── Folder discovery (Inbox/Sent/Spam)
                    └── Network breach recovery (auto-resurrect)
```

## Network Connection State (UI Banner)

**File:** `client/src/components/InternetConnectionBanner.tsx`

```
States: online | offline | server_down | degraded | reconnecting

navigator.onLine ──┐
                   ├── connectionState ──→ Banner display
Server health ping ─┘     (15s interval)
```

| State | Trigger | Banner Color | Action |
|-------|---------|-------------|--------|
| offline | `navigator.onLine = false` | Amber | Retry button |
| server_down | `/api/health` fails | Red | Retry button |
| degraded | Latency > 3s | Amber | Shows latency ms |
| reconnecting | Browser online + health pass | Green (primary) | Auto-syncs data |
| online | Everything OK | Hidden | — |

No more false "offline" banners when the server is the issue.

## Rust Binaries (Compiled)

### 1. Rust Email Sender (`rust-email-sender/`)
```
Path:    rust-email-sender/target/release/audnix-email-sender
Size:    4.0 MB
TLS:     rustls (pure Rust, no OpenSSL)
SMTP:    STARTTLS on port 587 (configurable)
Queue:   Redis BRPOP → send → LPUSH result
```

**Env config:**
```env
NEW_EMAIL_BACKEND=rust              # set to "node" to force Nodemailer
RUST_EMAIL_SENDER_PATH=./rust-email-sender/target/release/audnix-email-sender
REDIS_URL=redis://localhost:6379    # same Redis as Node.js
SMTP_PORT=587                       # default SMTP port
SMTP_TIMEOUT_SECS=15                # connection timeout
```

**How it works:**
1. Node.js pushes email job to Redis list `email-send-queue`
2. Rust binary polls Redis → deserializes → sends via `lettre`
3. Result pushed to Redis list `email-send-results`
4. Node.js (`withRustFallback`) polls for result with 3s timeout
5. On timeout/error → falls back to Nodemailer

### 2. Rust IMAP Worker (`rust-imap-worker/`)
```
Path:    rust-imap-worker/target/release/audnix-imap-worker
Size:    1.8 MB
TLS:     tokio-rustls (pure Rust)
IMAP:    LOGIN → SELECT → FETCH → IDLE
```

**Standalone test usage:**
```bash
./rust-imap-worker/target/release/audnix-imap-worker \
  <host> <port> <username> <password> [folder]
```

**Env config:**
```env
RUST_IMAP_WORKER_PATH=./rust-imap-worker/target/release/audnix-imap-worker
```

## Nodemailer Fallback

**File:** `services/email-service/src/email/multi-provider-failover.ts`

When Rust binary is unavailable or times out (>3s), the system falls back to Nodemailer:

```
1. Custom SMTP ── nodemailer (STARTTLS :587, SMTPS :465)
2. Gmail API    ── REST API (OAuth2 access token)
3. Outlook API  ── Microsoft Graph API (OAuth2 access token)
```

Each provider has 3 retries with exponential backoff (1s, 2s, 4s).

## Node.js IMAP IDLE Manager

**File:** `services/email-service/src/email/imap-idle-manager.ts`

Production IMAP sync (currently active by default — Rust IMAP worker is compiled but Node.js path is primary):

| Setting | Value |
|---------|-------|
| NOOP interval | 5s |
| Re-IDLE interval | 10s |
| Zombie timeout | 30s |
| Max IDLE connections | 500 |
| Polling fallback interval | 5s |
| Proactive recycle | 29 min |
| Watchdog sweep | 15s |

**Supported providers:** Gmail (XOAUTH2), Outlook (XOAUTH2), Custom SMTP (password)

## Testing

```bash
# 1. Test DNS/TCP connectivity
node -e "new Promise(r => require('dns').resolve4('smtp.gmail.com', (e,a) => { console.log(a); r() }))"

# 2. Test IMAP LOGIN (Node.js)
node -e "
const tls = require('tls');
const s = tls.connect(993, 'admin.mail.replyflow.pro', {rejectUnauthorized:false}, () => {
  s.write('A01 LOGIN \"user\" \"pass\"\\r\\n');
  s.on('data', d => { console.log(d.toString()); s.end(); });
});
"

# 3. Test Rust IMAP worker (after compile)
./rust-imap-worker/target/release/audnix-imap-worker \
  admin.mail.replyflow.pro 993 \
  "user@domain.com" "password" INBOX

# 4. Test Rust email sender (needs Redis)
export REDIS_URL=redis://localhost:6379
./rust-email-sender/target/release/audnix-email-sender

# 5. Run full test suite
npx vitest run tests/email-pipeline.test.ts
```

## Replit/Cloud Block Mitigation

If your cloud provider (Railway, Replit, etc.) blocks SMTP/IMAP ports:

1. **Use port 587** (STARTTLS) instead of 465 or 25 — most permissive
2. **Force IPv4** (`family: 4`) — already default in all code paths
3. **Rust binary** with rustls has no system OpenSSL dependency — works anywhere Node.js runs
4. **Fallback chain** ensures delivery even if one path is blocked

## Deployment

```bash
# Build Rust binaries (run during CI/CD)
cargo build --release --manifest-path rust-email-sender/Cargo.toml
cargo build --release --manifest-path rust-imap-worker/Cargo.toml

# Copy to standard location
cp rust-email-sender/target/release/audnix-email-sender /usr/local/bin/
cp rust-imap-worker/target/release/audnix-imap-worker /usr/local/bin/

# Or set env vars to custom paths
export RUST_EMAIL_SENDER_PATH=./rust-email-sender/target/release/audnix-email-sender
export RUST_IMAP_WORKER_PATH=./rust-imap-worker/target/release/audnix-imap-worker
```

## Security Vulnerability Fixes

### Dependabot Overrides (`package.json`)

All known GHSA advisories patched via overrides:

| Package | Fixed Version | Vuln |
|---------|--------------|------|
| `nodemailer` | ^9.0.4 | SMTP injection, CRLF injection, DoS |
| `drizzle-orm` | ^0.45.2 | SQL injection via identifiers |
| `undici` | ^8.3.0 | Various HTTP exploits |
| `uuid` | ^10.0.0 | Buffer bounds check |
| `esbuild` | ^0.25.0 | Dev server request smuggling |
| `axios` | ^1.16.1 | SSRF, prototype pollution |
| `cross-spawn` | ^7.0.6 | Shell injection |
| `micromatch` | ^4.0.8 | ReDoS |
| `cookie-signature` | ^1.2.2 | Signature bypass |
| `path-to-regexp` | ^8.0.0 | ReDoS |
| `express` | ^4.21.2 | Multiple vulns |
| `send` / `serve-static` | ^1.2.0 / ^2.2.0 | Path traversal |
| `elliptic` | ^6.6.1 | Cryptographic bugs |
| `ws` | ^8.18.2 | DoS, protocol confusion |
| `tar` | ^7.4.3 | Symlink race, path traversal |
| `xml2js` | ^0.6.2 | Prototype pollution |
| `ip-address` | ^10.2.0 | ReDoS |

## Env Reference

```env
# Backend selection
NEW_EMAIL_BACKEND=rust              # "rust" (default) or "node"
RUST_EMAIL_SENDER_PATH=...          # path to Rust email sender binary
RUST_IMAP_WORKER_PATH=...           # path to Rust IMAP worker binary

# Redis (shared between Node.js and Rust)
REDIS_URL=redis://localhost:6379

# System SMTP (for alerts only — not user email)
SYSTEM_SMTP_HOST=smtp.example.com
SYSTEM_SMTP_PORT=587
SYSTEM_SMTP_USER=user
SYSTEM_SMTP_PASS=pass

# OAuth providers
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
OUTLOOK_CLIENT_ID=...
OUTLOOK_CLIENT_SECRET=...
```

## Full Session Changelog (2026-07-15)

### Rust Stack
- Installed rustup → rustc 1.97.0 + cargo
- Fixed `rust-email-sender`: removed `trust-dns-resolver` (unused), swapped `native-tls`→`rustls`, fixed `redis::tokio`→`redis::aio`, fixed BRPOP for redis 0.27 API
- Fixed `rust-imap-worker`: removed broken `imap-codec`/`mail-parser` deps, rewrote `imap_client.rs` with working tokio-rustls TLS, added standalone CLI mode
- Both binaries compile with zero OpenSSL dependency — pure rustls

### Email Routing
- `shared/lib/channels/email.ts`: Rust binary auto-detected across 5 paths; `withRustFallback` timeout 50ms→3s; Redis result key matching fixed
- `multi-provider-failover.ts`: Now tries Rust SMTP first (3s timeout via Redis) before Nodemailer fallback

### Auto-Discover UI
- SMTP host onChange auto-derives IMAP host (`smtp.` → `imap.`) when IMAP empty
- Auto-discover triggers on email blur, fills SMTP/IMAP host + port + display name

### Network Banner
- `/api/health` ping every 15s for accurate server reachability
- 5 states: online / offline / server_down / degraded (shows latency ms) / reconnecting
- No more false "offline" when server is down but browser says online

### TypeScript Fixes
- 30+ errors fixed: Redis method casing (`lpush`→`lPush`), `QueryResult` typing, `finalScore` narrowing, `requireAuth`→`requireAuthOrApiKey`

### Security
- Fixed all Dependabot overrides in `package.json` (18 packages patched)
- Removed duplicate override entries causing EOVERRIDE errors
- `nodemailer`: 9.0.3 → 9.0.4 (5 GHSA fixes)
- `drizzle-orm`: added override for SQL injection fix
```
