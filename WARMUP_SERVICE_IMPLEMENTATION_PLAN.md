# P2P Email Warmup Service — 7-Phase Implementation Plan

> **Microservice:** `services/warmup-service/`  
> **Philosophy:** Ghost layer. Zero visibility. Pause — don't fake — when pools are insufficient.  
> **Runtime:** 24/7 scheduler with per-mailbox pause/resume gates.

---

## Phase 0: Architecture Overview

### Why a Microservice?

| Concern | Monolith | Microservice |
|---|---|---|
| Crash isolation | Warmup IMAP hang kills API gateway | Only warmup dies |
| Deploy cadence | Tied to full backend deploy | Independent deploy, rollback, scale |
| Schema isolation | Risk of writing to `messages` / `campaign_leads` | Own tables only |
| Resource scaling | Bulky alongside API routes | Dedicated Railway service |

### Service Boundary

**MAY WRITE TO:** `warmup_mailboxes`, `warmup_threads`, `warmup_interactions`, `warmup_pool_state`  
**MUST NOT WRITE TO:** `campaign_leads`, `outreach_campaigns`, `messages`, `email_tracking`, `email_events`, `leads`, `deals`, `follow_up_queue`  
**MAY READ FROM (read-only):** `users`, `organizations`, `team_members`, `integrations`

---

## Phase 1: Foundation & Schema

### 1.1 New Drizzle Tables

Add to `shared/schema.ts` and `packages/shared/schema.ts`. Migration in `shared/lib/db/migrator.ts` (same emergency sync block pattern as `campaign_job_logs`).

#### `warmup_mailboxes`

```typescript
export const warmupMailboxes = pgTable("warmup_mailboxes", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  integrationId: uuid("integration_id").notNull().references(() => integrations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  provider: text("provider", { enum: ["gmail", "outlook", "custom_email"] }).notNull(),
  status: text("status", { enum: ["active", "paused", "unenrolled", "error"] }).notNull().default("paused"),
  pauseReason: text("pause_reason"), // "single_mailbox_enterprise" | "empty_global_pool" | "user_disabled" | "daily_limit_reached" | "imap_error" | "smtp_error"
  poolType: text("pool_type", { enum: ["enterprise", "global"] }).notNull().default("global"),
  dailySentCount: integer("daily_sent_count").notNull().default(0),
  dailyReceivedCount: integer("daily_received_count").notNull().default(0),
  lastResetAt: timestamp("last_reset_at").notNull().defaultNow(),
  hiddenFolderPath: text("hidden_folder_path"),
  hiddenFolderCreatedAt: timestamp("hidden_folder_created_at"),
  activeThreadIds: jsonb("active_thread_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  metadata: jsonb("metadata").$type<{
    smtpHost?: string; smtpPort?: number; imapHost?: string; imapPort?: number;
    lastError?: string; lastErrorAt?: string;
  }>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  wmStatusIdx: index("wm_status_idx").on(table.status),
  wmPoolTypeIdx: index("wm_pool_type_idx").on(table.poolType),
  wmOrgIdx: index("wm_org_idx").on(table.organizationId),
  wmProviderIdx: index("wm_provider_idx").on(table.provider),
  wmIntegrationIdx: uniqueIndex("wm_integration_idx").on(table.integrationId),
}));
```

#### `warmup_threads`

```typescript
export const warmupThreads = pgTable("warmup_threads", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  senderMailboxId: uuid("sender_mailbox_id").notNull().references(() => warmupMailboxes.id, { onDelete: "cascade" }),
  recipientMailboxId: uuid("recipient_mailbox_id").notNull().references(() => warmupMailboxes.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["active", "completed", "stalled", "error"] }).notNull().default("active"),
  messageCount: integer("message_count").notNull().default(0),
  maxMessages: integer("max_messages").notNull().default(3), // 2-3 volleys
  subject: text("subject").notNull(),
  rootMessageId: text("root_message_id"),
  lastMessageId: text("last_message_id"),
  references: jsonb("references").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  nextSendAt: timestamp("next_send_at"),
  nextExpectedReplyAt: timestamp("next_expected_reply_at"),
  lastInteractionAt: timestamp("last_interaction_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  wtStatusNextSendIdx: index("wt_status_next_send_idx").on(table.status, table.nextSendAt),
  wtSenderIdx: index("wt_sender_idx").on(table.senderMailboxId),
  wtRecipientIdx: index("wt_recipient_idx").on(table.recipientMailboxId),
}));
```

#### `warmup_interactions`

```typescript
export const warmupInteractions = pgTable("warmup_interactions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  threadId: uuid("thread_id").notNull().references(() => warmupThreads.id, { onDelete: "cascade" }),
  direction: text("direction", { enum: ["outbound", "inbound"] }).notNull(),
  fromMailboxId: uuid("from_mailbox_id").notNull().references(() => warmupMailboxes.id, { onDelete: "cascade" }),
  toMailboxId: uuid("to_mailbox_id").notNull().references(() => warmupMailboxes.id, { onDelete: "cascade" }),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  messageId: text("message_id").notNull().unique(),
  inReplyTo: text("in_reply_to"),
  references: jsonb("references").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  xAudnixWarmup: boolean("x_audnix_warmup").notNull().default(true),
  expungedFromSent: boolean("expunged_from_sent").notNull().default(false),
  movedToHiddenFolder: boolean("moved_to_hidden_folder").notNull().default(false),
  status: text("status", { enum: ["pending", "sent", "delivered", "failed", "bounced", "expunged"] }).notNull().default("pending"),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at"),
  deliveredAt: timestamp("delivered_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  wiThreadIdx: index("wi_thread_idx").on(table.threadId),
  wiStatusIdx: index("wi_status_idx").on(table.status),
  wiMessageIdIdx: index("wi_message_id_idx").on(table.messageId),
}));
```

#### `warmup_pool_state`

```typescript
export const warmupPoolState = pgTable("warmup_pool_state", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  poolType: text("pool_type", { enum: ["enterprise", "global"] }).notNull(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  totalMailboxes: integer("total_mailboxes").notNull().default(0),
  activeMailboxes: integer("active_mailboxes").notNull().default(0),
  pausedMailboxes: integer("paused_mailboxes").notNull().default(0),
  lastSnapshotAt: timestamp("last_snapshot_at").notNull().defaultNow(),
  isHealthy: boolean("is_healthy").notNull().default(false),
  metadata: jsonb("metadata").$type<Record<string, any>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  wpsPoolTypeOrgIdx: uniqueIndex("wps_pool_type_org_idx").on(table.poolType, table.organizationId),
}));
```

### 1.2 Microservice File Tree

```
services/warmup-service/
├── index.ts                    # Entry: DB, Redis, queues, scheduler
├── src/
│   ├── config/
│   │   └── warmup-config.ts    # ENV vars, thresholds, schedules
│   ├── db/
│   │   └── warmup-db.ts        # Drizzle instance (isolated usage)
│   ├── engine/
│   │   ├── enrollment-engine.ts
│   │   └── pool-health-monitor.ts
│   ├── workers/
│   │   ├── outbound-worker.ts
│   │   ├── inbound-worker.ts
│   │   └── scheduler-worker.ts
│   ├── lib/
│   │   ├── pairing-engine.ts
│   │   ├── thread-manager.ts
│   │   ├── llm-copywriter.ts
│   │   ├── imap-stealth.ts
│   │   ├── smtp-sender.ts
│   │   ├── spam-rescue.ts
│   │   └── watchdog.ts
│   ├── queues/
│   │   └── warmup-queues.ts
│   └── types/
│       └── warmup-types.ts
├── package.json
└── tsconfig.json
```

### 1.3 Dependencies (Reuses Existing)

- `bullmq`, `imapflow`, `nodemailer`, `drizzle-orm`, `drizzle-zod`, `@audnix/shared`, `@shared/*`
- **Zero new external dependencies.**

---

## Phase 2: Enrollment & Tenant Classification

### 2.1 Auto-Enrollment Rules

Enroll integration into `warmup_mailboxes` when:
1. `provider` is `gmail`, `outlook`, or `custom_email`
2. `connected = true`
3. `healthStatus` not in (`suspended`, `revoked`, `error`)
4. `user.plan` is not `trial` OR `userOutreachSettings.warmupEnabled = true`
5. Not already enrolled

**Triggers:** Event-driven (on `integrations.connected = true`) + polling fallback every 5 min.

### 2.2 Classification Logic

```typescript
async function classifyMailbox(integration: Integration, user: User): Promise<'enterprise' | 'global'> {
  if (user.plan === 'enterprise' || user.subscriptionTier === 'enterprise') {
    const org = await getOrganizationForUser(user.id);
    if (org) {
      const count = await db
        .select({ count: sql<number>`count(*)` })
        .from(warmupMailboxes)
        .where(and(
          eq(warmupMailboxes.organizationId, org.id),
          eq(warmupMailboxes.status, 'active')
        ));
      if (count[0].count + 1 >= 20) return 'enterprise';
    }
  }
  return 'global';
}
```

### 2.3 Pause Gate on Enrollment

New mailboxes start as `status = 'paused'`. The pool health monitor (every 5 min) flips to `active` only when the pool is healthy.

### 2.4 Pool Health Thresholds

| Pool Type | Healthy Threshold | Pause Reason When Below |
|---|---|---|
| Global | >= 5 active mailboxes | `empty_global_pool` |
| Enterprise (per org) | >= 2 active mailboxes | `single_mailbox_enterprise` |

### 2.5 Pause States

| `pauseReason` | Meaning | Auto-Resume Trigger |
|---|---|---|
| `single_mailbox_enterprise` | Org has <2 active mailboxes | Another mailbox in same org connects |
| `empty_global_pool` | Global pool <5 active mailboxes | 5th mailbox joins global pool |
| `user_disabled` | User toggled off | User toggles back on |
| `daily_limit_reached` | Mailbox hit daily cap (15-25/day) | Midnight UTC reset |
| `imap_error` | Hidden folder or IMAP auth failed | Next health cycle + backoff |
| `smtp_error` | SMTP auth or send failure | Next health cycle + backoff |

### 2.6 Daily Reset (Midnight UTC)

- `dailySentCount = 0`, `dailyReceivedCount = 0`
- Mailboxes paused for `daily_limit_reached` auto-resume

---

## Phase 3: Pairing Algorithm

### 3.1 Core Flow

```typescript
async function findPartner(mailbox: WarmupMailbox): Promise<Candidate | null> {
  const candidates = mailbox.poolType === 'enterprise' && mailbox.organizationId
    ? await getOrgCandidates(mailbox.organizationId, mailbox.id)
    : await getGlobalCandidates(mailbox.id);

  if (candidates.length === 0) {
    await pauseMailbox(mailbox.id, 'empty_pool_defensive');
    return null;
  }

  const scored = candidates.map(c => ({ ...c, score: scoreCandidate(mailbox, c) }));
  scored.sort((a, b) => b.score - a.score);

  // Weighted random from top 3 (prevents always same partner)
  return weightedRandom(scored.slice(0, 3), c => c.score);
}
```

### 3.2 Scoring Function

```typescript
function scoreCandidate(self: WarmupMailbox, candidate: Candidate): number {
  let score = 100;
  if (self.provider !== candidate.provider) score += 40;        // Provider diversity
  if (candidate.dailySentCount < self.dailySentCount) score += 30; // Volume balance
  if (candidate.activeThreadCount < 3) score += 20;             // Thread load
  else if (candidate.activeThreadCount > 8) score -= 30;        // Overloaded
  if (self.poolType === 'global' && self.organizationId !== candidate.organizationId)
    score += 10;                                                 // Org diversity
  const hoursSinceLastUse = getHoursSince(candidate.lastInteractionAt);
  score -= Math.min(hoursSinceLastUse * 5, 50);                 // Staleness penalty
  return Math.max(score, 1);
}
```

### 3.3 Thread Lifecycle

- **Volley 1:** Sender A -> Recipient B (new thread)
- **Volley 2:** Recipient B -> Sender A (reply, same thread)
- **Volley 3 (optional):** Sender A -> Recipient B (reply, same thread) -> `status = 'completed'`

New thread created every `randomBetween(4, 12)` hours per active mailbox.

---

## Phase 4: Thread-Based Outbound Worker

### 4.1 BullMQ Queues

```typescript
export const warmupOutboundQueue = new Queue('warmup-outbound', {
  connection: redisConfig,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 60000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 100 },
  },
});

export const warmupInboundQueue = new Queue('warmup-inbound', {
  connection: redisConfig,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 100 },
  },
});
```

### 4.2 Outbound Worker Job Flow

1. Load thread + mailboxes
2. Check sender daily cap (15-25/day)
3. Generate plain-text copy via LLM (no links, no HTML, no tracking)
4. Build headers: `X-Audnix-Warmup: true`, `X-Audnix-Warmup-Thread: <threadId>`, `In-Reply-To: <lastMessageId>` (if reply), `References: <space-separated history>` (if reply)
5. SMTP send with provider credentials
6. Record interaction in `warmup_interactions`
7. Update thread (messageCount++, lastMessageId, references, status)
8. Increment sender `dailySentCount`
9. Queue inbound `expect-reply` job (1-4h delay)
10. Queue `expunge-sent` job (5s delay)
11. If thread not complete, queue next volley

### 4.3 SMTP Sender (`src/lib/smtp-sender.ts`)

```typescript
interface SmtpSendOptions {
  from: string; to: string; subject: string; body: string;
  messageId: string; headers: Record<string, string>;
  credentials: { host: string; port: number; user: string; pass: string; secure: boolean };
}

async function sendWarmupEmail(opts: SmtpSendOptions): Promise<SendResult> {
  const transporter = nodemailer.createTransporter({
    host: opts.credentials.host, port: opts.credentials.port,
    secure: opts.credentials.secure,
    auth: { user: opts.credentials.user, pass: opts.credentials.pass },
    tls: { rejectUnauthorized: false },
  });

  const result = await transporter.sendMail({
    from: opts.from, to: opts.to, subject: opts.subject,
    text: opts.body, html: undefined,
    messageId: opts.messageId, headers: opts.headers,
  });

  return { success: true, smtpMessageId: result.messageId };
}
```

**Critical Constraints:** `text:` only, `html: undefined`, NO URLs, NO tracking pixels, `X-Audnix-Warmup: true` header always present.

### 4.4 LLM Copywriter (`src/lib/llm-copywriter.ts`)

```typescript
const SYSTEM_PROMPT = `You are writing plain-text B2B email replies for an email warmup system.
Rules:
1. Write ONLY plain text. No HTML tags. No markdown links.
2. NEVER include URLs, hyperlinks, or web addresses.
3. NEVER include signatures with websites or phone numbers.
4. NEVER include tracking pixels or image references.
5. Be conversational and slightly informal. Short paragraphs.
6. Vary openings: "Hey", "Hi", "Quick question", "Just following up"
7. Topics: workflow questions, scheduling, tool recommendations, casual follow-ups.`;

async function generateReply(context: ThreadContext): Promise<string> {
  const messages = context.previousMessages.map(m => ({
    role: m.direction === 'outbound' ? 'assistant' : 'user', content: m.body,
  }));
  const completion = await deepseekClient.chat.completions.create({
    model: DEEPSEEK_CHAT_MODEL, messages: [
      { role: 'system', content: SYSTEM_PROMPT }, ...messages,
      { role: 'user', content: 'Write the next reply:' },
    ], max_tokens: 200, temperature: 0.8,
  });
  return completion.choices[0].message.content.trim()
    .replace(/https?:\/\/\S+|www\.\S+/g, '[link removed]');
}
```

**AI-down fallback:** Pre-written plain-text templates (20 rotating variants) in `src/lib/warmup-templates.ts`.

---

## Phase 5: Inbound IMAP Stealth Worker

### 5.1 Inbound Job Types

| Job | Purpose | Delay |
|---|---|---|
| `expect-reply` | Poll IMAP for expected reply | 1-4h |
| `expunge-sent` | Delete sent warmup from Sent folder | 5s after send |
| `inbox-sweep` | Move warmup from INBOX to hidden folder | Real-time + periodic |
| `spam-rescue` | Move wrongly filtered warmup from Junk/Spam | Every 30 min |
| `folder-init` | Create `.Audnix-Warmup` hidden folder | On enrollment |

### 5.2 Hidden Folder Creation (`imap-stealth.ts`)

```typescript
async function ensureHiddenFolder(client: ImapFlow, mailbox: WarmupMailbox): Promise<string> {
  const folderName = '.Audnix-Warmup';
  try { await client.mailboxCreate(folderName); }
  catch (err: any) { if (!err.responseText?.includes('EXISTS')) throw err; }
  const list = await client.list();
  const existing = list.find(f => f.name === folderName || f.path === folderName);
  const actualPath = existing ? existing.path : folderName;
  await db.update(warmupMailboxes)
    .set({ hiddenFolderPath: actualPath, hiddenFolderCreatedAt: new Date() })
    .where(eq(warmupMailboxes.id, mailbox.id));
  return actualPath;
}
```

### 5.3 Inbox Sweep: Move to Hidden Folder

```typescript
async function sweepInboxToHidden(client: ImapFlow, mailbox: WarmupMailbox): Promise<number> {
  const hiddenPath = mailbox.hiddenFolderPath || await ensureHiddenFolder(client, mailbox);
  const lock = await client.getMailboxLock('INBOX');
  try {
    const uids = await client.search({ since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) });
    let movedCount = 0;
    for (const uid of uids) {
      const message = await client.fetchOne(uid.toString(), { envelope: true, headers: true });
      if ((message.headers?.toString() || '').includes('X-Audnix-Warmup: true')) {
        await client.messageMove(uid.toString(), hiddenPath);
        movedCount++;
        await markInteractionMovedToHidden(mailbox.id, message.envelope.messageId);
      }
    }
    return movedCount;
  } finally { lock.release(); }
}
```

### 5.4 Sent Folder Expunge

```typescript
async function expungeSentWarmup(client: ImapFlow, mailbox: WarmupMailbox, messageId: string): Promise<boolean> {
  const sentFolder = resolveSentFolder(mailbox.provider); // Gmail: '[Gmail]/Sent Mail', Outlook: 'Sent Items'
  const lock = await client.getMailboxLock(sentFolder);
  try {
    const uids = await client.search({ header: { 'message-id': messageId } });
    if (uids.length === 0) return false;
    for (const uid of uids) {
      await client.messageFlagsSet(uid.toString(), ['\\Deleted'], { uid: true });
    }
    await client.mailboxExpunge();
    await db.update(warmupInteractions)
      .set({ expungedFromSent: true, status: 'expunged' })
      .where(eq(warmupInteractions.messageId, messageId));
    return true;
  } finally { lock.release(); }
}
```

### 5.5 Spam Rescue

```typescript
async function rescueSpamFolder(client: ImapFlow, mailbox: WarmupMailbox): Promise<number> {
  const spamFolder = resolveSpamFolder(mailbox.provider);
  const hiddenPath = mailbox.hiddenFolderPath || await ensureHiddenFolder(client, mailbox);
  const lock = await client.getMailboxLock(spamFolder);
  try {
    const uids = await client.search({ since: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) });
    let rescuedCount = 0;
    for (const uid of uids) {
      const msg = await client.fetchOne(uid.toString(), { envelope: true, headers: true });
      if ((msg.headers?.toString() || '').includes('X-Audnix-Warmup: true')) {
        await client.messageMove(uid.toString(), hiddenPath);
        await client.messageFlagsSet(uid.toString(), ['\\NotJunk'], { uid: true });
        rescuedCount++;
      }
    }
    return rescuedCount;
  } finally { lock.release(); }
}
```

### 5.6 Watchdog: 15s IMAP Timeout

```typescript
const IMAP_TIMEOUT_MS = 15000;

async function withImapTimeout<T>(fn: () => Promise<T>, mailboxId: string, context: string): Promise<T | null> {
  return Promise.race([
    fn(),
    new Promise<null>((_, reject) =>
      setTimeout(() => reject(new Error(`IMAP timeout: ${context} exceeded ${IMAP_TIMEOUT_MS}ms`)), IMAP_TIMEOUT_MS)
    ),
  ]).catch(async (err) => {
    console.error(`[Warmup][Watchdog] Mailbox ${mailboxId} ${context} timed out:`, err.message);
    await db.update(warmupMailboxes)
      .set({ status: 'paused', pauseReason: 'imap_error', updatedAt: new Date() })
      .where(eq(warmupMailboxes.id, mailboxId));
    return null;
  });
}
```

Hung jobs auto-retry via BullMQ `attempts: 3` + exponential backoff.

---

## Phase 6: KPI Segregation & Audit

### 6.1 The Iron Rule

> Warmup data must have exactly 0% impact on all user-facing KPIs.

### 6.2 Audit Checklist

| File | Metric | Action |
|---|---|---|
| `dashboard-routes.ts` | Total sends, reply rate | Add defensive `metadata` guards |
| `email-stats-routes.ts` | Mailbox health, daily volume | Verify no warmup table joins |
| `outreach.ts` | Campaign stats, lead counts | Add comments confirming isolation |
| `analytics-routes.ts` | Conversion funnel, revenue | Add defensive guards |
| `integrations-routes.ts` | Mailbox list, health status | Ensure warmup state not exposed |

Example defensive guard in analytics:

```typescript
const stats = await db.select({ ... })
  .from(messages)
  .where(and(
    eq(messages.userId, userId),
    eq(messages.channel, 'email'),
    sql`${messages.metadata}->>'warmupThreadId' is null`
  ));
```

### 6.3 UI Hidden Folder Filter

```typescript
const visibleFolders = folders.filter(
  f => !f.name.toLowerCase().includes('audnix-warmup') &&
       !f.path.toLowerCase().includes('audnix-warmup')
);
```

---

## Phase 7: Deployment, Monitoring & 24/7 Scheduler

### 7.1 24/7 Scheduler Worker

```typescript
class WarmupScheduler {
  private intervals: NodeJS.Timeout[] = [];

  start() {
    // Every 5 min: enrollment scan
    this.intervals.push(setInterval(() => enrollmentEngine.scan(), 5 * 60 * 1000));
    // Every 5 min: pool health monitor
    this.intervals.push(setInterval(() => poolHealthMonitor.evaluate(), 5 * 60 * 1000));
    // Every 30 min: spam rescue sweep
    this.intervals.push(setInterval(() => {
      warmupInboundQueue.add('spam-rescue-batch', {}, { delay: 0 });
    }, 30 * 60 * 1000));
    // Every 1 min: thread creation scheduler
    this.intervals.push(setInterval(() => this.scheduleNewThreads(), 60 * 1000));
    // Daily at 00:00 UTC: reset counters
    const msUntilMidnight = getMsUntilMidnightUTC();
    setTimeout(() => {
      this.resetDailyCounters();
      setInterval(() => this.resetDailyCounters(), 24 * 60 * 60 * 1000);
    }, msUntilMidnight);
  }

  async scheduleNewThreads() {
    const activeMailboxes = await getActiveMailboxes();
    for (const mb of activeMailboxes) {
      // Create a new thread every 4-12 hours per mailbox
      const hoursSinceLastThread = getHoursSince(mb.lastThreadCreatedAt);
      if (hoursSinceLastThread >= randomBetween(4, 12)) {
        const partner = await findPartner(mb);
        if (partner) {
          await createNewThread(mb, partner);
        }
      }
    }
  }

  async resetDailyCounters() {
    await db.update(warmupMailboxes)
      .set({ dailySentCount: 0, dailyReceivedCount: 0, lastResetAt: new Date() })
      .where(eq(warmupMailboxes.status, 'active'));
    // Resume mailboxes paused for daily_limit_reached
    await db.update(warmupMailboxes)
      .set({ status: 'active', pauseReason: null })
      .where(eq(warmupMailboxes.pauseReason, 'daily_limit_reached'));
  }
}
```

### 7.2 Railway / Docker Deployment

```dockerfile
# Dockerfile.warmup
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
CMD ["node", "services/warmup-service/index.ts"]
```

Procfile addition: `warmup: node services/warmup-service/index.ts`

### 7.3 Monitoring

- **BullMQ dashboard:** Redis-backed queue metrics
- **Health endpoint:** `GET /health` on the scheduler worker port
- **Alerts:** If `paused_mailboxes` exceeds 50% of `total_mailboxes` for > 1 hour
- **Logs:** Structured Winston logging with `[Warmup]` prefix

---

## Appendix A: Edge Case Matrix

| Scenario | Behavior |
|---|---|
| Enterprise org, 1 mailbox | Paused (`single_mailbox_enterprise`). Resumes when 2nd mailbox connects. |
| Global pool, 3 mailboxes | All paused (`empty_global_pool`). Resumes when 5th mailbox connects. |
| 1st user ever signs up | Paused (`empty_global_pool`). Resumes when enough global mailboxes join. |
| User toggles warmup off | Status = `unenrolled`. Threads completed. No new ones created. |
| SMTP send fails 3x | Mailbox paused (`smtp_error`). Exponential backoff retry. |
| IMAP hidden folder creation fails | Mailbox paused (`imap_error`). Retry next health cycle. |
| AI providers all down | Fallback to pre-written plain-text template pool. |
| Midnight UTC daily reset | `dailySentCount = 0`. `daily_limit_reached` mailboxes resume. |
| Mailbox deleted in integrations | Cascade delete from `warmup_mailboxes`. Active threads marked `stalled`. |

## Appendix B: File Tree (Full)

```
services/warmup-service/
├── index.ts
├── src/
│   ├── config/
│   │   └── warmup-config.ts
│   ├── db/
│   │   └── warmup-db.ts
│   ├── engine/
│   │   ├── enrollment-engine.ts
│   │   └── pool-health-monitor.ts
│   ├── workers/
│   │   ├── outbound-worker.ts
│   │   ├── inbound-worker.ts
│   │   └── scheduler-worker.ts
│   ├── lib/
│   │   ├── pairing-engine.ts
│   │   ├── thread-manager.ts
│   │   ├── llm-copywriter.ts
│   │   ├── imap-stealth.ts
│   │   ├── smtp-sender.ts
│   │   ├── spam-rescue.ts
│   │   ├── watchdog.ts
│   │   └── warmup-templates.ts
│   ├── queues/
│   │   └── warmup-queues.ts
│   └── types/
│       └── warmup-types.ts
├── package.json
└── tsconfig.json
```

---

*End of implementation plan. Ready to begin coding when you give the signal.*
