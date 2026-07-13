# IMAP Code Audit & Latency Optimization

## Files Audited
- `services/email-worker/src/imap/imap-connection-manager.ts` (806 lines)
- `services/warmup-service/src/lib/imap-stealth.ts` (430 lines)
- `services/lead-recovery-worker/src/mailbox.ts` (138 lines)
- `services/warmup-service/src/engine/seed-fleet-manager.ts` (520 lines)
- `shared/lib/queues/email-sync-queue.ts` (211 lines)
- `test-credentials.mjs` (147 lines)

---

## BUGS (Will Cause Failures)

### B1. Reconnect race in connection manager (CRITICAL)
**File:** `imap-connection-manager.ts:573-612`

The `_handleReconnect` method doesn't guard against multiple calls for the same integration. If the `error` and `close` events both fire (common during network blips), two reconnect timers are created. They race: first one reconnects, second one kills the new connection and reconnects again. Creates permanent reconnect storms.

**Why it happens:** `_cleanupClientTimers(data)` at line 579 clears timers but `data.reconnectTimeout` is only set at line 610 — AFTER the first `_handleReconnect` already ran its checks. A concurrent `_handleReconnect` sees `data.reconnectTimeout` as undefined, so it proceeds.

**Fix:** Add a `isConnecting` flag guard at the top:
```ts
private _handleReconnect(id: string, ...) {
  const data = this.connections.get(id);
  if (data?.isConnecting) return; // already reconnecting
  if (data) data.isConnecting = true;
  // ... rest ...
  // Set false after _establishConnection resolves
}
```

---

### B2. Semaphore leak in ImapStealth.getClient (CRITICAL)
**File:** `imap-stealth.ts:287-308`

`acquireConnectionSlot()` is called BEFORE `new ImapFlow(...)`. If the constructor throws (invalid host, bad config), the semaphore slot is NEVER released. You lose a slot permanently. After enough bad configs, the semaphore exhausts and no new connections can be made until restart.

**Fix:** Wrap in try/finally:
```ts
await this.acquireConnectionSlot();
let client: ImapFlow | null = null;
try {
  client = new ImapFlow({ ... });
  await client.connect();
} catch (err) {
  this.releaseConnectionSlot(); // <-- missing
  throw err;
}
```

---

### B3. Expunge method uses wrong API (HIGH)
**File:** `imap-stealth.ts:194`

```ts
await (client as any).expunge();
```
This casts to `any` and calls `expunge()`. ImapFlow's public API is `mailboxExpunge()`. The internal `expunge()` exists but may behave differently. If an ImapFlow update changes internal methods, this breaks silently.

**Fix:** Use the typed method:
```ts
await client.mailboxExpunge();
```

---

### B4. Gmail error detection too narrow (HIGH)
**File:** `imap-stealth.ts:105-106`

```ts
if (!err.responseText?.includes('EXISTS')) throw err;
```
Gmail returns `ALREADYEXISTS` not just `EXISTS`. Different IMAP servers use different strings. This re-throws an error that should be swallowed, causing folder creation to fail.

**Fix:** Check broader:
```ts
const msg = (err.responseText || err.message || '').toLowerCase();
if (msg.includes('exists') || msg.includes('already')) return;
throw err;
```

---

### B5. No connection timeout on lead-recovery (HIGH)
**File:** `mailbox.ts:50-84`

Three `new ImapFlow()` calls with no `connectionTimeout` or `greetingTimeout`. If the IMAP server is unreachable but doesn't RST (firewall drop), the TCP handshake hangs for OS-default timeout (30-120s on Windows). The entire lead-recovery job blocks.

**Fix:** Add to all three:
```ts
connectionTimeout: 15000,
greetingTimeout: 15000,
```

---

### B6. Yahoo/AOL mapped to Gmail IMAP settings (MEDIUM)
**File:** `seed-fleet-manager.ts:89`

```ts
const mappedProvider = (provider === 'custom_email' || provider === 'yahoo' || provider === 'aol') ? 'gmail' : provider;
```
This maps `yahoo` and `aol` provider values to `gmail`, which uses `imap.gmail.com` settings. Yahoo mailboxes will try to connect to Gmail's IMAP servers. This always fails.

**Fix:** Don't remap providers for IMAP. Use the actual provider's IMAP host.

---

### B7. Duplicate encryption functions (LOW)
**File:** `seed-fleet-manager.ts:16-38` and `imap-stealth.ts:15-30`

Identical `encryptSecret`/`decryptSecret` functions copy-pasted. If the encryption scheme needs to change, one will be missed. Should be extracted to shared lib.

---

### B8. Custom email secure flag logic is a no-op (LOW)
**File:** `imap-stealth.ts:349-353`

```ts
secure = d.port === 993 || d.port === 995;
```
But `d.port` defaults to 993 already (line 340), and `d.secure` was already `true`. For port 143, `secure` correctly becomes `false`, but the default port is always 993 so this code path never runs meaningfully.

---

## LATENCY BOTTLENECKS (Why AI Reads Are Slow)

### L1. IMAP EXISTS → Queue → Transient IMAP → Parse → DB → WebSocket → AI

The current flow for a new email:
```
IMAP EXISTS (server push, ~100ms)
  → BullMQ enqueue (~1ms)
  → BullMQ worker picks up (depends on concurrency, 0-500ms)
  → Transient IMAP connection to fetch envelope (~200-1500ms)
  → simpleParser on header+text (~10-50ms)
  → DB save (~20-100ms)
  → WebSocket push to frontend (~5-50ms)
  → AI inference (2-10s)
```

**Total to get email to AI: ~350ms to 2.2s BEFORE AI inference.**

### L2. Sequential UID processing in warmup service (HIGH)
**File:** `imap-stealth.ts:139-166`

```ts
for (const uid of uids) {
  const message = await client.fetchOne(uid.toString(), {...}); // ROUND TRIP 1
  if (headers.includes('X-Audnix-Warmup: true')) {
    await client.messageMove(uid.toString(), hiddenPath);     // ROUND TRIP 2
  }
}
```

For 100 messages: **200 sequential IMAP round-trips**. Each is 50-200ms. Total: **10-40 seconds**.

### L3. Fetching full `source` in lead-recovery (MEDIUM)
**File:** `mailbox.ts:124-128`

```ts
for await (const message of client.fetch(searchQuery, {
  source: true, // <-- fetches FULL raw email
}))
```

`source: true` fetches the complete RFC822 message including attachments. Then `simpleParser` re-parses it. For 100 emails with attachments, this could pull 100MB+ over the IMAP connection. Fetch only `HEADER` and `TEXT` body parts instead.

### L4. No IMAP pipelining anywhere (MEDIUM)

ImapFlow supports pipelining (sending multiple commands before waiting for responses). None of the code uses it. Every `fetchOne`, `messageMove`, `search` call waits for the previous to complete before sending the next.

### L5. `emailSyncQueue` fetches integration from DB on every job (LOW)
**File:** `email-sync-queue.ts:80`

```ts
const integration = await storage.getIntegrationById(integrationId);
```
For high-frequency IMAP EXISTS events (bursts), this is a DB hit per job. The integration data comes from the job payload already — `integrationId` and `userId` are in the payload. Add `provider` to the payload too, skip the DB call.

---

## OPTIMIZATION PLAN (AI Reads in Milliseconds)

### Phase 1: Max Out IMAP (This Week)
1. **Add IMAP pipelining** — batch `search`, `fetchOne`, `messageMove` in the warmup service. Use `client.fetch()` with a range instead of per-UID `fetchOne()`.
2. **Stop fetching full `source`** in lead-recovery — use `bodyParts: ['HEADER', 'TEXT']`.
3. **Cache integration data** in email-sync-queue handler to skip DB hit.
4. Fix B1-B5 (bug fixes).

### Phase 2: Gmail/Outlook Get Webhooks (2 Weeks)
For Gmail users: replace IMAP EXISTS with **Gmail Pub/Sub push notifications**. Google sends a POST to your webhook endpoint when new mail arrives. Your app fetches the message via Gmail API (HTTP, no IMAP socket). **~100ms to get message body**, no IMAP round-trip.

For Outlook users: same with **Microsoft Graph webhooks**.

Keep ImapFlow **only for custom_email** users.

### Phase 3: AI Gets Pre-Fetched Body (Parallel with Phase 2)
Modify the `process-new-mail` handler to fetch the full text body in the background and store it BEFORE the AI job starts. The AI worker doesn't need to parse anything — the message body is already in the DB.

Current: `EXISTS → fetch envelope (no body) → DB save → WebSocket → AI worker fetches full body`

Target: `EXISTS → fetch envelope + body → DB save (with full body) → WebSocket → AI worker reads from DB (0ms IMAP)`

---

## MIGRATION CHECKLIST (If You Fix Bugs)

### Today (no architecture change):
- [ ] Fix B1 (reconnect guard)
- [ ] Fix B2 (semaphore leak)
- [ ] Fix B3 (expunge API)
- [ ] Fix B4 (wider error check)
- [ ] Fix B5 (add timeouts)
- [ ] Fix B6 (yahoo/aol mapping)
- [ ] Fix L2 (sequential → batch in ImapStealth)
- [ ] Fix L3 (source → bodyParts)

### This week:
- [ ] Add IMAP config to `fetchRecoveryEmails` (timeout + retries)
- [ ] Add integration cache to email-sync-queue handler
- [ ] Extract shared encryption utils from duplicated functions
- [ ] Add `mailboxExpunge` typed wrapper instead of `(client as any).expunge()`

### Next (major improvement):
- [ ] Evaluate: what % of your users are Gmail vs Outlook vs custom_email?
  If >80% are Gmail/Outlook, implement webhook-based pipeline. Only custom_email users keep IMAP.
