# User Interface Guide

## Overview

The dashboard provides 15 main pages for managing email outreach. The UI follows shadcn/ui + Tailwind CSS design patterns with real-time updates via Socket.IO.

## Dashboard Layout

### Sidebar
- **Logo/Home** — Navigation to dashboard home
- **Navigation items**: Home, Inbox, Campaigns, Warmup, Analytics, Deals, Calendar, Integrations, Settings
- **Avatar**: Click → navigate to `/dashboard/settings`
- **Green dot pulse ring**: Active connection indicator

### Global Components

#### Mailbox Switcher
- Dropdown at top of all data pages
- "All Mailboxes" option for aggregate view
- When mailbox selected: filters all KPIs, charts, and lead lists
- No auto-select on mount (avoids overriding user preference)

#### PageWrapper
- Consistent padding and max-width for all pipeline pages
- Responsive: adjusts layout for mobile/tablet/desktop

#### RecentConversations
- Home page component showing recent email activity
- Handles API returning plain array (not `{leads:[...]}`)
- Message bubbles with `break-words` and `max-h-[200px] overflow-y-auto`
- Refetches on socket events

## Page Details

### Home (`/dashboard/home`)
- **KPIs**: Total leads, Sent, Open Rate, Responses, Converted, Bounce Rate
- **Empty state**: "Connect Mailbox" / "Create Campaign" when no mailboxes
- **Recent Activity**: Latest conversations with direction indicators
- **Socket**: `stats_updated` → instant KPI refresh

### Inbox (`/dashboard/inbox`)
- **Dual pane**: Lead list (left) + Message thread (right)
- **Virtual list**: Infinite scroll with windowing
- **Filters**: Status, Channel, Search, Archive toggle, Warmup toggle
- **Real-time**: Socket events for new messages, status changes
- **Compose**: Bottom compose area (no double input)

### Warmup (`/dashboard/warmup`)
- **KPIs**: Fully Warmed count, Inbox Score, Sent Today, Spam Count
- **Active Progress Cards**: Per-mailbox progress with stage labels
- **Chart**: 24h activity with selector (24h/7d/14d/30d/90d/365d)
- **Controls**: Per-mailbox switch, Pause All/Start All

### Campaigns (`/dashboard/campaigns`)
- **List**: All campaigns with status badges
- **Modal**: Campaign creation wizard (Leads → Emails → Mailbox → Review)
- **Progress**: Per-campaign progress bars + ETA
- **Controls**: Launch, Pause, Resume per campaign

### Analytics (`/dashboard/analytics`)
- **Time series**: Sent, Opened, Replied, Bounced, Spam over time
- **Pie chart**: Distribution breakdown
- **Date range**: 24h, 7d, 30d, 60d, 90d
- **KPIs**: All metrics respect date range parameter

### Deliverability (`/dashboard/deliverability`)
- **Placement pie**: Inbox (green), Spam (red), Bounce (amber), Other (gray)
- **Per-domain breakdown**: DNS status + placement rates
- **Socket**: `deliverability_updated` → instant chart refresh
- **Zero data**: "No data yet" when no email activity

### Insights (`/dashboard/insights`)
- **Three-tier empty state**: No mailbox → "Connect", No campaign → "Start", No data → "Not yet"
- **AI insights**: Trends, predictions, recommendations, summary
- **Threshold**: Shows data when any metric is non-zero
- **Socket**: `insights_updated` → instant refresh

### Calendar (`/dashboard/calendar`)
- **Grid**: Month view with day cells
- **Events panel**: Selected-day event list, Upcoming events
- **Settings**: Google Calendar + Calendly connect/disconnect
- **Timezone-aware**: `Intl.DateTimeFormat` not UTC-based

### Deals (`/dashboard/deals`)
- **Pipeline**: Kanban columns by stage
- **Deal cards**: Company, value, contact, stage badge
- **Color coding**: red (lost), amber (pending), sky (qualified), emerald (won/booked)

### Integrations (`/dashboard/integrations`)
- **Mailbox list**: Email, provider, DNS badges, stats
- **View All modal**: Grid of all mailboxes with full details
- **DNS health**: SPF/DKIM/DMARC/MX/BL per domain
- **Pulse dot**: Real-time placement indicator

### Settings (`/dashboard/settings`)
- **Profile**: Name, email, avatar (image only, no PDF)
- **Deal values**: Average Deal Value ($), Deal Value 2 ($)
- **Avatar upload**: S3 storage with proper MIME types
- **Account deletion**: 7-day countdown, undo capability
- **Calendar link**: Scheduling URL display

### Developer (`/developer`)
- **API reference**: 17+ endpoints with curl examples
- **Search**: Live client-side filtering
- **SEO**: Helmet meta tags for Google/AI crawlers

### MCP Server (`/dashboard/mcp-server`)
- **Key management**: Create, rename, delete API keys
- **Permissions**: read / read-write
- **Show-once**: Full key displayed once then masked
- **JSON-RPC**: AI agent integration endpoint

## Mobile Responsiveness

### Breakpoints
| Breakpoint | Width | Behavior |
|---|---|---|
| `sm` | ≥640px | Compact cards, hidden brain buttons |
| `md` | ≥768px | Sidebar visible, full layout |
| `lg` | ≥1024px | Full content width |

### Mobile-Specific Adjustments
- Inbox: Brain button `hidden` on mobile (frees space)
- Integrations: Stats grid `grid-cols-2 sm:grid-cols-4`
- Calendar: Compact day cells, hidden sidebar
- Warmup: Progress cards stack vertically
- Pipeline: Single column, horizontal scroll for stages
- Charts: Responsive container (Recharts `aspect` ratio)

## Accessibility

- All interactive elements have focus styles
- Color-coded badges use both color AND text labels
- Links are visually distinct
- Error states have `role="alert"`
- Loading states show spinners (not blank space)

## Performance

### Bundle Size
| Chunk | Size (gzip) |
|---|---|
| Analytics (largest) | 632 KB |
| Auth | 811 KB |
| Index | 222 KB |
| Chart utilities | 100 KB |

### Optimization Notes
- Code splitting by route (lazy-loaded pages)
- Virtual list for inbox (only renders visible leads)
- Debounced socket handlers (reduce re-renders)
- 500ms server cache for stats (cleared on every event)
- React Query cache (stale-while-revalidate)

### Infinite Scroll Implementation
```typescript
// Inbox uses virtual list with react-window
// onItemsRendered callback loads more pages
const loadMore = () => {
  if (hasNextPage && !isFetchingNextPage) {
    fetchNextPage();
  }
};

// Filter change resets page to 0 and clears virtual range
useEffect(() => {
  setPage(0);
  setVirtualRange({ start: 0, end: 50 });
}, [filterStatus, filterChannel, searchQuery]);
```
