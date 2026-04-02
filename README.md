<div align="center">

<img src="https://raw.githubusercontent.com/Sapheron/Open-Agent-CRM/main/docs/assets/logo.png" alt="Open Agent CRM" width="120" />

# Open Agent CRM

### The Open-Source WhatsApp AI CRM — Built for Real Businesses

**Self-hosted · AI-powered · WhatsApp-native · Multi-agent**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](LICENSE)
[![Stars](https://img.shields.io/github/stars/Sapheron/Open-Agent-CRM?style=flat-square&color=yellow)](https://github.com/Sapheron/Open-Agent-CRM/stargazers)
[![Forks](https://img.shields.io/github/forks/Sapheron/Open-Agent-CRM?style=flat-square)](https://github.com/Sapheron/Open-Agent-CRM/network)
[![Issues](https://img.shields.io/github/issues/Sapheron/Open-Agent-CRM?style=flat-square&color=red)](https://github.com/Sapheron/Open-Agent-CRM/issues)
[![Last Commit](https://img.shields.io/github/last-commit/Sapheron/Open-Agent-CRM?style=flat-square)](https://github.com/Sapheron/Open-Agent-CRM/commits/main)
[![Top Language](https://img.shields.io/github/languages/top/Sapheron/Open-Agent-CRM?style=flat-square)](https://github.com/Sapheron/Open-Agent-CRM)
[![Repo Size](https://img.shields.io/github/repo-size/Sapheron/Open-Agent-CRM?style=flat-square)](https://github.com/Sapheron/Open-Agent-CRM)

---

**A Sapheron Project** · Powered by **TechnoTaLim Platform and Services LLP**

Developed by **[ASHIK K I](https://github.com/ashik-k-i)**

---

[🚀 Install in one command](#-one-command-install) · [✨ Features](#-features) · [🏗 Architecture](#-architecture) · [📖 Docs](#-documentation) · [🤝 Contributing](#-contributing)

</div>

---

## What is Open Agent CRM?

Open Agent CRM is a **production-ready, self-hosted WhatsApp CRM** that puts an AI agent at the center of every customer conversation.

Instead of manually replying to hundreds of WhatsApp messages, your AI agent handles inquiries, qualifies leads, creates deals, generates payment links, and escalates to a human agent when needed — all automatically, all from a single dashboard you control.

**Everything is configured from the dashboard — no .env files for AI keys or payment credentials.**

---

## One-Command Install

**Mac / Linux:**
```bash
curl -fsSL https://openagentcrm.sapheron.com/install.sh | bash
```

**Windows:**
```powershell
powershell -c "irm https://openagentcrm.sapheron.com/install.ps1 | iex"
```

The installer is **fully idempotent** — re-run it anytime to update or repair. Each step checks if it's already done and asks to skip.

> **Requirements:** Docker, 2GB RAM, any Linux VPS or local machine

---

## Features

### 📲 WhatsApp Integration
- Connect multiple WhatsApp numbers via QR scan — no phone needed 24/7
- Baileys-based (WhatsApp Web protocol) + optional Cloud API fallback
- Real-time message delivery, read receipts, and status tracking
- Media support — images, video, audio, documents stored in MinIO
- **Warmup scheduler** — 6-stage daily limit progression to prevent bans
- Account-level session isolation with auto-reconnect

### 🤖 AI Agent
- Fully autonomous agent loop with tool-calling capabilities
- Supports **6 AI providers** — all configured from the dashboard, keys encrypted in DB
  | Provider | Models |
  |---|---|
  | **Google Gemini** | gemini-2.0-flash, gemini-1.5-pro, gemini-1.5-flash |
  | **OpenAI** | gpt-4o, gpt-4o-mini, gpt-4-turbo |
  | **Anthropic Claude** | claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5 |
  | **Groq** | llama-3.3-70b, mixtral-8x7b |
  | **Ollama** | any local model (llama3, mistral, phi3…) |
  | **OpenRouter** | 200+ models via unified API |
- **8 built-in AI tools:** create-lead, create-deal, create-task, move-deal-stage, create-payment-link, schedule-followup, update-contact, escalate-to-human
- Circuit breaker (Opossum) — auto-fallback if AI provider goes down
- Context builder with token counting and smart pruning
- Conversation FSM with 7 states:
  ```
  OPEN → AI_HANDLING → WAITING_HUMAN → HUMAN_HANDLING → RESOLVED → CLOSED
                                                                   ↘ SPAM
  ```

### 🧾 CRM Modules
| Module | Features |
|---|---|
| **Contacts** | Full-text search, tags, opt-out, phone normalization, custom fields |
| **Leads** | Status pipeline (NEW→WON/LOST), source tracking, score, estimated value |
| **Deals** | Kanban board, 16-stage pipeline, probability, won/lost tracking |
| **Tasks** | Priority, due dates, reminders, assigned agents |
| **Payments** | AI-generated payment links, status tracking, webhook processing |
| **Broadcasts** | Tag-based targeting, scheduled sends, warmup-aware delivery |
| **Analytics** | KPI dashboard, deal funnel, lead sources, agent performance |

### 👥 Team Inbox
- Multi-agent real-time inbox with WebSocket push
- Conversation assignment, claim, and escalation
- AI / Human toggle per conversation
- Role-based access: Super Admin → Admin → Manager → Agent
- Team invite with role assignment

### 💳 Payment Gateways
All configured from the dashboard — keys encrypted in database, never in .env:

| Gateway | Countries | Features |
|---|---|---|
| **Razorpay** | India | Payment links, webhooks, auto deal-won |
| **Stripe** | Global | Payment links, webhooks, auto deal-won |
| **Cashfree** | India | Payment links, webhooks |
| **PhonePe** | India | UPI payment pages |
| **PayU** | India | Payment pages, webhooks |

### 📊 Observability
- **Prometheus** — metrics scraping for API, Worker, Redis, Postgres
- **Grafana** — pre-provisioned dashboards and datasources
- **Loki** — centralized log aggregation
- **Health endpoint** — `/api/health` for Docker and uptime monitoring

### 🔒 Security
- JWT auth with 15-minute access tokens + 7-day refresh token rotation
- SHA-256 refresh token hashing — old token invalidated on use
- **AES-256-GCM encryption** for all AI/payment API keys in the database
- Company-scoped multi-tenancy — `CompanyScopeGuard` on every request
- Rate limiting via Throttler
- Audit logging for all sensitive actions
- GDPR-friendly: soft delete, opt-out, data purge

### 🐳 Self-Hosted & Open Source
- Single `docker compose up -d` deploys everything
- Traefik reverse proxy with auto Let's Encrypt SSL
- PgBouncer connection pooling
- Nightly PostgreSQL backups with configurable retention
- MIT licensed — fork it, customize it, run it yourself

---

## Architecture

```
                         ┌──────────────────────────────────┐
                         │          Dashboard (Next.js)      │
                         │   Inbox · CRM · Settings · Setup  │
                         └────────────┬─────────────────────┘
                                      │ HTTPS + WebSocket
                         ┌────────────▼─────────────────────┐
                         │           API (NestJS)            │
                         │  REST · WS Gateway · Guards       │
                         │  Auth · Contacts · Conversations  │
                         │  Leads · Deals · Tasks · Payments │
                         └──┬──────────────┬────────────────┘
                            │              │
              ┌─────────────▼──┐    ┌──────▼──────────────┐
              │  WhatsApp Svc  │    │   Worker (BullMQ)    │
              │  (Baileys)     │    │   AI Agent Loop      │
              │  QR · Sessions │    │   Tool Executor      │
              │  Media Upload  │    │   Broadcast Sender   │
              │  Outbound Sub  │    │   Cleanup · Warmup   │
              └───────┬────────┘    └──────┬───────────────┘
                      │                   │
              ┌───────▼───────────────────▼───────┐
              │           Redis (BullMQ + Pub/Sub) │
              └───────────────────────────────────┘
              ┌───────────────────────────────────┐
              │     PostgreSQL + PgBouncer        │
              └───────────────────────────────────┘
              ┌───────────────────────────────────┐
              │     MinIO (Media Storage)         │
              └───────────────────────────────────┘
```

### Monorepo Structure

```
Open-Agent-CRM/
├── apps/
│   ├── api/             # NestJS — REST API + WebSocket gateway
│   ├── dashboard/       # Next.js 15 — App Router dashboard
│   ├── whatsapp/        # Baileys service — sessions, inbound, outbound
│   └── worker/          # BullMQ — AI agent loop + background jobs
├── packages/
│   ├── database/        # Prisma schema (18 models), migrations, seed
│   └── shared/          # FSM, crypto utils, queue names, WS event types
├── deploy/
│   ├── docker-compose.yml        # Production stack
│   ├── docker-compose.dev.yml    # Local dev (postgres + redis + minio)
│   ├── install.sh                # Mac/Linux one-command installer
│   ├── install.ps1               # Windows one-command installer
│   ├── traefik/                  # Traefik reverse proxy config
│   ├── prometheus/               # Prometheus scrape config
│   ├── grafana/                  # Grafana provisioning
│   └── loki/                     # Loki log aggregation config
└── .github/workflows/
    └── ci.yml                    # Lint → Test → Build → Docker push
```

---

## Tech Stack

<table>
<tr>
<td valign="top" width="33%">

**Backend**
- NestJS 10 (TypeScript)
- Prisma ORM + PostgreSQL 16
- Redis 7 + BullMQ
- Socket.io WebSockets
- Baileys (WhatsApp Web)
- Passport.js + JWT
- Opossum (circuit breaker)

</td>
<td valign="top" width="33%">

**Frontend**
- Next.js 15 (App Router)
- Tailwind CSS + shadcn/ui
- Zustand (state)
- TanStack Query
- Recharts (charts)
- dnd-kit (kanban)
- Socket.io client

</td>
<td valign="top" width="33%">

**Infrastructure**
- Docker + Docker Compose
- Traefik (reverse proxy + SSL)
- PgBouncer (connection pool)
- MinIO (S3-compatible storage)
- Prometheus + Grafana
- Loki (log aggregation)
- GitHub Actions CI/CD

</td>
</tr>
</table>

---

## Getting Started (Development)

### Prerequisites
- Node.js 20+
- pnpm 9+
- Docker + Docker Compose

### 1. Clone

```bash
git clone https://github.com/Sapheron/Open-Agent-CRM.git
cd Open-Agent-CRM
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Start infrastructure

```bash
docker compose -f deploy/docker-compose.dev.yml up -d
```

### 4. Set up environment

```bash
cp .env.example .env
# Edit .env — only infra config needed here.
# AI keys and payment keys are set from the dashboard.
```

### 5. Run migrations & seed

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

### 6. Start development servers

```bash
pnpm dev
```

| Service | URL |
|---|---|
| Dashboard | http://localhost:3001 |
| API | http://localhost:3000/api |
| API Docs (Swagger) | http://localhost:3000/api/docs |
| Grafana | http://localhost:3002 |
| MinIO Console | http://localhost:9001 |

---

## Configuration

Only **infrastructure** goes in `.env`. All AI and payment keys are set from the dashboard and stored encrypted in the database.

```env
# Infrastructure only — see .env.example for full list
DATABASE_URL=postgresql://crm:password@pgbouncer:5432/wacrm
REDIS_URL=redis://redis:6379
JWT_SECRET=<generated>
ENCRYPTION_KEY=<32-byte hex — used to encrypt AI/payment keys in DB>
MINIO_ENDPOINT=minio
```

> **AI providers, payment gateways, and WhatsApp accounts are all configured from the dashboard Setup Wizard after first login.**

---

## Production Deployment

### One command (recommended)

```bash
curl -fsSL https://openagentcrm.sapheron.com/install.sh | bash
```

The installer will:
1. Detect your OS and install Docker if needed
2. Clone the repo to `/opt/openagentcrm`
3. Interactively generate your `.env` (domain, admin email, password)
4. Pull and build Docker images
5. Start infrastructure (postgres, redis, minio, pgbouncer)
6. Run database migrations
7. Seed the admin user
8. Start all services with Traefik SSL

### Manual deployment

```bash
git clone https://github.com/Sapheron/Open-Agent-CRM.git /opt/openagentcrm
cd /opt/openagentcrm
cp .env.example .env     # fill in your values
docker compose -f deploy/docker-compose.yml up -d
```

---

## Roadmap

- [x] Turborepo monorepo scaffold
- [x] Prisma schema (18 models, full CRM)
- [x] Shared package (FSM, crypto, queue names, WS types)
- [x] NestJS API — auth, guards, interceptors, Swagger
- [x] JWT with refresh token rotation
- [x] AES-256-GCM credential encryption
- [x] Company-scoped multi-tenancy
- [x] WebSocket gateway (real-time events)
- [x] CRM modules — contacts, conversations, leads, deals, tasks, payments
- [x] Analytics module
- [x] Team module with invite + roles
- [x] Broadcast module with BullMQ queue
- [x] AI settings (6 providers, live test, model list)
- [x] Payment settings (5 gateways, webhook handler)
- [x] WhatsApp settings (account management)
- [x] Baileys WhatsApp service (sessions, QR, inbound, outbound)
- [x] Redis pub/sub for QR streaming to dashboard
- [x] MinIO media storage for inbound media
- [x] AI provider adapters (Gemini, OpenAI, Anthropic, Groq, Ollama, OpenRouter)
- [x] Tool system (8 tools with ToolRegistry + ToolExecutor)
- [x] AI agent loop with circuit breaker + FSM integration
- [x] BullMQ processors (AI, broadcast, reminder, follow-up, cleanup, payment-check, warmup-reset)
- [x] Next.js 15 dashboard — all pages implemented
- [x] Setup wizard (6-step onboarding)
- [x] Prometheus + Grafana + Loki observability stack
- [x] Docker Compose production stack with Traefik SSL
- [x] Idempotent one-command installer (Mac/Linux + Windows)
- [x] GitHub Actions CI/CD pipeline
- [ ] Email notifications for task reminders
- [ ] WhatsApp Cloud API support
- [ ] Mobile app (React Native)
- [ ] Plugin / webhook system for external integrations
- [ ] White-label support
- [ ] Multi-language AI responses

---

## Security

Open Agent CRM is built with security-first principles:

- **Encrypted credentials** — AI provider keys and payment gateway keys are encrypted with AES-256-GCM before storing in the database. The encryption key never leaves your `.env`.
- **JWT hardening** — 15-minute access tokens, 7-day refresh tokens. Refresh tokens are stored as SHA-256 hashes and invalidated on every rotation.
- **Multi-tenancy isolation** — `CompanyScopeGuard` injects `companyId` from JWT into every request. Cross-company data access is impossible.
- **Rate limiting** — Throttler on all API endpoints.
- **Audit logs** — All sensitive actions (login, key updates, permission changes) are logged with before/after values.
- **GDPR** — Soft delete for contacts, opt-out support, 90-day hard purge via cleanup processor.

---

## Contributing

Contributions are welcome and appreciated.

```bash
# Fork → clone → branch → PR
git checkout -b feature/your-feature
git commit -m "feat: your feature"
git push origin feature/your-feature
# Open a Pull Request on GitHub
```

Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) before submitting a PR.

---

## Disclaimer

Open Agent CRM is an **independent open-source project** and is **not affiliated with, endorsed by, or sponsored by WhatsApp, Meta, OpenAI, Google, Anthropic, Stripe, Razorpay, Cashfree, PhonePe, PayU, or any other third-party provider**.

Users are solely responsible for complying with:
- WhatsApp Terms of Service and Business Policy
- Applicable local laws and data protection regulations (GDPR, PDPA, IT Act, etc.)
- AI provider usage policies
- Payment provider terms of service

---

## License

This project is licensed under the **[MIT License](LICENSE)**.

---

<div align="center">

## Built by

<table>
<tr>
<td align="center" width="200">
<br/>
<b>ASHIK K I</b><br/>
<sub>Creator & Lead Developer</sub><br/>
<a href="https://github.com/ashikki">@ashik-k-i</a>
<br/>
</td>
<td align="center" width="200">
<br/>
<b>SANWEER K T</b><br/>
<sub>Contributor</sub><br/>
<a href="https://github.com/listenermedia">@listenermedia</a>
<br/>
</td>
</tr>
</table>

<br/>

**A [Sapheron](https://sapheron.com) Project**

*Sapheron is a product and technology brand under*

**TechnoTaLim Platform and Services LLP**

<br/>

[![GitHub](https://img.shields.io/badge/GitHub-Sapheron%2FOpen--Agent--CRM-181717?style=flat-square&logo=github)](https://github.com/Sapheron/Open-Agent-CRM)
[![Website](https://img.shields.io/badge/Website-openagentcrm.sapheron.com-blue?style=flat-square)](https://openagentcrm.sapheron.com)

<br/>

---

*If this project helped you, please consider giving it a ⭐ — it helps others discover it.*

[![Star History Chart](https://api.star-history.com/svg?repos=Sapheron/Open-Agent-CRM&type=Date)](https://star-history.com/#Sapheron/Open-Agent-CRM&Date)

<br/>

<p>
  <a href="https://github.com/Sapheron/Open-Agent-CRM/issues">🐛 Report Bug</a> ·
  <a href="https://github.com/Sapheron/Open-Agent-CRM/issues">💡 Request Feature</a> ·
  <a href="https://github.com/Sapheron/Open-Agent-CRM/discussions">💬 Discussions</a> ·
  <a href="https://openagentcrm.sapheron.com/install.sh">📦 Install Script</a>
</p>

<br/>

<sub>© 2025 TechnoTaLim Platform and Services LLP · MIT License</sub>

</div>
