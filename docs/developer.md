# Developer Documentation

## Overview

The developer documentation page (`/developer`) serves as the public API reference for developers integrating with the Audnix platform. It is designed for both human developers and AI crawlers (LLM-friendly).

## SEO & Meta Tags

```tsx
<Helmet>
  <title>Audnix API Reference — Email Outreach & Campaign Platform</title>
  <meta name="description" content="Complete API documentation for Audnix email outreach platform. REST API, MCP JSON-RPC, authentication, rate limits, and webhooks." />
  <meta property="og:title" content="Audnix API Reference" />
  <meta property="og:description" content="Build AI-powered email outreach with Audnix's API. REST endpoints, MCP server integration, and real-time webhooks." />
</Helmet>
```

## Sections

### 1. Getting Started
- Base URL: `https://audnixai.com/api`
- Authentication options (API Key, Session Cookie)
- Quick start with curl
- Rate limiting info

### 2. Authentication
- API Key format: `audnix_<64-hex-chars>`
- Header: `x-api-key: audnix_...` or `Authorization: Bearer audnix_...`
- Permission levels: `read`, `read-write`
- Security: SHA-512 hashed + AES-256-GCM encrypted

### 3. Endpoints (17+ documented)

#### Leads
```bash
# List leads
curl -H "x-api-key: audnix_..." https://audnixai.com/api/leads?limit=50

# Create lead
curl -X POST -H "x-api-key: audnix_..." \
  -H "Content-Type: application/json" \
  -d '{"name":"John","email":"john@example.com"}' \
  https://audnixai.com/api/leads

# Response
{"id":"uuid","name":"John","email":"john@example.com","status":"new","score":0}
```

#### Messages
```bash
# Get conversation
curl -H "x-api-key: audnix_..." \
  https://audnixai.com/api/messages/LEAD_ID?limit=50
```

#### Campaigns
```bash
# Create campaign
curl -X POST -H "x-api-key: audnix_..." \
  -H "Content-Type: application/json" \
  -d '{"name":"Q3 Outreach","type":"sequence"}' \
  https://audnixai.com/api/campaigns
```

#### Analytics
```bash
# Get full analytics
curl -H "x-api-key: audnix_..." \
  "https://audnixai.com/api/dashboard/analytics/full?days=30"
```

#### Integrations/Mailboxes
```bash
# List integrations
curl -H "x-api-key: audnix_..." \
  https://audnixai.com/api/integrations?limit=100
```

#### MCP Server (JSON-RPC)
```json
{
  "jsonrpc": "2.0",
  "method": "list_leads",
  "params": { "limit": 10 },
  "id": 1
}
```

#### Dashboard KPIs
```bash
curl -H "x-api-key: audnix_..." \
  "https://audnixai.com/api/dashboard/stats?days=30"
```

### 4. Search
- Live client-side search across all documentation
- Filters sections and endpoints in real-time
- Case-insensitive matching

### 5. Icons & Visual Design
- Each section has a semantic icon:
  - Key → Authentication
  - BookOpen → Endpoints
  - Terminal → curl examples
  - Server → MCP
  - Globe → Webhooks
- Clean, monospace-friendly layout

## MCP Server Page

### Overview
The MCP (Model Context Protocol) server page at `/dashboard/mcp-server` provides AI agent integration capabilities.

### Features
- API key management (create, rename, delete)
- Key permissions (read, read-write)
- Show-once key display with masking
- JSON-RPC endpoint for AI tool calls

### SEO Meta Tags
```tsx
<Helmet>
  <title>MCP Server — AI Agent Integration | Audnix</title>
  <meta name="description" content="Connect AI agents to your Audnix email outreach platform via MCP (Model Context Protocol). JSON-RPC API for autonomous lead management and campaign control." />
  <meta property="og:title" content="Audnix MCP Server — AI Agent Integration" />
  <meta property="og:description" content="Enable AI agents to read leads, send emails, and manage campaigns through Audnix's MCP server." />
</Helmet>
```

### JSON-RPC Methods
| Method | Description | Auth |
|---|---|---|
| `list_leads` | List leads with filters | read |
| `get_lead` | Get lead details | read |
| `create_lead` | Create a new lead | read-write |
| `send_email` | Send email to lead | read-write |
| `list_campaigns` | List campaigns | read |
| `get_stats` | Get dashboard stats | read |
| `get_analytics` | Get full analytics | read |

## API Rate Limiting

| Plan | Requests/min | Concurrent | 
|---|---|---|
| Trial | 60 | 2 |
| Starter | 300 | 5 |
| Pro | 1000 | 10 |
| Enterprise | Custom | Custom |

Rate limit headers returned: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

## Webhooks

Webhooks notify your application when events occur. Configure via:

```bash
POST /api/webhooks
{
  "url": "https://your-app.com/webhook",
  "events": ["email.sent", "email.opened", "email.bounced", "lead.created"],
  "secret": "your-webhook-secret"
}
```

### Event Types
| Event | Payload |
|---|---|
| `email.sent` | `{ leadId, messageId, recipient, subject, timestamp }` |
| `email.opened` | `{ leadId, messageId, recipient, timestamp, userAgent }` |
| `email.clicked` | `{ leadId, messageId, recipient, url, timestamp }` |
| `email.bounced` | `{ leadId, messageId, recipient, reason, timestamp }` |
| `email.spam` | `{ leadId, messageId, recipient, timestamp }` |
| `lead.created` | `{ leadId, name, email, source, timestamp }` |
| `lead.status_changed` | `{ leadId, oldStatus, newStatus, timestamp }` |
| `campaign.completed` | `{ campaignId, name, sent, opened, replied, timestamp }` |

## SDK Examples

### Python
```python
import requests

API_KEY = "audnix_..."
BASE = "https://audnixai.com/api"

headers = {
    "x-api-key": API_KEY,
    "Content-Type": "application/json"
}

# List leads
response = requests.get(f"{BASE}/leads", headers=headers)
leads = response.json()

# Send email
response = requests.post(
    f"{BASE}/messages/{lead_id}",
    headers=headers,
    json={
        "subject": "Following up",
        "body": "Hi {{name}}, just checking in..."
    }
)
```

### JavaScript
```javascript
const API_KEY = 'audnix_...';
const BASE = 'https://audnixai.com/api';

async function getLeads() {
  const res = await fetch(`${BASE}/leads`, {
    headers: { 'x-api-key': API_KEY }
  });
  return res.json();
}

async function sendEmail(leadId, subject, body) {
  const res = await fetch(`${BASE}/messages/${leadId}`, {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ subject, body })
  });
  return res.json();
}
```

### curl
```bash
# Export for reuse
export AUDNIX_KEY="audnix_..."

# List leads
curl -H "x-api-key: $AUDNIX_KEY" \
  "https://audnixai.com/api/leads?limit=10"

# Get analytics
curl -H "x-api-key: $AUDNIX_KEY" \
  "https://audnixai.com/api/dashboard/analytics/full?days=30"
```

## Best Practices

### 1. Use Pagination
Always paginate list endpoints. Default limit is 50, max is 200.

```bash
GET /api/leads?limit=200&page=0
GET /api/leads?limit=200&page=1
```

### 2. Handle Rate Limits
Implement exponential backoff when you receive `429 Too Many Requests`.

```javascript
async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url);
    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After') || 5;
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      continue;
    }
    return res;
  }
  throw new Error('Rate limit exceeded');
}
```

### 3. Use Webhooks for Real-Time
Instead of polling, register webhooks to receive events as they happen.

### 4. Batch Operations
Use the bulk import endpoint for creating many leads at once (up to 5000 per request).

### 5. Environment-Specific Keys
Use different API keys for development and production. Set appropriate permission levels.

## MCP Server Integration

The MCP server enables AI agents (Claude, ChatGPT, etc.) to interact with Audnix programmatically.

### AI Agent Permissions

| Permission | Can Read | Can Write | Can Manage Keys |
|---|---|---|---|
| `read` | ✅ Leads, campaigns, analytics, stats | ❌ | ❌ |
| `read-write` | ✅ Everything | ✅ Send emails, create leads, manage campaigns | ❌ |
| `admin` | ✅ Everything | ✅ Everything | ✅ Key management |

### MCP Tools for AI Agents
The MCP server exposes these tools to AI agents:

**Lead Management**
- `list_leads(filters)` — Query leads by status, score, date
- `get_lead(id)` — Full lead profile with conversation history
- `create_lead({ name, email, company })` — Add new lead
- `update_lead(id, { status, score })` — Modify lead

**Email**
- `send_email(leadId, { subject, body })` — Send outbound email
- `get_conversation(leadId)` — Full message thread

**Analytics**
- `get_stats({ days })` — Dashboard KPIs
- `get_analytics({ days })` — Full analytics with trends

**Campaigns**
- `list_campaigns()` — Active campaigns
- `get_campaign(id)` — Campaign details and progress

### Usage Example (AI Agent)
```json
// Request
{
  "jsonrpc": "2.0",
  "method": "list_leads",
  "params": { "status": "new", "limit": 5 },
  "id": 1
}

// Response
{
  "jsonrpc": "2.0",
  "result": {
    "leads": [{ "name": "John", "email": "john@example.com", "status": "new" }],
    "total": 1
  },
  "id": 1
}
```
