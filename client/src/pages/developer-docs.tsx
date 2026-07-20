import { useState } from "react";
import { Helmet } from "react-helmet-async";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Key, Server, BookOpen, Copy, Check, Terminal, Globe, ChevronRight, Shield, AlertTriangle, Clock, Lock, Users, Mail, BarChart3, Plug, Code, ArrowRight } from "lucide-react";

const BASE = "https://audnixai.com";

interface EndpointItem {
  method: string;
  path: string;
  desc: string;
  auth: string;
  params?: string;
  bodyExample?: string;
  curl: string;
  response: string;
  errorExample?: string;
  scopes?: string;
  notes?: string;
}

interface EndpointSection {
  section: string;
  icon: any;
  intro?: string;
  items: EndpointItem[];
}

const API_ENDPOINTS: EndpointSection[] = [
  {
    section: "Getting Started", icon: Code,
    intro: "All API requests require authentication. You can use either a session cookie (for UI-based workflows) or an API key (for programmatic access). API keys are created from the developer dashboard and support 'read' or 'read_write' permission levels.",
    items: [
      {
        method: "POST", path: "/api/auth/login", desc: "Login with email/password — returns session cookie + user profile. Use this first, then all subsequent requests include the cookie automatically.", auth: "None",
        bodyExample: `{ "email": "user@example.com", "password": "your_password" }`,
        curl: `curl -X POST ${BASE}/api/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{"email":"user@example.com","password":"your_password"}' \\
  -c /tmp/cookies.txt`,
        response: `{
  "success": true,
  "user": {
    "id": "784005b5-...",
    "email": "user@example.com",
    "username": "johndoe",
    "plan": "enterprise"
  },
  "sessionExpiresIn": "30 days"
}`,
        errorExample: `HTTP 401: { "error": "Invalid email or password" }`,
        notes: "Session is set via httpOnly cookie (audnix.sid). Use -c/-b flags in curl to persist.",
      },
      {
        method: "GET", path: "/api/user/profile", desc: "Get full authenticated user profile. This is the endpoint the UI uses. Returns all fields including plan, settings, and metadata.", auth: "Session Cookie | API Key",
        curl: `curl ${BASE}/api/user/profile \\
  -b /tmp/cookies.txt`,
        response: `{
  "id": "784005b5-...",
  "email": "user@example.com",
  "username": "johndoe",
  "name": "John Doe",
  "company": "Acme Inc",
  "plan": "enterprise",
  "subscriptionTier": "business",
  "timezone": "America/New_York",
  "avatar": null,
  "role": "owner",
  "businessName": "Acme Inc",
  "calendarLink": "https://calendly.com/johndoe",
  "createdAt": "2025-01-15T10:30:00.000Z",
  "config": {},
  "metadata": {}
}`,
        errorExample: `HTTP 401: { "error": "Unauthorized" }`,
      },
      {
        method: "POST", path: "/api/mcp/key/create", desc: "Create an API key for programmatic access. Keys are 16 chars with 'audnix_' prefix. Shown ONCE on creation then masked.", auth: "Session Cookie",
        bodyExample: `{ "name": "My API Key", "permission_level": "read_write" }`,
        curl: `curl -X POST ${BASE}/api/mcp/key/create \\
  -b /tmp/cookies.txt \\
  -H "Content-Type: application/json" \\
  -d '{"name":"My API Key","permission_level":"read_write"}'`,
        response: `{
  "key": "audnix_a1b2c3d4e5f6g7h8",
  "id": "uuid-...",
  "name": "My API Key",
  "permissionLevel": "read_write",
  "prefix": "audnix_a1b2",
  "createdAt": "2025-06-20T12:00:00.000Z"
}`,
        errorExample: `HTTP 400: { "error": "Name already in use" }`,
        notes: "Save the full key immediately — it won't be shown again. Permission levels: 'read' (GET only) or 'read_write' (all operations except account deletion).",
        scopes: "read | read_write",
      },
    ],
  },
  {
    section: "Authentication & Keys", icon: Key,
    intro: "Two authentication modes. Sessions are for browser use. API keys are for curl/automation/MCP. Keys are created from the developer dashboard or via the create endpoint above.",
    items: [
      {
        method: "GET", path: "/api/mcp/keys", desc: "List all API keys for your account. Key values are masked — only metadata and prefix shown.", auth: "Session Cookie",
        curl: `curl ${BASE}/api/mcp/keys \\
  -b /tmp/cookies.txt`,
        response: `{
  "keys": [
    {
      "id": "uuid-...",
      "name": "My API Key",
      "permissionLevel": "read_write",
      "prefix": "audnix_a1b2",
      "createdAt": "2025-06-20T12:00:00.000Z",
      "lastUsedAt": "2025-06-21T08:15:00.000Z"
    }
  ]
}`,
        errorExample: `HTTP 401: { "error": "Unauthorized" }`,
      },
      {
        method: "DELETE", path: "/api/mcp/key/:id", desc: "Delete an API key immediately. Irreversible.", auth: "Session Cookie",
        curl: `curl -X DELETE ${BASE}/api/mcp/key/<key_id> \\
  -b /tmp/cookies.txt`,
        response: `{ "success": true, "deleted": "uuid-..." }`,
      },
      {
        method: "PATCH", path: "/api/mcp/key/:id", desc: "Rename an API key.", auth: "Session Cookie",
        bodyExample: `{ "name": "Renamed Key" }`,
        curl: `curl -X PATCH ${BASE}/api/mcp/key/<key_id> \\
  -b /tmp/cookies.txt \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Renamed Key"}'`,
        response: `{ "success": true, "id": "uuid-...", "name": "Renamed Key" }`,
      },
      {
        method: "POST", path: "/mcp", desc: "MCP JSON-RPC endpoint. Execute tools using an API key in the Authorization header. Also accepts simple {tool, args} format.", auth: "API Key (Bearer)",
        bodyExample: `{ "jsonrpc": "2.0", "method": "tools/list", "id": 1 }`,
        curl: `curl -X POST ${BASE}/mcp \\
  -H "Authorization: Bearer audnix_a1b2c3d4e5f6g7h8" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'`,
        response: `{
  "jsonrpc": "2.0",
  "result": {
    "tools": [
      { "name": "list_leads", "description": "List leads with filters", "inputSchema": { ... } },
      { "name": "get_lead", "description": "Get single lead by ID", "inputSchema": { ... } },
      { "name": "send_message", "description": "Send a message to a lead", "inputSchema": { ... } },
      { "name": "list_campaigns", "description": "List campaigns", "inputSchema": { ... } },
      { "name": "get_dashboard_stats", "description": "Get KPI summary", "inputSchema": { ... } }
    ]
  },
  "id": 1
}`,
        errorExample: `HTTP 401: { "error": "Invalid API key" }`,
        notes: "API key must have 'Authorization: Bearer audnix_...' header. 'read' keys can only list/get data. 'read_write' keys can also send messages and update leads.",
        scopes: "depends on key permission_level",
      },
    ],
  },
  {
    section: "Leads", icon: Users,
    items: [
      {
        method: "GET", path: "/api/leads", desc: "List leads with filters. Supports pagination, search, status/channel filtering, and per-mailbox scoping.", auth: "Session Cookie | API Key",
        params: "status=(new|contacted|replied|converted|unsubscribed|cold|booked|warm) & channel=(email|instagram|linkedin) & search=<string> & limit=<number>& offset=<number>& includeArchived=<bool>& integrationId=<mailbox_id>& excludeActiveCampaignLeads=<bool>",
        curl: `curl "${BASE}/api/leads?status=new&limit=5&search=john" \\
  -H "Authorization: Bearer audnix_a1b2c3d4e5f6g7h8"`,
        response: `{
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
      "lastMessageIsRead": true,
      "metadata": {}
    }
  ],
  "total": 142,
  "planLimit": 50000,
  "hasMore": true
}`,
        errorExample: `HTTP 429: { "error": "Rate limit exceeded" }`,
        scopes: "read",
      },
      {
        method: "GET", path: "/api/leads/:id", desc: "Get a single lead by ID with full details.", auth: "Session Cookie | API Key",
        curl: `curl ${BASE}/api/leads/<lead_id> \\
  -H "Authorization: Bearer audnix_a1b2c3d4e5f6g7h8"`,
        response: `{
  "id": "uuid-...",
  "name": "John Smith",
  "email": "john@example.com",
  "company": "Acme Corp",
  "position": "CTO",
  "status": "new",
  "channel": "email",
  "score": 72,
  "integrationId": "uuid-...",
  "phone": "+1234567890",
  "archived": false,
  "metadata": { "source": "csv_import", "campaignId": "uuid-..." },
  "snippet": "Thanks for reaching out...",
  "lastMessageAt": "2025-06-18T14:30:00.000Z",
  "lastMessageDirection": "inbound",
  "lastMessageIsRead": true,
  "createdAt": "2025-06-15T10:00:00.000Z",
  "updatedAt": "2025-06-18T14:30:00.000Z"
}`,
        errorExample: `HTTP 404: { "error": "Lead not found" }`,
        scopes: "read",
      },
      {
        method: "PATCH", path: "/api/leads/:leadId", desc: "Update a lead. You can change status, name, email, phone, metadata, or toggle AI pause.", auth: "Session Cookie | API Key",
        bodyExample: `{ "status": "contacted", "metadata": { "custom_field": "value" } }`,
        curl: `curl -X PATCH ${BASE}/api/leads/<lead_id> \\
  -H "Authorization: Bearer audnix_a1b2c3d4e5f6g7h8" \\
  -H "Content-Type: application/json" \\
  -d '{"status":"contacted","aiPaused":false}'`,
        response: `{
  "id": "uuid-...",
  "name": "John Smith",
  "email": "john@example.com",
  "status": "contacted",
  "aiPaused": false,
  "updatedAt": "2025-06-20T12:00:00.000Z"
}`,
        errorExample: `HTTP 400: { "error": "Invalid status value" }`,
        scopes: "read_write",
      },
      {
        method: "POST", path: "/api/leads/import-csv", desc: "Bulk import leads from a CSV file. CSV must have at minimum 'email' and 'name' columns. Uses multipart/form-data.", auth: "Session Cookie (only — API keys can't upload files)",
        curl: `curl -X POST ${BASE}/api/leads/import-csv \\
  -b /tmp/cookies.txt \\
  -F "file=@leads.csv"`,
        response: `{
  "imported": 150,
  "failed": 2,
  "updated": 0,
  "errors": [
    "Row 12 (john@bad.com): Invalid email format",
    "Row 45: Missing email and name"
  ]
}`,
        errorExample: `HTTP 413: { "error": "File too large. Max 5MB." }`,
        notes: "CSV columns: email, name, company, phone, position, custom_fields. Maximum 50,000 rows per import. Leads are automatically MX-routed to connected mailboxes.",
      },
    ],
  },
  {
    section: "Messages", icon: Mail,
    items: [
      {
        method: "GET", path: "/api/messages/:leadId", desc: "Get the full conversation thread for a lead. Paginated with newest first.", auth: "Session Cookie | API Key",
        params: "limit=<number>& offset=<number>",
        curl: `curl ${BASE}/api/messages/<lead_id>?limit=20 \\
  -H "Authorization: Bearer audnix_a1b2c3d4e5f6g7h8"`,
        response: `{
  "messages": [
    {
      "id": "uuid-...",
      "leadId": "uuid-...",
      "direction": "inbound",
      "subject": "Re: Conference follow-up",
      "body": "Hi, thanks for reaching out! I'd be interested in learning more.",
      "from": "john@example.com",
      "createdAt": "2025-06-18T14:30:00.000Z",
      "isRead": true
    },
    {
      "id": "uuid-...",
      "leadId": "uuid-...",
      "direction": "outbound",
      "subject": "Conference follow-up",
      "body": "Hi John, it was great meeting you at the conference...",
      "to": "john@example.com",
      "createdAt": "2025-06-16T09:00:00.000Z",
      "isRead": true
    }
  ],
  "total": 5,
  "hasMore": false
}`,
        errorExample: `HTTP 404: { "error": "Lead not found" }`,
        scopes: "read",
      },
      {
        method: "POST", path: "/api/messages/:leadId", desc: "Send a message to a lead. The lead's assigned mailbox is used automatically. Updates lead status and KPI stats in real-time.", auth: "Session Cookie | API Key",
        bodyExample: `{ "content": "Hi John, just following up on my previous email...", "subject": "Re: Follow-up" }`,
        curl: `curl -X POST ${BASE}/api/messages/<lead_id> \\
  -H "Authorization: Bearer audnix_a1b2c3d4e5f6g7h8" \\
  -H "Content-Type: application/json" \\
  -d '{"content":"Hi John, following up on my previous email. Would love to connect!","subject":"Re: Follow-up"}'`,
        response: `{
  "message": {
    "id": "uuid-...",
    "leadId": "uuid-...",
    "direction": "outbound",
    "subject": "Re: Follow-up",
    "body": "Hi John, following up on my previous email. Would love to connect!",
    "createdAt": "2025-06-20T12:00:00.000Z"
  },
  "leadStatus": "contacted"
}`,
        errorExample: `HTTP 400: { "error": "Content is required" }`,
        scopes: "read_write",
        notes: "Subject is optional. If omitted, a default subject is generated. Channel defaults to the lead's existing channel. Updates the inbox UI and KPI page instantly via WebSocket.",
      },
    ],
  },
  {
    section: "Campaigns", icon: Server,
    items: [
      {
        method: "GET", path: "/api/outreach/campaigns", desc: "List all campaigns for your account. Includes current stats and status.", auth: "Session Cookie | API Key",
        curl: `curl ${BASE}/api/outreach/campaigns \\
  -H "Authorization: Bearer audnix_a1b2c3d4e5f6g7h8"`,
        response: `[
  {
    "id": "uuid-...",
    "userId": "uuid-...",
    "name": "Q2 Product Outreach",
    "status": "active",
    "stats": { "total": 500, "sent": 234, "replied": 18, "bounced": 4 },
    "config": {
      "dailyLimit": 50,
      "mailboxIds": ["uuid-..."],
      "mailboxLimits": { "uuid-...": 40 },
      "durationDays": 30
    },
    "excludeWeekends": true,
    "createdAt": "2025-06-01T10:00:00.000Z",
    "updatedAt": "2025-06-20T12:00:00.000Z"
  }
]`,
        scopes: "read",
      },
      {
        method: "POST", path: "/api/outreach/campaigns", desc: "Create a campaign. Provide template with initial email + follow-up steps, leads array, and per-mailbox config.", auth: "Session Cookie",
        bodyExample: `{ "name": "My Campaign", "leads": ["lead_id_1", "lead_id_2"], "config": { "dailyLimit": 50, "mailboxIds": ["mailbox_id"], "durationDays": 30 }, "template": { "initial": { "subject": "Hi {{name}}", "body": "Hello {{name}}..." }, "followups": [ { "delayDays": 3, "subject": "Re: {{name}}", "body": "Following up..." } ] }, "excludeWeekends": true }`,
        curl: `curl -X POST ${BASE}/api/outreach/campaigns \\
  -b /tmp/cookies.txt \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Q3 Outreach",
    "leads": ["uuid-lead1", "uuid-lead2"],
    "config": {
      "dailyLimit": 50,
      "mailboxIds": ["uuid-mailbox1"],
      "mailboxLimits": { "uuid-mailbox1": 40 },
      "durationDays": 30
    },
    "template": {
      "initial": {
        "subject": "Hi {{name}}, great connecting!",
        "body": "Hello {{name}},\\n\\nIt was great meeting you...\\n\\nBest,\\n{{sender}}"
      },
      "followups": [
        { "delayDays": 3, "subject": "Re: {{name}}", "body": "Hi {{name}}, just checking in..." }
      ]
    },
    "excludeWeekends": true
  }'`,
        response: `{
  "id": "uuid-...",
  "name": "Q3 Outreach",
  "status": "draft",
  "addedLeads": 500,
  "safety": { "safe": true, "warnings": [] },
  "schedule": {
    "dailyLimit": 50,
    "durationDays": 30,
    "totalLeads": 500,
    "averagePerDay": 17,
    "estimatedDaysToComplete": 10
  },
  "createdAt": "2025-06-20T12:00:00.000Z"
}`,
        errorExample: `HTTP 400: { "error": "Campaign has no email body. Please write your initial email copy before saving." }`,
        notes: "Campaign leads are MX-routed to mailboxes automatically. Follow-ups are threaded as replies. Initial sends are spread evenly across 24h respecting per-mailbox caps. Cap-hit initials redistribute to underloaded mailboxes.",
      },
      {
        method: "POST", path: "/api/outreach/campaigns/:id/start", desc: "Start a draft campaign. Begins sending immediately.", auth: "Session Cookie",
        curl: `curl -X POST ${BASE}/api/outreach/campaigns/<campaign_id>/start \\
  -b /tmp/cookies.txt`,
        response: `{ "success": true, "status": "active", "startedAt": "2025-06-20T12:00:00.000Z" }`,
        scopes: "read_write",
      },
      {
        method: "POST", path: "/api/outreach/campaigns/:id/pause", desc: "Pause an active campaign. Sending stops. Can be resumed.", auth: "Session Cookie",
        curl: `curl -X POST ${BASE}/api/outreach/campaigns/<campaign_id>/pause \\
  -b /tmp/cookies.txt`,
        response: `{ "success": true, "status": "paused" }`,
        scopes: "read_write",
      },
      {
        method: "GET", path: "/api/outreach/campaigns/:id/progress", desc: "Get campaign progress with real-time ETA. Calculated from actual send rate, not configured rate.", auth: "Session Cookie | API Key",
        curl: `curl ${BASE}/api/outreach/campaigns/<campaign_id>/progress \\
  -H "Authorization: Bearer audnix_a1b2c3d4e5f6g7h8"`,
        response: `{
  "campaignId": "uuid-...",
  "total": 500,
  "sent": 234,
  "replied": 18,
  "pending": 266,
  "queued": 0,
  "failed": 2,
  "bounced": 4,
  "todaySent": 12,
  "initialToday": 8,
  "followUpToday": 4,
  "dailyLimit": 50,
  "remaining": 266,
  "etaDays": 6,
  "etaLabel": "~6 days remaining",
  "status": "active"
}`,
        scopes: "read",
        notes: "ETA is based on avgDailyRate (actual sends/day from history), not configured limit. Accounts for weekend exclusion and daily caps. Updates in real-time.",
      },
    ],
  },
  {
    section: "Dashboard & Analytics", icon: BarChart3,
    items: [
      {
        method: "GET", path: "/api/dashboard/stats", desc: "Full KPI summary with per-mailbox breakdown, DNS health, reputation, benchmarks, and AI activity logs.", auth: "Session Cookie | API Key",
        params: "integrationId=<mailbox_id> (optional, filters to one mailbox)",
        curl: `curl ${BASE}/api/dashboard/stats \\
  -H "Authorization: Bearer audnix_a1b2c3d4e5f6g7h8"`,
        response: `{
  "totalLeads": 1500,
  "totalSent": 3200,
  "totalOpened": 1450,
  "totalReplied": 380,
  "totalConverted": 42,
  "totalBounced": 65,
  "openRate": 45.3,
  "replyRate": 11.9,
  "bounceRate": 2.0,
  "conversionRate": 1.3,
  "wonCount": 8,
  "pipelineValue": 125000,
  "domainHealth": { "score": 85, "status": "good" },
  "globalBounceRate": 2.5,
  "domainVerifications": [
    { "domain": "example.com", "spf": true, "dkim": true, "dmarc": true, "mx": true, "blacklisted": false, "overallScore": 92 }
  ],
  "health": {
    "score": 88,
    "status": "healthy",
    "reputation": "good",
    "dns": { "spf": true, "dkim": true, "dmarc": true, "mx": true, "blacklist": false },
    "bounces": { "rate": 2.0, "count": 65 }
  },
  "perMailbox": [
    { "id": "uuid-...", "email": "sender@example.com", "sent": 1200, "openRate": 47.2, "replyRate": 12.1, "bounceRate": 1.8, "reputationScore": 92 }
  ],
  "benchmarks": { "industryOpenRate": 38.0, "industryReplyRate": 8.5 },
  "trend": [ { "date": "2025-06-20", "sent": 45, "opened": 22, "replied": 5 } ],
  "aiActionLogs": [ { "action": "reply_generated", "count": 12, "date": "2025-06-20" } ]
}`,
        scopes: "read",
      },
      {
        method: "GET", path: "/api/stats/inbox-placement", desc: "Inbox vs spam vs bounce placement rates per mailbox. Shows real delivery data from tracking pixels, IMAP spam folder scans, and bounce handlers.", auth: "Session Cookie | API Key",
        params: "days=<number>& integrationId=<mailbox_id>",
        curl: `curl "${BASE}/api/stats/inbox-placement?days=30" \\
  -H "Authorization: Bearer audnix_a1b2c3d4e5f6g7h8"`,
        response: `{
  "success": true,
  "mailboxes": [
    {
      "integrationId": "uuid-...",
      "sent": 1200,
      "inbox": 1050,
      "spam": 96,
      "bounce": 54,
      "other": 0,
      "inboxRate": 87.5
    }
  ],
  "totals": {
    "sent": 1200,
    "inbox": 1050,
    "spam": 96,
    "bounce": 54,
    "rate": 87.5
  }
}`,
        scopes: "read",
      },
      {
        method: "GET", path: "/api/stats/domain-reputation", desc: "Domain reputation scores per mailbox. Includes warmup stage, blacklist status, and DNS health.", auth: "Session Cookie | API Key",
        curl: `curl ${BASE}/api/stats/domain-reputation \\
  -H "Authorization: Bearer audnix_a1b2c3d4e5f6g7h8"`,
        response: `{
  "success": true,
  "reputations": [
    {
      "integrationId": "uuid-...",
      "domain": "example.com",
      "score": 92,
      "status": "good",
      "warmupStage": "full",
      "blacklisted": false,
      "dns": { "spf": true, "dkim": true, "dmarc": true }
    }
  ]
}`,
        scopes: "read",
      },
      {
        method: "GET", path: "/api/dashboard/activity", desc: "Recent 50 activity events — sends, opens, replies, bounces, imports.", auth: "Session Cookie | API Key",
        curl: `curl ${BASE}/api/dashboard/activity \\
  -H "Authorization: Bearer audnix_a1b2c3d4e5f6g7h8"`,
        response: `{
  "events": [
    { "type": "email_sent", "leadName": "John Smith", "description": "Initial email sent to John", "createdAt": "2025-06-20T12:00:00.000Z" },
    { "type": "email_opened", "leadName": "Jane Doe", "description": "Email opened by Jane", "createdAt": "2025-06-20T11:45:00.000Z" },
    { "type": "lead_replied", "leadName": "Bob Wilson", "description": "Bob replied to your email", "createdAt": "2025-06-20T11:30:00.000Z" }
  ]
}`,
        scopes: "read",
      },
    ],
  },
  {
    section: "Integrations & Email", icon: Plug,
    items: [
      {
        method: "GET", path: "/api/integrations", desc: "List all connected integrations — email mailboxes, Calendly, Instagram, etc. Filterable by provider and connection status.", auth: "Session Cookie | API Key",
        params: "provider=(custom_email|gmail|outlook|calendly|instagram)& connected=<bool>& limit=<number>& search=<string>",
        curl: `curl "${BASE}/api/integrations?provider=custom_email&connected=true" \\
  -H "Authorization: Bearer audnix_a1b2c3d4e5f6g7h8"`,
        response: `{
  "integrations": [
    {
      "id": "uuid-...",
      "provider": "custom_email",
      "email": "sender@example.com",
      "connected": true,
      "dailyLimit": 40,
      "warmupStatus": "active",
      "reputationScore": 92,
      "healthStatus": "healthy",
      "lastSyncAt": "2025-06-20T12:00:00.000Z",
      "createdAt": "2025-06-01T10:00:00.000Z"
    }
  ],
  "total": 3,
  "page": 1,
  "limit": 100,
  "pages": 1
}`,
        scopes: "read",
      },
      {
        method: "GET", path: "/api/custom-email/status", desc: "Detailed mailbox connection status with delivery stats, reputation, and warmup info. Used by the integration page.", auth: "Session Cookie | API Key",
        curl: `curl ${BASE}/api/custom-email/status \\
  -H "Authorization: Bearer audnix_a1b2c3d4e5f6g7h8"`,
        response: `{
  "success": true,
  "integrations": [
    {
      "id": "uuid-...",
      "email": "sender@example.com",
      "provider": "custom_email",
      "connected": true,
      "dailyLimit": 40,
      "warmupStatus": "active",
      "reputationScore": 92,
      "sent": 1200,
      "delivered": 1170,
      "inbox": 1050,
      "spam": 96,
      "bounceCount": 54,
      "placementRate": 87.5,
      "deliveryRate": 97.5,
      "bounceRate": 4.5,
      "spamRate": 8.0,
      "healthStatus": "healthy",
      "lastSync": "2025-06-20T12:00:00.000Z"
    }
  ]
}`,
        scopes: "read",
        notes: "Placement data comes from tracking pixels (opens = inbox), bounce handlers (SMTP rejections), and IMAP spam folder scans.",
      },
      {
        method: "POST", path: "/api/custom-email/connect", desc: "Connect a custom SMTP/IMAP email mailbox.", auth: "Session Cookie",
        bodyExample: `{ "host": "smtp.example.com", "port": 587, "username": "user@example.com", "password": "pass", "fromName": "John Doe" }`,
        curl: `curl -X POST ${BASE}/api/custom-email/connect \\
  -b /tmp/cookies.txt \\
  -H "Content-Type: application/json" \\
  -d '{"host":"smtp.example.com","port":587,"username":"user@example.com","password":"your_password","fromName":"John Doe"}'`,
        response: `{ "success": true, "id": "uuid-...", "email": "user@example.com", "provider": "custom_email", "connected": true }`,
        errorExample: `HTTP 400: { "error": "Connection failed: SMTP authentication error" }`,
        scopes: "read_write",
      },
      {
        method: "GET", path: "/api/warmup/status", desc: "Warmup status for all mailboxes including stage, daily limit, and sent count.", auth: "Session Cookie | API Key",
        curl: `curl ${BASE}/api/warmup/status \\
  -H "Authorization: Bearer audnix_a1b2c3d4e5f6g7h8"`,
        response: `{
  "mailboxes": [
    {
      "mailboxId": "uuid-...",
      "email": "sender@example.com",
      "warmupStatus": "active",
      "warmupPercent": 100,
      "dailyLimit": 40,
      "dailySentCount": 8,
      "daysSinceConnected": 45,
      "reputationScore": 92,
      "totalSent": 1200
    }
  ]
}`,
        scopes: "read",
      },
    ],
  },
  {
    section: "Error Handling", icon: AlertTriangle,
    intro: "All API errors return consistent JSON with an 'error' field. HTTP status codes indicate the type of error. Rate limiting is per-endpoint, typically 10-60 requests/minute.",
    items: [
      {
        method: "--", path: "HTTP 400 — Bad Request", desc: "Invalid input — missing required fields, bad data types, or validation failures.", auth: "--",
        curl: `curl -X POST ${BASE}/api/leads/<lead_id>/messages \\
  -H "Authorization: Bearer audnix_a1b2c3d4e5f6g7h8" \\
  -H "Content-Type: application/json" \\
  -d '{}'`,
        response: `HTTP 400
{ "error": "Content is required" }`,
      },
      {
        method: "--", path: "HTTP 401 — Unauthorized", desc: "Missing or invalid authentication. Session expired or API key invalid/deleted.", auth: "--",
        curl: `curl ${BASE}/api/user/profile \\
  -H "Authorization: Bearer audnix_badkey"`,
        response: `HTTP 401
{ "error": "Unauthorized" }`,
      },
      {
        method: "--", path: "HTTP 403 — Forbidden", desc: "Authenticated but not allowed. Usually: 'read' API key trying to write, or plan limit exceeded.", auth: "--",
        curl: `curl -X PATCH ${BASE}/api/leads/<id> \\
  -H "Authorization: Bearer audnix_read_only_key" \\
  -d '{"status":"contacted"}'`,
        response: `HTTP 403
{ "error": "API key has read-only permissions" }`,
        notes: "Check your API key's permission_level. 'read' keys can only GET data. 'read_write' can also POST/PATCH/DELETE.",
        scopes: "read vs read_write",
      },
      {
        method: "--", path: "HTTP 404 — Not Found", desc: "Resource doesn't exist or was deleted.", auth: "--",
        curl: `curl ${BASE}/api/leads/nonexistent-id \\
  -H "Authorization: Bearer audnix_a1b2c3d4e5f6g7h8"`,
        response: `HTTP 404
{ "error": "Lead not found" }`,
      },
      {
        method: "--", path: "HTTP 429 — Rate Limited", desc: "Too many requests. Wait and retry. Rate limits vary by endpoint.", auth: "--",
        curl: `for i in $(seq 1 100); do curl -s ${BASE}/api/leads -H "Authorization: Bearer audnix_key"; done`,
        response: `HTTP 429
{ "error": "Rate limit exceeded. Try again in 60 seconds." }`,
        notes: "Auth endpoints: 10 req/min. Campaign create: 10 req/min. General API: 60 req/min. Check Retry-After header.",
      },
      {
        method: "--", path: "HTTP 502 — Bad Gateway", desc: "Upstream service unavailable. Rare — usually during deployments. Retry with exponential backoff.", auth: "--",
        curl: `curl ${BASE}/api/dashboard/stats \\
  -H "Authorization: Bearer audnix_key"`,
        response: `HTTP 502
{ "error": "Bad Gateway", "message": "Upstream service temporarily unavailable" }`,
        notes: "Retry after 5s, then 15s, then 30s. If persists >2min, check status page.",
      },
      {
        method: "--", path: "HTTP 503 — Service Unavailable", desc: "Server is temporarily overloaded or down for maintenance. Retry with backoff.", auth: "--",
        curl: `curl ${BASE}/api/leads \\
  -H "Authorization: Bearer audnix_key"`,
        response: `HTTP 503
{ "error": "Service Unavailable" }`,
      },
    ],
  },
];

const SECTIONS = API_ENDPOINTS.map(s => s.section);

const methodColors: Record<string, string> = {
  GET: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20",
  POST: "text-blue-500 bg-blue-500/10 border-blue-500/20",
  PATCH: "text-amber-500 bg-amber-500/10 border-amber-500/20",
  PUT: "text-orange-500 bg-orange-500/10 border-orange-500/20",
  DELETE: "text-red-500 bg-red-500/10 border-red-500/20",
};

function CopyButton({ text, id }: { text: string; id: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(null), 2000); }}
      className="shrink-0 p-1 rounded hover:bg-muted transition-all"
    >
      {copied === id ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
    </button>
  );
}

export default function DeveloperDocsPage() {
  const [activeSection, setActiveSection] = useState("Getting Started");
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const filteredSections = API_ENDPOINTS.map(s => ({
    ...s,
    items: s.items.filter(
      i => i.path.toLowerCase().includes(searchQuery.toLowerCase()) || i.desc.toLowerCase().includes(searchQuery.toLowerCase()) || i.method.toLowerCase().includes(searchQuery.toLowerCase())
    ),
  })).filter(s => s.items.length > 0);

  const currentSection = filteredSections.find(s => s.section === activeSection) || filteredSections[0];

  return (
    <>
      <Helmet>
        <title>Audnix API Reference — REST & MCP Documentation for Email Outreach</title>
        <meta name="description" content="Complete Audnix API reference with real curl examples, JSON responses, authentication guide, and error handling. Use API keys or session auth for programmatic email outreach and campaign management." />
        <meta property="og:title" content="Audnix API Reference — REST & MCP Documentation" />
        <meta property="og:description" content="Full API reference for the Audnix email outreach platform. Includes authentication, leads, messages, campaigns, analytics, integrations, and MCP JSON-RPC endpoints." />
        <meta name="robots" content="index, follow" />
        <link rel="canonical" href="https://audnixai.com/developer" />
      </Helmet>
      <div className="min-h-screen bg-background text-foreground">
        <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur-sm">
          <div className="max-w-[1400px] mx-auto px-4 h-14 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <a href="/" className="flex items-center gap-2">
                <div className="w-7 h-7 rounded bg-primary/20 flex items-center justify-center">
                  <div className="w-3.5 h-3.5 bg-primary rounded-sm rotate-45" />
                </div>
                <span className="font-bold text-sm">Audnix</span>
              </a>
              <div className="h-4 w-px bg-border" />
              <span className="text-xs font-medium text-muted-foreground">API Reference</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative hidden md:block">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input placeholder="Search endpoints..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="h-8 pl-8 pr-3 text-xs w-48" />
              </div>
              <a href="/dashboard/developer" className="inline-flex items-center gap-1.5 h-8 px-3 rounded bg-primary text-primary-foreground text-xs font-medium">
                <Key className="h-3.5 w-3.5" />API Keys
              </a>
              <button onClick={() => setSidebarOpen(!sidebarOpen)} className="md:hidden p-1.5 text-muted-foreground hover:text-foreground">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
              </button>
            </div>
          </div>
        </header>

        <div className="max-w-[1400px] mx-auto flex">
          <aside className={`${sidebarOpen ? "fixed inset-0 z-40 bg-background" : "hidden"} md:block md:w-56 lg:w-64 border-r shrink-0`}>
            <nav className={`${sidebarOpen ? "p-4" : "sticky top-14 p-3"} max-h-[calc(100vh-3.5rem)] overflow-y-auto`}>
              {sidebarOpen && (
                <div className="mb-4"><Input placeholder="Search endpoints..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="h-9 text-xs" /></div>
              )}
              <div className="space-y-0.5">
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Sections</div>
                {SECTIONS.map(section => (
                  <button key={section} onClick={() => { setActiveSection(section); setSidebarOpen(false); }}
                    className={`w-full text-left px-3 py-1.5 rounded text-sm transition-colors ${activeSection === section ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}>
                    {section}
                  </button>
                ))}
              </div>
              <div className="mt-6 pt-4 border-t space-y-1">
                <a href="/dashboard/developer" className="flex items-center gap-2 px-3 py-1.5 rounded text-sm text-muted-foreground hover:text-foreground hover:bg-muted"><Key className="h-3.5 w-3.5" />API Keys</a>
                <a href="/dashboard/mcp-server" className="flex items-center gap-2 px-3 py-1.5 rounded text-sm text-muted-foreground hover:text-foreground hover:bg-muted"><Server className="h-3.5 w-3.5" />MCP Server</a>
                <a href="/dashboard/settings" className="flex items-center gap-2 px-3 py-1.5 rounded text-sm text-muted-foreground hover:text-foreground hover:bg-muted"><BookOpen className="h-3.5 w-3.5" />Dashboard</a>
              </div>
            </nav>
          </aside>

          <main className="flex-1 min-w-0 p-4 md:p-6 lg:p-8">
            <div className="max-w-3xl">
              <div className="mb-6">
                <h1 className="text-xl font-bold">API Reference</h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Authenticate with <code className="text-xs font-mono bg-muted px-1 py-0.5 rounded">Authorization: Bearer audnix_...</code> or session cookie
                </p>
              </div>

              {currentSection && (
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    {currentSection.icon && <currentSection.icon className="h-4 w-4 text-primary" />}
                    <h2 className="text-base font-semibold">{currentSection.section}</h2>
                  </div>
                  {currentSection.intro && (
                    <p className="text-xs text-muted-foreground mb-4 leading-relaxed">{currentSection.intro}</p>
                  )}
                  <div className="space-y-3">
                    {currentSection.items.map(item => (
                      <div key={item.path} className="border rounded-lg overflow-hidden hover:border-primary/20 transition-colors">
                        <div className="p-3">
                          <div className="flex items-start gap-3">
                            {item.method !== "--" ? (
                              <Badge variant="outline" className={`text-[10px] font-mono px-1.5 py-0 border shrink-0 mt-0.5 ${methodColors[item.method] || ""}`}>
                                {item.method}
                              </Badge>
                            ) : (
                              <div className="w-12 shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <code className="text-xs font-mono break-all">{item.path}</code>
                                {item.method !== "--" && <CopyButton text={item.curl} id={item.path} />}
                                {item.scopes && (
                                  <Badge variant="outline" className="text-[8px] font-mono px-1 py-0 border-border/30 text-muted-foreground">
                                    {item.scopes}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                              {item.params && (
                                <div className="mt-1.5">
                                  <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Query Params</span>
                                  <p className="text-[10px] font-mono text-muted-foreground/70 mt-0.5 leading-relaxed break-all">{item.params}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {item.method !== "--" && (
                          <div className="border-t bg-muted/20">
                            <div className="px-3 py-2">
                              <div className="flex items-center gap-1.5 mb-1">
                                <Terminal className="h-3 w-3 text-muted-foreground" />
                                <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">curl</span>
                                <CopyButton text={item.curl} id={`curl:${item.path}`} />
                              </div>
                              <pre className="text-[10px] font-mono leading-relaxed text-foreground/80 whitespace-pre-wrap break-all">{item.curl}</pre>
                            </div>
                            <div className="px-3 py-2 border-t border-border/30">
                              <div className="flex items-center gap-1.5 mb-1">
                                <ArrowRight className="h-3 w-3 text-emerald-500" />
                                <span className="text-[9px] font-semibold text-emerald-500 uppercase tracking-wider">Response</span>
                                <CopyButton text={item.response} id={`res:${item.path}`} />
                              </div>
                              <pre className="text-[10px] font-mono leading-relaxed text-foreground/80 whitespace-pre-wrap">{item.response}</pre>
                            </div>
                            {item.errorExample && (
                              <div className="px-3 py-2 border-t border-border/30 bg-red-500/5">
                                <div className="flex items-center gap-1.5 mb-1">
                                  <AlertTriangle className="h-3 w-3 text-red-400" />
                                  <span className="text-[9px] font-semibold text-red-400 uppercase tracking-wider">Error</span>
                                </div>
                                <pre className="text-[10px] font-mono leading-relaxed text-red-400/80 whitespace-pre-wrap">{item.errorExample}</pre>
                              </div>
                            )}
                          </div>
                        )}

                        {item.method === "--" && (
                          <div className="border-t bg-muted/20 px-3 py-2">
                            <pre className="text-[10px] font-mono leading-relaxed whitespace-pre-wrap">{item.response}</pre>
                            {item.notes && <p className="text-[10px] text-muted-foreground mt-1">{item.notes}</p>}
                          </div>
                        )}

                        {item.notes && item.method !== "--" && (
                          <div className="px-3 py-1.5 border-t border-border/30 bg-blue-500/5">
                            <div className="flex items-start gap-1.5">
                              <Info className="h-3 w-3 text-blue-400 mt-0.5 shrink-0" />
                              <p className="text-[10px] text-muted-foreground leading-relaxed">{item.notes}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {filteredSections.length === 0 && (
                <p className="text-sm text-muted-foreground py-8 text-center">No endpoints match your search.</p>
              )}
            </div>
          </main>
        </div>
      </div>
    </>
  );
}

function Info(props: any) { return <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>; }
