# Error Handling & Troubleshooting

## Global Error Handler

### Server-Side (Express Middleware)
```typescript
// routes/index.ts — registered after all routes
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  
  // Always return JSON (not HTML)
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});
```

### Client-Side (ErrorBoundary)
```tsx
// ErrorBoundary.tsx
class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null, isChunkError: false };
  
  static getDerivedStateFromError(error: Error) {
    const isChunk = error.message?.includes('Loading chunk') 
      || error.message?.includes('dynamically imported module');
    return { 
      hasError: !isChunk,  // Don't show dialog for chunk errors
      error, 
      isChunkError: isChunk 
    };
  }
  
  componentDidCatch(error: Error) {
    if (this.state.isChunkError) {
      // Silent reload (max 2 attempts)
      const attempts = parseInt(sessionStorage.getItem('chunkReloadAttempts') || '0');
      if (attempts < 2) {
        sessionStorage.setItem('chunkReloadAttempts', String(attempts + 1));
        window.location.reload();
        return;
      }
      // After 2 failed attempts, show error dialog
      this.setState({ hasError: true });
    }
  }
}
```

### Unhandled Rejection Handler (App.tsx)
```typescript
window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
  const error = e.reason;
  // Suppress chunk load errors (no console output)
  if (error?.message?.includes('import(') || error?.message?.includes('Loading chunk')) {
    e.preventDefault();
    return;
  }
  console.error('Unhandled rejection:', error);
});
```

## Common Error Scenarios

### "Loading chunk failed" (Client)
- **Cause**: New deploy → old JS file no longer on CDN
- **Behavior**: Silent reload (max 2 attempts)
- **Fix**: Ensure CDN cache is invalidated on deploy
- **User impact**: Brief flash, page reloads automatically

### "401 Unauthorized" (API)
- **Cause**: Expired session, invalid API key
- **React Query**: 2 retries with backoff, then redirect to `/auth`
- **Direct fetch**: Immediate redirect with 2s toast
- **Socket**: Connection closed, reconnects on next page load

### "503 Service Unavailable"
- **Cause**: Worker overload, DB connection pool exhausted
- **Retry**: React Query retries 2x with backoff
- **Resolution**: Scale workers, increase pool size

### "500 Internal Server Error"
- **Common causes**:
  - DB query timeout
  - AI provider timeout
  - Rate limit exceeded
- **Resolution**: Check PM2 logs, check RDS metrics, check AI provider status

## Recovery Strategies

### DB Connection Failures
- `mysql2` lazy import with pool
- Pool auto-reconnects on failure
- Query retry logic for transient failures
- Connection pool: 10 min, 25 max

### Redis Connection Failures
- Auto-reconnect with exponential backoff
- Health check (PING) before returning cached client
- Dead client nullified on `end` event
- Fallback: inline processing (no Redis)
- Workers: 30s polling fallback when Redis unavailable

### AI Provider Failures
- Gemini → OpenAI fallback chain
- 30s timeout per provider
- Cache common responses
- Non-blocking: AI features degrade gracefully

### SMTP Send Failures
- 3 retries with exponential backoff (30s, 60s, 120s)
- Circuit breaker: pause mailbox after 5 consecutive failures
- Queue remaining sends for next retry window
- Admin notified via dashboard alert

### IMAP Connection Failures
- Circuit breaker pattern (Redis `imap:circuit:*` keys)
- Cooldown: 1 hour before retry
- Auto-reconnect on network recovery
- Stale state cleanup: delete Redis keys manually if needed

## Debugging Tools

### PM2 Log Filtering
```bash
# Search for specific error
pm2 logs --lines 1000 --nostream | grep -i error

# Watch specific worker
pm2 logs audnix-worker-email --lines 50

# Combined with timestamp
pm2 logs --format --lines 100
```

### Redis State Inspection
```bash
# Active IMAP connections
redis-cli keys "imap:active:*"

# Circuit breaker state
redis-cli keys "imap:circuit:*"

# Queue depth
redis-cli LLEN email-send-queue

# Cluster events
redis-cli SUBSCRIBE "audnix-cluster:events"  # Wait for next event
```

### DB Query Debugging
```bash
# Slow queries
mysql -h <host> -e "SHOW FULL PROCESSLIST;" | grep -i "Query"

# Connection pool
mysql -h <host> -e "SHOW STATUS LIKE 'Threads_connected';"

# Table sizes
mysql -h <host> -e "
  SELECT table_name, 
    ROUND(((data_length + index_length) / 1024 / 1024), 2) AS size_mb,
    table_rows
  FROM information_schema.tables
  WHERE table_schema = 'audnix'
  ORDER BY size_mb DESC;
"
```

## Known Issues

### 1. Encryption Key Mismatch (IMAP)
- **Status**: Partially resolved
- **Issue**: Original encryption key for 5 IMAP integrations is lost
- **Impact**: Those 5 mailboxes need manual credential re-entry
- **Workaround**: Delete and re-create those integrations

### 2. Seed Monitor Not Active
- **Status**: Known limitation
- **Issue**: `SEED_MONITOR_EMAIL` / `SEED_MONITOR_PASSWORD` env vars not set
- **Impact**: Rust seed monitor doesn't connect → warmup emails are not auto-moved from spam on seeds
- **Workaround**: Node.js inbound worker monitors seeds as fallback

### 3. npm Vulnerabilities
- **Status**: Monitored, non-blocking
- **Details**: 4 moderate vulns (`request` / `google-it`)
- **Impact**: None — `request` is deprecated but functional
- **Fix**: No direct fix available (transitive dependency)

### 4. CodeQL Alerts
- **Status**: 12 open alerts
- **Details**: 1 critical SSRF, 6 high sanitization, etc.
- **Impact**: Low — alerts are in admin-only endpoints or input-validated routes
- **Fix**: Review on GitHub, address per alert

### 5. Chunk Load Failures After Deploy
- **Status**: Mitigated
- **Issue**: Old client JS files cached by browser after new deploy
- **Impact**: Brief flash, auto-reload (max 2 attempts)
- **Fix**: ErrorBoundary + unhandledrejection handler handle silently

## Client-Side Error States (All Pages)

| Page | Loading | Empty | Error | Network Offline |
|---|---|---|---|---|
| Home | Skeleton KPIs | "Connect Mailbox" prompt | Red error banner, retry button | Reconnection toast |
| Inbox | Skeleton lead list | "No conversations yet" | "Failed to load messages" | "Connection lost" bar |
| Warmup | Skeleton progress cards | "No mailboxes warming" | Card-level retry per mailbox | Auto-reconnect on socket |
| Campaigns | Skeleton list | "Create your first campaign" | "Failed to load campaigns" | Offline indicator |
| Analytics | Skeleton chart | "No analytics data" (all 4 charts) | "Failed to load analytics" | Stale data shown with warning |
| Deliverability | Skeleton pie | "No data yet" (centered text) | "Failed to load stats" | "Last updated: X min ago" |
| Insights | Spinner | 3-tier: no mailbox → no campaign → no data | "AI not available" with contact support | Socket wait indicator |
| Calendar | Mini spinner per section | "No events this month" | "Calendar unavailable" | 15s polling fallback |
| Deals | Skeleton pipeline | "No deals yet" | Per-column error state | Visual warning bar |
| Integrations | Skeleton cards x3 | "Connect your first mailbox" | "Failed to load integrations" | Banner: "Some data may be stale" |

### Loading State Patterns
```tsx
// Skeleton component pattern
{isLoading ? (
  <div className="space-y-3 animate-pulse">
    <div className="h-4 bg-muted rounded w-3/4" />
    <div className="h-4 bg-muted rounded w-1/2" />
    <div className="h-4 bg-muted rounded w-2/3" />
  </div>
) : (
  <DataContent data={data} />
)}
```

## Server-Side Fixes (Historical)

### Jul 15: 2-strike 401 policy
- AuthGuard retries /api/user/profile 2x before redirect
- Prevents transient 503 from logging users out

### Jul 17: Encryption key crisis
- Removed ENCRYPTION_KEY from PM2 env block
- Re-encrypted credentials with .env key

### Jul 19: Redis pub/sub fix
- `require()` → LRU cache for STATS_CACHE_INVALIDATE
- Zombie client detection with PING health check
- Broadcast retry on publish failure

### Jul 19: Notification push fix
- Changed `wsSync` → `clusterSync` in `createNotification()`
- 19 of 34 notification sites were broken in workers

### Jul 20: OAuth redirect fix
- Session regenerate + cookie re-set for Calendly/Google OAuth
- Prevents ITP/3rd-party cookie blocking

### Jul 21: Login error messages
- Differentiated: not found, deleted, wrong password, OAuth-only
- `deleted_accounts_log` table for tracking

### Jul 22: Rust println fix
- Removed raw IMAP protocol `println!` leaking to stdout
