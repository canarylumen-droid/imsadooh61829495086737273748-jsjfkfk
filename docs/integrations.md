# Integrations Page

## Overview

The integrations page manages all connected email mailboxes, calendar providers, and social accounts.

## Mailbox Types

| Type | Description | IMAP | Warmup Support |
|---|---|---|---|
| `custom_email` | Custom SMTP/IMAP | Rust (`rust-imap-worker`) | Yes (no seeds for custom domains) |
| `gmail` | Gmail API OAuth | Node.js (OAuth2 tokens) | Yes |
| `outlook` | Outlook API OAuth | Node.js (OAuth2 tokens) | Yes |
| `google_calendar` | Google Calendar events | API only | N/A |
| `calendly` | Calendly scheduling | Webhook sync | N/A |
| `instagram` | Social media | API only | N/A |

## UI Sections

### Mailbox Cards
- **Per-mailbox card**: Email address, provider badge, DNS status, 4-column stats
- **Stats grid**: Delivery %, Bounce %, Inbox %, Rep Score
- **"Init..." replaced with "—"**: Shows em dash when no data yet
- **Dynamic status badges** (4-8 chars, lowercase):
  - `inactive` (gray) — disconnected
  - `warming` (amber) — warmup active, rep < 85
  - `warm` (emerald) — warmup active, rep ≥ 85
  - `paused` (amber/secondary) — manually paused
  - `outreach` (sky/blue) — connected, no warmup

### Connection Banner
- Green banner: connected and active
- Red banner: disconnected or expired
- Shows provider icon + email + status

### DNS Health Section
- Per-domain SPF/DKIM/DMARC/MX/BL verification
- Badges: green (✓ verified) or red (✗ failed/missing)
- "BL" instead of "RBL" (shorter)
- Per-domain data used first (not aggregate stats)

### View All Mailboxes Modal
- "≡ View All" button next to "Add Mailbox"
- Opens dialog with 2-column grid of all mailboxes
- Each card shows: email, provider, DNS badges, 4-column stats
- Focus + Disconnect actions

### Reputation Section
- Per-mailbox reputation score
- Sent, Bounce, Spam counts
- Shows "--" when `sent === 0` (no data yet)
- Score with color coding:
  - > 85: green (healthy)
  - 70-85: amber (acceptable)
  - < 70: red (at risk)

### Real-Time Updates
- `settings_updated` → full integration refresh
- `integration_reputation_updated` → reputation score update
- `deliverability_updated` → instant placement pulse dot color change
- Pulse dot: green (inbox), red (spam), amber (bounced), blue (other)

## Disconnect Flow

### Custom SMTP
1. Click "Disconnect"
2. Confirm dialog
3. POST `/api/integrations/:id/disconnect`
4. Integration soft-deleted (is_deleted = true)
5. Mailbox removed from warmup
6. Socket events: `settings_updated`, `integration_reputation_updated`

### Gmail / Outlook OAuth
1. Click "Disconnect"
2. POST `/api/oauth/:provider/disconnect`
3. Revokes OAuth refresh token
4. Deletes integration record
5. Same cleanup flow as SMTP

### Calendly
1. Click "Disconnect" (destructive)
2. POST `/api/oauth/disconnect/calendly`
3. Revokes Calendly OAuth token (POST with `application/x-www-form-urlencoded`)
4. Deletes integration record
5. Clears `users.calendarLink`
6. Deletes Calendly scheduling URL settings
7. Verifies via `/api/channels/calendly` that Disconnect shows even when Calendly paginated off page 1

### Google Calendar
1. Click "Disconnect"
2. POST `/api/oauth/google-calendar/disconnect`
3. Revokes Google OAuth token
4. Fires `wsSync.notifySettingsUpdated(userId)` for instant UI refresh

## Add Mailbox

### SMTP
1. "Add Mailbox" button → form
2. Fields: Email (accountType), SMTP Host, Port, Username, Password
3. Test connection before saving
4. POST `/api/integrations/create`
5. Auto-starts warmup (enrollment status = 'active')
6. Triggers Sent folder scanner

### Gmail
1. "Connect Gmail" → OAuth redirect
2. Scopes: `gmail.send`, `gmail.readonly`, `gmail.labels`
3. Auto-starts warmup
4. DNS verification (SPF/DKIM/DMARC) runs in background

### Outlook
1. "Connect Outlook" → OAuth redirect
2. Scopes: `Mail.Send`, `Mail.Read`, `offline_access`
3. Same flow as Gmail

## DNS Verification

### Check Results
| Check | Green (✓) | Red (✗) |
|---|---|---|
| SPF | v=spf1 includes sending IP | Missing or invalid |
| DKIM | Valid DKIM signature | Missing or mismatch |
| DMARC | Policy set (p=quarantine/reject) | Missing or p=none |
| MX | MX record points to valid server | Missing or misconfigured |
| BL | Not on any blacklist | Listed on RBL |

### How It Works
- `POST /api/integrations/:id/verify-dns`
- Queries DNS TXT, MX, and SPF records
- Checks common blacklists (Spamhaus, Barracuda, etc.)
- Results cached in `domain_verifications` table
- Unique index on `(user_id, domain)` for `ON CONFLICT` updates

### Per-Domain Badges
```
User has 2 mailboxes: john@company.com, sales@company.com
Both share domain "company.com"
→ SPF/DKIM/DMARC/MX/BL checked once for company.com
→ Same badges shown for both mailboxes
```

## Limits

- API returns limit 100 integrations per request
- Pagination for View All modal
- "∞ UNLIMITED" → actual count display
- Shows `{count} Connected` and `{count} / {count}`

## Mobile Layout

- Stats grid: `grid-cols-2 sm:grid-cols-4` (was `grid-cols-4` causing overflow)
- Labels: `tracking-normal sm:tracking-widest`
- Reduced gaps/padding
- No `overflow-x-auto` wrapper
- Compact button sizes (h-8, text-[10px])
- Stacked layout on small screens
- Mailbox header: "Mailboxes" with `truncate`
- View All button accessible
