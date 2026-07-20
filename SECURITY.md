# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability within this project, please send an email to **security@audnixai.com**. All security vulnerabilities will be promptly addressed.

Please do NOT report security vulnerabilities through public GitHub issues.

## Security Practices

### Authentication & Authorization
- All API routes use `requireAuth` or `requireAuthOrApiKey` middleware
- Admin-only routes use `requireAdmin` middleware
- SSE/WebSocket connections require authentication
- Internal service-to-service communication uses `x-api-key` headers
- Cron job endpoints gated behind `CRON_SECRET` or `WORKER_SECRET`
- API key auth: `Authorization: Bearer audnix_<key>` header
- Session auth: httpOnly `audnix.sid` cookie (30-day rolling expiry)

### Data Protection
- All user passwords are bcrypt-hashed (10 rounds)
- PII (emails, names) encrypted at rest via AES-256-GCM
- API keys: 70 chars (`audnix_` + 64 hex), SHA-512 hashed in DB (irreversible), encrypted at rest
- Raw API key shown ONCE on creation, then masked forever — only hash stored
- Keys and secrets stored in environment variables, never in code
- `.gitignore` blocks `.env`, `opencode.json`, and credential files

### Input Validation
- All database queries use Drizzle ORM parameterized queries (no SQL injection)
- HTML output sanitized with DOMPurify before rendering
- File uploads validated by MIME type and extension
- Path traversal protections on file storage

### Rate Limiting
- Authentication endpoints: 5 requests/minute
- API endpoints: 60 requests/minute
- Webhook endpoints: 30 requests/minute
- AI generation: 10 requests/minute
- Account reset: 5 requests/minute
- Worker status: 30 requests/minute

### CORS Policy
- Production: restricted to `ALLOWED_ORIGINS` environment variable
- No wildcard origins in credential mode
- Deliverability service: restricted to internal network

### Dependency Management
- Dependabot enabled for daily security updates
- `npm audit` run on every deployment
- Known vulnerabilities tracked and patched

### Infrastructure
- Security headers (CSP, X-Frame-Options, HSTS) applied via middleware
- Helmet.js for HTTP header hardening
- No `eval()` or dynamic code execution in production paths
- Worker processes require authentication tokens

## Scope

This security policy applies to the main application codebase. Third-party services and infrastructure-level security (database, CDN, DNS) are managed separately.

---
Last updated: July 2026
