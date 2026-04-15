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
  <a href="#ai-agent-capabilities">200+ AI Tools</a>
</p>

---

**AgenticCRM** is a full-stack, self-hosted CRM built around WhatsApp. Your AI agent autonomously handles customer conversations, creates leads, manages deals, sends invoices, and controls the entire CRM — from WhatsApp or the dashboard. One `curl` to install. MIT licensed.

<p align="center">
  <sub>A <a href="https://sapheron.com">Sapheron</a> Project · <a href="https://technotalim.com">TechnoTaLim Platform and Services LLP</a></sub>
</p>

---

## Highlights

- **Autonomous WhatsApp AI** — 200+ tools, 5-iteration tool chains, circuit breaker, fallback providers
- **Staff AI control** — message your own WhatsApp number to run the entire CRM via natural language
- **Full CRM pipeline** — Contacts → Leads → Deals → Quotes → Invoices → Payments
- **Engagement suite** — Broadcasts, Campaigns, Sequences, Templates, Forms
- **Support tools** — Tickets, Knowledge Base, Documents with e-signatures
- **Automation** — Workflows, recurring tasks, form auto-actions
- **Analytics** — Revenue trends, conversion funnels, agent performance, custom reports
- **24/7 WhatsApp** — keepalive ping, auto-reconnect, stale connection watchdog, session persistence in PostgreSQL
- **In-app updates** — version-based checking, one-click update from the dashboard

---

## Tech Stack

```
API            NestJS 11 · TypeScript         Dashboard      Next.js 15 · React 19 · Tailwind
WhatsApp       Baileys (multi-session)         Job Queue      BullMQ + Redis
Database       PostgreSQL 16 + pgvector        Pool           PgBouncer
Media          MinIO (S3-compatible)            Realtime       Socket.io (WebSocket)
Monitoring     Prometheus + Grafana             Deploy         Docker Compose
```

---

## AI Providers

Configure from **Settings → AI**. Supports fallback chains — if the primary fails, retries with the next provider automatically.

| Provider | Models |
|---|---|
| **OpenAI** | GPT-4.1, GPT-4o, o3, o3-mini, o4-mini |
| **Anthropic** | Claude Opus 4.6, Sonnet 4.6, Haiku 4.5 |
| **Google** | Gemini 2.5 Pro, 2.5 Flash, 2.0 Flash |
| **Groq** | Llama 3.3-70b, Qwen-qwq-32b |
| **DeepSeek** | deepseek-chat, deepseek-reasoner |
| **xAI** | Grok-4, Grok-3, Grok-3-mini |
| **Mistral** | mistral-large-latest, codestral |
| **Moonshot** | Kimi K2.5, Kimi K2-thinking |
| **Alibaba** | Qwen-max, Qwen-plus |
| **Together AI** | All hosted models |
| **Ollama** | Any local model via base URL |
| **OpenRouter** | Any model via API |
| **Custom** | Any OpenAI-compatible endpoint |

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
4. Auto-generates all secrets (database, JWT, encryption, MinIO)
5. Builds all Docker images
6. Starts infrastructure (PostgreSQL, Redis, MinIO, PgBouncer)
7. Runs database migrations, seeds admin user
8. Starts all 11 services, verifies API health
9. Auto-patches nginx timeouts if detected
10. Prints reverse proxy setup instructions

</details>

After install: `http://localhost:3001` → set up reverse proxy for HTTPS (instructions printed by installer).

Updating: **Settings → System → Update Now** or re-run the install command.

---

## Services

```
┌─────────────────────────────────────────────────────────────┐
│                     Docker Compose                          │
│                                                             │
│  ┌─────────┐  ┌───────────┐  ┌──────────┐  ┌────────┐     │
│  │   API   │  │ Dashboard │  │ WhatsApp │  │ Worker │     │
│  │ :3000   │  │  :3001    │  │ Baileys  │  │ BullMQ │     │
│  └────┬────┘  └─────┬─────┘  └────┬─────┘  └───┬────┘     │
│       │             │              │             │          │
│  ┌────┴─────────────┴──────────────┴─────────────┴────┐    │
│  │              Redis 7 · PgBouncer                    │    │
│  └────────────────────┬───────────────────────────────┘    │
│                       │                                     │
│  ┌────────────────────┴───────────────────────────────┐    │
│  │          PostgreSQL 16 + pgvector                   │    │
│  └────────────────────────────────────────────────────┘    │
│                                                             │
│  ┌──────────┐  ┌─────────┐  ┌────────────┐  ┌──────────┐  │
│  │   MinIO  │  │ Grafana │  │ Prometheus │  │  Backup  │  │
│  │ :9000/01 │  │  :3002  │  │   :9090    │  │  Nightly │  │
│  └──────────┘  └─────────┘  └────────────┘  └──────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## WhatsApp

### Connect

1. **Settings → WhatsApp → Add Account** → scan QR
2. Your number is auto-added to the allowlist
3. Done — AI starts handling messages

### Multi-account

Each WhatsApp number runs an isolated Baileys session with auth stored in PostgreSQL.

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

Only numbers in the allowed list trigger the AI. **Settings → WhatsApp → Allowed Numbers**. Allowlisted numbers get full admin AI access (same as self-chat).

### 24/7 uptime

| Layer | What it does |
|---|---|
| WebSocket keepalive | Ping every 30s prevents silent drops |
| Auto-reconnect | Exponential backoff, unlimited retries |
| Stale watchdog | Force-reconnects if no activity for 5 min |
| Session persistence | Auth survives restarts (stored in PostgreSQL) |
| Presence update | Sends "available" on connect so WhatsApp delivers messages |

---

## Dashboard Pages

<details>
<summary><strong>AI</strong></summary>

| Page | Description |
|---|---|
| `/chat` | Chat with AI — full CRM control via natural language |
| `/memory` | Manage AI's persistent memory files |
| `/docs` | Browse all 200+ AI commands and tools |

</details>

<details>
<summary><strong>Analytics</strong></summary>

| Page | Description |
|---|---|
| `/analytics` | Revenue trends, conversion funnel, agent performance, message volume |
| `/reports` | Custom report builder with scheduling and export |

</details>

<details>
<summary><strong>CRM</strong></summary>

| Page | Description |
|---|---|
| `/contacts` | Contact list with search, tags, CSV import/export |
| `/leads` | Lead pipeline with score, status, source, duplicate detection |
| `/deals` | Deal pipeline with stages, line items, probability, forecasting |
| `/tasks` | Tasks with subtasks, comments, recurrence, time logging |
| `/products` | Product catalog with variants and pricing |

</details>

<details>
<summary><strong>Engage</strong></summary>

| Page | Description |
|---|---|
| `/broadcasts` | One-time WhatsApp blasts with audience targeting |
| `/templates` | Reusable message templates with categories |
| `/sequences` | Multi-step automated message sequences |
| `/campaigns` | Targeted campaigns with audience builder |
| `/forms` | Lead capture forms with auto-actions and public links |

</details>

<details>
<summary><strong>Sales</strong></summary>

| Page | Description |
|---|---|
| `/quotes` | Quote builder with line items, accept/reject |
| `/invoices` | Invoicing with payment recording |
| `/payments` | Payment links, manual entry, refunds |

</details>

<details>
<summary><strong>Support + Automate + More</strong></summary>

| Page | Description |
|---|---|
| `/tickets` | Support tickets with escalation, SLA tracking |
| `/kb` | Knowledge base — internal and public-facing |
| `/workflows` | No-code automation with triggers and actions |
| `/documents` | Document management with e-signatures |
| `/integrations` | Webhooks, calendar events, third-party connections |

</details>

---

## AI Agent Capabilities

The agent has **200+ tools** and can chain up to **5 tool calls** per message.

<details>
<summary><strong>Full tool list</strong></summary>

**Contacts & Leads** — search, create, update, delete, score, qualify, convert, merge duplicates

**Deals & Pipeline** — create, update, move stages, manage line items, set probability, forecast

**Tasks & Tickets** — create, assign, add comments, log time, escalate, track SLA

**Quotes, Invoices & Payments** — build quotes, send invoices, generate payment links, record refunds

**Engagement** — enroll in sequences, send templates, manage broadcasts, create campaigns

**Conversation** — escalate to human, add notes, resolve/reopen, toggle AI per conversation

**Analytics** — query revenue, pipeline, agent metrics, create custom reports

**Knowledge Base & Documents** — search/create articles, create documents, request e-signatures

**Automation** — trigger workflows, schedule sequences, configure form actions

</details>

**Circuit breaker** — if the AI provider fails repeatedly, conversations escalate to human automatically.

**Fallback chain** — retries with backup providers before escalating.

---

## Memory System

| Type | How it works |
|---|---|
| **Structured** | Named entries by category. Survives restarts. CRUD from dashboard. |
| **File-based** | Text chunked and embedded with pgvector. Semantic search at query time. |

---

## Roles & Permissions

| Role | Access |
|---|---|
| `SUPER_ADMIN` | Everything |
| `ADMIN` | Everything including settings |
| `AGENT` | Only permitted modules |
| `VIEWER` | Read-only |

Per-user permissions from **Settings → Team**.

---

## Settings

<details>
<summary><strong>All settings</strong></summary>

- **AI** — provider, model, API key (encrypted), system prompt, temperature, auto-reply, tool calling, fallback chain
- **WhatsApp** — add/remove accounts, QR, reconnect, allowed numbers
- **Payments** — gateway config, webhook URL
- **Team** — invite members, assign roles/permissions
- **Webhooks** — inbound sources, secret rotation
- **System** — version, check for updates, view changelog, trigger update

</details>

---

## In-App Updates

**Settings → System → Update Now**

1. Pulls latest code from GitHub
2. Rebuilds Docker images (cached layers — fast)
3. Runs database migrations
4. Restarts all services
5. Auto-patches nginx timeouts

Update banner only appears when `package.json` version is bumped — test commits don't trigger it.

---

## Environment Variables

<details>
<summary><strong>Key variables in <code>.env</code></strong></summary>

```env
DATABASE_URL=           # PostgreSQL (via PgBouncer)
REDIS_URL=              # Redis
JWT_SECRET=             # JWT signing
JWT_REFRESH_SECRET=     # Refresh token
ENCRYPTION_KEY=         # AES key for AI provider keys
MINIO_ENDPOINT=         # MinIO host
MINIO_ACCESS_KEY=       # MinIO access
MINIO_SECRET_KEY=       # MinIO secret
MINIO_BUCKET=           # Media bucket
NEXT_PUBLIC_API_URL=    # Dashboard → API URL
```

AI provider keys are encrypted in the database, configured from **Settings → AI** — not in `.env`.

</details>

---

## Project Structure

```
agenticcrm/
├── apps/
│   ├── api/              NestJS REST API + WebSocket gateway
│   ├── dashboard/         Next.js dashboard (React, Tailwind)
│   ├── whatsapp/          Baileys WhatsApp session manager
│   └── worker/            BullMQ job processor + AI agent loop
├── packages/
│   ├── database/          Prisma schema + migrations
│   └── shared/            Shared utilities, types, constants
└── deploy/
    ├── docker-compose.yml
    ├── install.sh
    ├── update.sh
    └── uninstall.sh
```

---

## License

MIT

---

<p align="center">
  <img src="logo_nobg.png" alt="AgenticCRM" width="50" /><br/>
  <strong><a href="https://sapheron.com">Sapheron</a></strong><br/>
  <sub><a href="https://technotalim.com">TechnoTaLim Platform and Services LLP</a></sub>
</p>
