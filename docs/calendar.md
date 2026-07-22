# Calendar & Scheduling

## Overview

The calendar system manages meetings and events from three sources: Google Calendar, Calendly bookings, and the internal `calendar_events` table.

## Data Sources

### 1. Google Calendar
- OAuth2 integration (read-only events)
- `GET /api/oauth/connect/google-calendar` → OAuth flow → redirect to `/dashboard/calendar`
- Events fetched via Google Calendar API (`calendar.events.list`)
- Disconnect: `POST /api/oauth/google-calendar/disconnect`
- Notifications: `wsSync.notifySettingsUpdated(userId)` on disconnect

### 2. Calendly
- OAuth2 integration (scheduling webhook)
- `GET /api/oauth/connect/calendly` → OAuth flow with `prompt=consent`
- Webhook subscriptions for: `invitee.created`, `invitee.canceled`, `invitee.no_show`
- Events synced to `calendar_events` table via `calendly-sync-worker.ts`
- Scheduling link: `settings.calendarLink` (from DB or Calendly API)
- Disconnect: `POST /api/oauth/disconnect/calendly` → revokes token + deletes integration + clears user/calendar settings

### 3. Internal Events (`calendar_events` table)
- Synced from Calendly webhooks
- Stored in MySQL for fast querying
- Merged with Google Calendar events on the frontend

## Calendar Page

### Components
- **Calendar grid**: Month view with day cells
- **Timezone-aware rendering**: `Intl.DateTimeFormat` for date display
- **Selected date panel**: Shows all events for clicked date, sorted by time
  - Lead name, meeting URL, time range
- **Upcoming events list**: Future events in chronological order
- **Settings sheet**: Calendar provider connections

### Day Click Behavior
- Click on day: shows events for that date in side panel
- "Create Event" onClick: shows event details panel (not creates new)

### Timezone Handling (Fix: Jul 20)
```typescript
// Before (broken for negative UTC offsets):
const isToday = date.toISOString().split('T')[0] === todayISO;
// "July 20 10:00 PM UTC-4" → July 21 UTC → wrong date

// After (timezone-aware):
const dateToTzStr = (date: Date) => {
  return new Intl.DateTimeFormat('en-CA', {  // en-CA → YYYY-MM-DD
    timeZone: userTimezone,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
};
const isToday = dateToTzStr(date) === todayInTz;
```

### Connection Management
- **Google Calendar**: "Connect Google Calendar" button → OAuth redirect
  - Connected: shows "Disconnect" (destructive button)
  - Disconnect fires `notifySettingsUpdated`
- **Calendly**: "Connect Calendly" button → OAuth redirect
  - Connected: shows "Disconnect" (destructive)
  - Checks `/api/channels/calendly` for Calendly integration status

### Socket Integration
| Event | Invalidates |
|---|---|
| `settings_updated` | Calendar settings, connection status |
| `calendar_updated` | All calendar events queries |

### Polling Fallback
```typescript
refetchInterval: isConnected ? false : 15000
// 15s polling when socket disconnected
// Pure real-time when WebSocket connected
```

## API Endpoints

### Calendar Events
```
GET /api/calendar/events?start=ISO&end=ISO
→ 200: { events: [{ id, title, start, end, url, source, leadName }] }
```

### Connect
```
GET /api/oauth/connect/google-calendar   → OAuth redirect
GET /api/oauth/connect/calendly           → OAuth redirect
```

### Disconnect
```
POST /api/oauth/google-calendar/disconnect  → 200: { success }
POST /api/oauth/disconnect/calendly          → 200: { success }
  → Revokes OAuth token
  → Deletes integration record
  → Clears user.calendarLink
  → Deletes Calendly scheduling URL settings
```

### Settings
```
GET  /api/user/settings                     → { calendarLink, ... }
PATCH /api/user/settings                    → Update calendarLink
```

### Calendly Sync Worker
```
calendly-sync-worker.ts:
  → Listens for Calendly webhook events
  → Syncs to calendar_events table
  → Fires wsSync.notifyCalendarUpdated(userId)
```

## OAuth Flow Details

### Google Calendar OAuth
1. User clicks "Connect Google Calendar"
2. GET `/api/oauth/connect/google-calendar` → 302 to Google
3. User authorizes: `calendar.readonly`, `calendar.events`
4. Google redirects to `/api/oauth/google-calendar/callback`
5. Callback handler:
   - Exchanges code for tokens
   - Stores encrypted refresh token
   - Regenerates session (cookie fix for ITP blocking)
   - Sets `audnix.sid` cookie explicitly
   - Redirects to `/dashboard/calendar?success=google_connected`
6. Error: `?error=access_denied` toast shown

### Calendly OAuth
1. User clicks "Connect Calendly"
2. GET `/api/oauth/connect/calendly` → 302 to Calendly
3. User authorizes
4. Calendly redirects to `/api/oauth/calendly/callback`
5. Same session regeneration + cookie fix
6. Redirects to `/dashboard/calendar?success=calendly_connected`
7. Error handling: "already in use" detection
   ```typescript
   connectCalendlyOAuthMutation.onError = (error) => {
     if (error.message.includes('already') || error.message.includes('in use')) {
       toast('This Calendly account is already connected to another Audnix user');
     }
   };
   ```
