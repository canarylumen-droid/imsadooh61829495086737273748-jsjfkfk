# Audnix AI — 45-Phase Implementation Plan

## Phase 1: Avatar Upload Fix (ROUTE MISSING)
- Add POST /api/user/avatar route with multer diskStorage
- Frontend already tries to upload to this route (settings.tsx:152)
- Error: route doesn't exist → 404

## Phase 2: Calendly Per-User Isolation
- Fix "account already in use" banner showing for wrong user
- Ensure each user's Calendly connection is independent
- Clear Calendly state on user switch/logout

## Phase 3: OAuth Token Revocation on DB Clear
- When user is deleted / DB cleared, revoke all OAuth tokens
- Gmail, Outlook, Instagram, Calendly tokens must be revoked
- Add cleanup hook in user deletion route

## Phase 4: Inbox 404 Fix — Route Matching
- Fix wouter route matching for /dashboard/inbox/:id
- Add catch-all error handling so INbox never shows 404

## Phase 5: Real-Time Campaign Stats (WebSocket Push)
- Push campaign_progress events from worker to UI every 5s
- Update dashboard sent/queued counts in real-time

## Phase 6: Atomic Campaign Counters
- Fix sent vs queued counting — strict atomic transactions
- Redis lock on campaign stats to prevent race conditions

## Phase 7: Conversation Threading (Message-ID / In-Reply-To)
- Fix mail parser to properly thread replies
- Store Message-ID, References headers correctly
- Group threads by lead_id + campaign_id

## Phase 8: Campaign Draft Persistence (Server-Side)
- Save draft to DB, not just localStorage
- Restore draft across browsers and sessions
- Auto-save every 30s while editing

## Phase 9: MX Lookup on Lead Import
- Add real DNS MX check during CSV/PDF import
- Verify email deliverability before importing
- Show MX status in import results

## Phase 10: Bulk Lead Import Speed (50k-100k)
- Optimize batch inserts for large imports
- Use COPY FROM instead of INSERT for bulk
- Show progress bar during import

## Phase 11: Domain Reputation Per-Domain
- Calculate separate reputation for each sending domain
- Show domain-specific score in health dashboard
- Fix: currently all domains show same score

## Phase 12: WebSocket Real-Time Sync (All States)
- Push mailbox status changes via WebSocket
- Push campaign progress
- Push worker status
- Push lead updates
- Replace polling with event-driven system

## Phase 13: "Synced seconds ago" — Real-Time
- Replace polling with WebSocket push
- Show actual last-sync time in seconds
- Remove fake/static timestamps

## Phase 14: HTML Email Rendering in Inbox
- Sanitize and render HTML emails properly (DOMPartial fix done)
- Strip tracking pixels from visible content
- Show plain text fallback

## Phase 15: Loading Animations for Data Fetches
- Add skeleton loaders for every data fetch
- Blur/shimmer transitions when data changes
- Prevent layout shift during loading

## Phase 16: Subject Line Editing for ALL Steps
- Allow custom subject for S1, S2, S3, Auto Reply
- Each follow-up step has its own subject field
- Currently: Auto Reply subject is hardcoded as "Re: {subject}"

## Phase 17: Clean Up Error Modals
- Remove "Emergency Override" / "System Isolation" error boundary
- Replace with graceful error handling
- Show user-friendly error messages

## Phase 18: Fix All 404 Routes
- Audit entire App.tsx routing
- Ensure all pages are imported and routed
- Add catch-all for unknown routes

## Phase 19: End-to-End Integration Test
- Test: Launch campaign → Email sent → Lead updated in CRM
- Test: Custom template copy is preserved
- Test: Dashboard numbers match DB after 10, 50, 100 emails

## Phase 20: Unit Tests for Pages & Components
- Write tests for inbox, campaign wizard, settings
- Write tests for campaign-queue worker
- Write tests for routing engine

## Phase 21: API → UI Sync (No Refresh Needed)
- Every API change reflects in UI immediately
- Remove all manual refresh buttons
- WebSocket pushes state changes

## Phase 22: Storage/S3 Fallback for Uploads
- Add S3 storage for avatars, PDFs
- Fallback to local disk if S3 unavailable
- CDN URL generation

## Phase 23: Validate All API Payloads
- Every API returns fresh JSON, not stale state
- No cached/mock objects in responses
- Zod validation on all endpoints

## Phase 24: Notification System Overhaul
- Real-time notifications via WebSocket
- In-app toast notifications for all events
- Email notifications for key events

## Phase 25: IMAP Connection Stability
- Fix "IMAP not active" errors
- Better reconnection logic
- Connection pooling for IMAP

## Phase 26: SMTP Connection Pooling
- Persistent SMTP connections
- Pre-validate connection before sending
- Auto-reconnect on failure

## Phase 27: Campaign ETA — Dynamic Calculation
- Calculate remaining time based on actual send rate
- Update ETA in real-time as sends progress
- Show per-mailbox ETA

## Phase 28: Sender Name Resolution
- Dashboard/CRM shows sender display name
- Integration name from SMTP config
- Fallback: email username

## Phase 29: Lead Profile Page
- Full lead details view
- Message history
- Campaign participation
- Timeline of interactions

## Phase 30: Bulk Actions Performance
- Archive/delete 50k leads in <1s
- Background processing with progress
- Undo support

## Phase 31: Redis Connection Health
- Monitor Redis latency
- Auto-reconnect on failure
- Fallback to PG when Redis down

## Phase 32: Database Connection Pooling
- Optimize pool sizes per service
- Prevent connection exhaustion
- Monitor pool usage

## Phase 33: Error Logging Standardization
- Structured logging across all services
- Error severity levels
- Centralized log aggregation
- Remove console.log scattered everywhere

## Phase 34: Campaign Queue Monitoring
- BullMQ dashboard for queue health
- Stalled job detection
- Failed job retry logic

## Phase 35: Webhook Reliability
- Calendly webhook signature verification
- Retry on failure
- Webhook health dashboard

## Phase 36: Autoscaling — Queue-Based
- Scale workers based on queue depth
- KEDA integration
- Min/max replicas per service

## Phase 37: Security Audit
- XSS prevention (DOMpurify)
- CSRF protection (fix the /api/csrf-token route)
- Rate limiting review
- SQL injection prevention

## Phase 38: GDPR Compliance
- Data deletion endpoint
- Export user data
- Retention policies

## Phase 39: Performance Optimization
- Bundle size reduction
- Code splitting
- Lazy loading
- Image optimization

## Phase 40: Mobile Responsiveness
- Fix inbox on mobile
- Responsive campaign wizard
- Touch-friendly UI

## Phase 41: Accessibility
- ARIA labels
- Keyboard navigation
- Screen reader support

## Phase 42: Internationalization
- Multi-language support
- Date/number formatting per locale
- RTL support

## Phase 43: Documentation
- API documentation
- User guide
- Developer onboarding

## Phase 44: Monitoring & Alerting
- Sentry error tracking ✅ (already configured)
- Uptime monitoring
- Performance metrics
- Alert thresholds

## Phase 45: Production Readiness Review
- Full security audit
- Load testing
- Disaster recovery plan
- Backup verification
