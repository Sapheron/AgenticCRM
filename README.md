# Open Agent CRM

![License](https://img.shields.io/github/license/Sapheron/Open-Agent-CRM)
![Stars](https://img.shields.io/github/stars/Sapheron/Open-Agent-CRM)
![Forks](https://img.shields.io/github/forks/Sapheron/Open-Agent-CRM)
![Issues](https://img.shields.io/github/issues/Sapheron/Open-Agent-CRM)
![Contributors](https://img.shields.io/github/contributors/Sapheron/Open-Agent-CRM)
![Last Commit](https://img.shields.io/github/last-commit/Sapheron/Open-Agent-CRM)

**Open-source, self-hosted AI CRM with WhatsApp integration, team inbox, lead management, deal pipelines, automation, and multi-agent workflows.**

Built for businesses that want a production-ready customer communication and CRM platform powered by AI agents, real-time messaging, automation, and self-hosted infrastructure.

---

## ✨ Features

- 📲 **WhatsApp Integration**
  - Baileys-based WhatsApp Web integration
  - Optional Cloud API support
  - QR-based account connection
  - Delivery, read, and message status tracking

- 🤖 **AI Agent Workflows**
  - AI-powered customer replies
  - Human handoff / escalation flow
  - Multi-provider AI support
  - Tool calling for CRM actions

- 🧾 **CRM Modules**
  - Contacts
  - Conversations
  - Leads
  - Deals
  - Tasks
  - Payments

- 📨 **Shared Team Inbox**
  - Multi-agent conversation assignment
  - Real-time updates
  - Conversation status and ownership
  - AI / human hybrid workflows

- 💳 **Payment Integrations**
  - Razorpay
  - Stripe
  - Cashfree
  - PhonePe
  - PayU

- 🧠 **Multi-AI Provider Support**
  - OpenAI
  - Gemini
  - Claude
  - Groq
  - Ollama
  - OpenRouter
  - Custom provider support

- 📊 **Analytics & Monitoring**
  - Dashboard analytics
  - Message volume insights
  - Deal pipeline analytics
  - Prometheus + Grafana + Loki + Sentry

- 🛡️ **Production-Ready Security**
  - JWT auth + refresh token rotation
  - Multi-tenant isolation
  - Encrypted credential storage
  - Rate limiting
  - Audit logging
  - GDPR-friendly soft delete / opt-out support

- 🐳 **Self-Hosted & Open**
  - Docker / Docker Compose deployment
  - Traefik reverse proxy
  - PostgreSQL + Redis + MinIO
  - Open-source monorepo architecture

---

## 🏗️ Architecture Overview

Open Agent CRM is designed as a **production-grade, self-hosted WhatsApp AI CRM platform** with a modular monorepo architecture.

### Core Services
- **API** → NestJS REST + WebSocket backend
- **WhatsApp Service** → Baileys / Cloud API integration
- **Worker** → BullMQ background jobs + AI agent loop
- **Dashboard** → Next.js web application

### Core Capabilities
- Real-time inbox and message updates
- AI-assisted conversations
- Lead / deal / task management
- Payment link generation
- CRM automation workflows
- Broadcasts and team workflows
- Multi-tenant company isolation

---

## 🧱 Tech Stack

### Backend
- **NestJS**
- **Prisma**
- **PostgreSQL**
- **Redis**
- **BullMQ**
- **Socket.io**
- **MinIO**

### Frontend
- **Next.js**
- **Tailwind CSS**
- **shadcn/ui**
- **Zustand**
- **TanStack Query**
- **Recharts**
- **dnd-kit**

### DevOps / Infra
- **Docker**
- **Docker Compose**
- **Traefik**
- **PgBouncer**
- **Prometheus**
- **Grafana**
- **Loki**
- **Sentry**
- **GitHub Actions**

---

## 📁 Monorepo Structure

```bash
apps/
  api/          # NestJS REST + WebSocket API
  whatsapp/     # WhatsApp integration service
  worker/       # AI agent loop + background jobs
  dashboard/    # Next.js frontend

packages/
  shared/       # Shared types, FSM, schemas, utils
  database/     # Prisma schema, migrations, seed

deploy/         # Docker, Traefik, Grafana, Loki, Prometheus
docs/           # Architecture and contributor docs
scripts/        # Utility scripts
```

---

## 🔄 Conversation Flow

Open Agent CRM uses a **conversation state machine (FSM)** for AI + human workflows:

```text
OPEN → AI_HANDLING → WAITING_HUMAN → HUMAN_HANDLING → RESOLVED → CLOSED
                  ↓
                SPAM
```

### Supported Workflow
- New inbound message
- AI auto-reply
- Tool execution
- Human escalation
- Agent claim
- Resolution
- Re-open on new message

---

## ⚙️ Planned / Supported Modules

- [x] Multi-tenant auth architecture
- [x] WhatsApp session handling
- [x] CRM schema design
- [x] AI provider abstraction
- [x] Payment abstraction
- [x] Monitoring architecture
- [x] Production deployment plan
- [ ] Full implementation in progress

---

## 🚀 Getting Started

### Requirements
- Node.js 20+
- Docker
- Docker Compose
- PostgreSQL
- Redis

### Clone the repository

```bash
git clone https://github.com/Sapheron/Open-Agent-CRM.git
cd Open-Agent-CRM
```

### Install dependencies

```bash
npm install
```

### Setup environment

```bash
cp .env.example .env
```

Update your `.env` values before starting services.

### Start development services

```bash
docker compose -f deploy/docker-compose.dev.yml up -d
```

### Run development

```bash
npm run dev
```

---

## 📌 Roadmap

### Stage 1
- Database schema
- Prisma migrations
- Shared package setup

### Stage 2
- Auth system
- Multi-tenant guards
- CRM CRUD APIs

### Stage 3
- WhatsApp service
- QR flow
- Real-time inbox

### Stage 4
- AI provider adapters
- Tool system
- Agent loop

### Stage 5
- Dashboard UI
- Payments
- Analytics
- Monitoring
- Production deploy

---

## 🛡️ Security Notes

Open Agent CRM is designed with security in mind:

- Encrypted credential storage
- JWT auth with token rotation
- Company-scoped resource access
- Input validation and sanitization
- Audit logs for key actions
- Queue-based background processing
- Rate limiting and warmup protections

---

## ⚠️ Disclaimer

Open Agent CRM is an **independent open-source project** and is **not affiliated with, endorsed by, or sponsored by WhatsApp, Meta, OpenAI, Google, Anthropic, Stripe, Razorpay, or any other third-party provider**.

Users are responsible for complying with:
- local laws and regulations
- messaging platform policies
- payment provider terms
- AI provider usage policies
- privacy and data protection obligations

---

## 🤝 Contributing

Contributions are welcome.

If you’d like to contribute:
- fork the repository
- create a feature branch
- make your changes
- open a pull request

More contributor documentation will be added under `/docs`.

---

## 📄 License

This project is licensed under the **MIT License**.

---

## 🏢 Organization

**Maintained under:** `Sapheron`

**From:** **TechnoTaLim Platform and Services LLP**

**Developer:** **ASHIK K I**

---

## 👥 Contributors

- **ASHIK K I** — Creator & Lead Developer  
- **SANWEER K T** — Contributor  

---

## ⭐ Star History

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Sapheron/Open-Agent-CRM&type=Date)](https://star-history.com/#Sapheron/Open-Agent-CRM&Date)

![Repo Size](https://img.shields.io/github/repo-size/Sapheron/Open-Agent-CRM)
![Code Size](https://img.shields.io/github/languages/code-size/Sapheron/Open-Agent-CRM)
![Top Language](https://img.shields.io/github/languages/top/Sapheron/Open-Agent-CRM)
![Commit Activity](https://img.shields.io/github/commit-activity/m/Sapheron/Open-Agent-CRM)

<p align="center">
  <a href="https://github.com/Sapheron/Open-Agent-CRM/issues">Report Bug</a> •
  <a href="https://github.com/Sapheron/Open-Agent-CRM/issues">Request Feature</a> •
  <a href="https://github.com/Sapheron/Open-Agent-CRM/discussions">Discussions</a> •
  <a href="https://github.com/Sapheron/Open-Agent-CRM">Documentation</a>
</p>

