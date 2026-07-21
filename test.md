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

## Server-Side Fixes Deployed

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
