<p align="center">
  <img src="full_logo_w.png" alt="AgenticCRM" width="420" />
</p>

<p align="center">
  <strong>Self-hosted AI CRM that runs on WhatsApp.</strong><br/>
  <sub>Connect your number. Configure an AI. Your agent handles the rest.</sub>
</p>

<p align="center">
  <a href="https://github.com/Sapheron/AgenticCRM/releases"><img src="https://img.shields.io/github/v/release/Sapheron/AgenticCRM?style=for-the-badge&color=000" alt="Release" /></a>
  <a href="https://github.com/Sapheron/AgenticCRM/actions"><img src="https://img.shields.io/github/actions/workflow/status/Sapheron/AgenticCRM/ci.yml?branch=main&style=for-the-badge&color=000" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-000?style=for-the-badge" alt="MIT License" /></a>
</p>

<p align="center">
  <a href="https://agenticcrm.sapheron.com">Website</a> ·
  <a href="#installation">Install</a> ·
  <a href="#ai-providers">AI Providers</a> ·
  <a href="#whatsapp">WhatsApp</a> ·
  <a href="#dashboard-pages">Dashboard</a> ·
  <a href="#ai-agent-tools">AI Tools</a>
</p>

---

**AgenticCRM** is a full-stack, self-hosted CRM built around WhatsApp. Your AI agent handles customer conversations, creates leads, manages deals, sends payment links, and controls the entire CRM — from WhatsApp or the dashboard. One `curl` to install. MIT licensed.

<p align="center">
  <sub>A <a href="https://sapheron.com">Sapheron</a> Project · <a href="https://technotalim.com">TechnoTaLim Platform and Services LLP</a></sub>
</p>

---

> **⚠️ A friendly note.** AgenticCRM is early-stage software under active development. You *will* find bugs. As a rule, we treat them as undocumented features — if one particularly annoys you, [open an issue](https://github.com/Sapheron/AgenticCRM/issues) and we'll graduate it from "feature" to "fixed." 🐛 → ✨

---

## A peek inside

<table>
<tr>
<td width="50%"><img src="ss1.png" alt="AgenticCRM analytics dashboard — KPIs, revenue trend, lead funnel, deal pipeline, agent performance" /></td>
<td width="50%"><img src="ss2.png" alt="AgenticCRM AI Assistant — chat-driven CRM control with inline tool calls (search_contacts, update_contact, list_deals)" /></td>
</tr>
<tr>
<td align="center"><sub><b>Analytics</b> — one board. Every number that matters.</sub></td>
<td align="center"><sub><b>AI Assistant</b> — run the CRM from a chat thread. Tool calls rendered inline.</sub></td>
</tr>
</table>

---

## Highlights

- **WhatsApp AI agent** — 8 registered tools, 5-iteration tool chains, circuit breaker with auto-escalation, fallback providers
- **Staff AI control** — message your own WhatsApp number to run the entire CRM via natural language
- **Full CRM pipeline** — Contacts → Leads → Deals → Quotes → Invoices → Payments
- **Engagement suite** — Broadcasts, Campaigns, Sequences, Templates, Forms
- **Support tools** — Tickets with SLA tracking, Knowledge Base, Documents with e-signatures
- **No-code automation** — Workflows with triggers and actions, recurring tasks, form auto-actions
- **Analytics** — Revenue trends, conversion funnels, agent performance, custom reports (table, chart, funnel, metric, cohort)
- **15 AI providers** — Gemini, OpenAI, Anthropic, Groq, DeepSeek, xAI, Mistral, Together, Moonshot, GLM, Qwen, StepFun, Ollama, OpenRouter, Custom
- **5 payment gateways** — Razorpay, Stripe, Cashfree, PhonePe, Payu
- **24/7 WhatsApp** — keepalive ping, auto-reconnect, stale watchdog, session persistence in PostgreSQL
- **11 Docker services** — one-command deploy with nightly backups and Prometheus + Grafana monitoring
- **In-app updates** — semver-based checking, one-click update from Settings

---

## Tech Stack

```
API            NestJS 11 · TypeScript 6        Dashboard      Next.js 16 · React 19 · Tailwind 3
WhatsApp       Baileys 6 (multi-session)        Job Queue      BullMQ 5 · Redis 7
Database       PostgreSQL 16 + pgvector         ORM            Prisma 7
Pool           PgBouncer (transaction mode)     Media          MinIO (S3-compatible)
AI SDKs        OpenAI 6 · Anthropic 0.86 · Gemini 0.24       Circuit Breaker   Opossum 9
Realtime       Socket.io 4                      Monitoring     Prometheus · Grafana
Validation     Zod 4                            Monorepo       Turborepo · pnpm 10
Deploy         Docker Compose (11 services)     Backup         Nightly PostgreSQL dump
```

---

## AI Providers

Configure from **Settings → AI**. Supports fallback chains (up to 5) — if the primary fails, retries with the next provider automatically. Each provider has native SDK integration or OpenAI-compatible routing.

| Provider | Integration | Models |
|---|---|---|
| **Google Gemini** | Native SDK | `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-3.1-pro-preview`, `gemini-3.1-flash-preview`, `gemini-3.1-flash-lite-preview`, `gemini-3-pro-preview`, `gemini-3-flash-preview` |
| **OpenAI** | Native SDK | `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`, `gpt-4o`, `gpt-4o-mini`, `o4-mini`, `o3`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano`, `gpt-5.4-pro` |
| **Anthropic** | Native SDK | `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-sonnet-4-5`, `claude-haiku-4-5-20251001` |
| **Groq** | OpenAI-compat | `llama-3.3-70b-versatile`, `deepseek-r1-distill-llama-70b`, `qwen-qwq-32b`, `llama-3.1-8b-instant`, `mixtral-8x7b-32768`, `gemma2-9b-it` |
| **DeepSeek** | OpenAI-compat | `deepseek-chat`, `deepseek-reasoner` |
| **xAI (Grok)** | OpenAI-compat | `grok-4`, `grok-4-fast`, `grok-4-1-fast`, `grok-3`, `grok-3-mini`, `grok-3-fast` |
| **Mistral** | OpenAI-compat | `mistral-large-latest`, `mistral-medium-latest`, `mistral-small-latest`, `codestral-latest` |
| **Together AI** | OpenAI-compat | `Llama-3.3-70B-Instruct-Turbo`, `Llama-4-Scout-17B`, `Llama-4-Maverick-17B`, `DeepSeek-V3.1`, `DeepSeek-R1`, `Kimi-K2.5` |
| **Moonshot (Kimi)** | OpenAI-compat | `kimi-k2.5`, `kimi-k2-thinking`, `kimi-k2-thinking-turbo`, `kimi-k2-turbo` |
| **GLM (ZhipuAI)** | OpenAI-compat | `glm-5.1`, `glm-5`, `glm-5-turbo`, `glm-4.7`, `glm-4.7-flash`, `glm-4.6`, `glm-4.5`, `glm-4.5-flash` |
| **Qwen (Alibaba)** | OpenAI-compat | `qwen-max`, `qwen-plus`, `qwen3.5`, `qwen-2.5-vl-72b-instruct` |
| **StepFun** | OpenAI-compat | `step-2-16k`, `step-1-200k`, `step-1-32k` |
| **Ollama** | Local | Any self-hosted model — no API key needed. Default: `llama3.3`, `mistral`, `phi4`, `gemma3`, `deepseek-r1`, `qwen2.5` |
| **OpenRouter** | OpenAI-compat | `auto`, `openrouter/hunter-alpha`, `google/gemini-3.1-pro`, `openai/gpt-5.4`, `anthropic/claude-sonnet-4-6`, `deepseek/deepseek-r1`, + any model |
| **Custom** | OpenAI-compat | Any endpoint that speaks the OpenAI chat completions format |

---

## Installation

Works on **Linux**, **macOS**, and **Windows**. One command installs everything.

### Linux / macOS

```bash
curl -fsSL https://agenticcrm.sapheron.com/install.sh | bash
```

### Windows (PowerShell)

```powershell
irm https://agenticcrm.sapheron.com/install.ps1 | iex
```

<details>
<summary><strong>What the installer does</strong></summary>

1. Detects OS, installs Docker if missing
2. Clones repository to `/opt/agenticcrm` (Linux/macOS) or `C:\agenticcrm` (Windows)
3. Asks for company name, admin email, admin password
4. Auto-generates all secrets (JWT, encryption key, MinIO credentials, database password)
5. Builds all Docker images
6. Starts infrastructure (PostgreSQL, Redis, MinIO, PgBouncer)
7. Runs Prisma migrations, seeds admin user
8. Starts all 11 services, verifies API health
9. Auto-patches nginx timeouts if detected
10. Prints reverse proxy setup instructions

</details>

After install: `http://localhost:3001` → set up reverse proxy for HTTPS (instructions printed by installer).

Updating: **Settings → System → Update Now** or re-run the install command.

---

## Services

```
┌─────────────────────────────────────────────────────────────────┐
│                       Docker Compose                            │
│                                                                 │
│  ┌──────────┐  ┌───────────┐  ┌───────────┐  ┌──────────┐     │
│  │   API    │  │ Dashboard │  │ WhatsApp  │  │  Worker  │     │
│  │  :3000   │  │   :3001   │  │  Baileys  │  │  BullMQ  │     │
│  └────┬─────┘  └─────┬─────┘  └─────┬─────┘  └────┬─────┘     │
│       │              │               │              │           │
│  ┌────┴──────────────┴───────────────┴──────────────┴─────┐    │
│  │                Redis 7 · PgBouncer                      │    │
│  └─────────────────────────┬──────────────────────────────┘    │
│                            │                                    │
│  ┌─────────────────────────┴──────────────────────────────┐    │
│  │            PostgreSQL 16 + pgvector                     │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌──────────┐  ┌───────────┐  ┌────────────┐  ┌──────────┐    │
│  │  MinIO   │  │  Grafana  │  │ Prometheus │  │  Backup  │    │
│  │ :9000/01 │  │   :3002   │  │   :9090    │  │  Nightly │    │
│  └──────────┘  └───────────┘  └────────────┘  └──────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

| Service | Port | Purpose |
|---|---|---|
| **API** | 3000 | NestJS REST API + WebSocket gateway (Socket.io) |
| **Dashboard** | 3001 | Next.js 16 frontend with React 19 |
| **WhatsApp** | — | Baileys multi-session handler, QR streaming via Redis |
| **Worker** | — | BullMQ job processor, AI agent loop, circuit breaker |
| **PostgreSQL** | 5432 (internal) | Primary database with pgvector extension |
| **PgBouncer** | 5432 | Connection pooling (transaction mode) |
| **Redis** | 6379 (internal) | Job queue, QR pub/sub, caching (256MB, AOF) |
| **MinIO** | 9000 / 9001 | S3-compatible media storage (API / console) |
| **Prometheus** | 9090 | Metrics collection |
| **Grafana** | 3002 | Monitoring dashboards |
| **Backup** | — | Nightly PostgreSQL dump to `/backups` |

---

## WhatsApp

### Connect

1. **Settings → WhatsApp → Add Account** → scan QR
2. Your number is auto-added to the allowlist
3. Done — AI starts handling messages

### Multi-account

Each WhatsApp number runs an isolated Baileys session with auth state encrypted and stored in PostgreSQL. QR codes stream in real-time via Redis pub/sub to the dashboard.

### Staff AI control

Message your connected number (self-chat) to control the CRM:

```
You:  How many open deals do we have?
AI:   You have 12 open deals worth $184,500. Top 3:
      1. Acme Corp — Proposal Sent — $45,000
      2. Widget Inc — Negotiating — $32,000
      3. DataFlow — Qualified — $28,000

You:  Move Acme to Won
AI:   Done! Deal "Acme Corp" moved to Won. Revenue: $45,000.

You:  Create a follow-up task for Widget Inc next Monday
AI:   Created task "Follow up with Widget Inc" due Monday Apr 21.
```

### Allowlist

Only numbers in the allowed list trigger the AI. **Settings → WhatsApp → Allowed Numbers**. Allowlisted numbers get full admin AI access (same as self-chat). Daily message limits and warmup stage tracking per account.

### 24/7 uptime

| Layer | What it does |
|---|---|
| WebSocket keepalive | Ping every 30s prevents silent drops |
| Auto-reconnect | Exponential backoff (up to 60s), unlimited retries, resets on success |
| Stale watchdog | Checks every 2 min, force-reconnects if no activity for 5 min |
| Session persistence | Encrypted auth state in PostgreSQL — survives container restarts |
| Presence update | Sends "available" on connect so WhatsApp delivers messages |
| Status tracking | DISCONNECTED → QR_PENDING → CONNECTING → CONNECTED (with error/ban detection) |

---

## Dashboard Pages

<details>
<summary><strong>AI</strong></summary>

| Page | Description |
|---|---|
| `/chat` | Chat with AI — full CRM control via natural language |
| `/memory` | Manage AI's persistent memory files |
| `/docs` | Browse all registered AI tools and commands |

</details>

<details>
<summary><strong>Analytics</strong></summary>

| Page | Description |
|---|---|
| `/analytics` | Revenue trends, conversion funnel, agent performance, message volume |
| `/reports` | Custom report builder (table, chart, funnel, metric, cohort) with scheduling and export |

</details>

<details>
<summary><strong>CRM</strong></summary>

| Page | Description |
|---|---|
| `/contacts` | Contact list with search, tags, CSV import/export |
| `/contacts/[id]` | Contact detail — activity timeline, notes, linked deals |
| `/leads` | Lead pipeline with score, status, source, duplicate detection |
| `/leads/[id]` | Lead detail with conversion to deal |
| `/leads/integrations` | Lead intake integrations (Meta Ads, webhooks) |
| `/leads/api-keys` | API key management for lead capture |
| `/leads/api-docs` | Lead API documentation |
| `/deals` | Deal pipeline — stages: Lead In → Qualified → Proposal → Negotiation → Won/Lost |
| `/deals/[id]` | Deal detail with line items and linked payments |
| `/pipelines` | Pipeline stage configuration |
| `/tasks` | Task list with Kanban view, subtasks, comments, time logging |
| `/tasks/[id]` | Task detail |
| `/tasks/recurrences` | Recurring task templates (daily, weekly, monthly, quarterly, yearly, custom) |
| `/products` | Product catalog with pricing |

</details>

<details>
<summary><strong>Engage</strong></summary>

| Page | Description |
|---|---|
| `/broadcasts` | One-time WhatsApp blasts with audience targeting, throttle control |
| `/templates` | Reusable message templates — 10 categories (greeting, follow-up, promotion, payment reminder, etc.), A/B testing, usage stats |
| `/sequences` | Multi-step automated sequences with delays, conditions, and webhooks |
| `/campaigns` | Targeted campaigns with audience builder and recipient tracking |
| `/forms` | Lead capture forms with auto-actions (create lead, send sequence, webhook), public shareable links |

</details>

<details>
<summary><strong>Sales</strong></summary>

| Page | Description |
|---|---|
| `/quotes` | Quote builder with line items, discount, tax — accept/reject workflow |
| `/invoices` | Invoicing with auto-generated numbers (`INV-YYMMDD-XXX`), payment status tracking |
| `/payments` | Payment links, manual recording, refunds — supports Razorpay, Stripe, Cashfree, PhonePe, Payu |

</details>

<details>
<summary><strong>Support</strong></summary>

| Page | Description |
|---|---|
| `/tickets` | Support tickets — status (open → in progress → waiting → escalated → resolved → closed), SLA tracking with breach flags, auto-generated numbers (`TKT-YYMMDD-XXX`) |
| `/kb` | Knowledge base articles — internal and public-facing, markdown, categories, view tracking |
| `/documents` | Document management with e-signature requests |
| `/workflows` | No-code automation — trigger on events (form submission, lead created, deal won), chain actions |

</details>

<details>
<summary><strong>Settings & More</strong></summary>

| Page | Description |
|---|---|
| `/inbox` | Message inbox — all WhatsApp conversations |
| `/integrations` | Third-party connections — Google Calendar, Google Sheets, Slack, Zapier, webhooks, SMTP |
| `/settings/company` | Company name, logo, timezone, branding |
| `/settings/whatsapp` | WhatsApp accounts, QR scanning, allowlist, warmup, daily limits |
| `/settings/ai` | AI provider, model, API key, system prompt presets, temperature, tool calling, fallback chain |
| `/settings/payments` | Payment gateway setup (5 gateways), currency, test mode |
| `/settings/team` | Team members, roles (Super Admin, Admin, Manager, Agent), permissions |
| `/settings/webhooks` | Webhook endpoint management with event selection |
| `/settings/system` | Version info, update check, one-click update, backup retention |

</details>

---

## AI Agent Tools

The agent has **8 registered tools** and can chain up to **5 tool calls** per message. Tools are executed via the worker's agent loop with Opossum circuit breaker protection.

| Tool | What it does |
|---|---|
| `create_lead` | Create a lead when a customer shows buying intent (title, estimated value, source) |
| `update_deal_stage` | Move a deal between pipeline stages (Lead In → Qualified → Proposal → Negotiation → Won/Lost) |
| `create_task` | Create follow-up tasks with priority and due date |
| `search_contacts` | Search CRM contacts by name or phone number |
| `send_payment_link` | Generate and send a payment link for an amount (links to deals) |
| `get_conversation_history` | Retrieve recent messages for context (up to 20) |
| `add_note` | Add a note to the contact record |
| `escalate_to_human` | Hand off conversation to a human agent with reason |

**Circuit breaker** — if the AI provider fails repeatedly, the Opossum circuit opens and conversations auto-escalate to human.

**Fallback chain** — retries with up to 5 backup providers (using primary or separate API keys) before escalating.

**System prompt presets** — Sales Assistant, Customer Support, Lead Qualifier, Appointment Setter, or Custom.

---

## Memory System

| Type | How it works |
|---|---|
| **Structured** | Named entries by category (general, product, policy, FAQ, instruction). CRUD from `/memory` dashboard. Survives restarts. |
| **File-based** | Markdown files chunked and embedded with pgvector (1536-dim vectors). Hybrid search: semantic (vector similarity) + keyword (PostgreSQL tsvector). |
| **Recall tracking** | Tracks recall frequency, scores, concept tags. Promotes short-term recalls to long-term memory. |

---

## Roles & Permissions

| Role | Access |
|---|---|
| `SUPER_ADMIN` | Full system access |
| `ADMIN` | Company-level admin including settings |
| `MANAGER` | Team lead / supervisor |
| `AGENT` | Only assigned modules (default role) |

Per-user permissions array from **Settings → Team**.

---

## Settings

<details>
<summary><strong>All settings</strong></summary>

- **Company** — name, slug, email, phone, website, logo, timezone, public webhook URL
- **AI** — provider (15 options), model, API key (encrypted in DB), system prompt presets, temperature, tool calling toggle, fallback chain (up to 5), test connection
- **WhatsApp** — add/remove accounts, QR scanning, allowed numbers, daily message limits, warmup stages
- **Payments** — gateway (Razorpay, Stripe, Cashfree, PhonePe, Payu), API keys (encrypted), webhook secret, currency, test mode
- **Team** — invite members, assign roles (Super Admin, Admin, Manager, Agent), custom permissions, track last login
- **Webhooks** — endpoint management, event selection, active/inactive toggle
- **System** — version info, semver update check, one-click update, backup retention (default 30 days)

</details>

---

## In-App Updates

**Settings → System → Update Now**

1. Compares `package.json` version against remote (semver)
2. Pulls latest code from GitHub
3. Rebuilds Docker images (cached layers — fast)
4. Runs Prisma migrations
5. Restarts all services
6. Logs to `/tmp/agenticcrm-update.log`

Update banner only appears when `package.json` version is bumped — test commits don't trigger it.

---

## Environment Variables

<details>
<summary><strong>Key variables in <code>.env</code></strong></summary>

```env
# Core
NODE_ENV=               # production
DOMAIN=                 # crm.yourcompany.com

# Database
DATABASE_URL=           # PostgreSQL via PgBouncer
DIRECT_DATABASE_URL=    # Direct PostgreSQL (for migrations)
DB_USER=                # Database user
DB_PASSWORD=            # Database password

# Auth
JWT_SECRET=             # JWT signing (auto-generated)
JWT_EXPIRES_IN=         # Token TTL (default: 7d)
JWT_REFRESH_EXPIRES_IN= # Refresh TTL (default: 30d)
ENCRYPTION_KEY=         # AES key for encrypting API keys in DB

# Infrastructure
REDIS_URL=              # Redis connection
MINIO_ENDPOINT=         # MinIO host
MINIO_ACCESS_KEY=       # MinIO access key
MINIO_SECRET_KEY=       # MinIO secret key
MINIO_BUCKET=           # Media bucket name

# Dashboard
NEXT_PUBLIC_API_URL=    # Dashboard → API URL

# Optional
SENTRY_DSN=             # Error tracking
BACKUP_RETENTION_DAYS=  # Backup retention (default: 30)
API_RATE_LIMIT_MAX=     # Rate limit per window (default: 100)
```

AI provider keys and payment gateway keys are configured via **Settings** in the dashboard — encrypted in the database, not in `.env`.

</details>

---

## Project Structure

```
agenticcrm/
├── apps/
│   ├── api/                NestJS 11 REST API + WebSocket gateway
│   ├── dashboard/          Next.js 16 frontend (React 19, Tailwind)
│   ├── whatsapp/           Baileys 6 WhatsApp session manager
│   └── worker/             BullMQ job processor + AI agent loop
├── packages/
│   ├── database/           Prisma 7 schema + migrations (67+ models)
│   └── shared/             Shared utilities, types, encryption helpers
├── deploy/
│   ├── docker-compose.yml  Production stack (11 services)
│   ├── docker-compose.dev.yml
│   ├── install.sh          Linux/macOS installer
│   ├── install.ps1         Windows installer
│   ├── update.sh           In-app update script
│   ├── uninstall.sh        Clean removal
│   ├── prometheus/         Prometheus config
│   ├── grafana/            Grafana dashboards
│   ├── loki/               Log aggregation config
│   ├── pgbouncer/          Connection pool config
│   └── traefik/            Reverse proxy config
├── docs/
├── scripts/
├── turbo.json              Turborepo pipeline
└── pnpm-workspace.yaml     pnpm monorepo config
```

---

## License

MIT

---

<p align="center">
  <img src="logo_w.png" alt="AgenticCRM" width="50" /><br/>
  <strong><a href="https://sapheron.com">Sapheron</a></strong><br/>
  <sub><a href="https://technotalim.com">TechnoTaLim Platform and Services LLP</a></sub>
</p>
