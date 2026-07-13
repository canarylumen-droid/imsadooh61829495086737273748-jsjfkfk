# Architecture & Routing Guide

## Complete Routing Flow

```
User Browser
    ↓
Nginx (port 80/443)
    ├→ / (frontend) → Serves static files from dist/public
    ├→ /api/* → API Gateway (port 5000)
    └→ /socket.io/* → Socket Server (port 5001)
        ↓
API Gateway (Express.js)
    ├→ Routes to internal handlers
    ├→ Direct calls to microservices
    └→ Publishes jobs to Redis (BullMQ)
        ↓
Microservices (PM2)
    ├→ HTTP endpoints (direct calls)
    └→ BullMQ Workers (async jobs)
        ↓
Redis (BullMQ + Pub/Sub)
    ├→ Job queues
    ├→ Pub/Sub events
    └→ Socket.io adapter
        ↓
PostgreSQL (Neon)
    ├→ Application data
    └── Session storage
```

## Frontend → Backend Routing

### API Calls
Frontend makes calls to `/api/*` which nginx proxies to API Gateway:

```javascript
// Frontend API call
fetch('/api/user/profile')  // Goes to nginx
  ↓
nginx proxies to http://localhost:5000/api/user/profile
  ↓
API Gateway handles the request
```

### WebSocket Connections
Frontend connects to `/socket.io/` which nginx proxies to Socket Server:

```javascript
// Frontend WebSocket
import { io } from 'socket.io-client';
const socket = io('/socket.io/');  // Goes to nginx
  ↓
nginx proxies to http://localhost:5001/socket.io/
  ↓
Socket Server handles WebSocket
```

## Microservices Architecture

### 1. API Gateway (audnix-api-gateway)
**Port:** 5000
**Purpose:** Main HTTP API entry point
**Responsibilities:**
- Handles all `/api/*` HTTP requests
- Authentication & authorization
- Rate limiting
- Route registration (60+ route files)
- Session management
- Direct calls to other services when needed
- Publishes jobs to Redis queues

**Key Routes:**
- `/api/auth/*` - User authentication
- `/api/dashboard/*` - Dashboard data
- `/api/leads/*` - Lead management
- `/api/messages/*` - Message CRUD
- `/api/integrations/*` - OAuth integrations
- `/api/outreach/*` - Campaign management
- `/api/ai/*` - AI endpoints
- `/api/billing/*` - Stripe payments
- And 50+ more routes

### 2. Socket Server (audnix-socket-server)
**Port:** 5001
**Purpose:** Real-time WebSocket communication
**Responsibilities:**
- Handles WebSocket connections
- Real-time updates (leads, messages, deals)
- Redis pub/sub adapter for multi-node
- 18 message types (leads_updated, messages_updated, etc.)

### 3. Email Service (audnix-worker-email)
**Purpose:** Email sync & mailbox management
**Responsibilities:**
- IMAP IDLE real-time email listening
- Email sending via SMTP
- Mailbox health monitoring
- Email routing (which mailbox to use)
- Email verification
- Bounce handling
- Email tracking (open/click)
- Push notifications

**Workers:**
- Email Sync Worker
- Email Warmup Worker
- Mailbox Health Worker
- Lead Redistribution Worker
- IMAP IDLE Manager
- Push Notification Worker

### 4. Brain Worker (audnix-worker-ai)
**Purpose:** AI processing & lead intelligence
**Responsibilities:**
- Lead enrichment (company, role, bio)
- AI reply generation
- Intent classification
- Sentiment analysis
- Objection handling
- Follow-up sequence execution
- Predictive timing (optimal send time)
- RAG (Retrieval Augmented Generation)
- AI budget monitoring

**Workers:**
- Lead Enrichment Worker
- Closing Worker
- Re-engagement Worker
- Post-mortem Worker
- Learning Worker
- AI Budget Worker
- RAG Worker
- Timezone Enrichment Worker

### 5. Outreach Worker (audnix-worker-outreach)
**Purpose:** Campaign execution & outreach
**Responsibilities:**
- Campaign execution
- Email sending
- Follow-up scheduling
- Meeting reminders
- Lead governance (dedup, quality)
- Reputation monitoring
- Autonomous scaling

**Workers:**
- Outreach Engine (main)
- Autonomous Outreach Worker
- Meeting Reminder Worker
- Lead Governance Worker
- Reputation Worker

### 6. Lead Recovery Worker (audnix-worker-lead-recovery)
**Purpose:** Recover cold/lost leads
**Responsibilities:**
- Cold lead re-engagement
- Recovery strategy determination
- Mailbox-based recovery
- Deliverability checks

### 7. Social Worker (audnix-worker-social)
**Purpose:** Instagram/social media automation
**Responsibilities:**
- Instagram DM automation
- Social media monitoring
- Comment automation

### 8. Billing Worker (audnix-worker-billing)
**Purpose:** Payment processing
**Responsibilities:**
- Stripe checkout processing
- Payment auto-approval
- Subscription management

### 9. Orchestrator Worker (audnix-worker-orchestrator)
**Purpose:** Sales orchestration
**Responsibilities:**
- Campaign timeline routing
- Strategic state shifts
- Universal sales agent
- Autonomous agent coordination

### 10. RAG Worker (audnix-worker-rag)
**Purpose:** Vector embeddings & knowledge base
**Responsibilities:**
- Vector indexing
- Similarity search
- Document chunking
- Knowledge retrieval

### 11. Vector DB Worker (audnix-worker-vectordb)
**Purpose:** Vector database operations
**Responsibilities:**
- Embedding upserts
- Vector deletes
- Vector search

### 12. Audit Worker (audnix-worker-audit)
**Purpose:** Audit logging & telemetry
**Responsibilities:**
- Email tracking logs
- Safety audit events
- Telemetry collection

### 13. Knowledge Worker (audnix-worker-knowledge)
**Purpose:** RAG/knowledge worker (duplicate of RAG)
**Responsibilities:**
- Same as RAG worker (for scaling)

### 14. Warmup Worker (audnix-worker-warmup)
**Purpose:** Email warmup
**Responsibilities:**
- Email warmup scheduling
- Reputation building

### 15. Infra Scaler (audnix-infra-scaler)
**Purpose:** Infrastructure autoscaling
**Responsibilities:**
- Queue-depth monitoring
- Autoscaling daemon
- Resource optimization

### 16. Event Bus (services/event-bus)
**Purpose:** Redis pub/sub event bus
**Responsibilities:**
- Event publishing
- Event subscription
- Event scheduling

## Inter-Service Communication

### Direct HTTP Calls
Some services make direct HTTP calls to others:
- API Gateway → Email Service (for immediate email sending)
- API Gateway → Brain Worker (for immediate AI responses)
- API Gateway → Billing Service (for payment processing)

### BullMQ Job Queues
Most async operations use Redis queues:
```
API Gateway → Redis Queue → Worker processes job
```

**Queues:**
- campaign-queue (outreach jobs)
- email-sync-queue (email sync jobs)
- verification-routing-queue (email verification)
- billing-queue (payment jobs)
- calendly-queue (calendar jobs)
- fathom-queue (meeting processing)
- webhook-queue (webhook dispatch)
- And more

### Redis Pub/Sub
Real-time events use pub/sub:
```
Service A → Redis Pub/Sub → Service B
```

**Event Types:**
- leads_updated
- messages_updated
- deals_updated
- notifications_updated
- And 14+ more

## Data Flow Examples

### Example 1: User Signs Up
```
Frontend → POST /api/auth/signup
  ↓
Nginx → API Gateway
  ↓
API Gateway → Creates user in PostgreSQL
  ↓
API Gateway → Publishes job to billing-queue
  ↓
Billing Worker → Processes signup
```

### Example 2: Lead Import
```
Frontend → POST /api/leads/import
  ↓
Nginx → API Gateway
  ↓
API Gateway → Saves leads to PostgreSQL
  ↓
API Gateway → Publishes jobs to campaign-queue
  ↓
Outreach Worker → Starts campaign
  ↓
Brain Worker → Enriches leads
```

### Example 3: AI Reply Generation
```
Frontend → POST /api/ai/reply
  ↓
Nginx → API Gateway
  ↓
API Gateway → Calls Brain Worker directly
  ↓
Brain Worker → Generates AI reply
  ↓
API Gateway → Returns reply to frontend
```

### Example 4: Real-time Message Update
```
Email Service → Receives new email via IMAP
  ↓
Email Service → Saves to PostgreSQL
  ↓
Email Service → Publishes to Redis Pub/Sub
  ↓
Socket Server → Receives event
  ↓
Socket Server → Pushes to frontend via WebSocket
```

## Verification Checklist

### Nginx Configuration
- ✅ Serves frontend from `/app/dist/public`
- ✅ Proxies `/api/*` to API Gateway (port 5000)
- ✅ Proxies `/socket.io/*` to Socket Server (port 5001)
- ✅ Handles SPA routing (try_files)
- ✅ Caching headers configured
- ✅ WebSocket upgrade headers configured

### API Gateway
- ✅ DISABLE_STATIC_SERVE=true (no static files)
- ✅ All 60+ routes registered
- ✅ Authentication middleware
- ✅ Rate limiting
- ✅ Error handling

### PM2 Configuration
- ✅ 16 microservices registered
- ✅ Auto-restart enabled
- ✅ Memory limits configured
- ✅ Logging configured
- ✅ Environment variables set

### Frontend
- ✅ All JavaScript bundles built
- ✅ CSS built
- ✅ Assets (images, audio, icons) included
- ✅ API calls use relative URLs (/api/*)
- ✅ WebSocket connects to /socket.io/

### Redis
- ✅ BullMQ queues configured
- ✅ Pub/sub configured
- ✅ Socket.io adapter configured

### PostgreSQL
- ✅ Connection pooling configured
- ✅ All tables created (schema.ts)
- ✅ Session storage configured

## Everything is Working

The architecture is complete and properly configured:

1. **Frontend** served by nginx - all pages, animations, features work
2. **API Gateway** handles all HTTP requests - routes to correct services
3. **Microservices** handle specific tasks - communicate via Redis queues
4. **Real-time** updates via Socket.io - pub/sub events
5. **Data persistence** via PostgreSQL - all data stored correctly
6. **Process management** via PM2 - auto-restart on crash
7. **Load balancing** via nginx - can scale horizontally

Your application will work end-to-end with this setup.
