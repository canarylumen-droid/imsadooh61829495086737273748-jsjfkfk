# WildDuck Migration Plan — Technical Evaluation

## Short Answer: The Plan Does Not Work As Written

WildDuck is a **standalone IMAP/POP3 mail server** — it stores mail locally in MongoDB and serves it to email clients. It does NOT proxy/relay connections to external IMAP servers (Gmail, Outlook, custom). Your entire codebase connects **outbound** to those external servers. WildDuck cannot replace ImapFlow here.

## Why It Won't Work

### What WildDuck Actually Is
- An email server (like Dovecot) — people log INTO it with their email client
- Stores mail in MongoDB, serves via IMAP/POP3
- Has an HTTP **admin** API for managing users/mailboxes/messages/webhooks
- Designed to be the final destination for email (receives via SMTP, stores, serves via IMAP)

### What Your Code Actually Does
Every ImapFlow usage in your codebase connects **to** external IMAP servers:

| File | Connects To | Purpose |
|---|---|---|
| `email-worker/imap-connection-manager.ts` | Gmail/Outlook/custom IMAP | Listen for new mail via IDLE, process inbound |
| `warmup-service/imap-stealth.ts` | Gmail/Outlook/custom IMAP | Create folders, sweep inbox, expunge sent |
| `lead-recovery-worker/mailbox.ts` | Gmail/Outlook/custom IMAP | Fetch recovery emails |
| `warmup-service/seed-fleet-manager.ts` | Gmail/Outlook/custom IMAP | Test IMAP credentials |

Your `integrations` table stores `provider` as: `gmail | outlook | custom_email`. These are credentials to **external email servers**, not accounts on your own mail server.

### The Fundamental Mismatch

```
Current: Your Node.js app --[ImapFlow]--> Gmail/Outlook/other IMAP servers
                                                    ↑
Plan:    Your Node.js app --[HTTP API]--> WildDuck --|--??--> Gmail/Outlook/other IMAP servers
                                                    ✗
WildDuck cannot fetch mail from Gmail for you. It only serves mail it has stored.
```

## The "40+ Connections" Claim

WildDuck can handle many concurrent IMAP connections because it's a mail server — clients connect TO it. But your problem is the opposite: your app connects FROM itself to external servers. These are outbound IMAP client connections, not inbound server connections. WildDuck doesn't change that equation.

## What Would Actually Work (3 Options)

### Option A: Keep ImapFlow, Improve Scale
Your existing `imap-connection-manager.ts` is already well-architected (circuit breakers, Redis state, backoff, zombie watchdog). The socket cap (`MAX_SOCKETS=50`) is real. To go beyond it:
- Add more worker replicas (each handles 50, Redis ensures no double-connect)
- This is already designed for — the code has `TOTAL_REPLICAS`, `WORKER_ID`, Redis-based worker load tracking
- **Result**: Scales horizontally. Each replica handles 50 mailboxes. Need 500? Deploy 10 replicas.

### Option B: Provider-Native APIs (Recommended Upgrade Path)
For Gmail/Outlook users, replace IMAP with native HTTP APIs:
- **Gmail API** (via `googleapis` npm) — push notifications via Pub/Sub, no sockets
- **Microsoft Graph API** — webhooks via subscription, no sockets
- Both are HTTP-only, support 1000s of mailboxes with no socket-per-mailbox cost
- Keep ImapFlow only for `custom_email` provider
- Your code already has OAuth infrastructure for both providers

### Option C: Build a Dedicated IMAP Proxy Service
If you need a unified abstraction for all providers (including custom IMAP):
- Build a small, stateless microservice that wraps ImapFlow internally but exposes an HTTP API
- Deploy it as a sidecar or separate service with its own scaling
- Your main app calls HTTP endpoints (fetch message, move, search, etc.)
- This is what your deepseek prompt describes — but call it "imap-proxy" not "WildDuck"
- WildDuck is NOT this service, but the concept is sound

## What About the Warmup Service?

The warmup service creates its OWN mailboxes (seed accounts) to send warmup emails between them. For THIS use case only, WildDuck actually makes sense if:
- You host warmup mailboxes directly on WildDuck (instead of Gmail/Outlook)
- Manage them via WildDuck's HTTP API
- Use webhooks for event-driven warmup logic

But this is a new feature, not a replacement for existing ImapFlow usage. It also means your warmup emails would come from @wildduck.email or your own WildDuck domain, not from Gmail/Outlook — which may not achieve the same reputation-building goal.

## Recommendation

1. **Don't use WildDuck to replace ImapFlow** — it's the wrong tool
2. Short-term: Stay on ImapFlow, add more replicas (your architecture already supports this)
3. Medium-term: Migrate Gmail/Outlook users to native APIs (eliminates 80%+ of your IMAP socket load)
4. Long-term (optional): Build an IMAP Proxy service for remaining custom-email users

Want me to draft the actual migration plan for Option B (Gmail API + Graph API)?
