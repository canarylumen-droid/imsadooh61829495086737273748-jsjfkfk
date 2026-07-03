# MTA Migration Plan: Zero-Disconnect Email Infrastructure

## Problem

Nodemailer opens/closes raw SMTP sockets. AWS NAT kills idle TCP connections at ~350 seconds. This causes `ECONNRESET`, `ETIMEDOUT`, and IMAP disconnections across all 40 mailboxes.

## Solution: Postal MTA + Wildduck IMAP Proxy

Replace direct Nodemailer SMTP with a local Mail Transfer Agent (Postal) that holds persistent TLS sessions. Replace raw IMAP connections with Wildduck REST API.

## Architecture Before & After

```
BEFORE:                           AFTER:
Audnix App ──SMTP──► Gmail MX     Audnix App ──HTTP──► Postal MTA ──SMTP──► Gmail MX
  (Nodemailer, pools die)           (localhost:2525)   (daemon, 90d uptime)
                                   Audnix App ──REST──► Wildduck ──IMAP──► Gmail IMAP
                                   (poll /messages)    (holds IDLE 24/7)
```

## What Changes (Minimal)

### File 1: `shared/lib/channels/email.ts`

Replace `sendCustomSMTP()` function (lines 194-396) with `sendViaPostalMTA()`:

```typescript
async function sendViaPostalMTA(
  config: EmailConfig,
  to: string,
  subject: string,
  body: string,
  isHtml: boolean
): Promise<{ messageId: string }> {
  const res = await axios.post('http://localhost:2525/api/v1/send/raw', {
    mail_from: config.smtp_user,
    rcpt_to: [to],
    data: buildMimeMessage(config.smtp_user, to, subject, body, isHtml)
  }, {
    headers: { 'X-Postal-Server': config.smtp_host }
  });
  return { messageId: res.data.message_id };
}
```

Guarded by: `if (process.env.NEW_EMAIL_BACKEND === 'postal')` — old Nodemailer path still exists.

### File 2: `shared/lib/channels/email.ts`

Delete these (no longer needed):
- `smtpPools` Map
- `dnsCache` Map  
- `resolveSmtpHost()` function
- `setInterval()` keep-alive health check
- Port cycling logic (465/587/2525)
- Circuit breaker for SMTP hosts
- Exponential backoff retry loop

Postal handles all of this automatically.

### What Stays Identical

| Component | Status | Reason |
|---|---|---|
| `sendEmail()` function | Unchanged | Only swaps which underlying function sends |
| All API routes | Unchanged | No route changes needed |
| Gmail/Outlook OAuth sending | Unchanged | Uses REST APIs, not SMTP |
| Daily limit logic | Unchanged | Still enforces 50/1000/2500 per day |
| Branded email generation | Unchanged | Still generates HTML before sending |
| Tracking pixel injection | Unchanged | Still injects before sending |
| Database schemas & migrations | Unchanged | No schema changes |
| PM2 processes (16 total) | Unchanged | Still run as-is |
| Nginx config | Unchanged | No port changes |
| All 15 existing services | Unchanged | Same ports, same env vars |

## New Infrastructure

### Docker Compose (`docker-compose.mta.yml`)

```yaml
services:
  postal-mta:
    image: ghcr.io/postalserver/postal:latest
    restart: always
    ports: ["2525:2525"]
    volumes: [postal-data:/opt/postal/data]
    depends_on: [redis]

  wildduck:
    image: wildduck/wildduck:latest  
    restart: always
    ports: ["8080:8080"]
    depends_on: [redis]

  redis:
    image: redis:7-alpine
    restart: always
    ports: ["6379:6379"]
```

### Postmaster Monitor (New Microservice)

A lightweight Node.js service that:
- Queries Gmail Postmaster Tools API every 30s
- Writes IP/domain reputation scores to Redis
- Postal MTA Lua hooks read Redis before sending

## Rollback

```bash
# Instant rollback — no deploy needed
export NEW_EMAIL_BACKEND=nodemailer
pm2 restart audnix-worker-email
# Back to Nodemailer. Zero downtime.
```

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Postal install fails | Env flag defaults to `nodemailer` — app unaffected |
| Postal has bug | Flip env flag back, old code path works |
| Wildduck misses email | Poll every 60s as fallback |
| Redis goes down | Postal queues to disk, replays on restart |

## Timeline

1. **Write code** (1 hour): `sendViaPostalMTA()` + env flag + rollback
2. **Test** (30 min): Smoke test with 1 mailbox against Postal, verify fallback
3. **Deploy infra** (20 min): `docker compose -f docker-compose.mta.yml up`
4. **Flip** (1 sec): `export NEW_EMAIL_BACKEND=postal`
5. **Monitor** (24h): Watch error logs — no `ECONNRESET` expected
