# audnixai.com - Intelligent Sales Automation Platform

## Overview

audnixai.com is a full-stack SaaS platform that serves as an autonomous AI sales representative. The system automates lead engagement across Instagram and Email channels with human-like timing and personalized voice messages. Core capabilities include AI-powered conversation handling, voice cloning for personalized audio messages, lead scoring, objection handling (110+ scripts), and automated meeting booking.

The platform targets creators, coaches, agencies, and founders who need 24/7 sales automation without manual follow-up overhead.

## Recent Changes (February 2026)

- Migrated database connection from Neon Serverless to Replit's built-in PostgreSQL (drizzle-orm/node-postgres with pg driver)
- Removed cross-env dependency from npm scripts (using native NODE_ENV= on Linux)
- Fixed SSL/connection string handling for Replit PostgreSQL in session store
- Pushed database schema via drizzle-kit
- Configured deployment for autoscale with build and start commands

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript, built using Vite
- **Styling**: Tailwind CSS with shadcn/ui component library (New York style)
- **Animations**: Framer Motion for UI transitions, GSAP for advanced animations
- **3D Graphics**: React Three Fiber with Drei helpers for landing page effects
- **State Management**: TanStack React Query for server state
- **Forms**: React Hook Form with Zod validation via @hookform/resolvers
- **Routing**: Client-side routing with lazy-loaded dashboard pages
- **Path Aliases**: `@/` maps to `client/src/`, `@shared/` maps to `shared/`

### Backend Architecture
- **Runtime**: Node.js 22.x with Express.js
- **Language**: TypeScript with ES modules (tsx for execution)
- **API Design**: RESTful endpoints under `/api/` prefix
- **Session Management**: PostgreSQL-backed sessions via connect-pg-simple
- **Rate Limiting**: Custom middleware for API and auth endpoints
- **Background Workers**: Follow-up scheduling, email warmup, video comment monitoring, payment auto-approval

### Database Layer
- **Primary Database**: PostgreSQL via Replit's built-in database
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Schema Location**: `shared/schema.ts` (shared between client and server)
- **Migrations**: SQL files in `migrations/` directory, executed via drizzle-kit
- **Connection**: Uses `drizzle-orm/node-postgres` with the `pg` package

### Authentication System
- **Primary Provider**: Supabase Auth (Google OAuth, Email OTP)
- **Session Storage**: PostgreSQL-backed Express sessions
- **Admin Management**: Email whitelist for admin access
- **Token Handling**: Supabase JWT verification with service role for admin operations

### AI and ML Services
- **Conversation AI**: Google Gemini 2.0 Flash for chat responses and lead analysis (updated from 1.5)
- **Voice Cloning**: ElevenLabs API for personalized voice message generation
- **Lead Scoring**: AI-powered quality scoring with 95%+ threshold
- **Scraping Capability**: Scaled to 1,000,000 leads with Gemini 2.0 intent analysis and advanced proxy rotation simulation

### Lead Prospecting Engine
- **Data Sources**: Google Search, Bing Search, Instagram, YouTube (HTML scraping, no API keys required)
- **Volume**: 500-2000 leads per scan
- **Quality Assurance**: SMTP verification, MX record checks, duplicate prevention
- **Email Intelligence**: Personal email prioritization, founder email detection, generic email filtering

## External Dependencies

### Required Services
- **Supabase**: Authentication, realtime subscriptions, and admin client
  - Environment: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- **Neon Database**: PostgreSQL hosting
  - Environment: `DATABASE_URL`
- **Google Gemini**: AI conversation and analysis
  - Environment: `GEMINI_API_KEY`

### Optional Integrations
- **ElevenLabs**: Voice cloning and audio generation
  - Environment: `ELEVENLABS_API_KEY`
- **Stripe**: Payment processing via payment links (no direct API integration)
  - Environment: `STRIPE_PAYMENT_LINK_*` variables for each plan
- **Redis**: Background job queues and caching
  - Environment: `REDIS_URL`
- **Google OAuth**: Calendar integration for meeting booking
  - Environment: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- **Instagram**: Channel integrations via OAuth and webhooks
  - Environment: `META_APP_ID`, `META_APP_SECRET`, `META_CALLBACK_URL`

### Deployment Targets
- **Vercel**: Primary deployment with serverless functions (`vercel.json` configuration)
- **Railway**: Alternative deployment with Nixpacks (`railway.json` configuration)
- **Replit**: Development environment with custom Vite plugins

### Build Configuration
- **Vite**: Frontend bundler with React plugin
- **Output**: `dist/public/` for static assets
- **Development Server**: Port 5000 with HMR disabled for stability
