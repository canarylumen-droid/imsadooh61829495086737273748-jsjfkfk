# Campaign Scheduling Requirements

## 1. Campaign Creation
- User picks which mailboxes to use (Select All exists in wizard)
- Or types a lead count
- Leads are MX-routed: `@gmail` → Gmail mailbox, same custom domain → that domain's mailbox, everything else → round-robin across `custom_email` if none then still balance it evem if balances it pairs and still baalnce it
- Round-robin is even — each mailbox gets floor(N/count) or ceil(N/count)

## 2. Outreach Sending
- Each mailbox sends ONLY its assigned leads (no cross-mailbox stealing)
- EXCEPT when a mailbox hits its daily cap — its INITIALS (not follow-ups) redistribute to mailboxes with spare capacity
- Follow-ups NEVER get redistributed — they stay with the original mailbox

## 3. Warmup Coexistence
- Warmup runs alongside campaigns, takes 20-25% of mailbox daily cap
- Warmup emails are spaced naturally throughout the day with gaps if 48 emals mailbox cap 20% is 4 to 5 wmajls rounds it to 5 emails then calcualtes 5 emails divide by 24 hours check minutes too maybe 1 warm up per 7 hours depends so wont be bad and if warmup email wnts to go check if its 10 to 15 minutes gap from what outreach emils is doing too or waits to dl it  bu
- If warmup + campaign + follow-ups exceed cap, warmup is reduced first

## 4. Smart 24h Timing
- Total sends per day ÷ 24 = interval between sends
- Mix initials, follow-ups, and warmup so there's 10-15 minute gaps between each warmup is different adds eztra itself but wont pass 20-25% of what itll send for that day or maikbox limit chdkx what we have 
- Never burst — spread evenly across all 24 hours and spread across minutes we have in a day if every bour then soread out that hour too accurately if 48 maklbox cap or its sending a day it could be 15 starting out then ramps up  sp it checks 2 emails an hour note warmup is different it doesnt respect cap but while running outreach or campaign check is active then it cant go morethan 10 for warmup so try balance it 
- If cap hit mid-day, excess moves to TOMORROW (not same-day catch-up)

## 5. Sequence Handling
- Sequences don't clash — step 1 finishes before step 2 starts sending
- Follow-up delays (delayDays) are respected
- If campaign length extends due to caps, ETA recalculates
 in real time even 
## 6. ETA
- Based on actual send rate (historic), not configured rate
- Updates in real-time as sends complete
- `remaining / avgDailyRate` with calendar day multiplier for weekends

## 7. Performance
- Rust backs the math: daily plan calculation, spacing, redistribution
- 100 mailboxes × 10k leads = no RAM meltdown
- BullMQ for job dispatch (lightweight), Rust for scheduling logic (fast) so do we cange rust entirely or sth

## 8. Edge Cases
- Odd numbers (17 leads across 5 mailboxes = 4,4,3,3,3) — handled by round-robin +1
- Bad logic protection: if something breaks, it doesn't clash — defers to next day 
- Mid-budget re-check: after each send, verify cap isn't exceeded
- If all mailboxes hit cap = 0, everything defers to tomorrow naturally
