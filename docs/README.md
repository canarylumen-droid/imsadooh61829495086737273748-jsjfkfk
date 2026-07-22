# Audnix Documentation

Audnix is an email outreach and campaign platform. It consists of a React SPA client (Vite), Node.js Express API gateway (PM2), MySQL database, and Rust services for email sending and IMAP monitoring.

## Architecture Overview

```
┌─────────────┐     ┌───────────────┐     ┌───────────┐
│  React SPA   │────▶│ API Gateway    │────▶│  MySQL DB  │
│  (Vite/S3)   │◀────│ (Express/PM2)  │     └───────────┘
└─────────────┘     └───────┬───────┘
                            │
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                 ▼
   ┌──────────┐     ┌──────────────┐     ┌───────────┐
   │ Socket.IO│◀───▶│ Redis Pub/Sub │◀───▶│  Workers  │
   │  Server  │     └──────────────┘     │  (16x)    │
   └──────────┘           │              └───────────┘
                          │                     │
                          ▼                     ▼
                   ┌──────────────┐     ┌─────────────┐
                   │ Rust Email   │     │ Rust IMAP   │
                   │ Sender (SMTP)│     │ Worker (IDLE)│
                   └──────────────┘     └─────────────┘
```

## Service Map (17 PM2 Services)

| ID | Name | Purpose |
|---|---|---|
| 0 | api-gateway | Express HTTP API |
| 1 | socket-server | Socket.IO real-time |
| 2 | worker-email | Email sending orchestration |
| 3 | worker-imap | Gmail/Outlook OAuth IMAP |
| 4 | worker-warmup | Warmup engine |
| 5 | worker-ai | AI enrichment, features |
| 6 | worker-billing | Subscription management |
| 7 | worker-outreach | Campaign sending |
| 8 | worker-lead-recovery | Lead re-engagement |
| 9 | worker-orchestrator | Cross-worker coordination |
| 10 | worker-audit | Audit logging |
| 11 | worker-social | Social media monitoring |
| 12 | worker-knowledge | Knowledge base AI |
| 13 | worker-rag | RAG pipeline |
| 14 | worker-vectordb | Vector DB sync |
| 15 | worker-infra-scaler | Auto-scaling |
| 16 | worker-deliverability | Deliverability monitoring |
| R1 | rust-email-sender | SMTP email sending (Rust) |
| R2 | rust-imap-worker | Custom email IMAP IDLE (Rust) |

## Tech Stack

- **Frontend**: React 18, shadcn/ui, Tailwind CSS, Recharts, React Query, Socket.IO client
- **API Gateway**: Node.js 20, Express, tsx (TypeScript execution), PM2
- **Real-Time**: Socket.IO (WebSocket), Redis pub/sub cluster, Redis BRPOP for worker queues
- **Database**: MySQL 8 (Aurora/RDS), Drizzle ORM, Knex migrations
- **Email**: Rust SMTP sender (lettre), Rust IMAP worker (async-imap), Node.js IMAP (gmail/outlook OAuth)
- **Queue**: BullMQ (Redis-backed), Redis BRPOP/LPUSH for Rust interop
- **Storage**: S3 (audnix-app-uploads, us-east-1)
- **Auth**: Session cookies (PostgreSQL `user_sessions` via connect-pg-simple), API keys (SHA-512 + AES-256-GCM)
- **Realtime**: Redis pub/sub cluster events → Socket.IO relay to clients
- **Workers**: 16 Node.js workers + 2 Rust services, all PM2-managed

## Quick Reference

### Key Commands
```bash
# Development
npx vite                    # Start client dev server
npx tsx watch src/index.ts  # Start API gateway (dev)
pm2 logs                    # View all logs

# Build & Deploy
npx vite build              # Build client
cargo build --release       # Build Rust services
pm2 restart all             # Restart everything

# Debug
redis-cli MONITOR           # Watch Redis events
pm2 logs --lines 50 --nostream | grep -i error  # Find errors
```

### Key Ports
| Service | Port |
|---|---|
| API Gateway | 3001 |
| Socket Server | 3002 |
| MySQL | 3306 |
| Redis | 6379 |
| Client (dev) | 5173 |

### Key URLs
- App: `https://audnixai.com`
- API: `https://audnixai.com/api`
- Developer Docs: `https://audnixai.com/developer`
- MCP Server: `https://audnixai.com/dashboard/mcp-server`

## Documentation Index

| File | Description |
|---|---|
| [architecture.md](architecture.md) | Full system architecture, data flows |
| [auth.md](auth.md) | Authentication, sessions, API keys |
| [warmup.md](warmup.md) | Warmup engine, seed monitoring, reply chain |
| [inbox.md](inbox.md) | Inbox, leads, messaging, IMAP sync |
| [deliverability.md](deliverability.md) | Email placement tracking, deliverability |
| [campaigns.md](campaigns.md) | Outreach campaigns, scheduling |
| [import.md](import.md) | CSV/bulk import pipeline |
| [lead-recovery.md](lead-recovery.md) | Lead recovery system |
| [api.md](api.md) | Full API reference |
| [deployment.md](deployment.md) | EC2 deployment, PM2, CI/CD |
| [realtime.md](realtime.md) | Socket.IO + Redis pub/sub events |
| [rust.md](rust.md) | Rust services (email sender, IMAP worker) |
| [errors.md](errors.md) | Error handling, troubleshooting, known issues |
| [ai.md](ai.md) | AI features, providers, brand knowledge |
| [developer.md](developer.md) | Developer docs, MCP server, SDK examples |
| [integrations.md](integrations.md) | Mailbox management, DNS verification |
| [deals.md](deals.md) | Deals pipeline |
| [calendar.md](calendar.md) | Calendar + scheduling |
| [ui.md](ui.md) | UI guide, pages, mobile, performance |
