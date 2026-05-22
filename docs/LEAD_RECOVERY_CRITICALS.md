# Lead Recovery Criticals

## 1. User-Triggered 90-Day Sync

Lead Recovery activation only enables the feature. It does not scan mailboxes by itself.

Users click **Sync 90 days** in the Lead Recovery dashboard. That queues a read-only scan across connected email mailboxes and records `syncRequestedAt` in MongoDB. The worker only processes states where the user explicitly requested a sync.

## 2. MongoDB Storage And Tenant Isolation

All Lead Recovery feature data is stored in MongoDB, not Postgres:

- `LeadRecoveryState`
- `RecoveredLead`
- `RecoveryPromptConfig`
- `LeadRecoveryObjection`
- `RecoveryEventLog`

Every query is scoped by `tenantId`. Recovered leads are unique by `tenantId + mailboxId + email`, so the same contact in two different user mailboxes cannot be mixed.

## 3. Mailbox-Aware Conversation Recovery

Recovered leads remember the exact source mailbox:

- `mailboxId`
- `sourceMailboxSnapshot`
- `sourceMessageIds`
- `conversationSummary`
- `lastMessageText`
- `lastMessageAt`

When the user recovers a lead, the system returns the source mailbox and generates the draft using that conversation context. Recovery sending must use the same mailbox that held the previous conversation.

## 4. Different AI Behavior From Normal Outreach

Lead Recovery is not campaign outreach.

Normal outreach can reuse initial sequence copy and adjust follow-ups. Lead Recovery must inspect where each individual conversation stopped and draft a personalized recovery reply. For example, if a lead previously said they were not interested, the AI must address that specific objection instead of sending a generic intro.

The prompt config must be dynamic and loaded from MongoDB or seeded from env:

- `LEAD_RECOVERY_SYSTEM_PROMPT`
- `LEAD_RECOVERY_USER_PROMPT_TEMPLATE`
- Mongo prompt config name: `email-lead-recovery`

## 5. Scale, Safety, And Audit Trail

The worker supports many connected mailboxes by queuing each mailbox state separately. A user with hundreds or thousands of mailboxes gets isolated per-mailbox sync state and per-mailbox recovered lead storage.

The sync is read-only and scans up to 90 days of email history. It filters OTPs, receipts, newsletters, promos, and no-reply senders. It checks deliverability with syntax and MX lookup. Every system action is logged in Mongo event logs, including sync requests, sync starts, completion, failures, filtering, deliverability checks, lead analysis, draft generation, and objection discovery.

Runtime requirements:

- Set `MONGODB_URI` or `MONGO_URL`.
- Run `npm run start:worker:lead-recovery`.
- Keep Gmail/Outlook OAuth refresh working for IMAP access.
- Configure `email-lead-recovery` prompt values before users recover leads.
