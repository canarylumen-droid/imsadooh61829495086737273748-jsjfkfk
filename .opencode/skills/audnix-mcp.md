# Audnix MCP — LLM Skill Guide

> For LLM agents (Claude, Gemini, GPT, Cursor, Copilot, etc.) connected via MCP to Audnix.
> **Audnix** is an autonomous AI sales platform for cold email, lead gen, and objection handling.

## Connection

```
URL: https://audnixai.com/api/mcp  
Auth: Authorization: Bearer audnix_<api_key>
```

## Rules (MUST FOLLOW)

### 🚫 CAN NEVER DO
- **Delete user accounts** — Absolutely forbidden. There is no MCP tool for this.
- **Access auth endpoints** — No login, signup, password reset via MCP.
- **Access billing** — No payment, subscription, or invoice tools.
- **Access other users' data** — Everything is scoped to the API key owner.
- **Admin operations** — No admin-only tools exposed via MCP.

### ⚠️ MUST CONFIRM WITH USER BEFORE
- **`send_message`** — Sends a real email/DM to a real lead. Show the FULL content first.
- **`manage_webhooks`** — Creating or deleting webhooks affects integrations.
- **Deleting leads** — Only if user explicitly confirms. Double-check lead ID.
- **Modifying campaigns** — Paused/running campaigns need explicit confirmation.

### ✅ Can Do Freely (Read)
- Query leads, campaigns, analytics, inbox messages — all read operations.

---

## Available Tools

### `get_leads`
Query leads. Filters: `status` (cold, warm, replied, booked, converted, not_interested, bouncy, unsubscribed), `limit` (default 50), `offset`.

### `get_campaigns`
List campaigns. Returns name, status, metrics (sent, opens, replies).

### `get_analytics`
Dashboard stats, trends, inbox placement, domain reputation.

### `get_inbox`
Read inbox messages. Returns sender, subject, body, timestamps.

### `send_message` ⚠️ CONFIRM FIRST
Send email/DM via connected mailboxes. Requires `leadId` + `content`.

### `manage_webhooks` ⚠️ CONFIRM FIRST
Create, list, delete webhook endpoints for event-driven integrations.

---

## Permissions

| Scope | Read | Write | Blocked |
|-------|------|-------|---------|
| `read_only` | All data | Nothing | Sending, modifying, deleting |
| `read_write` | All data | Messages, campaigns, leads, webhooks | Account deletion, billing, auth, admin |

## Rate Limits

60 requests/minute per API key. Headers: `RateLimit-Remaining`, `RateLimit-Reset`.

## Error Codes

`AUTH_REQUIRED`, `NOT_FOUND`, `RATE_LIMITED`, `VALIDATION_ERROR`, `SCOPE_DENIED`

## Example Queries

```json
{ "tool": "get_leads", "params": { "status": "warm", "limit": 10 } }
{ "tool": "get_campaigns", "params": {} }
{ "tool": "get_analytics", "params": { "period": "7d" } }
```
