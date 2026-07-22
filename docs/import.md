# CSV/Bulk Import — Full Pipeline

## Flow

```
User uploads CSV
  → /api/leads/import-csv?preview=true        (CSV preview — column mapping)
    → csv-parser (Node.js) parses rows
    → mapCSVColumnsToSchema()
        → AI (Gemini/OpenAI, 12s timeout) maps columns
        → Fallback: regex pattern matching
    → Returns preview with mapped leads
  → User confirms
    → /api/bulk/import-bulk                    (actual import)

User pastes leads or calls API directly
  → /api/bulk/import-bulk                      (JSON bulk import)
```

## Per-Lead Processing

Every lead goes through:

| Step | What | Detail |
|---|---|---|
| MX resolution | DNS MX lookup | Batch via Rust `mx-batch-queue` (BRPOP) or Node.js `Promise.allSettled` fallback. Results cached per domain. |
| Spam trap scan | `SpamTrapDetector.scan()` | Checks known trap domains, disposable email patterns, spam signatures |
| Dedup | DB + batch check | `getExistingEmails()` query + in-memory `Set`. Duplicates filtered. |
| Smart MX routing | `assignMailbox()` | `@gmail.com` → Gmail mailbox, `@outlook.com` → Outlook, custom domain → matching `custom_email`, fallback round-robin |
| Status assignment | `'bouncy'` or `'new'` | `'bouncy'` if spam trap detected OR no MX records. Tags `['spam_trap', 'spam_risk']` added. |
| Metadata stored | JSON in `leads.metadata` | `spam_check`, `spam_reason`, `is_disposable`, `has_mx`, `imported_via`, `import_date` |
| Background enrich | BullMQ `timezone-enrichment` job | AI-based timezone + geolocation enrichment dispatched per lead |

## MX Batch Queue (Rust)

### Why Rust?
- Node.js DNS resolution: ~5-50ms per domain sequential
- Rust parallel DNS via `futures::future::join_all` + `hickory-resolver`: all domains resolved simultaneously
- 50k leads → ~3 seconds (vs 4+ minutes Node.js sequential)

### Flow
```
Node.js bulk-actions-routes.ts
  → enqueueMxBatch({ domains: [...uniqueDomains] })
    → LPUSH to mx-batch-queue (Redis)
  → BRPOP on mx-batch-results (15s timeout)
    → If Rust responds in time: use results
    → Fallback: Node.js Promise.allSettled DNS

Rust main.rs (BRPOP handler)
  → tokio::spawn dedicated handler
  → futures::future::join_all resolves ALL domains
  → LPUSH results back to mx-batch-results
```

## Lead Distribution

- Gmail leads → Gmail mailboxes (evenly distributed)
- Outlook leads → Outlook mailboxes (evenly distributed)
- Same-domain leads → matching `custom_email` mailbox
- All others → round-robin across remaining mailboxes
- If no matching mailbox type: fallback to custom SMTP mailboxes

## UI

### Lead Import Page
- Always shows pipeline usage (even <1%)
- Progress bar minimum 0.5% width
- Status text during import:
  - "Parsing text with AI..."
  - "Identifying leads..."
  - "Checking MX records & spam filters..."
  - "Import complete!"
- Socket progress event: `bulk_import` (not `bulk_import_progress`)

## Server-Side Fixes (Deployed)

- **AI mapping timeout**: 12s `Promise.race` → falls back to regex instead of hanging 60s+
- **Missing-email fallback**: If AI returns valid JSON with null email/name, regex runs
- **Nginx proxy timeout**: `proxy_read_timeout 120s` for `/api/` (was default 60s → 502)
- **Express timeout**: Import routes 60s (was 30s)
- **Dynamic import hoisted**: `mailbox-router` imported once, not per-lead

## DB Migration

- `warmup_interactions.placement` column added (was missing → warmup chart 500 error)

## Test Results (Jul 21 2026)

```
=== CSV Preview ===
preview: true  total: 5  leads: 5
  - Test Lead One   <test1@example.com>   Acme Corp
  - Test Lead Two   <test2@example.com>   Globex Inc
  - Test Lead Three <test3@example.com>   Initech
  - Test Lead Four  <test4@example.com>   Umbrella Corp
  - Test Lead Five  <test5@example.com>   Hooli

=== Bulk Import ===
status: OK  imported: 5  filtered: 0
```
