#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║          OpenAgent CRM — One-Command Installer                             ║
# ║          https://openagentcrm.sapheron.in                                  ║
# ╚══════════════════════════════════════════════════════════════════════════════╝
set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

# ── Config ────────────────────────────────────────────────────────────────────
INSTALL_DIR="${INSTALL_DIR:-/opt/openagentcrm}"
REPO_URL="${REPO_URL:-https://github.com/yourorg/whatsapp-ai-crm}"
COMPOSE_FILE="$INSTALL_DIR/deploy/docker-compose.yml"
TOTAL_STEPS=8

# ── Helpers ───────────────────────────────────────────────────────────────────
step()  { echo -e "\n${BOLD}${CYAN}┌─[${NC}${BOLD} STEP $1/$TOTAL_STEPS — $2 ${CYAN}]${NC}"; }
ok()    { echo -e "  ${GREEN}✔  $1${NC}"; }
warn()  { echo -e "  ${YELLOW}⚠  $1${NC}"; }
fail()  { echo -e "\n  ${RED}✖  ERROR: $1${NC}\n"; exit 1; }
info()  { echo -e "  ${BLUE}→  $1${NC}"; }
rand_hex() { openssl rand -hex "${1:-32}"; }

# Idempotency helper — shows what's done and asks to skip or redo
ask_skip() {
  local msg="$1"
  ok "Already done: $msg"
  if [[ "${CI:-false}" == "true" ]] || [[ "${FORCE:-false}" == "true" ]]; then
    return 0  # auto-skip in CI / force mode
  fi
  while true; do
    read -rp "  $(echo -e "${YELLOW}Skip this step?${NC}") [Y/n]: " choice
    case "${choice:-Y}" in
      [Yy]*) return 0 ;;
      [Nn]*) return 1 ;;
      *) echo "  Please answer Y or n." ;;
    esac
  done
}

# ── Banner ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}${BOLD}"
echo "  ╔═══════════════════════════════════════════════════╗"
echo "  ║        OpenAgent CRM — Installer v1.0            ║"
echo "  ║    WhatsApp AI CRM • Self-hosted • Open Source    ║"
echo "  ╚═══════════════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "  Install dir: ${BLUE}$INSTALL_DIR${NC}"
echo -e "  Repo:        ${BLUE}$REPO_URL${NC}"
echo ""

# ════════════════════════════════════════════════════════════════════════════
# STEP 1 — OS CHECK
# ════════════════════════════════════════════════════════════════════════════
step 1 "Operating system"

OS=$(uname -s)
ARCH=$(uname -m)

case "$OS" in
  Linux)
    if [[ -f /etc/os-release ]]; then
      source /etc/os-release
      DISTRO="${PRETTY_NAME:-Linux}"
    else
      DISTRO="Linux"
    fi
    ok "OS: $DISTRO ($ARCH)"
    ;;
  Darwin)
    MACOS_VER=$(sw_vers -productVersion)
    ok "OS: macOS $MACOS_VER ($ARCH) — development mode"
    warn "For production, use Ubuntu 22.04+ on a VPS"
    ;;
  *)
    fail "Unsupported OS: $OS. Use Ubuntu 22.04+, Debian 12+, or macOS."
    ;;
esac

# ════════════════════════════════════════════════════════════════════════════
# STEP 2 — DOCKER
# ════════════════════════════════════════════════════════════════════════════
step 2 "Docker & Docker Compose"

if command -v docker &>/dev/null; then
  DOCKER_VER=$(docker --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  if ask_skip "Docker $DOCKER_VER is installed"; then
    ok "Using Docker $DOCKER_VER"
  else
    info "Reinstall skipped — remove manually if needed"
  fi
else
  info "Docker not found — installing..."
  if [[ "$OS" == "Linux" ]]; then
    curl -fsSL https://get.docker.com | sh
    if command -v systemctl &>/dev/null; then
      systemctl enable --now docker
      # Add current user to docker group
      usermod -aG docker "${SUDO_USER:-$USER}" 2>/dev/null || true
    fi
    ok "Docker installed"
  else
    fail "Install Docker Desktop from https://docker.com/products/docker-desktop then re-run"
  fi
fi

if ! docker compose version &>/dev/null 2>&1; then
  info "Installing Docker Compose plugin..."
  if [[ "$OS" == "Linux" ]]; then
    apt-get install -y docker-compose-plugin 2>/dev/null || \
      fail "Could not install docker-compose-plugin. Install manually: https://docs.docker.com/compose/install/"
  else
    fail "Update Docker Desktop to get the Compose plugin"
  fi
fi

COMPOSE_VER=$(docker compose version --short 2>/dev/null || echo "unknown")
ok "Docker Compose $COMPOSE_VER ready"

# ════════════════════════════════════════════════════════════════════════════
# STEP 3 — CODE
# ════════════════════════════════════════════════════════════════════════════
step 3 "Download / update code"

if [[ -d "$INSTALL_DIR/.git" ]]; then
  if ask_skip "Code already at $INSTALL_DIR"; then
    ok "Using existing code"
  else
    info "Pulling latest changes..."
    git -C "$INSTALL_DIR" pull origin main
    ok "Code updated"
  fi
else
  info "Cloning repository..."
  git clone "$REPO_URL" "$INSTALL_DIR"
  ok "Code cloned to $INSTALL_DIR"
fi

cd "$INSTALL_DIR"

# ════════════════════════════════════════════════════════════════════════════
# STEP 4 — ENVIRONMENT CONFIG
# ════════════════════════════════════════════════════════════════════════════
step 4 "Environment configuration"

if [[ -f "$INSTALL_DIR/.env" ]]; then
  if ask_skip ".env already configured"; then
    ok "Using existing .env"
  else
    write_env
  fi
else
  write_env
fi

write_env() {
  echo ""
  echo -e "  ${BOLD}Configure your installation:${NC}"
  echo ""

  read -rp "  $(echo -e "${CYAN}Domain${NC}") (e.g. crm.company.com): " DOMAIN
  [[ -z "$DOMAIN" ]] && fail "Domain is required"

  read -rp "  $(echo -e "${CYAN}Admin email${NC}"): " ADMIN_EMAIL
  [[ -z "$ADMIN_EMAIL" ]] && fail "Admin email is required"

  while true; do
    read -rsp "  $(echo -e "${CYAN}Admin password${NC}") (min 8 chars): " ADMIN_PASSWORD
    echo ""
    [[ ${#ADMIN_PASSWORD} -ge 8 ]] && break
    warn "Password must be at least 8 characters"
  done

  read -rsp "  $(echo -e "${CYAN}Database password${NC}"): " DB_PASSWORD
  echo ""
  [[ -z "$DB_PASSWORD" ]] && DB_PASSWORD=$(rand_hex 16)

  MINIO_SECRET=$(rand_hex 16)
  JWT_SECRET=$(rand_hex 32)
  REFRESH_TOKEN_SECRET=$(rand_hex 32)
  ENCRYPTION_KEY=$(rand_hex 32)
  GRAFANA_PASSWORD=$(rand_hex 12)
  ACME_EMAIL="${ADMIN_EMAIL}"

  cat > "$INSTALL_DIR/.env" << ENVEOF
# ── OpenAgent CRM — Environment ──────────────────────────────────────────────
# Generated by installer on $(date -u '+%Y-%m-%d %H:%M UTC')
# DO NOT add AI/payment keys here — configure those from the dashboard.

# ── App ──────────────────────────────────────────────────────────────────────
NODE_ENV=production
DOMAIN=${DOMAIN}
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}

# ── Database ─────────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://crm:${DB_PASSWORD}@pgbouncer:5432/wacrm
DIRECT_DATABASE_URL=postgresql://crm:${DB_PASSWORD}@postgres:5432/wacrm
DB_USER=crm
DB_PASSWORD=${DB_PASSWORD}
DB_NAME=wacrm

# ── Redis ─────────────────────────────────────────────────────────────────────
REDIS_URL=redis://redis:6379

# ── JWT ──────────────────────────────────────────────────────────────────────
JWT_SECRET=${JWT_SECRET}
REFRESH_TOKEN_SECRET=${REFRESH_TOKEN_SECRET}
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# ── Encryption (AES-256-GCM for API keys stored in DB) ───────────────────────
ENCRYPTION_KEY=${ENCRYPTION_KEY}

# ── MinIO ────────────────────────────────────────────────────────────────────
MINIO_ENDPOINT=minio
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=${MINIO_SECRET}
MINIO_BUCKET=wacrm-media
MINIO_PUBLIC_URL=https://${DOMAIN}/media

# ── Observability ────────────────────────────────────────────────────────────
GRAFANA_PASSWORD=${GRAFANA_PASSWORD}
LOG_LEVEL=info

# ── Traefik ──────────────────────────────────────────────────────────────────
ACME_EMAIL=${ACME_EMAIL}

# ── Ports (internal) ─────────────────────────────────────────────────────────
API_PORT=3000
DASHBOARD_PORT=3001
ENVEOF

  ok ".env written to $INSTALL_DIR/.env"
  info "Grafana password: ${GRAFANA_PASSWORD} (save this!)"
}

# ════════════════════════════════════════════════════════════════════════════
# STEP 5 — PULL / BUILD IMAGES
# ════════════════════════════════════════════════════════════════════════════
step 5 "Docker images"

IMAGES_EXIST=$(docker images --format "{{.Repository}}" 2>/dev/null | grep -c "openagentcrm" || true)

if [[ "$IMAGES_EXIST" -gt 0 ]]; then
  if ask_skip "Images already built/pulled ($IMAGES_EXIST found)"; then
    ok "Using cached images"
  else
    info "Rebuilding images..."
    docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" build --quiet
    ok "Images rebuilt"
  fi
else
  info "Pulling pre-built images (or building locally)..."
  docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" pull --quiet 2>/dev/null || true
  docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" build --quiet
  ok "Images ready"
fi

# ════════════════════════════════════════════════════════════════════════════
# STEP 6 — START INFRASTRUCTURE
# ════════════════════════════════════════════════════════════════════════════
step 6 "Infrastructure services (postgres, redis, minio)"

INFRA_RUNNING=$(docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" \
  ps -q postgres redis minio pgbouncer 2>/dev/null | wc -l | tr -d ' ')

if [[ "$INFRA_RUNNING" -ge 4 ]]; then
  if ask_skip "Infrastructure services already running ($INFRA_RUNNING containers)"; then
    ok "Using running infrastructure"
  else
    docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" \
      up -d postgres redis minio pgbouncer
    ok "Infrastructure restarted"
  fi
else
  info "Starting infrastructure services..."
  docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" \
    up -d postgres redis minio pgbouncer

  info "Waiting for health checks (up to 60s)..."
  for svc in postgres redis; do
    for i in $(seq 1 20); do
      HEALTH=$(docker inspect \
        "$(docker compose -f "$COMPOSE_FILE" ps -q "$svc" 2>/dev/null)" \
        --format '{{.State.Health.Status}}' 2>/dev/null || echo "starting")
      if [[ "$HEALTH" == "healthy" ]]; then
        ok "$svc is healthy"
        break
      fi
      [[ $i -eq 20 ]] && warn "$svc health check timed out (may still be starting)"
      sleep 3
    done
  done
fi

# ════════════════════════════════════════════════════════════════════════════
# STEP 7 — DATABASE MIGRATIONS & SEED
# ════════════════════════════════════════════════════════════════════════════
step 7 "Database migrations & seed"

MIGRATION_DONE=$(docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" \
  run --rm api sh -c \
  "npx prisma migrate status --schema=packages/database/prisma/schema.prisma 2>&1 | grep -c 'Database schema is up to date'" \
  2>/dev/null || echo "0")

if [[ "$MIGRATION_DONE" -gt 0 ]]; then
  if ask_skip "Migrations already up to date"; then
    ok "Migrations current"
  else
    info "Re-running migrations..."
    docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" \
      run --rm api sh -c \
      "npx prisma migrate deploy --schema=packages/database/prisma/schema.prisma"
    ok "Migrations applied"
  fi
else
  info "Running database migrations..."
  docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" \
    run --rm api sh -c \
    "npx prisma migrate deploy --schema=packages/database/prisma/schema.prisma"
  ok "Migrations applied"
fi

USER_COUNT=$(docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" \
  run --rm api sh -c \
  "node -e \"const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.user.count().then(n=>{console.log(n);p.\$disconnect()})\"" \
  2>/dev/null | tail -1 || echo "0")

if [[ "${USER_COUNT:-0}" -gt 0 ]]; then
  if ask_skip "Admin user already seeded ($USER_COUNT users found)"; then
    ok "Skipping seed"
  else
    info "Re-seeding..."
    docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" \
      run --rm api sh -c "npx tsx packages/database/prisma/seed.ts"
    ok "Database re-seeded"
  fi
else
  info "Seeding database with admin user..."
  docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" \
    run --rm api sh -c "npx tsx packages/database/prisma/seed.ts"
  ok "Database seeded"
fi

# ════════════════════════════════════════════════════════════════════════════
# STEP 8 — START APPLICATION
# ════════════════════════════════════════════════════════════════════════════
step 8 "Start application"

info "Starting all services..."
docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" up -d

info "Waiting for application to be ready (up to 30s)..."
for i in $(seq 1 10); do
  HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" \
    "http://localhost:3000/api/health" 2>/dev/null || echo "000")
  if [[ "$HTTP_CODE" == "200" ]]; then
    ok "API is healthy"
    break
  fi
  [[ $i -eq 10 ]] && warn "API health check timed out — check logs with: docker compose logs api"
  sleep 3
done

DOMAIN_VAL=$(grep -E "^DOMAIN=" "$INSTALL_DIR/.env" | cut -d= -f2 2>/dev/null || echo "localhost")

# ════════════════════════════════════════════════════════════════════════════
# DONE
# ════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║   ✅  OpenAgent CRM is ready!                       ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Dashboard:${NC}   ${BLUE}https://${DOMAIN_VAL}${NC}"
echo -e "  ${BOLD}API Docs:${NC}    ${BLUE}https://${DOMAIN_VAL}/api/docs${NC}"
echo -e "  ${BOLD}Grafana:${NC}     ${BLUE}https://${DOMAIN_VAL}/grafana${NC}"
echo ""
echo -e "  ${YELLOW}${BOLD}Next step:${NC} Open the dashboard and complete the 6-step setup wizard"
echo -e "  ${YELLOW}(configure WhatsApp, AI provider, and payment gateway from the UI)${NC}"
echo ""
echo -e "  ${BOLD}Useful commands:${NC}"
echo -e "  ${CYAN}docker compose -f $COMPOSE_FILE logs -f api${NC}"
echo -e "  ${CYAN}docker compose -f $COMPOSE_FILE ps${NC}"
echo -e "  ${CYAN}docker compose -f $COMPOSE_FILE restart${NC}"
echo -e "  ${CYAN}docker compose -f $COMPOSE_FILE down${NC}"
echo ""
echo -e "  ${BOLD}Reinstall / update anytime:${NC}"
echo -e "  ${CYAN}curl -fsSL https://openagentcrm.sapheron.in/install.sh | bash${NC}"
echo ""
echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════════${NC}"
echo ""
