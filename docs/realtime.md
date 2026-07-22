# Real-Time System

## Overview

Audnix uses a dual real-time architecture: Socket.IO for client→server push and Redis pub/sub for server→server communication. All real-time events follow a "push before DB write" pattern for instant UI updates.

## System Components

```
┌──────────┐     Socket.IO      ┌────────────────┐
│  Client   │◄──────────────────│ Socket Server   │
│ (Browser) │     events        │  (Port 3002)   │
└──────────┘                    └───────┬────────┘
                                        │
                                  Redis Pub/Sub
                                        │
          ┌─────────────────────────────┼─────────────────────────────┐
          │                             │                             │
          ▼                             ▼                             ▼
   ┌──────────────┐           ┌──────────────────┐         ┌────────────────┐
   │ API Gateway   │           │ All Workers (16) │         │ Rust Services │
   │ (Port 3001)  │           │ (email, ai, ...) │         │ (sender, imap)│
   └──────────────┘           └──────────────────┘         └────────────────┘
```

## Socket.IO Architecture

### Server Setup (socket-server)
```typescript
const io = new Server(httpServer, {
  cors: { origin: process.env.CLIENT_URL, credentials: true },
  transports: ['websocket', 'polling']
});

// Session-based auth middleware
io.use(async (socket, next) => {
  const session = await sessionStore.get(socket.handshake.query.sid);
  if (!session?.userId) return next(new Error('Unauthorized'));
  socket.data.userId = session.userId;
  next();
});
```

### Client Connection (useSocket hook)
```typescript
const socket = io(WS_URL, {
  withCredentials: true,
  query: { sid: getCookie('audnix.sid') },
  transports: ['websocket'],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 10000,
});

// Single connection shared across all pages
// Event handlers registered by use-realtime.tsx
```

## Redis Cluster Events

### Event Publishing
```typescript
// All services use clusterSync (or wsSync for in-process)
clusterSync.notifyStatsUpdated(userId);
clusterSync.notifyDeliverabilityUpdated(userId, data);
clusterSync.notifyLeadsUpdated(userId, data);
clusterSync.notifyNotification(userId, notification);

// Published to Redis: PUBLISH audnix-cluster:events
{
  event: "STATS_UPDATED",
  payload: { userId: "uuid", timestamp: 1234567890 }
}
```

### Event Subscribing (redis-pubsub.ts)
```typescript
// Subscriber runs in ALL processes (API gateway, socket server, workers)
subscriber.subscribe('audnix-cluster:events', (message) => {
  const { event, payload } = JSON.parse(message);
  
  switch (event) {
    case 'STATS_UPDATED':
      // API gateway: clear stats cache
      pendingInvalidations.set(payload.userId, true);
      break;
      
    case 'STATS_CACHE_INVALIDATE':
      // API gateway: clear LRU cache
      statsCache.delete(payload.userId);
      break;
      
    case 'NOTIFICATION':
      // Socket server: relay to client
      relayToSocket(payload.userId, 'notification', payload);
      break;
      
    case 'CALENDAR_UPDATE':
      relayToSocket(payload.userId, 'calendar_updated', {});
      break;
  }
});
```

### STATS_CACHE_INVALIDATE Fix (Jul 19)
- **Root cause**: `require()` used in handler throws `ReferenceError` in ESM mode
- Empty `catch (_) {}` silently swallowed the error → `invalidateStatsCache` NEVER fired
- **Fix**: Replaced `require()` with in-process LRU cache `pendingInvalidations`
- `STATS_CACHE_INVALIDATE` sets `pendingInvalidations.set(userId, true)`
- Stats endpoint checks this before serving cached data

### Redis Client Health (redis.ts)
```typescript
// Zombie client prevention (Jul 19 fix)
client.on('end', () => { redisClient = null; });

async function getRedisClient() {
  if (redisClient) {
    try {
      await redisClient.ping();  // Health check
      return redisClient;
    } catch {
      redisClient = null;  // Stale connection
    }
  }
  // Reconnect
  redisClient = new Redis(connectionString);
  return redisClient;
}
```

## Event Flow Patterns

### Pattern 1: Two-Phase Push (IMAP new mail)

```
1. IMAP detects new email
2. Phase 1 (before DB):
   → clusterSync.notifyLeadsUpdated(userId, { type: 'INSERT', lead })
   → clusterSync.notifyMessagesUpdated(userId, { type: 'new_message', message })
   → clusterSync.notifyStatsUpdated(userId)
   → clusterSync.notifyStatsCacheInvalidate(userId)
3. Socket server receives → relays to client (instant UI)
4. Phase 2:
   → db.insert(messages).values(message)
   → db.update(leads).set({ snippet, lastMessageAt, ... })
```

### Pattern 2: Action → Update (send email)

```
1. User clicks "Send" in inbox
2. sendMutation.onMutate:
   → Optimistically adds temp message to list
   → Clears drafts
3. POST /api/messages/:leadId
   → SMTP send → 250 OK
   → invalidateStatsCache(userId)  -- clears 500ms cache
   → wsSync.notifyStatsUpdated(userId)
   → Create message in DB
4. Socket receives messages_updated:
   → Replaces temp message with real one
   → Updates tick (✓ pending)
   → Stats queries refetch with fresh data
```

### Pattern 3: Worker → Client (campaign progress)

```
1. Campaign sends an email
2. outreach-worker:
   → db.updateCampaignStats(campaignId, { sentCount: +1 })
   → clusterSync.notifyStatsUpdated(userId)
3. Socket server receives:
   → relays stats_updated to client
4. Client handler:
   → invalidates /api/dashboard/stats
   → invalidates /api/campaigns/:id/stats
   → Page re-renders with updated KPIs
```

## Event Reference

### Stats Events
| Event | Source | Invalidates |
|---|---|---|
| `stats_updated` | All workers, API | ALL dashboard, warmup, deliverability, analytics queries |
| `stats_cache_invalidate` | Cluster sync | API gateway 500ms cache |

### Data Events
| Event | Source | Client Effect |
|---|---|---|
| `leads_updated` | IMAP, import, manual | Patches lead list state |
| `messages_updated` | IMAP, send | Replaces temp, appends new |
| `deliverability_updated` | Tracking, monitor | Updates placement chart |
| `open_click_event` | Tracking pixel | Updates tick (✓→✓✓) |

### Warmup Events
| Event | Source | Client Effect |
|---|---|---|
| `warmup_update` | Warmup workers | Refreshes warmup page |
| `warmup_interaction` | Warmup workers | Updates progress cards |

### Admin Events
| Event | Source | Client Effect |
|---|---|---|
| `notification` | All workers | Shows notification bell |
| `settings_updated` | API gateway | Refreshes settings |
| `calendar_updated` | Calendly sync | Refreshes calendar |
| `insights_updated` | AI worker | Refreshes AI insights |
| `bulk_import` | Bulk import | Updates progress bar |
| `campaign_eta` | Outreach worker | Updates campaign ETA |
| `integration_reputation_updated` | Reputation monitor | Updates DNS badges |

## Polling Fallbacks

| Page | Polling | Condition |
|---|---|---|
| Calendar | 15s | Socket disconnected |
| Notifications | 5s | Socket disconnected |
| All pages (global) | None | Socket connected only |
| Warmup | None | Socket events only |
| Inbox | None | `refetchOnMount: true` |

## Migrating from Polling to Real-Time

### Required Checklist
1. Worker fires `clusterSync.notify*(userId, data)` after DB write
2. `redis-pubsub.ts` has handler for event type
3. Socket server relays event to correct user
4. Client `use-realtime.tsx` has event handler with `invalidateQueries`
5. Page-level socket listeners for page-specific events
6. `refetchInterval` set to `false` when socket connected
7. Polling fallback only for disconnected state

### Common Pitfalls
- Using `wsSync` instead of `clusterSync` in workers (wsSync.io is null)
- Missing `stats_cache_invalidate` → 500ms cache serves stale data
- `Notification` events not relayed to socket (was broken for 19/34 sites)
- `require()` in ESM context (was silently swallowing cache invalidations)
