# Audnix API Reference

**Base URL:** `https://audnixai.com`

## Authentication

All API requests require authentication via **session cookie** (browser) or **API key** (programmatic).

### API Keys
- **Format:** `audnix_` + 64 hex chars (32 bytes) = 70 chars total
- **Hash:** SHA-512 stored in DB (irreversible — raw key never stored)
- **Storage:** Encrypted at rest via AES-256-GCM
- **Permission levels:** `read` (GET only) | `read_write` (all except account deletion)
- **Creation:** `POST /api/mcp/key/create` — key shown ONCE, then masked forever
- **Rate limits:** 60 req/min general, 10 req/min on auth/campaign-create

### Using API Keys
```bash
# Bearer token in Authorization header
curl https://audnixai.com/api/leads \
  -H "Authorization: Bearer audnix_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2g3h4i5j6k7l8m9n0o1p2q3r4s5t6u7v8w9x0y1z2a3b4c5d6e7f8g9h0i1j2k3l4m5n6o7p8q9r0s1t2u3v4w5x6y7z8a9b0c1d2e3f4g5h6i7j8k9l0m1n2o3p4q5r6s7t8u9v0w1x2y3z4a5b6c7d8e9f0"

# Rate limit response
HTTP 429
{ "error": "Rate limit exceeded. Try again in 60 seconds." }
```

## Endpoints

### Leads
```
GET  /api/leads              List leads (paginated, filterable)
GET  /api/leads/:id          Get single lead
PATCH /api/leads/:id         Update lead (status, score, etc.)
POST /api/leads/bulk-import  CSV bulk import
```

**List leads:**
```bash
curl "https://audnixai.com/api/leads?status=new&limit=5&search=john" \
  -H "Authorization: Bearer audnix_<key>"
```
```json
{
  "success": true,
  "leads": [
    {
      "id": "uuid-...",
      "name": "John Smith",
      "email": "john@example.com",
      "company": "Acme Corp",
      "status": "new",
      "channel": "email",
      "score": 72,
      "integrationId": "uuid-...",
      "snippet": "Thanks for reaching out...",
      "createdAt": "2025-06-15T10:00:00.000Z",
      "lastMessageAt": "2025-06-18T14:30:00.000Z",
      "lastMessageDirection": "inbound",
      "lastMessageIsRead": true
    }
  ],
  "total": 142,
  "hasMore": true
}
```

### Messages
```
GET  /api/leads/:id/messages  Get conversation with a lead
POST /api/leads/:id/messages  Send message to a lead
```

**Send message:**
```bash
curl -X POST https://audnixai.com/api/leads/<lead_id>/messages \
  -H "Authorization: Bearer audnix_<key>" \
  -H "Content-Type: application/json" \
  -d '{"content":"Hi John, following up on our conversation...","integrationId":"mailbox-uuid"}'
```
```json
{
  "success": true,
  "message": {
    "id": "uuid-...",
    "content": "Hi John, following up on our conversation...",
    "direction": "outbound",
    "createdAt": "2025-06-20T14:30:00.000Z"
  }
}
```

### Campaigns
```
GET    /api/outreach/campaigns          List campaigns
POST   /api/outreach/campaigns          Create campaign
POST   /api/outreach/campaigns/:id/start  Start campaign
POST   /api/outreach/campaigns/:id/pause   Pause campaign
GET    /api/outreach/campaigns/:id/progress  Campaign ETA
```

**Create campaign:**
```bash
curl -X POST https://audnixai.com/api/outreach/campaigns \
  -H "Authorization: Bearer audnix_<key>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Q2 Outreach","dailyLimit":50,"durationDays":30}'
```
```json
{
  "id": "uuid-...",
  "name": "Q2 Outreach",
  "status": "draft",
  "config": { "dailyLimit": 50, "durationDays": 30 },
  "totalLeads": 0,
  "createdAt": "2025-06-20T12:00:00.000Z"
}
```

**Campaign ETA:**
```bash
curl https://audnixai.com/api/outreach/campaigns/<id>/progress \
  -H "Authorization: Bearer audnix_<key>"
```
```json
{
  "campaignId": "uuid-...",
  "total": 500,
  "sent": 143,
  "replied": 12,
  "remaining": 357,
  "todaySent": 8,
  "dailyLimit": 50,
  "etaDays": 8,
  "etaLabel": "~8 days"
}
```

### Dashboard & Analytics
```
GET /api/dashboard/stats                 KPI summary (sent, open rate, responses, converted)
GET /api/stats/inbox-placement           Spam/inbox/bounce breakdown
GET /api/stats/domain-reputation         Per-domain reputation scores
GET /api/dashboard/analytics/full        Full analytics with trends & predictions
```

**KPI stats:**
```bash
curl https://audnixai.com/api/dashboard/stats \
  -H "Authorization: Bearer audnix_<key>"
```
```json
{
  "sent": 1243,
  "totalOutreachedLeads": 500,
  "uniqueReplied": 87,
  "convertedCount": 23,
  "openRate": 62.5,
  "replyRate": 17.4,
  "globalBounceRate": 3.2,
  "totalSent": 1243,
  "period": "30d"
}
```

### Integrations & Email
```
GET  /api/integrations           List all connected mailboxes
POST /api/custom-email/connect   Connect custom SMTP mailbox
POST /api/custom-email/disconnect Disconnect mailbox
GET  /api/warmup/status          Warmup status per mailbox
POST /api/mcp/key/create         Create API key
GET  /api/mcp/keys               List API keys (masked)
```

### MCP (JSON-RPC)
```
POST /mcp    Execute AI tools via JSON-RPC 2.0
GET  /mcp    List available tools
```

**List tools:**
```bash
curl -X POST https://audnixai.com/mcp \
  -H "Authorization: Bearer audnix_<key>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```
```json
{
  "jsonrpc": "2.0",
  "result": {
    "tools": [
      { "name": "list_leads", "description": "List leads with filters", "inputSchema": {} },
      { "name": "get_lead", "description": "Get single lead by ID", "inputSchema": {} },
      { "name": "send_message", "description": "Send a message to a lead", "inputSchema": {} },
      { "name": "list_campaigns", "description": "List campaigns", "inputSchema": {} },
      { "name": "get_dashboard_stats", "description": "Get KPI summary", "inputSchema": {} }
    ]
  },
  "id": 1
}
```

## Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created (key, lead, campaign) |
| 400 | Bad request — missing/invalid fields |
| 401 | Unauthorized — missing/invalid auth |
| 403 | Forbidden — read key on write endpoint |
| 404 | Resource not found |
| 409 | Conflict — duplicate key name |
| 429 | Rate limited — retry after 60s |
| 502 | Bad gateway — upstream unavailable |
| 503 | Service unavailable |

## Error Response Format
```json
{ "error": "Human-readable error message" }
```

## Rate Limits
- **Auth:** 10 req/min
- **Campaign create:** 10 req/min
- **General API:** 60 req/min
- **Tracking/webhook:** 300 req/min
