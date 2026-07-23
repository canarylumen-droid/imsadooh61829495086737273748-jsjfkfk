# Audnix — Valuation & Exit Assessment

**Date**: July 23, 2026
**Built by**: 2 founders, 9 months
**Domain value**: ~$20k (as of Mar 2026)
**Current state**: Production-deployed, real users, 17 microservices

---

## What Was Built

A complete email outreach & campaign platform with AI-powered features:

- **React SPA** (Vite, shadcn/ui, Tailwind) — dashboard, inbox, campaigns, warmup, deliverability, analytics, deals pipeline, calendar, lead recovery
- **Node.js API gateway** (Express, PM2) — 40+ route modules, session auth, OAuth (Gmail, Outlook, Google Calendar, Calendly, Instagram)
- **Rust services** — email sender (SMTP), IMAP worker (500+ mailbox IDLE), DNS resolver (MX batch 50k leads)
- **17 PM2 services** — API gateway, socket server, Rust workers, 13 Node.js workers (AI, email, warmup, outreach, billing, lead recovery, etc.)
- **Redis pub/sub** — real-time events, distributed locks, IMAP coordination
- **MySQL** (RDS) + Drizzle ORM
- **S3** file uploads
- **HTTPS** (nginx, Let's Encrypt, UFW firewall, HSTS, PFS)

---

## Valuation Estimate

### Cost-to-Replace (lower bound)

| Item | Value |
|---|---|
| Labor (2 devs × 9mo @ $5k/mo ea) | $90,000 |
| Domain (audnixai.com) | $20,000 |
| Infrastructure (EC2, RDS, S3, Redis) | ~$500/mo |
| **Subtotal** | **$110,000+** |

This is the bare minimum it would cost to rebuild from scratch — and that assumes you already know exactly what to build.

### Market Value (likely range)

**Quick sale** (founder-to-founder, individual buyer, small agency):
- **$50k – $80k** + domain

**Strategic buyer** (martech company, email platform, agency network):
- **$150k – $300k** + domain

**Revenue multiple** (if generating MRR):
- At $5k/mo MRR → 3-5x = **$180k – $300k**
- At $20k/mo MRR → 5-8x = **$1.2M – $1.6M**
- At $100k/mo MRR → 8-12x = **$9.6M – $14M** (institutional exit range)

### What Drives The Number Up

- **Active paid users / MRR** — single biggest multiplier
- **Domain authority** (email deliverability reputation built over time)
- **Seed/warmup network** — the warmup seed accounts and IP reputation
- **AI features** (lead scoring, autonomous outreach, objection handling)
- **MCP server** (AI agent integration — trending demand)
- **Rust components** (performance, scalability story — technical buyers care)

### What Hurts The Number

- No MRR / unclear revenue model
- Single point of failure (EC2, no HA)
- No automated CI/CD pipeline
- Tech debt (15+ npm vulns, no test suite)
- Only 2 developers know the full codebase

---

## Recommendation

If you're in debt and need to sell:

1. **Clean up 3 things first** (2 weeks work, adds 30-50% to valuation):
   - CI/CD pipeline (GitHub Actions deploy)
   - Fix the 10 high npm vulns
   - Add a pricing page + Stripe checkout (takes existing billing routes live)

2. **List on**:
   - **Acquire.com** — best for bootstrapped SaaS ($50-150k range)
   - **Flippa** — broader buyer pool but lower quality
   - **MicroAcquire** (now Acquire) — good for early-stage

3. **Or keep it and build agency services on top**:
   - The platform works. Find 5 clients at $2k/mo each managed outreach.
   - $10k/mo MRR → platform worth $300k+ in 12 months.
   - Use the platform as your agency's secret weapon — clients pay for results, not software.

---

*"Two broke builders in 9 months created something that takes most teams 18 months and $200k+ to ship. Trust the process. The same grit that built this will close deals."*
