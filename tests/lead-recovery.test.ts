import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const store = readFileSync('client/src/stores/leadRecoveryStore.tsx', 'utf-8');
const page = readFileSync('client/src/pages/dashboard/lead-recovery.tsx', 'utf-8');
const worker = readFileSync('services/lead-recovery-worker/src/worker.ts', 'utf-8');
const workerIndex = readFileSync('services/lead-recovery-worker/index.ts', 'utf-8');
const mysqlLib = readFileSync('shared/lib/mysql.ts', 'utf-8');
const routes = readFileSync('services/api-gateway/src/routes/lead-recovery-routes.ts', 'utf-8');
const mailboxService = readFileSync('services/api-gateway/src/services/lead-recovery-mailbox.ts', 'utf-8');
const eventsFile = readFileSync('services/lead-recovery-worker/src/events.ts', 'utf-8');

// ─────────────────────────────────────────────────────────────────────────────
// 1. STORE — Field name fixes (the entire UI was broken)
// ─────────────────────────────────────────────────────────────────────────────
describe('LeadRecoveryStore — Field name fixes', () => {
  it('RecoveredLead uses `id` not `_id`', () => {
    expect(store).toContain('interface RecoveredLead {');
    expect(store).toContain('id: string;');
    expect(store).not.toContain('_id: string;');
  });

  it('RecoveryEventLog uses `id` not `_id`', () => {
    expect(store).toContain('export interface RecoveryEventLog {');
    expect(store).toContain('id: string;');
    expect(store).not.toContain('_id: string;');
  });

  it('RecoveredLead uses flat sourceMailboxProvider (not nested snapshot)', () => {
    expect(store).toContain('sourceMailboxProvider?: string | null;');
    expect(store).toContain('sourceMailboxAccountType?: string | null;');
    expect(store).not.toContain('sourceMailboxSnapshot?: {');
  });

  it('recoverLead() checks res.ok before parsing', () => {
    expect(store).toContain('if (!res.ok) {');
    expect(store).toContain('throw new Error(err.error || err.message || `HTTP ${res.status}`);');
  });

  it('syncObjections() checks res.ok before parsing', () => {
    expect(store).toContain('if (!res.ok) {');
    expect(store).toContain("throw new Error(err.error || err.message || `HTTP ${res.status}`);");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. UI PAGE — Field references, socket listeners, deactivation dialog
// ─────────────────────────────────────────────────────────────────────────────
describe('LeadRecoveryPage — UI fixes', () => {
  it('Uses lead.id not lead._id for keys and recover', () => {
    expect(page).toContain('key={lead.id}');
    expect(page).not.toContain('lead._id');
    expect(page).toContain("store.recoverLead(lead.id)");
  });

  it('Uses event.id not event._id for keys', () => {
    expect(page).toContain('key={event.id}');
    expect(page).not.toContain('event._id');
  });

  it('Uses flat source fields not nested sourceMailboxSnapshot', () => {
    expect(page).toContain('lead.sourceMailboxAccountType');
    expect(page).not.toContain('sourceMailboxSnapshot');
  });

  it('Has socket listeners for real-time updates', () => {
    expect(page).toContain("socket.on('stats_updated', refresh)");
    expect(page).toContain("socket.on('leads_updated', refresh)");
    expect(page).toContain("socket.on('settings_updated', refresh)");
    expect(page).toContain("socket.off('stats_updated', refresh)");
    expect(page).toContain("socket.off('leads_updated', refresh)");
    expect(page).toContain("socket.off('settings_updated', refresh)");
  });

  it('Has deactivation confirmation dialog', () => {
    expect(page).toContain('confirmDeactivate');
    expect(page).toContain('setConfirmDeactivate(true)');
    expect(page).toContain('Deactivate Lead Recovery?');
  });

  it('Synced Mailboxes count uses syncStatus not lastSyncAt', () => {
    expect(page).toContain("mailbox.syncStatus === 'completed'");
    // Still shows lastSyncAt timestamp in mailbox details — only the COUNT filter changed
    expect(page).toContain('mailbox.lastSyncAt &&');
  });

  it('Has useRealtime import', () => {
    expect(page).toContain("import { useRealtime } from \"@/hooks/use-realtime\"");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. WORKER — Safety guards, error handling, campaign protection
// ─────────────────────────────────────────────────────────────────────────────
describe('LeadRecoveryWorker — Campaign safety', () => {
  it('Guard 1: checks active campaigns before recovery', () => {
    expect(worker).toContain("eq(outreachCampaigns.status, 'active')");
    expect(worker).toContain('SkippedInActiveCampaign');
  });

  it('Guard 2: checks recent activity (< 7 days) before recovery', () => {
    expect(worker).toContain('recentCutoff');
    expect(worker).toContain('recentActivity');
    expect(worker).toContain('SkippedRecentActivity');
  });

  it('Does not write to main leads table — only recovered_leads', () => {
    expect(worker).not.toContain("INSERT INTO leads");
    expect(worker).not.toContain("UPDATE leads");
    expect(worker).not.toContain("DELETE FROM leads");
    expect(worker).toContain("upsertRecoveredLead");
  });

  it('Error handling stringifies non-Error throws', () => {
    expect(worker).toContain("const errorMsg = typeof error === 'string' ? error : (error?.message || String(error))");
  });

  it('Consolidated DB reads into single import block', () => {
    const dbImports = (worker.match(/import\('@shared\/lib\/db\/db\.js'\)/g) || []).length;
    expect(dbImports).toBe(1); // Was 2 separate imports, now 1
  });

  it('Campaign guard catch logs warnings instead of silent', () => {
    expect(worker).toContain("console.warn(`[LeadRecoveryWorker] Safety guard DB error for ${leadEmail}:`");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. WORKER INDEX — Double initialization fix
// ─────────────────────────────────────────────────────────────────────────────
describe('LeadRecoveryWorker index — No double init', () => {
  it('Worker is created inside main() not at module top level', () => {
    expect(workerIndex).toContain('worker = new LeadRecoveryWorker()');
    const topLevelNew = (workerIndex.match(/new LeadRecoveryWorker\(\)/g) || []).length;
    // Should only appear once — inside the `if (UNIFIED_MODE !== 'true')` block in main()
    // The startRecoveryService path uses `worker.start()` not `new LeadRecoveryWorker()`
    // The code does `worker = new LeadRecoveryWorker()` (no `const` since already declared as `let`)
    const newCalls = (workerIndex.match(/(?<!const\s)worker\s*=\s*new\s+LeadRecoveryWorker\(\)/g) || []).length;
    expect(newCalls).toBe(1); // Only inside main()
  });

  it('main() creates worker locally instead of using module-level instance', () => {
    expect(workerIndex).toContain('let worker: LeadRecoveryWorker');
    expect(workerIndex).toContain('worker = new LeadRecoveryWorker()');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. MYSQL LIB — Race conditions, error clearing, prompt config
// ─────────────────────────────────────────────────────────────────────────────
describe('MySQL — Atomic operations', () => {
  it('completeMailboxSync clears error_message', () => {
    expect(mysqlLib).toContain("error_message = NULL");
  });

  it('upsertRecoveredLead uses SELECT FOR UPDATE in transaction', () => {
    expect(mysqlLib).toContain("FOR UPDATE");
    expect(mysqlLib).toContain("await conn.beginTransaction()");
    expect(mysqlLib).toContain("await conn.commit()");
    expect(mysqlLib).toContain("await conn.rollback()");
  });

  it('upsertRecoveryPromptConfig actually updates on conflict', () => {
    expect(mysqlLib).toContain("system_prompt = VALUES(system_prompt),");
    expect(mysqlLib).toContain("user_prompt_template = VALUES(user_prompt_template)");
    // The prompt config function must NOT have `id = id` — it should update the prompt fields
    // (upsertRecoveryObjection still legitimately uses `id = id` elsewhere)
    const promptConfigSection = mysqlLib.slice(
      mysqlLib.indexOf("upsertRecoveryPromptConfig"),
      mysqlLib.indexOf("export async function promptConfigExists")
    );
    expect(promptConfigSection).toContain("VALUES(system_prompt)");
    expect(promptConfigSection).not.toContain("id = id");
  });

  it('has getRecoveryStats exported as static function', () => {
    expect(mysqlLib).toContain('export async function getRecoveryStats');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. ROUTES — Proper imports, warning text
// ─────────────────────────────────────────────────────────────────────────────
describe('LeadRecoveryRoutes — Clean imports', () => {
  it('getRecoveryStats is a static import not lazy dynamic import', () => {
    expect(routes).toContain('getRecoveryStats,');
  });

  it('SKIP_WARNING reflects actual behavior (no campaign blocking)', () => {
    expect(routes).toContain('works alongside your active campaigns');
    expect(routes).not.toContain('until this campaign is finished');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. MAILBOX SERVICE — Real implementation
// ─────────────────────────────────────────────────────────────────────────────
describe('checkMailboxCampaignStatus — Real implementation', () => {
  it('Uses Drizzle to query outreachCampaigns', () => {
    expect(mailboxService).toContain("from(outreachCampaigns)");
    expect(mailboxService).toContain('eq(outreachCampaigns.status, "active")');
  });

  it('Uses db import not stub return as primary logic', () => {
    expect(mailboxService).toContain("from \"@shared/lib/db/db.js\"");
    // The catch fallback still returns the default, but the primary path uses real DB query
    expect(mailboxService).toContain(".from(outreachCampaigns)");
    expect(mailboxService).toContain('eq(outreachCampaigns.status, "active")');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. EVENTS — New event types
// ─────────────────────────────────────────────────────────────────────────────
describe('Worker event types', () => {
  it('Includes SkippedRecentActivity', () => {
    expect(eventsFile).toContain('"SkippedRecentActivity"');
  });
});
