<p align="center">
  <img src="full_logo_w.png" alt="AgenticCRM" width="500" />
</p>

<p align="center">
  <strong>Self-hosted, AI-powered WhatsApp CRM</strong><br/>
  <sub>A <a href="https://sapheron.com">Sapheron</a> Project · From <a href="https://technotalim.com">TechnoTaLim Platform and Services LLP</a></sub>
</p>

<p align="center">
  <a href="https://agenticcrm.sapheron.com"><img src="https://img.shields.io/badge/Install-curl_|_bash-black?style=for-the-badge" alt="Install" /></a>
  <a href="https://github.com/Sapheron/AgenticCRM"><img src="https://img.shields.io/badge/License-MIT-black?style=for-the-badge" alt="MIT License" /></a>
</p>

---

Connect your WhatsApp number, configure an AI provider, and your AI agent handles customer conversations, creates leads, manages deals, sends invoices, and controls the entire CRM — autonomously or on demand from the dashboard.

---

## What it does

- **Autonomous WhatsApp AI** — incoming messages are processed by an AI agent that can search contacts, create leads, update deals, send payment links, escalate to humans, and more — without any manual intervention
- **Staff AI chat** — message your own connected WhatsApp number to control the CRM using natural language, exactly like the dashboard chat
- **Full CRM pipeline** — Contacts → Leads → Deals → Quotes → Invoices → Payments, all linked together
- **Engagement tools** — Broadcasts, Campaigns, Sequences, Templates, Forms
- **Support tools** — Tickets, Knowledge Base, Documents with e-signatures
- **Automation** — Workflows, recurring tasks, form auto-actions, sequence enrollments
- **Analytics & Reports** — Revenue trends, conversion funnels, agent performance, custom report builder

---

## Tech Stack

| Layer | Technology |
|---|---|
| API | NestJS 11, TypeScript |
| Dashboard | Next.js 15, React 19, Tailwind CSS |
| WhatsApp | Baileys (multi-session) |
| Job Queue | BullMQ + Redis |
| Database | PostgreSQL 16 + pgvector |
| Connection Pool | PgBouncer |
| Media Storage | MinIO (S3-compatible) |
| Realtime | Socket.io (WebSocket) |
| Monitoring | Prometheus + Grafana |
| Deployment | Docker Compose |

---

## AI Providers

Configure any of these providers from **Settings → AI**:

| Provider | Models |
|---|---|
| OpenAI | GPT-4.1, GPT-4o, o3, o3-mini, o4-mini |
| Anthropic | Claude Opus 4.6, Sonnet 4.6, Haiku 4.5 |
| Google | Gemini 2.5 Pro, 2.5 Flash, 2.0 Flash |
| Groq | Llama 3.3-70b, Qwen-qwq-32b |
| DeepSeek | deepseek-chat, deepseek-reasoner |
| xAI | Grok-4, Grok-3, Grok-3-mini |
| Mistral | mistral-large-latest, codestral |
| Moonshot | Kimi K2.5, Kimi K2-thinking |
| Alibaba | Qwen-max, Qwen-plus |
| Together AI | All hosted models |
| Ollama | Any local model via base URL |
| OpenRouter | Any model via API |
| Custom | Any OpenAI-compatible endpoint |

Supports **fallback chains** — if the primary model fails, the system automatically retries with the next configured provider.

---

## Installation

**Requirements:** A Linux server with Docker and Docker Compose installed.

```bash
curl -fsSL https://agenticcrm.sapheron.com/install.sh | bash
```

The installer will:
1. Ask for your domain, database password, and other config
2. Clone the repository to `/opt/agenticcrm`
3. Generate a `.env` file
4. Build and start all Docker services
5. Run database migrations and seed an admin user
6. Print your login credentials

After installation, access the dashboard at `https://your-domain.com`.

---

## Services

The stack runs 11 Docker services:

| Service | Port | Description |
|---|---|---|
| API (NestJS) | 3000 | REST API + WebSocket gateway |
| Dashboard (Next.js) | 3001 | Web UI |
| WhatsApp (Baileys) | — | WhatsApp session manager |
| Worker (BullMQ) | — | AI agent job processor |
| PostgreSQL 16 | 5432 | Primary database |
| PgBouncer | 6432 | Connection pooler |
| Redis 7 | 6379 | Pub/sub, caching, job queue |
| MinIO | 9000/9001 | Media file storage |
| Prometheus | 9090 | Metrics collection |
| Grafana | 3002 | Metrics dashboard |
| Backup | — | Nightly PostgreSQL backup |

---

## Connecting WhatsApp

1. Go to **Settings → WhatsApp**
2. Click **Add Account**
3. Scan the QR code with your WhatsApp phone
4. The account connects and your number is auto-added to the allowlist

**Multi-account:** Add multiple WhatsApp numbers. Each runs an isolated Baileys session with its own auth state stored in PostgreSQL.

**Allowlist:** Only numbers in the allowed list trigger the AI agent or staff AI chat. Go to **Settings → WhatsApp → Allowed Numbers** to manage it.

**Staff chat:** Message your own connected WhatsApp number to yourself. The AI responds with full CRM access — same as the dashboard `/chat` page.

**24/7 uptime:** Three layers protect the connection — native WebSocket keepalive ping every 30s, exponential backoff reconnect on disconnect (unlimited retries), and a 2-minute watchdog for silent drops. Session credentials survive container restarts via PostgreSQL storage.

---

## Dashboard Pages

### AI
| Page | Description |
|---|---|
| `/chat` | Chat with the AI agent — full CRM control via natural language |
| `/memory` | Manage the AI's persistent memory files |
| `/docs` | Browse all available AI commands and tools |

### Analytics
| Page | Description |
|---|---|
| `/analytics` | Revenue trends, conversion funnel, agent performance, message volume, ticket stats |
| `/reports` | Custom report builder with scheduling and export |

### CRM
| Page | Description |
|---|---|
| `/contacts` | Contact list with search, tags, CSV import/export, GDPR opt-out |
| `/leads` | Lead pipeline with score, status, source, duplicate detection |
| `/deals` | Deal pipeline with stages, line items, probability, forecasting |
| `/tasks` | Tasks with subtasks, comments, recurrence, time logging, watchers |
| `/products` | Product catalog with variants, stock management, and pricing |

### Engage
| Page | Description |
|---|---|
| `/broadcasts` | One-time WhatsApp blasts with audience targeting |
| `/templates` | Reusable message templates with categories |
| `/sequences` | Multi-step automated message sequences with enrollment management |
| `/campaigns` | Targeted campaigns with audience builder and scheduling |
| `/forms` | Lead capture forms with auto-actions, public links, webhook triggers |

### Sales
| Page | Description |
|---|---|
| `/quotes` | Quote builder with line items, send, accept/reject, expiry |
| `/invoices` | Invoicing with payment recording and status tracking |
| `/payments` | Payment link generation, manual payment entry, refunds |

### Support
| Page | Description |
|---|---|
| `/tickets` | Support tickets with escalation, merge, SLA tracking |
| `/kb` | Knowledge base articles — internal and public-facing |

### Automate
| Page | Description |
|---|---|
| `/workflows` | No-code automation workflows with triggers and actions |

### More
| Page | Description |
|---|---|
| `/documents` | Document management with e-signature requests and tracking |
| `/integrations` | Third-party integrations, webhooks, calendar events |

---

## AI Agent Capabilities

The AI agent has access to **200+ tools** across every CRM module. When a customer sends a WhatsApp message, or when a staff member chats from the dashboard or their own WhatsApp, the agent can chain multiple actions in a single response.

**Contacts & Leads**
- Search, create, and update contacts
- Create leads with source tracking (WhatsApp, form, webhook, etc.)
- Adjust lead scores manually or trigger recalculation
- Convert leads to deals
- Detect and merge duplicate contacts

**Deals & Pipeline**
- Create and update deals with custom fields
- Move deals through pipeline stages
- Manage line items, pricing, and discount
- Set close probability and expected value

**Tasks & Tickets**
- Create and assign tasks with due dates
- Create support tickets and add comments
- Escalate tickets to senior agents
- Log time against tasks

**Quotes, Invoices & Payments**
- Build quotes with line items
- Send invoices to contacts
- Generate payment links
- Record manual payments and refunds

**Engagement**
- Enroll contacts in sequences
- Send template messages
- Manage broadcast recipients

**Conversation Management**
- Escalate conversation to human agent
- Add internal notes
- Resolve or reopen conversations
- Toggle AI on/off per conversation

**Analytics & Reports**
- Query revenue, pipeline, and agent metrics
- Create and run custom reports
- Get business health summaries

**Knowledge Base & Documents**
- Search and create knowledge articles
- Create documents and request e-signatures

**Automation**
- Trigger workflows manually
- Schedule sequence steps
- Configure form auto-actions

The agent loop supports up to **5 tool call iterations** per message, so it can chain actions: search contact → find open deal → update stage → create a follow-up task — all in one reply.

**Circuit breaker:** If the AI provider fails repeatedly, the circuit opens and the conversation escalates to a human automatically. The breaker resets after a cooldown.

---

## Memory System

The AI has two types of persistent memory:

**Structured Memory** (`/memory → Memory tab`)
- Named entries grouped by category
- Survives across conversations and container restarts
- Create, update, archive, and delete from the dashboard

**File-Based Memory** (`/memory → Files tab`)
- Store any text as a named knowledge file
- Content is chunked and embedded with pgvector
- Semantic similarity search at query time — relevant chunks are automatically injected into the AI context
- Track source (user, AI, system) per chunk

---

## Roles & Permissions

| Role | Access |
|---|---|
| SUPER_ADMIN | Everything including system settings and team management |
| ADMIN | Everything including settings |
| AGENT | Only modules their permissions allow |
| VIEWER | Read-only on allowed modules |

Admins assign per-user permissions from **Settings → Team**. Each dashboard module maps to a permission key — users without it don't see the page and can't call the API.

---

## Settings

**AI (`/settings/ai`)**
- Provider and model selection
- Encrypted API key storage
- Custom base URL for self-hosted models
- System prompt and tone
- Temperature and max tokens
- Auto-reply toggle
- Tool calling toggle
- Fallback model chain configuration
- Connection test

**WhatsApp (`/settings/whatsapp`)**
- Add and remove WhatsApp accounts
- QR code generation and reconnection
- Allowed numbers list per account
- Account status monitoring

**Payments (`/settings/payments`)**
- Payment gateway configuration
- Webhook URL for payment callbacks

**Team (`/settings/team`)**
- Invite team members
- Assign roles and permissions
- Change passwords

**Webhooks (`/settings/webhooks`)**
- Configure inbound webhook sources (Meta Lead Ads, custom)
- Webhook secret rotation

**System (`/settings/system`)**
- View current installed version
- Check for new releases (version-based — only shows update when package.json version is bumped)
- View changelog
- Trigger in-place update

---

## In-App Updates

Go to **Settings → System** and click **Update Now**. The system will:
1. Pull the latest code from GitHub
2. Rebuild Docker images with the new version baked in
3. Run any new database migrations
4. Restart all services

The update banner only appears when the remote `package.json` version is greater than the installed version. Pushing test commits to the repo does not trigger update notifications — only intentional version bumps do.

---

## Monitoring

- **Prometheus** scrapes metrics from all services at port 9090
- **Grafana** dashboards available at port 3002
- All services run with `restart: unless-stopped` and Docker health checks
- Nightly PostgreSQL backups retained for 30 days in a named volume
- WhatsApp sessions include a watchdog that detects silent disconnects and reconnects automatically

---

## Environment Variables

Key variables in `.env` (generated by the installer):

```env
DATABASE_URL=           # PostgreSQL connection string (via PgBouncer)
REDIS_URL=              # Redis connection string
JWT_SECRET=             # JWT signing secret
JWT_REFRESH_SECRET=     # Refresh token signing secret
ENCRYPTION_KEY=         # AES key for encrypting AI provider API keys
MINIO_ENDPOINT=         # MinIO host
MINIO_ACCESS_KEY=       # MinIO access key
MINIO_SECRET_KEY=       # MinIO secret key
MINIO_BUCKET=           # Media storage bucket name
NEXT_PUBLIC_API_URL=    # Public URL the dashboard uses to reach the API
```

AI provider API keys are stored encrypted in the database, configured from **Settings → AI** — not in `.env`.

---

## Project Structure

```
agenticcrm/
├── apps/
│   ├── api/           # NestJS REST API + WebSocket gateway
│   ├── dashboard/     # Next.js dashboard (React, Tailwind)
│   ├── whatsapp/      # Baileys WhatsApp session manager
│   └── worker/        # BullMQ job processor + AI agent loop
├── packages/
│   ├── database/      # Prisma schema + migrations
│   └── shared/        # Shared utilities, types, constants
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
  <img src="logo_nobg.png" alt="AgenticCRM" width="60" /><br/>
  <strong>A <a href="https://sapheron.com">Sapheron</a> Project</strong><br/>
  <sub>From <a href="https://technotalim.com">TechnoTaLim Platform and Services LLP</a></sub>
</p>
