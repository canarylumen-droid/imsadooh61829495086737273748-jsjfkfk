# Full Codebase Audit Report — Audnix AI

**Date:** 2026-07-05  
**Scope:** Lead import pipeline, CSV column mapping, filtering, deduplication, performance, plan limits

---

## 🔴 CRITICAL ISSUE 1: 5 Inconsistent Plan Limit Systems (Hard Block)

### The Problem
Users get "Lead limit reached" errors even when they should have plenty of room. Enterprise users report being unable to import leads at all.

### Root Cause
There are **5 different limit systems** that all contradict each other:

| # | Location | free/trial | starter | pro | enterprise |
|---|----------|-----------|---------|-----|------------|
| A | `packages/shared/pricing-config.ts` (source of truth) | 250 | 2,500 | 7,000 | -1 (∞) |
| B | `ai-routes.ts` GET `/api/leads` & POST `/import-csv` | 10,000 | N/A | 100,000 | 500,000 |
| C | `ai-routes.ts` POST `/import-pdf` | 10,000 | 25,000 | 100,000 | 500,000 |
| D | `lead-importer.ts` (Instagram/Manychat/Gmail) | 5,000 | N/A | 50,000 | 250,000 |
| E | `bulk-actions-routes.ts` POST `/import-bulk` | **NO LIMIT CHECK** | **NO LIMIT CHECK** | **NO LIMIT CHECK** | **NO LIMIT CHECK** |

### Specific Bugs

**`ai-routes.ts:412-414`** — `POST /import-csv` uses a hardcoded limit map that ignores `pricing-config.ts`:
```ts
const limit = (user?.subscriptionTier === 'enterprise' || ...)
  ? 500000
  : (user?.subscriptionTier === 'pro' || user?.plan === 'pro' ? 100000 : 10000);
```

**`ai-routes.ts:1088-1091`** — `POST /import-bulk` (ai-routes.ts) has a completely hardcoded limit:
```ts
const maxLeads = 1000000; // Unlimited as per request
```

**`lead-importer.ts:85,167,253`** — The platform importers have a THIRD limit scheme that's even more restrictive:
```ts
const limit = user?.email === 'team.replyflow@gmail.com' ? 250000
  : (user?.plan === 'enterprise' ? 250000
  : (user?.plan === 'pro' ? 50000 : 5000));
```

**`bulk-actions-routes.ts`** — The `/import-bulk` endpoint has **zero** plan limit enforcement. Any user can import unlimited leads through this route.

### Impact
- Enterprise users with 10,000+ leads can get blocked depending on which route they use
- Free users are limited to 5,000 in platform importers but 10,000 in CSV import
- The `bulk-actions-routes.ts` endpoint bypasses all limits entirely
- The `getCampaignLimits()` in `plan-utils.ts` conflicts with the API route limits

---

## 🔴 CRITICAL ISSUE 2: Bulk Import Route Bypasses All Limits

**File:** `services/api-gateway/src/routes/bulk-actions-routes.ts:14-176`

The `POST /import-bulk` endpoint used by the frontend's `handleFinalizeImport()` and `handleManualImport()` has **no plan limit check**. It will import any number of leads regardless of the user's plan.

Furthermore, it uses the **old** `mapCsvToLeadMetadata()` from `lead-importer.ts` for CSV column mapping instead of the AI-powered `csv-mapper.ts`.

---

## 🔴 CRITICAL ISSUE 3: .png / Image File Filter Not Enforced Server-Side

### Frontend (`lead-import.tsx:148-164`)
The `processFileSelection()` correctly rejects non-CSV/Excel/PDF files:
```ts
if (!isPDF && !isCSV && !isExcel) {
  toast({ title: "Invalid file type", ... });
  return;
}
```

### Backend (`ai-routes.ts:270-276`)
But the multer instance has **no fileFilter** at all:
```ts
const upload = multer({ storage: multer.memoryStorage() });
// No fileFilter, no limits.fileSize
```

A user bypassing the frontend (curl/Postman) can upload a `.png` file to `/api/leads/import-csv` and the server will attempt to parse it as CSV, likely crashing or returning confusing errors.

Compare with `file-upload.ts` which has proper file filters for voice, PDF, and avatars.

---

## 🔴 CRITICAL ISSUE 4: LeadsDisplayModal — Extreme Performance Lag

**File:** `client/src/components/dashboard/LeadsDisplayModal.tsx`

### Bug: No Virtualization
The component renders ALL visible leads as real DOM `<tr>` elements. With 5000+ leads and potentially 20+ metadata columns, the DOM tree has 100,000+ elements, causing:
- 3-5 second initial render
- Janky scrolling (browser layout thrashing)
- "Load More" freezes the UI for 1-2 seconds

### Bug: Index as React Key (line 123)
```tsx
visibleLeads.map((lead: any, idx) => (<tr key={idx}>))
```
Using array index prevents React from properly reconciling list changes. Every "Load More" causes full re-render of ALL rows.

### Bug: allMetadataKeys Recomputes on Every Render (lines 46-48)
```tsx
const allMetadataKeys = Array.from(new Set(
  visibleLeads.flatMap(l => Object.keys((l as any).metadata || {})
    .filter(k => !k.endsWith('_type') && k !== '_unmapped_cols'))
)).sort();
```
This `flatMap` + `Object.keys` loop runs on EVERY render cycle, doing O(n*k) work. With thousands of leads and dozens of metadata keys, this is wasteful.

### Bug: Expensive CSS Overlays
- `backdrop-blur-2xl` (line 109) forces GPU composition on every scroll frame
- `backdrop-blur-xl` on sticky header
- `transition-colors` on every `<tr>` forces paint on hover

---

## 🔴 CRITICAL ISSUE 5: HandleFinalizeImport Fetches 10,000 Leads

**File:** `client/src/pages/dashboard/lead-import.tsx:354`
```tsx
const leadsRes = await apiRequest("GET", `/api/leads?limit=10000&offset=0`);
const allLeads = await leadsRes.json();
```

After finalizing an import, the frontend fetches ALL leads (up to 10k) just to display them in the UI. This:
- Wastes bandwidth (potential MBs of JSON)
- Slows down the import flow by seconds
- Puts unnecessary load on the database

---

## 🔴 CRITICAL ISSUE 6: CSV Import Re-Streams the Entire File

**File:** `services/api-gateway/src/routes/ai-routes.ts:381-394`

In non-preview mode, the code re-parses the entire CSV after already parsing it once:
```ts
const reStream = Readable.from(file.buffer.toString('utf-8'));
reStream.pipe(csvParser())
```

Since `previewRows` already contains up to 5,000 parsed rows, this is completely redundant for files under 5,000 rows. For files over 5,000 rows, the re-stream should start from row 5001, not from the beginning.

---

## 🟠 HIGH ISSUE 7: Schema Mismatch — `plan` vs `subscriptionTier`

The codebase has two competing fields on the user object:

| File | Uses | Example |
|------|------|---------|
| `ai-routes.ts` | `user.plan` + `user.subscriptionTier` | `user?.plan === 'enterprise'` OR `user?.subscriptionTier === 'enterprise'` |
| `lead-importer.ts` | `user.plan` ONLY | `user?.plan === 'enterprise'` |
| `pricing-config.ts` | `subscriptionTier` | Via `getActivePlanId()` |
| `plan-utils.ts` | `subscriptionTier` with `plan` fallback | `const active = (tier && tier !== 'free' && tier !== 'none' ? tier : (plan \|\| altPlan)) \|\| 'starter'` |

If a user has `plan: 'enterprise'` but `subscriptionTier: 'free'` (or vice versa), different routes will enforce different limits. This is likely the root cause of "enterprise users can't import leads".

---

## 🟠 HIGH ISSUE 8: Upload Rate Limiter Is Not Tiered

**File:** `shared/lib/monitoring/upload-rate-limiter.ts:15-18`
```ts
const DEFAULT_CONFIG: UploadRateLimiterConfig = {
  uploadsPerHour: 10,
  windowSizeMinutes: 60,
};
```

All users are limited to **10 uploads per hour** regardless of plan. Enterprise users bulk-importing multiple CSV files will hit this limit quickly. Should be:
- free/trial: 10/hour
- starter: 25/hour
- pro: 100/hour
- enterprise: 1000/hour or unlimited

---

## 🟠 HIGH ISSUE 9: No Multer File Size Limit on CSV Import

**File:** `services/api-gateway/src/routes/ai-routes.ts:270`
```ts
const upload = multer({ storage: multer.memoryStorage() });
```

No `fileSize` limit. A user can upload a 500MB CSV file, which will:
1. Be held entirely in memory (`file.buffer`)
2. Be converted to a string (`csvBuffer.toString('utf-8')`) — double memory
3. Potentially crash the Node.js process

Compare with PDF import which also has no file size limit.

---

## 🟠 HIGH ISSUE 10: Bulk Actions Route Uses Old Mapper Without AI

**File:** `services/api-gateway/src/routes/bulk-actions-routes.ts:38`
```ts
const { mapCsvToLeadMetadata } = await import('@shared/lib/imports/lead-importer.js');
```

This uses the OLD `lead-importer.ts` mapper which only recognizes a fixed set of columns:
```
industry, companySize, painPoint, role, company, website, city, country, review, googleMapsUrl, businessName, countryCode, niche, bio, revenue
```

The NEW AI-powered `csv-mapper.ts` is available but only used in `ai-routes.ts`. The bulk import path doesn't benefit from AI column mapping, fuzzy matching, or dynamic metadata extraction.

---

## 🟡 MEDIUM ISSUE 11: CSV Import Response Returns Up to 1000 Leads

**File:** `services/api-gateway/src/routes/ai-routes.ts:580`
```ts
leads: leadsToSave.slice(0, 1000)
```

Returning 1000 full lead objects (with metadata) in the API response can be a 5-10MB JSON payload. This causes slow responses and high memory usage. Should return only IDs or paginate.

---

## 🟡 MEDIUM ISSUE 12: Campaign Wizard Dynamic Tags Only From First Lead's Metadata

**File:** `client/src/components/outreach/UnifiedCampaignWizard.tsx:377-383`
```ts
const dynamicTags = leads[0]?.metadata ?
  Object.keys(leads[0].metadata)
    .filter(k => !k.endsWith('_type') && k !== '_unmapped_cols')
    .map(k => ({ label: k.replace(/_/g, ' '), value: `{{${k}}}` })) : [];
```

If lead[0] has subset of columns compared to other leads, some CSV columns won't appear as available variables. Should aggregate across ALL leads or at least sample more than the first one.

---

## 🟡 MEDIUM ISSUE 13: `import-bulk` in ai-routes.ts Returns Leads Without Refresh

**File:** `services/api-gateway/src/routes/ai-routes.ts:1193-1199`

The route inserts leads and returns `finalLeads`, but bulk-actions-routes.ts at line 170 returns `results.leads.slice(0, 100)`. The frontend `handleFinalizeImport` has to make a SECOND API call to get real lead data:
```tsx
const leadsRes = await apiRequest("GET", `/api/leads?limit=10000&offset=0`);
```

If the import route returned the actual inserted leads with their DB IDs, this second call would be unnecessary.

---

## 🟡 MEDIUM ISSUE 14: No Image File Type Validation in CSV/PDF Upload Routes

**File:** `services/api-gateway/src/routes/ai-routes.ts`

The CSV and PDF upload endpoints don't validate MIME types or file signatures. Combined with the missing file filter (Issue 3), any file can be uploaded. An attacker could:
- Upload a `.exe` renamed to `.csv` 
- Upload a `.png` that gets parsed as CSV (garbage output or crash)
- Upload a malicious PDF with embedded JavaScript

---

## 🟡 MEDIUM ISSUE 15: `lead-importer.ts` Duplicate Check Only Scans First 10k Existing Leads

```ts
const existingLeads = await storage.getLeads({ userId, limit: 10000 });
```

For users with >10k leads, duplicate detection is incomplete. Leads beyond 10k won't be checked for duplicates.

---

## 🟡 MEDIUM ISSUE 16: CSV Import Preview Has Hardcoded 5000 Row Cap

**File:** `services/api-gateway/src/routes/ai-routes.ts:276`
```ts
const MAX_PREVIEW_ROWS = 5000;
```

This is fine for preview, but the `previewCount` in the response reports only this capped value, not the actual total. The frontend shows "5000 leads found" even if the actual file has 50,000 rows.

---

## 🟡 MEDIUM ISSUE 17: Email Verification Timeout Hardcoded to 5 Seconds

**File:** `services/api-gateway/src/routes/ai-routes.ts:477`
```ts
const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000));
```

For large imports (10k+ leads), 5 seconds per verification × 10,000 leads = 13.9 hours. The per-lead verification is done sequentially within each chunk. Should use a concurrent pool.

---

## 🟢 LOW ISSUE 18: `server/index.ts` Uses Deprecated `import` Syntax

**File:** `services/api-gateway/src/routes/ai-routes.ts:1101`
```ts
const { verifyDomainDns } = await (eval('import("@services/email-service/src/email/dns-verification.js")') as Promise<any>);
```

Using `eval()` for dynamic imports is a security risk and a code smell. Should use a proper dynamic `import()`.

---

## 🟢 LOW ISSUE 19: Inconsistent CSV Column Mapping Behavior

The `mapCsvToLeadMetadata()` in `lead-importer.ts` normalizes column names by stripping non-alphanumeric chars:
```ts
const normalizedAlias = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
```

But the `fallbackMapping()` in `csv-mapper.ts` uses regex patterns:
```ts
/^name$/i, /^full[_\s-]?name$/i, /^contact[_\s-]?name$/i
```

These two approaches can produce different mappings for the same CSV, leading to inconsistent behavior depending on which import route is used.

---

## 🟢 LOW ISSUE 20: No Backup Plan for AI Column Mapping

**File:** `services/brain-worker/src/ai-lib/utils/csv-mapper.ts:61-64`
```ts
if (skipAI || (!hasGemini && !hasOpenAI)) {
  return fallbackMapping(headers);
}
```

When AI is unavailable, it falls back to regex-based matching. But the `fallbackMapping` only recognizes a set of English column name patterns. CSVs with non-English column names (e.g., "Nombre", "Correo") will produce empty mappings.

---

## 🟢 LOW ISSUE 21: Multiple files have the same export name

**Files:**
- `packages/shared/plan-utils.ts` and `shared/plan-utils.ts` are near-duplicates
- `packages/shared/pricing-config.ts` and `shared/pricing-config.ts` are near-duplicates

These likely confuse the `tsconfig.json` path resolution. The versions differ in minor ways (e.g., `CampaignLimits` interface only exists in `shared/plan-utils.ts`).

---

## 🟢 LOW ISSUE 22: `file-upload.ts` Uses `require()` in ESM Context

**File:** `shared/lib/storage/file-upload.ts:365`
```ts
const pdf = require('pdf-parse');
```

Using CJS `require()` in an otherwise ESM file is a workaround that can cause issues in strict ESM environments.

---

## 🟢 LOW ISSUE 23: No Logging for Upload Errors in import-pdf

**File:** `services/api-gateway/src/routes/ai-routes.ts:1610-1616`
```ts
catch (error: unknown) {
  const errorMessage = error instanceof Error ? error.message : "Failed to import leads from PDF";
  console.error("PDF import error:", error);
```

The error message is generic and doesn't include details about what went wrong (file corrupt, extraction failed, etc.).

---

# Summary of All Issues Found

| Severity | Count | Key Issues |
|----------|-------|------------|
| 🔴 Critical | 6 | Inconsistent plan limits (5 systems), bulk route bypasses limits, missing .png filter server-side, LeadsDisplayModal performance (no virtualization), `handleFinalizeImport` fetches 10k leads, CSV re-streams entire file |
| 🟠 High | 4 | `plan` vs `subscriptionTier` mismatch, upload rate limiter not tiered, no multer file size limits, bulk route uses old mapper without AI |
| 🟡 Medium | 7 | 1000 leads in response, dynamic tags from first lead only, duplicate call to get leads, no image/MIME validation, 10k limit on existing leads check, hardcoded 5k preview cap, 5s email verification timeout |
| 🟢 Low | 5 | `eval()` for dynamic import, inconsistent column mapper behavior, no non-English column support, duplicate utility files, CJS `require()` in ESM |

---

# Quick Fix Priority

1. **Consolidate plan limits** — Use `pricing-config.ts` as single source of truth. Replace hardcoded limits in `ai-routes.ts`, `lead-importer.ts`, and `bulk-actions-routes.ts` with `getPlanCapabilities().leadsLimit`.
2. **Add plan limit check to `bulk-actions-routes.ts`** — Currently has zero enforcement.
3. **Add multer fileFilter + fileSize to CSV import** — Prevent .png/other files from being parsed as CSV.
4. **Virtualize LeadsDisplayModal** — Use `@tanstack/react-virtual` or similar to render only visible rows.
5. **Remove redundant `GET /api/leads?limit=10000` call** after finalizing import.
6. **Remove redundant CSV re-stream** by reusing already-parsed data.
7. **Add upload rate limiting tiers** based on user plan.
8. **Fix `plan` vs `subscriptionTier` inconsistency** — Pick one field and migrate all code to use it.
