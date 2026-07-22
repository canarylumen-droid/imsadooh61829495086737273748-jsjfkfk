# Audnix Documentation

> **Migrated to `docs/` folder** — comprehensive documentation for all subsystems.

| Document | Description |
|---|---|
| [docs/README.md](docs/README.md) | Overview, service map, tech stack |
| [docs/architecture.md](docs/architecture.md) | Full system architecture, communication patterns |
| [docs/auth.md](docs/auth.md) | Auth flow, sessions, API keys, account deletion |
| [docs/warmup.md](docs/warmup.md) | Warmup engine, seed monitoring, reply chain |
| [docs/inbox.md](docs/inbox.md) | Inbox, leads, messages, AI features |
| [docs/deliverability.md](docs/deliverability.md) | Email placement tracking, deliverability |
| [docs/campaigns.md](docs/campaigns.md) | Outreach campaigns, scheduling, coexistence |
| [docs/import.md](docs/import.md) | CSV/bulk import pipeline, MX batch queue |
| [docs/lead-recovery.md](docs/lead-recovery.md) | Lead recovery system, noise filtering |
| [docs/api.md](docs/api.md) | Full API reference, socket events, error codes |
| [docs/deployment.md](docs/deployment.md) | EC2 deployment, PM2, CI/CD, SSH key mgmt |

## Quick Stats

- **~4.5k lines** total documentation across 12 files
- **18** PM2 services (16 Node.js + 2 Rust)
- **50+** database tables
- **80+** API endpoints
- **40+** socket event handlers across dashboard pages

## What's Covered

- ✅ Architecture & system design
- ✅ Auth (session, cookies, API keys, OAuth, account deletion)
- ✅ Warmup engine (seeds, threads, IMAP stealth, stagger, spam tracking)
- ✅ Inbox & lead management (filtering, tick indicators, real-time, drafts)
- ✅ Deliverability (placement tracking, spam detection, seed monitoring, SMTP telemetry)
- ✅ Campaigns (sequences, broadcasts, coexistence, per-mailbox routing)
- ✅ Import pipeline (CSV parsing, MX batch, smart routing, dedup)
- ✅ Lead recovery (event-driven, noise filtering, AI analysis)
- ✅ Full API reference with curl-ready examples
- ✅ Deployment guide (EC2, PM2, SSH, Rust compilation)
- ✅ Known issues & workarounds (encryption key crisis, PM2 env traps)
