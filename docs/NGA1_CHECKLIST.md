# AUDNIX NGA-1 EXECUTION CHECKLIST — MUST DO ALL

*CONTEXT & MEMORY*
- [ ] *Ingest all columns*: If user imports CSV/table, map every field. City → timezone, fund → segment, role → ICP. Never drop data.
- [ ] *Timezone per lead*: Send at recipient’s best local time. Use LLM + column data to decide. NYC ≠ Lagos.
- [ ] *Episodic memory*: Store every touch + outcome for 90+ days. Reference it before any action.
- [ ] *Procedural memory*: After closed-won/lost, extract pattern. Apply to next similar lead automatically.
- [ ] *Fathom ingestion*: If call happened, parse transcript → BANT + objections + next steps → update memory before follow-up.

*VERIFICATION & SAFETY*
- [ ] *Zero hallucination*: Block send if any field unresolved. No `<field>` leaks. No fake facts.
- [ ] *Unsubscribe check*: Link must exist and be valid in every email. No send without it.
- [ ] *Math check*: Any discount/pricing calc must be verified. “20% off $10k” = $8k or block.
- [ ] *Payment link*: Never LLM-generate. Pull only from `settings.payment_link`. Verify URL is live via API.
- [ ] *Destructive action gate*: Never delete lead. Never mass edit. “Not interested” = pause + schedule re-engage, not delete.
- [ ] *Compliance*: Auto-append physical address. TCPA/GDPR/CAN-SPAM compliant. Track consent timestamp.
- [ ] *No double-send*: Use idempotency keys. BullMQ retry must not duplicate email.

*DELIVERABILITY & RESILIENCE*
- [ ] *Mailbox concurrency*: Same mailbox = serial queue. Different mailboxes = async parallel. 500 mailboxes can run.
- [ ] *Health gate*: If mailbox = Critical/paused, stop outbound. Still process inbound replies <60s. Route via healthy mailbox if needed.
- [ ] *Reply > sending*: always drop a reply due to quota or health. Revenue events always win.
- [ ] *Campaign over ≠ AI stop*: If reply comes Day 70 on Day-60 campaign, handle it. If new trigger Day 90, re-engage if valid.

*PLANNING & EXECUTION*
- [ ] *No hardcoded sequences*: Follow-up 3 is not “Follow-up 3”. Decide based on state: no_reply + click = ROI calc, not generic bump.
- [ ] *Timezone-aware schedule*: Use BullMQ + Redis. Queue job for best local time per lead. From city of the lead know the timezone know heat time calculate all these in seconds then outreach AI shares in a day we habe.
- [ ] *Mimic human*: Vary email length, send time, structure. Not every email 9:03am. Some PS, some not.
- [ ] *Channel fluid*: Email → LinkedIn DM → call, based on where lead responds. Same memory across channels.

*LEAD LIFECYCLE & RE-ENGAGEMENT*
- [ ] *State machine enforced*: `new → active → replied → meeting → closed_won` OR `no_reply → nurture_hold → reengage_window`.
- [ ] *Cooldown rules*: “Not interested” = 45-90d cooldown. Re-ping only with new value. “Closed-lost” = 90d. “Ghosted” = 14-60d based on intent.
- [ ] *Never force touches*: If no trigger + no value, do nothing. Idleness is correct.
- [ ] *Never send to*: closed-won, unsubscribed, hard bounce, “stop contacting me”.
- [ ] *Closed loop*: If closed-won, move to onboarding DAG. Stop prospecting that lead.

*QUALITY & LEARNING*
- [ ] *Meeting quality gate*: No book unless BANT + intent score > threshold. Block “15-min chat?” to unqualified.
- [ ] *Post-call analysis*: Fathom → if junk meeting, downrank ICP + adjust targeting.
- [ ] *Learn from outcomes*: Every send/click/reply/meeting/close updates `ai_learning_patterns`. Bad subject → downrank globally.
- [ ] *Audit old code*: If logic from 1-6 months ago runs, shadow-test improvements before swap.

*AUTONOMOUS + MANUAL MERGE*
- [ ] *3 modes respected*: Manual = user sets steps, AI still verifies/listens/replies. Autonomous = AI owns DAG. Hybrid = guardrails + AI optimize.
- [ ] *AI never sleeps*: Even in Manual mode, if campaign ends but lead raises funding 2mo later, flag re-engage opportunity.
- [ ] *User toggle honored*: If “let AI adjust campaign” = OFF, run as-is. If ON, rewrite mid-flight based on data.

*DATA & PORTABILITY*
- [ ] *Store everything*: Even if UI hides it, backend has full event log + memory.
- [ ] *Exportable state*: All procedural + episodic memory can move. Client owns their brain.
- [ ] *Encrypt PII*: Sensitive fields encrypted at rest. Transcripts redacted before LLM.

*NON-NEGOTIABLES*
- [ ] *Never assume*: Data conflict = skip or ask. Better to miss send than wrong send.
- [ ] *Never fake*: No fake invoices, calendar links, “I was in your city” lines.
- [ ] *Never limit replies*: Sending quota ≠ reply quota. Answer $100k deal even if domain paused.
- [ ] *90-day unsupervised*: Must run 90+ even unless meeting notify them 90+ days with zero human click, handling OOO, bounces, objections, no-shows.
