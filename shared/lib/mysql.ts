import crypto from "crypto";
import { createRequire } from "module";

let mysql: any;
try {
  mysql = createRequire(import.meta.url)("mysql2/promise");
} catch {
  mysql = null;
}

// ─── Column name conversion ────────────────────────────────────────────────

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function mapRowToCamelCase(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    result[snakeToCamel(key)] = value;
  }
  return result;
}

function mapDataToSnakeCase(
  data: Record<string, unknown>,
  allowedFields: string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const snakeKey = camelToSnake(key);
    if (allowedFields.includes(snakeKey)) {
      result[snakeKey] = value;
    }
  }
  return result;
}

// ─── UUID generation ───────────────────────────────────────────────────────

export function generateId(): string {
  return crypto.randomUUID();
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface BrainstormedObjection {
  category: string;
  rule: string;
  evidence?: string;
  syncedAt?: string;
}

export type SyncStatus = "idle" | "queued" | "syncing" | "completed" | "failed";
export type LeadIntent = "Converted" | "Ghosted" | "Not-Interested" | "Reply-Needed";
export type DeliverabilityStatus = "safe" | "risky" | "invalid" | "unknown";
export type ObjectionCreatedBy = "ai" | "user";

export interface LeadRecoveryStateRow {
  id: string;
  tenantId: string;
  mailboxId: string;
  isActive: boolean;
  lastSyncAt: Date | null;
  syncRequestedAt: Date | null;
  syncStatus: SyncStatus;
  isBusy: boolean;
  availableAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecoveredLeadRow {
  id: string;
  tenantId: string;
  mailboxId: string;
  sourceMailboxProvider: string | null;
  sourceMailboxAccountType: string | null;
  email: string;
  subject: string | null;
  intent: LeadIntent;
  deliverabilityStatus: DeliverabilityStatus;
  followUpDraft: string | null;
  conversationSummary: string | null;
  lastMessageText: string | null;
  lastMessageAt: Date | null;
  brainstormedObjections: BrainstormedObjection[] | null;
  sourceMessageIds: string[] | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecoveryPromptConfigRow {
  id: string;
  name: string;
  systemPrompt: string;
  userPromptTemplate: string;
  updatedAt: Date;
  createdAt: Date;
}

export interface RecoveryEventLogRow {
  id: string;
  tenantId: string;
  action: string;
  payload: Record<string, unknown> | null;
  timestamp: Date;
}

export interface RecoveryObjectionRow {
  id: string;
  tenantId: string;
  category: string;
  rule: string;
  evidence: string | null;
  sourceLeadId: string | null;
  createdBy: ObjectionCreatedBy;
  createdAt: Date;
  updatedAt: Date;
}

const LEAD_RECOVERY_STATE_COLUMNS = [
  "id", "tenant_id", "mailbox_id", "is_active", "last_sync_at",
  "sync_requested_at", "sync_status", "is_busy", "available_at",
  "created_at", "updated_at",
];

const RECOVERED_LEADS_COLUMNS = [
  "id", "tenant_id", "mailbox_id", "source_mailbox_provider",
  "source_mailbox_account_type", "email", "subject", "intent",
  "deliverability_status", "follow_up_draft", "conversation_summary",
  "last_message_text", "last_message_at", "brainstormed_objections",
  "source_message_ids", "created_at", "updated_at",
];

const RECOVERY_PROMPT_CONFIG_COLUMNS = [
  "id", "name", "system_prompt", "user_prompt_template",
  "updated_at", "created_at",
];

const RECOVERY_EVENT_LOGS_COLUMNS = [
  "id", "tenant_id", "action", "payload", "timestamp",
];

const RECOVERY_OBJECTIONS_COLUMNS = [
  "id", "tenant_id", "category", "rule", "evidence",
  "source_lead_id", "created_by", "created_at", "updated_at",
];

// ─── Connection pool singleton ─────────────────────────────────────────────

let pool: any | null = null;

function readInt(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) ? value : fallback;
}

export function hasMySqlUri(): boolean {
  return Boolean(process.env.MYSQL_HOST);
}

export function getMySqlPool(): any {
  if (!pool) {
    throw new Error("MySQL pool not initialized. Call connectMySql() first.");
  }
  return pool;
}

export async function connectMySql(): Promise<any> {
  if (!mysql) throw new Error("mysql2 package not available - install it with: npm install mysql2");
  if (pool) return pool;

  const host = process.env.MYSQL_HOST || "localhost";
  const port = readInt("MYSQL_PORT", 3306);
  const user = process.env.MYSQL_USER || "root";
  const password = process.env.MYSQL_PASSWORD || "";
  const database = process.env.MYSQL_DATABASE || "lead_recovery";

  pool = mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: readInt("MYSQL_POOL_SIZE", 10),
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
  });

  const conn = await pool.getConnection();
  try {
    await conn.ping();
    console.log(`[MySQL] Connected to ${host}:${port}/${database}`);
  } finally {
    conn.release();
  }

  return pool;
}

export async function closeMySql(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.log("[MySQL] Pool closed");
  }
}

// ─── Ensure tables ─────────────────────────────────────────────────────────

export async function ensureTables(): Promise<void> {
  const p = getMySqlPool();

  await p.query(`
    CREATE TABLE IF NOT EXISTS lead_recovery_state (
      id VARCHAR(36) PRIMARY KEY,
      tenant_id VARCHAR(255) NOT NULL,
      mailbox_id VARCHAR(255) NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 0,
      last_sync_at DATETIME NULL,
      sync_requested_at DATETIME NULL,
      sync_status ENUM('idle', 'queued', 'syncing', 'completed', 'failed') NOT NULL DEFAULT 'idle',
      is_busy TINYINT(1) NOT NULL DEFAULT 0,
      available_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE INDEX idx_tenant_mailbox (tenant_id, mailbox_id),
      INDEX idx_tenant_id (tenant_id),
      INDEX idx_is_active (is_active),
      INDEX idx_sync_status (sync_status)
    )
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS recovered_leads (
      id VARCHAR(36) PRIMARY KEY,
      tenant_id VARCHAR(255) NOT NULL,
      mailbox_id VARCHAR(255) NOT NULL,
      source_mailbox_provider VARCHAR(50) NULL,
      source_mailbox_account_type VARCHAR(50) NULL,
      email VARCHAR(255) NOT NULL,
      subject TEXT NULL,
      intent ENUM('Converted', 'Ghosted', 'Not-Interested', 'Reply-Needed') NOT NULL,
      deliverability_status ENUM('safe', 'risky', 'invalid', 'unknown') NOT NULL DEFAULT 'unknown',
      follow_up_draft TEXT NULL,
      conversation_summary TEXT NULL,
      last_message_text TEXT NULL,
      last_message_at DATETIME NULL,
      brainstormed_objections JSON NULL,
      source_message_ids JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE INDEX idx_tenant_mailbox_email (tenant_id, mailbox_id, email),
      INDEX idx_tenant_id (tenant_id),
      INDEX idx_intent (intent),
      INDEX idx_tenant_created (tenant_id, created_at)
    )
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS recovery_prompt_config (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      system_prompt TEXT NOT NULL,
      user_prompt_template TEXT NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS recovery_event_logs (
      id VARCHAR(36) PRIMARY KEY,
      tenant_id VARCHAR(255) NOT NULL,
      action VARCHAR(100) NOT NULL,
      payload JSON NULL,
      timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_tenant_id (tenant_id),
      INDEX idx_action (action),
      INDEX idx_timestamp (timestamp),
      INDEX idx_tenant_timestamp (tenant_id, timestamp)
    )
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS recovery_objections (
      id VARCHAR(36) PRIMARY KEY,
      tenant_id VARCHAR(255) NOT NULL,
      category VARCHAR(80) NOT NULL,
      rule VARCHAR(500) NOT NULL,
      evidence VARCHAR(500) NULL,
      source_lead_id VARCHAR(36) NULL,
      created_by ENUM('ai', 'user') NOT NULL DEFAULT 'ai',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE INDEX idx_tenant_rule (tenant_id, rule),
      INDEX idx_tenant_id (tenant_id)
    )
  `);
}

// ─── Internal helpers ──────────────────────────────────────────────────────

function parseRow<T>(row: Record<string, unknown>): T {
  return mapRowToCamelCase(row) as unknown as T;
}

function parseRows<T>(rows: Record<string, unknown>[]): T[] {
  return rows.map((r) => parseRow<T>(r));
}

function parseJsonField<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return JSON.parse(value) as T;
  return value as T;
}

function serializeJson(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}

// ─── LeadRecoveryState helpers ─────────────────────────────────────────────

export async function getLeadRecoveryStates(
  tenantId: string
): Promise<LeadRecoveryStateRow[]> {
  const p = getMySqlPool();
  const [rows] = await p.query(
    "SELECT * FROM lead_recovery_state WHERE tenant_id = ?",
    [tenantId]
  );
  return parseRows<LeadRecoveryStateRow>(rows as Record<string, unknown>[]);
}

export async function getActiveLeadRecoveryState(
  tenantId: string
): Promise<LeadRecoveryStateRow | null> {
  const p = getMySqlPool();
  const [rows] = await p.query(
    "SELECT * FROM lead_recovery_state WHERE tenant_id = ? AND is_active = 1 ORDER BY updated_at DESC LIMIT 1",
    [tenantId]
  );
  if (rows.length === 0) return null;
  return parseRow<LeadRecoveryStateRow>(rows[0] as Record<string, unknown>);
}

export async function getPendingSyncStates(): Promise<LeadRecoveryStateRow[]> {
  const p = getMySqlPool();
  const [rows] = await p.query(
    `SELECT * FROM lead_recovery_state
     WHERE is_active = 1
       AND sync_requested_at IS NOT NULL
       AND (last_sync_at IS NULL OR sync_requested_at > last_sync_at)`
  );
  return parseRows<LeadRecoveryStateRow>(rows as Record<string, unknown>[]);
}

export async function claimMailboxForSync(
  tenantId: string,
  mailboxId: string
): Promise<LeadRecoveryStateRow | null> {
  const p = getMySqlPool();
  const conn = await p.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT * FROM lead_recovery_state
       WHERE tenant_id = ? AND mailbox_id = ?
         AND is_active = 1 AND is_busy = 0
         AND sync_requested_at IS NOT NULL
         AND (last_sync_at IS NULL OR sync_requested_at > last_sync_at)
       FOR UPDATE`,
      [tenantId, mailboxId]
    );

    if (rows.length === 0) {
      await conn.commit();
      return null;
    }

    await conn.query(
      `UPDATE lead_recovery_state
       SET is_busy = 1, sync_status = 'syncing'
       WHERE tenant_id = ? AND mailbox_id = ?`,
      [tenantId, mailboxId]
    );

    const [updated] = await conn.query(
      "SELECT * FROM lead_recovery_state WHERE tenant_id = ? AND mailbox_id = ?",
      [tenantId, mailboxId]
    );

    await conn.commit();
    return parseRow<LeadRecoveryStateRow>(updated[0] as Record<string, unknown>);
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export async function completeMailboxSync(
  tenantId: string,
  mailboxId: string
): Promise<void> {
  const p = getMySqlPool();
  await p.query(
    `INSERT INTO lead_recovery_state (id, tenant_id, mailbox_id, is_busy, available_at, last_sync_at, sync_status)
     VALUES (?, ?, ?, 0, NULL, NOW(), 'completed')
     ON DUPLICATE KEY UPDATE
       is_busy = 0, available_at = NULL, last_sync_at = NOW(), sync_status = 'completed'`,
    [generateId(), tenantId, mailboxId]
  );
}

export async function failMailboxSync(
  tenantId: string,
  mailboxId: string
): Promise<void> {
  const p = getMySqlPool();
  const availableAt = new Date(Date.now() + 60 * 60 * 1000);
  await p.query(
    `INSERT INTO lead_recovery_state (id, tenant_id, mailbox_id, is_busy, sync_status, available_at)
     VALUES (?, ?, ?, 0, 'failed', ?)
     ON DUPLICATE KEY UPDATE
       is_busy = 0, sync_status = 'failed', available_at = ?`,
    [generateId(), tenantId, mailboxId, availableAt, availableAt]
  );
}

export async function upsertRecoveryState(
  tenantId: string,
  mailboxId: string,
  data: Partial<
    Record<
      | "isActive"
      | "isBusy"
      | "lastSyncAt"
      | "syncRequestedAt"
      | "syncStatus"
      | "availableAt",
      unknown
    >
  >
): Promise<void> {
  const p = getMySqlPool();
  const allowed = [
    "is_active", "is_busy", "last_sync_at", "sync_requested_at",
    "sync_status", "available_at",
  ];
  const mapped = mapDataToSnakeCase(data as Record<string, unknown>, allowed);

  const setClauses: string[] = [];
  const values: unknown[] = [];

  for (const [column, value] of Object.entries(mapped)) {
    setClauses.push(`${column} = ?`);
    values.push(value ?? null);
  }

  if (setClauses.length === 0) return;

  const setSql = setClauses.join(", ");
  await p.query(
    `INSERT INTO lead_recovery_state (id, tenant_id, mailbox_id${setClauses.length ? ", " + Object.keys(mapped).join(", ") : ""})
     VALUES (?, ?, ?${setClauses.length ? ", " + setClauses.map(() => "?").join(", ") : ""})
     ON DUPLICATE KEY UPDATE ${setSql}`,
    [generateId(), tenantId, mailboxId, ...values, ...values]
  );
}

export async function deactivateAllRecoveryStates(
  tenantId: string
): Promise<void> {
  const p = getMySqlPool();
  await p.query(
    "UPDATE lead_recovery_state SET is_active = 0 WHERE tenant_id = ?",
    [tenantId]
  );
}

// ─── RecoveredLead helpers ─────────────────────────────────────────────────

export async function getRecoveredLeads(
  tenantId: string,
  limit: number
): Promise<RecoveredLeadRow[]> {
  const p = getMySqlPool();
  const [rows] = await p.query(
    "SELECT * FROM recovered_leads WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?",
    [tenantId, limit]
  );
  return parseRows<RecoveredLeadRow>(rows as Record<string, unknown>[]).map(
    (row) => ({
      ...row,
      brainstormedObjections: parseJsonField<BrainstormedObjection[]>(
        (row as any).brainstormedObjections
      ),
      sourceMessageIds: parseJsonField<string[]>((row as any).sourceMessageIds),
    })
  );
}

export async function getRecoveredLeadById(
  leadId: string,
  tenantId: string
): Promise<RecoveredLeadRow | null> {
  const p = getMySqlPool();
  const [rows] = await p.query(
    "SELECT * FROM recovered_leads WHERE id = ? AND tenant_id = ?",
    [leadId, tenantId]
  );
  if (rows.length === 0) return null;
  const row = parseRow<RecoveredLeadRow>(rows[0] as Record<string, unknown>);
  return {
    ...row,
    brainstormedObjections: parseJsonField<BrainstormedObjection[]>(
      (row as any).brainstormedObjections
    ),
    sourceMessageIds: parseJsonField<string[]>((row as any).sourceMessageIds),
  };
}

export async function upsertRecoveredLead(
  tenantId: string,
  mailboxId: string,
  email: string,
  data: {
    sourceMailboxProvider?: string;
    sourceMailboxAccountType?: string;
    subject?: string;
    intent?: LeadIntent;
    deliverabilityStatus?: DeliverabilityStatus;
    followUpDraft?: string;
    conversationSummary?: string;
    lastMessageText?: string;
    lastMessageAt?: Date;
    sourceMessageIds?: string[];
    brainstormedObjections?: BrainstormedObjection[];
  }
): Promise<RecoveredLeadRow> {
  const p = getMySqlPool();

  const existingRows = await p.query(
    "SELECT * FROM recovered_leads WHERE tenant_id = ? AND mailbox_id = ? AND email = ?",
    [tenantId, mailboxId, email]
  );
  const existing = (existingRows[0] as Record<string, unknown>[])[0] ?? null;

  if (existing) {
    const allowed = [
      "source_mailbox_provider", "source_mailbox_account_type", "subject",
      "intent", "deliverability_status", "follow_up_draft",
      "conversation_summary", "last_message_text", "last_message_at",
    ];
    const mapped = mapDataToSnakeCase(data as Record<string, unknown>, allowed);

    const setClauses: string[] = [];
    const values: unknown[] = [];
    for (const [column, value] of Object.entries(mapped)) {
      setClauses.push(`${column} = ?`);
      values.push(value ?? null);
    }
    setClauses.push("updated_at = NOW()");

    let currentMessageIds: string[] =
      parseJsonField<string[]>(existing.source_message_ids) ?? [];
    let currentObjections: BrainstormedObjection[] =
      parseJsonField<BrainstormedObjection[]>(existing.brainstormed_objections) ?? [];

    if (data.sourceMessageIds) {
      for (const id of data.sourceMessageIds) {
        if (!currentMessageIds.includes(id)) {
          currentMessageIds.push(id);
        }
      }
    }
    if (data.brainstormedObjections) {
      const existingRules = new Set(currentObjections.map((o) => o.rule));
      for (const obj of data.brainstormedObjections) {
        if (!existingRules.has(obj.rule)) {
          currentObjections.push(obj);
          existingRules.add(obj.rule);
        }
      }
    }

    const messageIdsJson = serializeJson(currentMessageIds);
    const objectionsJson = serializeJson(currentObjections);

    await p.query(
      `UPDATE recovered_leads
       SET ${setClauses.join(", ")},
           source_message_ids = ?,
           brainstormed_objections = ?
       WHERE tenant_id = ? AND mailbox_id = ? AND email = ?`,
      [...values, messageIdsJson, objectionsJson, tenantId, mailboxId, email]
    );
  } else {
    const messageIdsJson = serializeJson(data.sourceMessageIds ?? []);
    const objectionsJson = serializeJson(data.brainstormedObjections ?? []);

    await p.query(
      `INSERT INTO recovered_leads
         (id, tenant_id, mailbox_id, source_mailbox_provider,
          source_mailbox_account_type, email, subject, intent,
          deliverability_status, follow_up_draft, conversation_summary,
          last_message_text, last_message_at, source_message_ids,
          brainstormed_objections)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        generateId(),
        tenantId,
        mailboxId,
        data.sourceMailboxProvider ?? null,
        data.sourceMailboxAccountType ?? null,
        email,
        data.subject ?? null,
        data.intent ?? "Reply-Needed",
        data.deliverabilityStatus ?? "unknown",
        data.followUpDraft ?? null,
        data.conversationSummary ?? null,
        data.lastMessageText ?? null,
        data.lastMessageAt ?? null,
        messageIdsJson,
        objectionsJson,
      ]
    );
  }

  const [rows] = await p.query(
    "SELECT * FROM recovered_leads WHERE tenant_id = ? AND mailbox_id = ? AND email = ?",
    [tenantId, mailboxId, email]
  );
  const row = parseRow<RecoveredLeadRow>(rows[0] as Record<string, unknown>);
  return {
    ...row,
    brainstormedObjections: parseJsonField<BrainstormedObjection[]>(
      (row as any).brainstormedObjections
    ),
    sourceMessageIds: parseJsonField<string[]>((row as any).sourceMessageIds),
  };
}

// ─── RecoveryPromptConfig helpers ──────────────────────────────────────────

export async function getRecoveryPromptConfig(
  name: string
): Promise<RecoveryPromptConfigRow | null> {
  const p = getMySqlPool();
  const [rows] = await p.query(
    "SELECT * FROM recovery_prompt_config WHERE name = ?",
    [name]
  );
  if (rows.length === 0) return null;
  return parseRow<RecoveryPromptConfigRow>(rows[0] as Record<string, unknown>);
}

export async function upsertRecoveryPromptConfig(
  name: string,
  systemPrompt: string,
  userPromptTemplate: string
): Promise<void> {
  const p = getMySqlPool();
  await p.query(
    `INSERT INTO recovery_prompt_config (id, name, system_prompt, user_prompt_template)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [generateId(), name, systemPrompt, userPromptTemplate]
  );
}

export async function promptConfigExists(name: string): Promise<boolean> {
  const p = getMySqlPool();
  const [rows] = await p.query(
    "SELECT 1 FROM recovery_prompt_config WHERE name = ? LIMIT 1",
    [name]
  );
  return rows.length > 0;
}

// ─── RecoveryEventLog helpers ──────────────────────────────────────────────

export async function getRecoveryEventLogs(
  tenantId: string,
  limit: number
): Promise<RecoveryEventLogRow[]> {
  const p = getMySqlPool();
  const [rows] = await p.query(
    "SELECT * FROM recovery_event_logs WHERE tenant_id = ? ORDER BY timestamp DESC LIMIT ?",
    [tenantId, limit]
  );
  return parseRows<RecoveryEventLogRow>(rows as Record<string, unknown>[]).map(
    (row) => ({
      ...row,
      payload: parseJsonField<Record<string, unknown>>(
        (row as any).payload
      ),
    })
  );
}

export async function createRecoveryEventLog(
  tenantId: string,
  action: string,
  payload: Record<string, unknown>
): Promise<RecoveryEventLogRow> {
  const p = getMySqlPool();
  const id = generateId();
  const payloadJson = serializeJson(payload);
  const timestamp = new Date();

  await p.query(
    `INSERT INTO recovery_event_logs (id, tenant_id, action, payload, timestamp)
     VALUES (?, ?, ?, ?, ?)`,
    [id, tenantId, action, payloadJson, timestamp]
  );

  return {
    id,
    tenantId,
    action,
    payload,
    timestamp,
  };
}

// ─── RecoveryObjection helpers ─────────────────────────────────────────────

export async function upsertRecoveryObjection(
  tenantId: string,
  rule: string,
  category: string,
  evidence?: string,
  sourceLeadId?: string,
  createdBy: ObjectionCreatedBy = "ai"
): Promise<void> {
  const p = getMySqlPool();
  await p.query(
    `INSERT INTO recovery_objections (id, tenant_id, category, rule, evidence, source_lead_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [generateId(), tenantId, category, rule, evidence ?? null, sourceLeadId ?? null, createdBy]
  );
}

// ─── Backlog / Stale recovery helpers ──────────────────────────────────────

export async function getLeadRecoveryBacklog(): Promise<number> {
  const p = getMySqlPool();
  const [rows] = await p.query(
    `SELECT COUNT(*) AS count FROM lead_recovery_state
     WHERE is_active = 1
       AND is_busy = 0
       AND sync_requested_at IS NOT NULL
       AND (last_sync_at IS NULL OR sync_requested_at > last_sync_at)`
  );
  return Number((rows[0] as Record<string, unknown>).count);
}

export async function recoverStaleBusyState(
  stateId: string
): Promise<void> {
  const p = getMySqlPool();
  await p.query(
    `UPDATE lead_recovery_state
     SET is_busy = 0, sync_status = 'idle', available_at = NOW()
     WHERE id = ?`,
    [stateId]
  );
}
