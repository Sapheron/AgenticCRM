<div align="center">

# ⚡ Open Agent CRM

### The Self-Hosted WhatsApp CRM You Run Entirely by Chatting With an AI

**Self-hosted · AI-powered · WhatsApp-native · Multi-tenant**

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

[🚀 Install](#one-command-install) · [✨ Features](#features) · [🏗 Architecture](#architecture) · [🛠 Tech Stack](#tech-stack) · [🚦 Roadmap](#roadmap) · [🤝 Contributing](#contributing)

</div>

---

## What is Open Agent CRM?

Open Agent CRM is a **self-hosted WhatsApp CRM that you run by chatting with an AI**. Instead of clicking through forms to create leads, move deals, schedule tasks, or send broadcasts, you open the admin chat, describe what you want in plain English, and the AI calls the right CRM actions for you.

Under the hood it's a complete CRM — contacts, leads, deals, tasks, pipelines, products, quotes, invoices, payments, sequences, templates, broadcasts, campaigns, forms, workflows, tickets, knowledge base, documents, analytics, reports — with WhatsApp as the primary outbound channel and an AI agent layered on top of every module.

**Two ways to talk to the AI:**

1. **The `/chat` dashboard page** — the primary interface. Type naturally; the AI uses **~169 registered CRM tools** to do the work (~55 exposed by default, the rest callable on demand).
2. **Optional auto-reply on inbound WhatsApp** — off by default. Flip `autoReplyEnabled` in Settings → AI and the same agent loop will respond to inbound customer WhatsApp messages using those tools.

All credentials — AI provider keys, payment gateway keys, WhatsApp accounts — live in the database, encrypted with AES-256-GCM. The only things in `.env` are infrastructure URLs and a master encryption key.

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

> **Requirements:** Docker, 2 GB RAM, any Linux VPS or local machine.
>
> **SSL & reverse proxy are NOT set up automatically.** The installer prints nginx and Caddy snippets at the end so you can use whatever you already have.

---

## Features

### 🤖 Admin AI Chat (the primary surface)

- A full conversational agent at `/chat` that drives the CRM through tool calls. Type "create a deal for Acme worth ₹50k and remind me to follow up on Friday" and the agent calls `create_deal` + `create_task` in sequence.
- **~169 admin tools** across every module: contacts, leads, deals, tasks, pipelines, products, quotes, invoices, payments, broadcasts, campaigns, forms, workflows, sequences, templates, tickets, knowledge base, documents, analytics, memory, WhatsApp.
- **~55 core tools** are always exposed to the model; the rest are callable by name on demand so the prompt stays short.
- Tool catalog UI at [`/docs`](apps/dashboard/src/app/(dashboard)/docs) — browse every tool grouped by domain so you can see exactly what the AI can do.
- File attachments — drop an image or PDF into the chat and say "send this to John"; the agent calls `send_whatsapp` with your attachment as the payload.
- Circuit breaker (Opossum) — auto-fallback if the configured AI provider errors out.
- Agent loop with a hard iteration cap so runaway tool loops can't burn tokens.

### 📲 WhatsApp Integration

- Connect multiple WhatsApp numbers via QR scan — no phone needs to stay online 24/7 after pairing.
- Baileys 6.17 (WhatsApp Web protocol) with session isolation and auto-reconnect.
- Real-time inbound + outbound with delivery / read receipts and status tracking.
- Media — images, video, audio, documents — stored in MinIO.
- **Warmup scheduler** — 6-stage daily-limit progression to protect fresh numbers from bans.
- **Inbound hooks** — every inbound message auto-creates a contact if it's new, auto-creates a lead with `source: WHATSAPP` if the contact has no open lead in the last 30 days, bumps lead scores based on response velocity, and drops activity rows on any open deal or task tied to the contact.
- **Optional AI auto-reply** — off by default. Enable in Settings → AI to have the admin agent loop run on inbound customer messages too.
- **Cloud API fallback scaffold** at [`apps/whatsapp/src/cloud-api/`](apps/whatsapp/src/cloud-api/) (not wired to the UI yet — see Roadmap).

### 🧠 File-Based AI Memory

- Markdown files (`MEMORY.md` + `memory/YYYY-MM-DD-*.md`) stored per company and chunked into **pgvector** embeddings + Postgres `tsvector` for hybrid search.
- `memory_search` tool — vector + FTS hybrid with per-keyword broaden-recall fallback and an ILIKE substring safety net, so proper nouns and conversational queries don't get dropped by stemming.
- `memory_write` tool — the agent proactively appends facts the user shares (names, roles, preferences, business policies) without asking.
- `memory_get` tool — read any file verbatim when search isn't precise enough.
- **Memory dreaming job** — every 6 hours a worker scores recall frequency, diversity, and recency across `RecallEntry`, and promotes the hottest snippets into the long-term `MEMORY.md`.
- Separate categorical `ai-memory` module for key/value facts you want injected into every system prompt verbatim.

### 🔁 Sequences, Templates & Broadcasts

- **Sequences** — multi-step drip campaigns with full lifecycle `DRAFT → ACTIVE → PAUSED → ARCHIVED` plus per-enrollment `ACTIVE → PAUSED → COMPLETED / STOPPED / CANCELLED`. Step types: `send_message`, `send_email`, `wait`, `add_tag`, `remove_tag`, `webhook`, `ai_task`. Hour-level delays, bulk enroll/unenroll, pause/resume per enrollment. A worker processor advances enrollments every minute with exponential-backoff retries (1h → 2h → 4h → STOPPED).
- **Templates** — WhatsApp message templates with `{{variable}}` substitution, default values, preview, `DRAFT / ACTIVE / ARCHIVED` status, and send/duplicate/archive actions.
- **Broadcasts** — tag-based audience targeting, scheduled sends, warmup-aware delivery, per-recipient state tracking, pause/resume/cancel.

### 🧾 CRM Modules (shipped)

| Module | What's in it |
|---|---|
| **Contacts** | Full-text search, tags, opt-out, phone normalization, custom fields, lifecycle stages, timeline, bulk actions |
| **Leads** | Status pipeline (`NEW → CONTACTED → QUALIFIED → PROPOSAL_SENT → NEGOTIATING → WON / LOST / DISQUALIFIED`), source tracking, auto-scoring with decay, estimated value, table + kanban views |
| **Deals** | Custom-pipeline kanban, configurable stages, line items, won/lost tracking, `get_deal_forecast` tool |
| **Tasks** | Priority, due dates, reminders, recurrence, watchers, comments, time logs, kanban view |
| **Products** | Catalog with variants, stock adjustments, low-stock alerts |
| **Quotes & Invoices** | Line-item builders with status tracking |
| **Payments** | Payment tracking, AI-generated payment links, webhook reconciliation, auto deal-won on paid |
| **Campaigns** | Marketing campaigns tied to forms and workflows |
| **Forms** | Lead-capture form builder with submission storage |
| **Workflows** | Trigger / condition / action automations with execution history |
| **Tickets** | Support tickets with comments and SLA policies |
| **Knowledge Base** | Internal articles (`/kb`) the AI can search via `search_knowledge_base` |
| **Documents** | File storage with signature requests (`DocumentSignature` model) |
| **Analytics** | KPI dashboard, deal funnel, lead sources, agent performance |
| **Reports** | Custom report builder + scheduled reports |

### 📬 Lead Intake & API Keys

- **Custom webhook endpoint** — `POST /api/webhooks/leads/custom` accepts JSON from Tally, Typeform, Webflow, n8n, Zapier, your own forms, anything that can speak HTTP. Protected by Bearer API key.
- **Meta Ads connector** ([`lead-intake` module](apps/api/src/modules/lead-intake/)) auto-creates leads when someone fills your Facebook / Instagram lead form. Gated by a public-URL eligibility check so Meta's callbacks can reach you.
- **Dedicated UI pages** — [`/leads/api-keys`](apps/dashboard/src/app/(dashboard)/leads/api-keys/) for key management and [`/leads/api-docs`](apps/dashboard/src/app/(dashboard)/leads/api-docs/) for the full REST reference.
- Keys are SHA-256 hashed at rest with scopes (`leads:write`, `leads:read`, `webhooks:meta`); raw value shown once on creation.
- Meta app secret + page access token encrypted with AES-256-GCM; Meta webhook payloads verified with HMAC-SHA256.

### 🧠 AI Providers

All configured from Settings → AI — keys encrypted at rest with AES-256-GCM, never in `.env`:

| Group | Providers |
|---|---|
| **Hosted** | Anthropic Claude · OpenAI · Google Gemini · Groq · DeepSeek · xAI · Mistral · Together · Moonshot · GLM · Qwen · StepFun |
| **Local** | Ollama (llama3, mistral, phi4, gemma3, deepseek-r1, qwen2.5, …) |
| **Aggregator** | OpenRouter (200+ models) · Custom OpenAI-compatible endpoint |

- **15 provider adapters total** (14 named + `CUSTOM`).
- Live "Test connection" button in settings — swap providers or models without restart.
- Per-company token budget, temperature, and system-prompt overrides.

### 💳 Payment Gateways

All keys encrypted in the database. Payment links can be generated by the AI agent with `create_payment_link` and webhooks auto-mark deals as won when payment clears.

| Gateway | Countries | Features |
|---|---|---|
| **Razorpay** | India | Payment links, webhooks, auto deal-won |
| **Stripe** | Global | Payment links, webhooks, auto deal-won |
| **Cashfree** | India | Payment links, webhooks |
| **PhonePe** | India | UPI payment pages |
| **PayU** | India | Payment pages, webhooks |

### 👥 Team Inbox & Multi-Tenancy

- WebSocket-pushed real-time inbox (inbox/conversation views via the chat + contacts pages).
- Conversation FSM with 7 states: `OPEN → AI_HANDLING → WAITING_HUMAN → HUMAN_HANDLING → RESOLVED → CLOSED` plus `SPAM`.
- Per-conversation AI / Human toggle.
- Role-based access: Super Admin → Admin → Manager → Agent.
- Team invites via the [Team settings](apps/dashboard/src/app/(dashboard)/settings/team/) page.
- `CompanyScopeGuard` on every request — cross-company data access is impossible.

### 📊 Observability

- **Prometheus** — metrics scraping for API, Worker, Redis, Postgres.
- **Grafana** — pre-provisioned dashboards and datasources.
- **Loki** — centralized log aggregation.
- **Health endpoint** — `/api/health` for Docker health checks and uptime monitoring.

### 🔒 Security

- JWT auth with 15-minute access tokens + 7-day refresh-token rotation.
- SHA-256 refresh-token hashing — old token invalidated on use.
- **AES-256-GCM encryption** for every AI / payment / Meta credential in the database.
- **API keys** SHA-256 hashed at rest; raw value shown only once at creation.
- Meta webhook HMAC-SHA256 verification.
- Rate limiting via Throttler on every endpoint.
- **Audit log** for sensitive actions (logins, key updates, permission changes) with before / after values.
- GDPR-friendly: soft delete, opt-out, hard purge via the cleanup processor.

### 🐳 Self-Hosted & Open Source

- Single `docker compose up -d` brings up the entire stack.
- Optional Traefik reverse proxy with auto Let's Encrypt SSL.
- PgBouncer connection pooling.
- MIT licensed — fork it, customize it, run it yourself.

---

## Architecture

```
                         ┌──────────────────────────────────────┐
                         │      Dashboard (Next.js 16)          │
                         │  /chat · CRM pages · Settings · Setup│
                         └────────────┬─────────────────────────┘
                                      │ HTTPS + WebSocket
                         ┌────────────▼─────────────────────────┐
                         │           API (NestJS 11)             │
                         │  REST · WS Gateway · Guards · Auth    │
                         │  34 modules · 72 Prisma models        │
                         └──┬──────────────┬────────────────────┘
                            │              │
              ┌─────────────▼──┐    ┌──────▼──────────────┐
              │  WhatsApp Svc  │    │   Worker (BullMQ)    │
              │  (Baileys 6.17)│    │   AI Agent Loop      │
              │  QR · Sessions │    │   12 job processors  │
              │  Inbound +     │    │   Sequences · Warmup │
              │  Outbound +    │    │   Memory dreaming    │
              │  Lead hooks    │    │   Lead decay cycle   │
              └───────┬────────┘    └──────┬───────────────┘
                      │                    │
              ┌───────▼────────────────────▼───────┐
              │         Redis (BullMQ + Pub/Sub)    │
              └────────────────────────────────────┘
              ┌────────────────────────────────────┐
              │   PostgreSQL 16 + pgvector         │
              │    (72 Prisma models · PgBouncer)  │
              └────────────────────────────────────┘
              ┌────────────────────────────────────┐
              │     MinIO (Media Storage)          │
              └────────────────────────────────────┘
```

### Monorepo Structure

```
Open-Agent-CRM/
├── apps/
│   ├── api/             # NestJS API — 34 modules
│   ├── dashboard/       # Next.js 16 App Router — 25 shipped pages
│   ├── whatsapp/        # Baileys service — sessions, inbound, outbound, lead hooks
│   └── worker/          # BullMQ — AI agent loop + 12 background processors
├── packages/
│   ├── database/        # Prisma schema (72 models), migrations, seed
│   └── shared/          # FSM, crypto utils, queue names, WS event types
├── deploy/
│   ├── docker-compose.yml        # Production stack
│   ├── docker-compose.dev.yml    # Local dev (postgres + redis + minio)
│   ├── install.sh                # Mac/Linux one-command installer
│   ├── install.ps1               # Windows one-command installer
│   ├── nginx-installer.conf      # Reverse proxy config template
│   ├── traefik/                  # Traefik reverse proxy config
│   ├── prometheus/               # Prometheus scrape config
│   ├── grafana/                  # Grafana provisioning
│   └── loki/                     # Loki log aggregation config
└── .github/workflows/
    └── ci.yml                    # Lint → Type-check → Test → Build → Docker push
```

### Dashboard Pages (25 shipped)

`/chat` (admin AI chat) · `/contacts` · `/leads` (+ `api-keys`, `api-docs`, `integrations`) · `/deals` · `/tasks` · `/sequences` · `/templates` · `/broadcasts` · `/campaigns` · `/products` · `/quotes` · `/invoices` · `/payments` · `/tickets` · `/kb` · `/documents` · `/forms` · `/workflows` · `/analytics` · `/reports` · `/memory` · `/docs` (AI tool catalog) · `/integrations` · `/settings` (ai, payments, whatsapp, webhooks, integrations, company, team) · `/setup` (6-step wizard)

### Background Jobs (12 processors)

`ai-message` (agent loop) · `broadcast` · `sequence-execution` · `memory-dreaming` · `follow-up` · `reminder` · `cleanup` · `payment-check` · `warmup-reset` · `lead-decay` · `deal-cycle` · `task-cycle`

---

## Tech Stack

<table>
<tr>
<td valign="top" width="33%">

**Backend**
- NestJS 11.1 · TypeScript 6.0
- Prisma 7.7 + PostgreSQL 16 + pgvector
- Redis 7 + BullMQ 5.73
- Socket.io 4.8 WebSockets
- Baileys 6.17 (WhatsApp Web)
- Passport.js + JWT
- Opossum 9 (circuit breaker)

</td>
<td valign="top" width="33%">

**Frontend**
- Next.js 16.2 (App Router)
- React 19.2
- Tailwind CSS 3.4
- Zustand 5 (state)
- TanStack Query 5.97
- Recharts 3.8 (charts)
- dnd-kit 6.3 (kanban)
- Socket.io client 4.8

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
- Node 22 · pnpm 10.33 · Turbo 2.9

</td>
</tr>
</table>

---

## Getting Started (Development)

### Prerequisites
- Node.js 22+
- pnpm 10.33+
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
# Edit .env — only infra config goes here.
# AI keys, payment keys, and WhatsApp accounts are set from the dashboard.
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

Only **infrastructure** goes in `.env`. AI providers, payment gateways, WhatsApp accounts, and company settings are all configured from the dashboard and stored encrypted in the database.

```env
# Infrastructure only — see .env.example for the full list
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
3. Interactively generate your `.env` (admin email, password, auto-generated secrets)
4. Pull and build Docker images
5. Start infrastructure (postgres + pgvector, redis, minio, pgbouncer)
6. Apply the Prisma schema and the pgvector memory migration
7. Seed the admin user
8. Start all services on localhost ports

Then **print nginx and Caddy config** so you can set up your own reverse proxy + SSL.

### Manual deployment

```bash
git clone https://github.com/Sapheron/Open-Agent-CRM.git /opt/openagentcrm
cd /opt/openagentcrm
cp .env.example .env     # fill in your values
docker compose -f deploy/docker-compose.yml up -d
```

---

## Roadmap

### Shipped
The full stack is production-ready: **34 NestJS modules**, **72 Prisma models**, **25 shipped dashboard pages**, **12 background workers**, **15 AI providers**, **5 payment gateways**, the admin AI chat with ~169 tool integrations, pgvector-backed memory with a dreaming job, Meta Ads + custom webhook lead intake, multi-tenant team inbox with role-based access, AES-256-GCM credential encryption, full Prometheus / Grafana / Loki observability, and an idempotent one-command installer for Linux / macOS / Windows.

### Planned / Next
- [ ] Email notifications for task reminders
- [ ] Finish wiring the WhatsApp Cloud API fallback into Settings
- [ ] Dedicated customer-support mode with its own system prompt (distinct from admin chat)
- [ ] Mobile app (React Native)
- [ ] Plugin / external webhook system
- [ ] White-label theming
- [ ] Multi-language AI replies

---

## Security

Open Agent CRM is built with security-first principles:

- **Encrypted credentials** — AI provider keys, payment gateway keys, and Meta tokens are encrypted with AES-256-GCM before storing in the database. The encryption key never leaves your `.env`.
- **JWT hardening** — 15-minute access tokens, 7-day refresh tokens. Refresh tokens are stored as SHA-256 hashes and invalidated on every rotation.
- **Hashed API keys** — external integration keys (custom webhook, Meta) are SHA-256 hashed at rest; the raw value is shown only once at creation time.
- **Multi-tenancy isolation** — `CompanyScopeGuard` injects `companyId` from the JWT into every request. Cross-company data access is impossible.
- **Webhook verification** — Meta lead webhooks are validated with HMAC-SHA256 against the signed body.
- **Rate limiting** — Throttler on all API endpoints.
- **Audit log** — every sensitive action (login, key updates, permission changes) is recorded with before / after values.
- **GDPR** — soft delete for contacts, opt-out support, scheduled hard purge via the cleanup processor.

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

Before opening a PR, please run:

```bash
pnpm turbo lint type-check test
```

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
<a href="https://github.com/ashik-k-i">@ashik-k-i</a>
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

*Sapheron is a software brand under*

**TechnoTaLim Platform and Services LLP**

*"Engineering the Future"*

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

<sub>© 2026 TechnoTaLim Platform and Services LLP · MIT License</sub>

</div>
