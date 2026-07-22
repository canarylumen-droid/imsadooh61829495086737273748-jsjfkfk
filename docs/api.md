# API Reference

## Base URL

Production: `https://audnixai.com/api`

## Authentication

### Session Cookie
- Cookie name: `audnix.sid`
- Set by login/register endpoints
- httpOnly, secure (prod), sameSite: lax

### API Key
```
Header: x-api-key: audnix_<64-hex-chars>
  OR Authorization: Bearer audnix_<64-hex-chars>
```
Keys have full access except delete_account, username/OTP endpoints.

## Auth Endpoints

### Register
```
POST /api/auth/register
Body: { email, password, name }
→ 200: { user }
→ 409: { error: "Account already exists" }
```

### Login
```
POST /api/auth/login
Body: { email, password }
→ 200: { user, session }
→ 401: { error }  -- differentiated messages
```

### Logout
```
POST /api/auth/logout
→ 200: { success: true }
```

### User Profile
```
GET /api/user/profile
→ 200: { id, email, name, plan, avatarUrl, offerValue, offerValue2, calendarLink, ... }
```

## Mailbox / Integration Endpoints

### List Integrations
```
GET /api/integrations?limit=100&offset=0
→ 200: { integrations: [...], total }
```

### Connect SMTP
```
POST /api/integrations/create
Body: { type: 'smtp', smtpHost, smtpPort, smtpUser, smtpPass, accountType, ... }
→ 200: { integration }
```

### Connect Gmail API
```
GET /api/oauth/connect/google
→ 302: Redirect to Google OAuth
```

### Connect Outlook API
```
GET /api/oauth/connect/outlook
→ 302: Redirect to Outlook OAuth
```

### Disconnect
```
POST /api/integrations/:id/disconnect
→ 200: { success }
```

### Update Integration
```
PATCH /api/integrations/:integrationId/outreach-limit
Body: { initialOutreachLimit }
→ 200: { integration }
```

## Lead Endpoints

### List Leads
```
GET /api/leads?status=new&integrationId=xxx&search=xxx&page=0&limit=50
→ 200: { leads: [...], total, page, totalPages }
```

### Get Lead
```
GET /api/leads/:id
→ 200: { id, name, email, company, status, score, snippet, ... }
```

### Update Lead
```
PATCH /api/leads/:id
Body: { status, score, archived, ... }
→ 200: { lead }
```

### Bulk Delete
```
POST /api/leads/bulk-delete
Body: { ids: [...] }
→ 200: { deleted: count }
```

### Import CSV Preview
```
POST /api/leads/import-csv?preview=true
Body: form-data (file)
→ 200: { preview: true, total, leads: [...] }
```

### Import Bulk
```
POST /api/bulk/import-bulk
Body: { leads: [{ name, email, company, ... }] }
→ 200: { status: 'OK', imported: count, filtered: count }
```

## Message Endpoints

### List Messages
```
GET /api/messages/:leadId?limit=50&before=timestamp
→ 200: { messages: [...] }
```

### Send Message
```
POST /api/messages/:leadId
Body: { subject, body, cc, bcc }
→ 200: { message }
```

### Bulk Send Campaign
```
POST /api/campaigns/:id/send
→ 200: { queued: count }
```

## Campaign Endpoints

### List Campaigns
```
GET /api/campaigns
→ 200: { campaigns: [...] }
```

### Create Campaign
```
POST /api/campaigns
Body: { name, type, steps: [...], dailyLimit, ... }
→ 200: { campaign }
```

### Launch Campaign
```
POST /api/campaigns/:id/launch
→ 200: { success }
```

### Campaign Stats
```
GET /api/campaigns/:id/stats
→ 200: { sent, opened, replied, bounced, eta, ... }
```

## Warmup Endpoints

### Warmup Status
```
GET /api/warmup/status?integrationId=xxx
→ 200: { email, status, dailyLimit, sentToday, warmupPercent, totalSpam, ... }
```

### Toggle Warmup
```
POST /api/warmup/toggle
Body: { integrationId, enabled }
→ 200: { status }
```

### Warmup Activity
```
GET /api/warmup/activity?integrationId=xxx&days=7
→ 200: [{ date, sent, opened, replied, spam }, ...]
```

### Warmup Inbox
```
GET /api/warmup/inbox
→ 200: [{ threadId, subject, messageCount, placement, openedAt, ... }]
```

## Deliverability Endpoints

### Inbox Placement
```
GET /api/stats/inbox-placement?integrationId=xxx&days=30
→ 200: { inboxRate, spamRate, bounceRate, unknownRate }
```

### Domain Reputation
```
GET /api/stats/domain-reputation?integrationId=xxx&days=30
→ 200: [{ domain, sent, inbox, spam, bounce, spf, dkim, dmarc, mx, blacklist }, ...]
```

## Dashboard Endpoints

### KPIs
```
GET /api/dashboard/stats?integrationId=xxx&days=30
→ 200: {
  totalLeads, totalSent, openRate, replyRate, bounceRate,
  convertedLeads, campaignCount, outreachRate, globalBounceRate, ...
}
```

### Recent Conversations
```
GET /api/dashboard/recent-conversations?limit=5
→ 200: [{ ...messages with lead info }]
```

### Analytics Full
```
GET /api/dashboard/analytics/full?days=30&integrationId=xxx
→ 200: {
  timeSeries: [{ date, sent, opened, replied, bounced, spam }],
  distribution: { inbox, spam, bounce, unknown },
  summary, trends, predictions, recommendations, topPerformers
}
```

## Calendar Endpoints

### Get Events
```
GET /api/calendar/events?start=ISO&end=ISO
→ 200: { events: [...] }
```

### Sync Calendly
```
POST /api/calendar/sync/calendly
→ 200: { synced: count }
```

## MCP / API Key Endpoints

### List Keys
```
GET /api/mcp/key
→ 200: { keys: [{ id, name, permissions, lastFour, createdAt }] }
```

### Create Key
```
POST /api/mcp/key
Body: { name, permissions: 'read'|'read-write' }
→ 200: { key: { id, name, fullKey: 'audnix_<64hex>', permissions } }
```

### Rename Key
```
PATCH /api/mcp/key/:id
Body: { name }
→ 200: { key }
```

### Delete Key
```
DELETE /api/mcp/key/:id
→ 200: { success }
```

### JSON-RPC (MCP)
```
POST /api/mcp/mcp
Body: { jsonrpc: '2.0', method, params, id }
→ 200: { jsonrpc: '2.0', result, id }
```

## Lead Recovery Endpoints

### Status
```
GET /api/lead-recovery/status
→ 200: { states: [{ integrationId, status, errorMessage, syncedAt, ... }] }
```

### Start Sync
```
POST /api/lead-recovery/sync
Body: { integrationId }
→ 200: { success }
```

### Send Recovery
```
POST /api/lead-recovery/send/:leadId
Body: { subject, body }
→ 200: { success, message }
```

### Event Logs
```
GET /api/lead-recovery/events?stateId=xxx
→ 200: { events: [...] }
```

## User Settings

### Get Settings
```
GET /api/user/settings
→ 200: { offerValue, offerValue2, calendarLink, ... }
```

### Update Settings
```
PATCH /api/user/settings
Body: { offerValue, offerValue2, ... }
→ 200: { settings }
```

### Schedule Deletion
```
DELETE /api/user/schedule-deletion
→ 200: { scheduledAt }
```

### Cancel Deletion
```
POST /api/user/cancel-deletion
→ 200: { success }
```

## OAuth Endpoints

### Google Calendar
```
GET /api/oauth/connect/google-calendar
→ 302: Redirect to Google OAuth

POST /api/oauth/google-calendar/disconnect
→ 200: { success }
```

### Calendly
```
GET /api/oauth/connect/calendly
→ 302: Redirect to Calendly OAuth

POST /api/oauth/disconnect/calendly
→ 200: { success }
```

## Socket Events (Server → Client)

| Event | Payload | Triggers |
|---|---|---|
| `stats_updated` | `{ userId }` | Every send/open/bounce/reply/spam |
| `leads_updated` | `{ type: 'INSERT'|'UPDATE'|'BULK_DELETE', lead }` | Lead changes |
| `messages_updated` | `{ type, leadId, ... }` | New message |
| `deliverability_updated` | `{ userId, placement, integrationId, email }` | Placement change |
| `open_click_event` | `{ leadId, messageId, type }` | Open/click |
| `warmup_update` | `{ ... }` | Warmup progress |
| `insights_updated` | `{ userId }` | AI insights ready |
| `settings_updated` | `{ userId }` | Settings change |
| `calendar_updated` | `{ userId }` | Calendar event change |
| `campaign_eta` | `{ campaignId, eta }` | ETA update |
| `bulk_import` | `{ progress }` | Import progress |
| `notification` | `{ notification }` | New notification |
| `integration_reputation_updated` | `{ userId, integrationId }` | Reputation score change |

## Email Tracking Headers

Every outbound email includes these tracking headers:
```
X-Audnix-Id: <uuid>             // Unique message ID for tracking
X-Audnix-Campaign: <uuid>       // Campaign ID (if campaign email)
List-Unsubscribe: <mailto:..>   // One-click unsubscribe
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

## Rate Limiting

### API Gateway Rate Limits
| Endpoint Group | Limit | Window |
|---|---|---|
| Auth (login/register) | 10 req/min | 1 minute |
| Email sending | 100 req/min | 1 minute |
| Import | 5 req/min | 1 minute |
| MCP (AI agent) | 30 req/min | 1 minute |
| General API | 1000 req/min | 1 minute |

### Per-Mailbox Rate Limits
- Daily send limit per mailbox (configurable)
- Initial outreach throttle (day-1 limit)
- Per-second rate: 1 email / 2-5 seconds (human-like)
- Warmup sends: staggered 30-90s + per-thread offset

## Pagination

### Request Parameters
| Param | Default | Max | Description |
|---|---|---|---|
| `limit` | 50 | 200 | Items per page |
| `offset` | 0 | - | Skip N items |
| `page` | 0 | - | Page number (alternative to offset) |
| `before` | - | - | Cursor-based pagination (timestamp) |

### Response Format
```json
{
  "items": [...],
  "total": 1234,
  "page": 0,
  "totalPages": 25,
  "limit": 50
}
```

## Socket Event Payloads

### stats_updated
```json
{
  "type": "stats_updated",
  "userId": "uuid"
}
```
Triggers invalidation of: dashboard KPIs, warmup status, inbox placement, analytics full.

### leads_updated
```json
{
  "type": "leads_updated",
  "leadId": "uuid",
  "data": {
    "type": "INSERT" | "UPDATE" | "BULK_DELETE",
    "lead": { ... }  // full lead object
  }
}
```

### messages_updated
```json
{
  "type": "messages_updated",
  "leadId": "uuid",
  "data": {
    "type": "new_message" | "temp_message" | "bounce",
    "message": { ... }
  }
}
```

### deliverability_updated
```json
{
  "type": "deliverability_updated",
  "userId": "uuid",
  "data": {
    "placement": "inbox" | "spam" | "bounced" | "delivered",
    "integrationId": "uuid",
    "email": "recipient@example.com",
    "source": "tracking_pixel" | "bounce_handler" | "fbl" | "seed_monitor" | "imap_spam_detect"
  }
}
```

## Nginx Configuration

Required nginx settings for API gateway:
```nginx
location /api/ {
  proxy_pass http://localhost:3001;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection 'upgrade';
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_read_timeout 120s;       # Important for import/bulk endpoints
  proxy_send_timeout 60s;
  proxy_buffering off;
}

location /socket.io/ {
  proxy_pass http://localhost:3002;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection 'upgrade';
  proxy_set_header Host $host;
  proxy_read_timeout 86400s;     # 24h for WebSocket
}
```

## Database Schema Reference

### users
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  password_hash TEXT,  -- NULL for OAuth-only accounts
  plan TEXT DEFAULT 'trial',  -- trial|starter|pro|enterprise
  avatar_url TEXT,
  offer_value INTEGER DEFAULT 0,
  offer_value2 INTEGER DEFAULT 0,
  calendar_link TEXT,
  scheduled_deletion_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### integrations (mailboxes)
```sql
CREATE TABLE integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  type TEXT NOT NULL,  -- smtp|gmail|outlook|custom_email|google_calendar|calendly|instagram
  account_type TEXT,    -- email address
  smtp_host TEXT, smtp_port INTEGER,
  smtp_user TEXT, smtp_pass TEXT,  -- encrypted
  credentials JSON,  -- OAuth tokens (encrypted)
  status TEXT DEFAULT 'connected',  -- connected|disconnected|expired
  warmup_status TEXT DEFAULT 'inactive',
  daily_limit INTEGER DEFAULT 50,
  initial_outreach_limit INTEGER DEFAULT 10,
  meta JSON,
  is_deleted BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### leads
```sql
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  integration_id UUID REFERENCES integrations(id),
  name TEXT, email TEXT, company TEXT,
  status TEXT DEFAULT 'new',  -- new|contacted|opened|replied|warm|booked|converted|cold|bouncy|unsubscribed|not_interested
  score INTEGER DEFAULT 0,
  snippet TEXT,
  archived BOOLEAN DEFAULT false,
  last_message_at TIMESTAMP,
  last_message_direction TEXT,
  last_message_is_read BOOLEAN,
  metadata JSON,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### messages
```sql
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id),
  user_id UUID REFERENCES users(id),
  integration_id UUID REFERENCES integrations(id),
  subject TEXT, body TEXT,
  direction TEXT,  -- inbound|outbound
  is_read BOOLEAN DEFAULT false,
  opened_at TIMESTAMP,
  message_id TEXT,  -- SMTP Message-ID
  in_reply_to TEXT,
  references_header TEXT,
  is_priority_reply BOOLEAN DEFAULT false,
  is_bounce BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### email_tracking
```sql
CREATE TABLE email_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  lead_id UUID REFERENCES leads(id),
  integration_id UUID REFERENCES integrations(id),
  campaign_id UUID REFERENCES campaigns(id),
  token TEXT UNIQUE NOT NULL,  -- tracking token
  message_id TEXT,  -- SMTP Message-ID
  recipient TEXT NOT NULL,
  placement TEXT DEFAULT 'unknown',  -- unknown|delivered|inbox|spam|bounced|promotions
  placement_updated_at TIMESTAMP,
  sent_at TIMESTAMP,
  opened_at TIMESTAMP,
  clicked_at TIMESTAMP,
  bounced_at TIMESTAMP,
  complained_at TIMESTAMP,
  metadata JSON,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### campaigns
```sql
CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  name TEXT NOT NULL,
  status TEXT DEFAULT 'draft',  -- draft|active|paused|completed|archived
  type TEXT DEFAULT 'sequence',  -- sequence|broadcast
  daily_limit INTEGER DEFAULT 50,
  steps JSON,  -- array of campaign steps
  total_leads INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  open_count INTEGER DEFAULT 0,
  reply_count INTEGER DEFAULT 0,
  click_count INTEGER DEFAULT 0,
  bounce_count INTEGER DEFAULT 0,
  start_date TIMESTAMP,
  end_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### warmup tables
```sql
CREATE TABLE warmup_mailboxes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  integration_id UUID REFERENCES integrations(id),
  status TEXT DEFAULT 'active',  -- active|paused|completed
  daily_limit INTEGER DEFAULT 12,
  sent_today INTEGER DEFAULT 0,
  last_sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE warmup_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox_id UUID REFERENCES warmup_mailboxes(id),
  sender TEXT, recipient TEXT,
  subject TEXT,
  status TEXT,  -- seed_pending|user_delivered|seed_replied|user_replied|completed
  max_messages INTEGER DEFAULT 20,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE warmup_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID REFERENCES warmup_threads(id),
  mailbox_id UUID REFERENCES warmup_mailboxes(id),
  message_id UUID REFERENCES messages(id),
  sender TEXT, recipient TEXT, subject TEXT,
  direction TEXT, status TEXT,
  placement TEXT DEFAULT 'unknown',  -- unknown|inbox|spam|promotions
  moved_to_hidden_folder BOOLEAN DEFAULT false,
  sent_at TIMESTAMP, opened_at TIMESTAMP, replied_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### recovery tables
```sql
CREATE TABLE lead_recovery_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  integration_id UUID REFERENCES integrations(id),
  status TEXT DEFAULT 'idle',  -- idle|queued|syncing|synced|failed|paused
  error_message TEXT,
  last_sync_at TIMESTAMP,
  available_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE recovery_event_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_id UUID REFERENCES lead_recovery_state(id),
  lead_id UUID REFERENCES leads(id),
  event_type TEXT,  -- noise_filtered|ai_analyzed|recovery_sent|reopened|pending_send
  metadata JSON,
  created_at TIMESTAMP DEFAULT NOW()
);
```

## Client-Facing Error Codes

| HTTP | Meaning |
|---|---|
| 200 | Success |
| 400 | Bad request (invalid params) |
| 401 | Not authenticated (redirect to /auth) |
| 403 | Forbidden (API key read-only) |
| 404 | Not found |
| 409 | Conflict (duplicate, already exists) |
| 422 | Validation error |
| 429 | Rate limited |
| 500 | Internal server error |
| 502 | Gateway timeout (increase proxy_read_timeout) |
| 503 | Service unavailable (retry) |
