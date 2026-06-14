# Calendly Integration - Free Plan Limitations

## What Works on Free Plan

### OAuth Connection
- ✅ OAuth authentication flow works
- ✅ Basic API access for reading user info
- ✅ Access to calendar events and scheduling URLs

### Manual Booking
- ✅ Users can manually book meetings via Calendly links
- ✅ AI can include Calendly scheduling URLs in messages
- ✅ Basic calendar integration for availability checking

## What Requires Standard Plan ($12/month)

### Webhook Subscriptions
- ❌ **Webhook registration fails** with error: "Permission Denied - Please upgrade your Calendly account to Standard"
- ❌ Real-time event notifications (invitee.created, invitee.canceled) won't work
- ❌ Automatic meeting booking triggers won't fire

### Webhook Features Affected
Without webhooks, the following features won't work automatically:
- Instant notification when a prospect books a meeting
- Automatic lead status updates on booking
- AI follow-up scheduling after meetings
- Meeting reminder automation

## Workarounds for Free Plan

### Option 1: Manual Sync (Implemented)
- ✅ Users can manually sync Calendly events via the dashboard using the `/api/calendar/sync-calendly` endpoint
- ✅ AI can still include Calendly links in messages
- ✅ Dashboard will show synced events after manual sync
- ✅ Lead status can be updated manually after meetings

**How to use manual sync:**
1. Connect your Calendly account via OAuth
2. When prospects book meetings via your Calendly link
3. Click "Sync Calendly" in the calendar dashboard
4. Events will be fetched from Calendly API and synced to Audnix AI
5. Dashboard will update with the synced events

### Option 2: Polling (Not Implemented)
- Could implement periodic polling of Calendly API to check for new bookings
- Higher API usage and latency compared to webhooks
- Not recommended for production use

### Option 3: Upgrade to Standard
- $12/month for Standard plan
- Enables webhook subscriptions
- Full automation capabilities
- Recommended for production use

## Implementation Status

The codebase has graceful error handling for webhook registration failures:
- When webhook registration fails, a warning is logged
- The error message clearly indicates the account tier limitation
- The OAuth flow still completes successfully
- Users can still use Calendly for manual booking

## Recommendation

For testing/development: Free plan is sufficient
For production: Upgrade to Standard plan ($12/month) for full automation

## Error Message

When webhook registration fails on free plan, you'll see:
```
⚠️ Calendly webhook registration requires Standard plan or higher. Webhook features will be limited. Error: {"title":"Permission Denied","message":"Please upgrade your Calendly account to Standard"}
```

This is expected behavior and won't break the integration - it just limits real-time automation features.
