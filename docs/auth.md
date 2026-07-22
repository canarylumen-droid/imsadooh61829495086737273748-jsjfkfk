# Authentication & Authorization

## Auth Flow

### Login/Register
```
POST /api/auth/login  { email, password }
POST /api/auth/register  { email, password, name }

→ Sets session cookie: audnix.sid
  → httpOnly, secure (prod), sameSite: lax, maxAge: 30 days, rolling: true
  → Store: PostgreSQL user_sessions (connect-pg-simple)
→ 500ms session propagation delay after login (DB replica lag)
```

### Error States (login)
| Condition | Error Message |
|---|---|
| No account found | `"No account found with this email. Please sign up or check your email address."` |
| Account was deleted | `"This account was deleted on {date}. Deletion is permanent — data cannot be restored. Please create a new account."` |
| No password set (OAuth-only) | `"This account has no password set. Please use Google OAuth to sign in."` |
| Wrong password | `"Invalid email or password"` |

### Session Check
```
GET /api/user/profile
  → returns user data (id, email, name, plan, avatar_url, etc.)
  → Used by AuthGuard to verify session on page load
```

### API Key Authentication
```
Header: x-api-key: audnix_<64-hex-chars>
  OR Authorization: Bearer audnix_<64-hex-chars>
```

- Keys are stored: SHA-512 hashed + AES-256-GCM encrypted at rest
- 70 chars total: `audnix_` prefix + 64 hex chars (32 bytes random)
- Show once on creation → masked forever
- Permission levels: `read` or `read-write`
- Keys have full access except: `delete_account`, username/OTP endpoints
- Rate limit: configurable per key

## Auth Middleware

`middleware/auth.ts`:
1. Checks `req.session.userId` (session cookie)
2. Falls back to API key auth (x-api-key or Authorization: Bearer)
3. API key auth sets `req.session.userId` as side effect
4. Returns 401 if neither valid

## AuthGuard (Client)

`components/auth-guard.tsx`:
- Fires `useQuery({ queryKey: ["/api/user/profile"] })`
- Retries 2x with backoff before redirecting to /auth
- Does NOT redirect during loading state (prevents premature redirect on network blips)
- 2-strike 401 policy: only redirects after 2nd 401 within 5s

## Account Deletion

### Schedule-Based (UI)
```
DELETE /api/user/schedule-deletion
  → Sets users.scheduled_deletion_at = NOW() + 7 days
  → UI shows countdown timer (useDeletionCountdown)
  → Undo button available until deletion executes
```

### Direct Deletion (Cron)
```
processExpiredDeletions() runs every 60s
  → Finds users WHERE scheduled_deletion_at <= NOW()
  → Logs email to deleted_accounts_log (before CASCADE)
  → Calls revokeAllAndDestroyUser()
    → Revokes all OAuth tokens (Google, Outlook, Calendly)
    → Deletes all user data (CASCADE wipes 50+ tables)
    → Destroys session
```

### Deleted Accounts Log
```sql
deleted_accounts_log (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  deleted_at TIMESTAMP NOT NULL,
  reason TEXT,
  INDEX idx_dal_email ON (email)
)
```

## API Key Model

### Creation
```
POST /api/mcp/key  { name, permissions }
  → Generates 32 random bytes → hex → "audnix_" prefix
  → SHA-512 hash stored in DB
  → AES-256-GCM encrypted at rest
  → Full key returned ONCE in response
  → "Show Once, Mask Forever" UI pattern
```

### Management
```
GET  /api/mcp/key           → List keys (names, permissions, last 4 chars)
PATCH /api/mcp/key/:id      → Rename key
DELETE /api/mcp/key/:id     → Revoke key
POST /api/mcp/mcp           → JSON-RPC endpoint (AI agent integration)
```

## OAuth Providers

| Provider | Scopes | Flow |
|---|---|---|
| Gmail API | `gmail.send`, `gmail.readonly`, `gmail.labels` | OAuth2 → refresh token stored encrypted |
| Outlook API | `Mail.Send`, `Mail.Read`, `offline_access` | OAuth2 → refresh token stored encrypted |
| Google Calendar | `calendar.readonly`, `calendar.events` | OAuth2 → refresh token |
| Calendly | `default`, `webhook:read`, `scheduling` | OAuth2 → token + webhook subscription |

### OAuth Redirect
- After OAuth callback, session is `regenerate()`'d and `audnix.sid` cookie is explicitly set
- Redirects to `/dashboard/calendar` (not `/dashboard/integrations`)
- URL params: `?success=calendly_connected`, `?error=calendly_denied`
- Calendly OAuth uses `prompt=consent` to always show authorization screen on reconnect

## Session Management

### Session Cookie
- **Name**: `audnix.sid`
- **Store**: PostgreSQL `user_sessions` via `connect-pg-simple`
- **Security**: httpOnly, secure (production), sameSite: lax
- **TTL**: 30 days, rolling refresh on activity
- **Race condition**: 500ms propagation delay after login (DB replica lag)

### Session Middleware
```typescript
app.use(session({
  store: new PgSession({
    pool: pgPool,
    tableName: 'user_sessions',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  },
  rolling: true // refresh TTL on activity
}));
```

### Session Regeneration on OAuth
```typescript
// After OAuth callback:
req.session.regenerate((err) => {
  req.session.userId = userId;
  req.session.email = email;
  req.session.save((err) => {
    res.cookie('audnix.sid', req.sessionID, cookieOptions);
    res.redirect('/dashboard/calendar');
  });
});
```

## Client-Side Auth

### AuthGuard Component
```tsx
// In AuthGuard.tsx:
const { data, isLoading, error } = useQuery({
  queryKey: ['/api/user/profile'],
  retry: 2,
  retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
});

// Only redirect after loading completes
if (isLoading) return <LoadingScreen />;
if (error) return <Redirect to="/auth" />;
return <>{children}</>;
```

### 2-Strike 401 Policy
- `queryClient.ts`: React Query's default retry handler counts 401s
- After 2nd 401 within 5 seconds → redirect to `/auth`
- Prevents transient session blips from logging users out
- `api-client.ts` (direct fetch): immediate 401 redirect with 2s toast warning

### Onboarding Flow
```
Login → /dashboard/home
  → AuthGuard checks /api/user/profile
  → If no mailboxes: "Connect Mailbox" / "Create Campaign" empty state
  → Successful connect: auto-start warmup (enrollment status='active')
  → Dashboard shows real data immediately
```

## API Key Model

### Key Lifecycle
```
1. CREATE: POST /api/mcp/key
    → 32 random bytes → hex
    → Prepend "audnix_"
    → SHA-512 hash → AES-256-GCM encrypt → store
    → Return full key (unique: shown ONCE)
    
2. USE: Header: x-api-key: audnix_<64hex>
    → Decrypt stored hash → compare SHA-512
    → Set req.session.userId from key's user
    → Log access
    
3. MANAGE: PATCH rename, DELETE revoke
    → Renamed keys keep same hash/encryption
    → Deleted keys: permanently removed (cannot be recovered)
```

### Key Constraints
- No duplicate names (unique per user)
- 70 chars total (`audnix_` prefix + 64 hex chars)
- SHA-512 hashing (not SHA-256, changed Jul 20 for stronger security)
- AES-256-GCM at-rest encryption
- Last four chars shown in UI for identification
- Read-only keys can query data but not mutate

## Error States

### Login Error Matrix
| DB State | User Exists | Has Password | Deleted Log | Error Message |
|---|---|---|---|---|
| Empty | No | N/A | No | "No account found with this email..." |
| Empty | No | N/A | Yes | "This account was deleted on {date}..." |
| `users` row | Yes | Password set | N/A | Normal login flow |
| `users` row | Yes | NULL (OAuth) | N/A | "This account has no password set..." |
| `users` row | Yes | Wrong password | N/A | "Invalid email or password" |
