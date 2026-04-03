#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║          Open Agent CRM — One-Command Installer                            ║
# ║          https://openagentcrm.sapheron.com                                  ║
# ╚══════════════════════════════════════════════════════════════════════════════╝
set -euo pipefail

main() {

# ── Colors ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

# ── Config ────────────────────────────────────────────────────────────────────
INSTALL_DIR="${INSTALL_DIR:-/opt/openagentcrm}"
REPO_URL="${REPO_URL:-https://github.com/Sapheron/Open-Agent-CRM.git}"
COMPOSE_FILE="$INSTALL_DIR/deploy/docker-compose.yml"
TOTAL_STEPS=7

# ── Helpers ───────────────────────────────────────────────────────────────────
step()     { echo -e "\n${BOLD}${CYAN}┌─[${NC}${BOLD} STEP $1/$TOTAL_STEPS — $2 ${CYAN}]${NC}"; }
ok()       { echo -e "  ${GREEN}✔  $1${NC}"; }
warn()     { echo -e "  ${YELLOW}⚠  $1${NC}"; }
fail()     { echo -e "\n  ${RED}✖  ERROR: $1${NC}\n"; exit 1; }
info()     { echo -e "  ${BLUE}→  $1${NC}"; }
rand_hex() { openssl rand -hex "${1:-32}"; }

ask_skip() {
  local msg="$1"
  ok "Already done: $msg"
  if [[ "${CI:-false}" == "true" ]] || [[ "${FORCE:-false}" == "true" ]]; then
    return 0
  fi
  while true; do
    read -rp "  $(echo -e "${YELLOW}Skip this step?${NC}") [Y/n]: " choice < /dev/tty
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
echo "  ║       Open Agent CRM — Installer v1.0            ║"
echo "  ║    WhatsApp AI CRM • Self-hosted • Open Source    ║"
echo "  ║         A Sapheron Project                        ║"
echo "  ╚═══════════════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "  Install dir : ${BLUE}$INSTALL_DIR${NC}"
echo -e "  Repo        : ${BLUE}$REPO_URL${NC}"
echo ""
echo -e "  ${YELLOW}Note: SSL and reverse proxy are NOT set up automatically.${NC}"
echo -e "  ${YELLOW}Instructions will be printed at the end.${NC}"
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
  fi
else
  info "Docker not found — installing..."
  if [[ "$OS" == "Linux" ]]; then
    curl -fsSL https://get.docker.com | sh
    if command -v systemctl &>/dev/null; then
      systemctl enable --now docker
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
      fail "Could not install docker-compose-plugin. See: https://docs.docker.com/compose/install/"
  else
    fail "Update Docker Desktop to get the Compose plugin"
  fi
fi

COMPOSE_VER=$(docker compose version --short 2>/dev/null || echo "unknown")
ok "Docker Compose $COMPOSE_VER ready"

# ════════════════════════════════════════════════════════════════════════════
# STEP 3 — DOWNLOAD CODE
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

write_env() {
  echo ""
  echo -e "  ${BOLD}Configure your installation:${NC}"
  echo ""

  read -rp "  $(echo -e "${CYAN}Admin email${NC}"): " ADMIN_EMAIL < /dev/tty
  [[ -z "$ADMIN_EMAIL" ]] && fail "Admin email is required"

  while true; do
    read -rsp "  $(echo -e "${CYAN}Admin password${NC}") (min 8 chars): " ADMIN_PASSWORD < /dev/tty
    echo ""
    [[ ${#ADMIN_PASSWORD} -ge 8 ]] && break
    warn "Password must be at least 8 characters"
  done

  read -rsp "  $(echo -e "${CYAN}Database password${NC}") (press Enter to auto-generate): " DB_PASSWORD < /dev/tty
  echo ""
  [[ -z "$DB_PASSWORD" ]] && DB_PASSWORD=$(rand_hex 16) && info "Database password auto-generated"

  MINIO_SECRET=$(rand_hex 16)
  JWT_SECRET=$(rand_hex 32)
  REFRESH_TOKEN_SECRET=$(rand_hex 32)
  ENCRYPTION_KEY=$(rand_hex 32)
  GRAFANA_PASSWORD=$(rand_hex 12)

  cat > "$INSTALL_DIR/.env" << ENVEOF
# ── Open Agent CRM — Environment ─────────────────────────────────────────────
# Generated by installer on $(date -u '+%Y-%m-%d %H:%M UTC')
#
# AI provider keys and payment gateway keys are configured from the dashboard.
# Do NOT add them here.
#
# Set DOMAIN and API_PUBLIC_URL after you configure your reverse proxy.

# ── App ──────────────────────────────────────────────────────────────────────
NODE_ENV=production
DOMAIN=localhost
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}

# ── Update these after setting up your reverse proxy ─────────────────────────
# DOMAIN=crm.yourcompany.com
# API_PUBLIC_URL=https://crm.yourcompany.com

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

# ── Encryption (AES-256-GCM — encrypts AI + payment keys in DB) ──────────────
ENCRYPTION_KEY=${ENCRYPTION_KEY}

# ── MinIO ────────────────────────────────────────────────────────────────────
MINIO_ENDPOINT=minio
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=${MINIO_SECRET}
MINIO_BUCKET=wacrm-media

# ── Observability ────────────────────────────────────────────────────────────
GRAFANA_PASSWORD=${GRAFANA_PASSWORD}
LOG_LEVEL=info

# ── Ports ────────────────────────────────────────────────────────────────────
API_PORT=3000
DASHBOARD_PORT=3001
ENVEOF

  ok ".env written to $INSTALL_DIR/.env"
  echo ""
  echo -e "  ${YELLOW}${BOLD}Save these — you will need them:${NC}"
  echo -e "  Admin email    : ${CYAN}${ADMIN_EMAIL}${NC}"
  echo -e "  Admin password : ${CYAN}${ADMIN_PASSWORD}${NC}"
  echo -e "  Grafana        : ${CYAN}${GRAFANA_PASSWORD}${NC}"
}

if [[ -f "$INSTALL_DIR/.env" ]]; then
  if ask_skip ".env already configured"; then
    ok "Using existing .env"
  else
    write_env
  fi
else
  write_env
fi

# ════════════════════════════════════════════════════════════════════════════
# STEP 5 — DOCKER IMAGES
# ════════════════════════════════════════════════════════════════════════════
step 5 "Docker images"

IMAGES_EXIST=$(docker images --format "{{.Repository}}" 2>/dev/null | grep -c "open-agent-crm" || true)

if [[ "$IMAGES_EXIST" -gt 0 ]]; then
  if ask_skip "Images already built/pulled ($IMAGES_EXIST found)"; then
    ok "Using cached images"
  else
    info "Rebuilding images..."
    docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" build
    ok "Images rebuilt"
  fi
else
  info "Pulling pre-built images..."
  docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" pull --quiet 2>/dev/null || true
  info "Building any missing images..."
  docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" build
  ok "Images ready"
fi

# ════════════════════════════════════════════════════════════════════════════
# STEP 6 — START INFRASTRUCTURE
# ════════════════════════════════════════════════════════════════════════════
step 6 "Infrastructure (postgres, redis, minio, pgbouncer)"

INFRA_RUNNING=$(docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" \
  ps -q postgres redis minio pgbouncer 2>/dev/null | wc -l | tr -d ' ')

if [[ "$INFRA_RUNNING" -ge 4 ]]; then
  if ask_skip "Infrastructure already running ($INFRA_RUNNING containers)"; then
    ok "Using running infrastructure"
  else
    docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" \
      up -d postgres redis minio pgbouncer
    ok "Infrastructure restarted"
  fi
else
  info "Starting postgres, redis, minio, pgbouncer..."
  docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" \
    up -d postgres redis minio pgbouncer

  info "Waiting for health checks (up to 60s)..."
  for svc in postgres redis; do
    for i in $(seq 1 20); do
      HEALTH=$(docker inspect \
        "$(docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" ps -q "$svc" 2>/dev/null)" \
        --format '{{.State.Health.Status}}' 2>/dev/null || echo "starting")
      if [[ "$HEALTH" == "healthy" ]]; then
        ok "$svc is healthy"
        break
      fi
      [[ $i -eq 20 ]] && warn "$svc health check timed out — may still be starting"
      sleep 3
    done
  done
fi

# ════════════════════════════════════════════════════════════════════════════
# STEP 7 — DATABASE + START APP
# ════════════════════════════════════════════════════════════════════════════
step 7 "Database migrations, seed & start"

# Migrations
MIGRATION_RES=$(docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" \
  run --rm api sh -c \
  "npx --yes prisma@6 migrate status --schema=prisma/schema.prisma 2>&1 | grep -c 'Database schema is up to date'" \
  2>/dev/null || echo "0")
MIGRATION_DONE=$(echo "$MIGRATION_RES" | grep -o '[0-9]\+' | tail -1)
MIGRATION_DONE=${MIGRATION_DONE:-0}

if [[ "$MIGRATION_DONE" -gt 0 ]]; then
  if ask_skip "Migrations already up to date"; then
    ok "Migrations current"
  else
    docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" \
      run --rm api sh -c \
      "npx --yes prisma@6 migrate deploy --schema=prisma/schema.prisma"
    ok "Migrations applied"
  fi
else
  info "Running database migrations..."
  docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" \
    run --rm api sh -c \
    "npx --yes prisma@6 migrate deploy --schema=prisma/schema.prisma"
  ok "Migrations applied"
fi

# Seed
USER_RES=$(docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" \
  run --rm api sh -c \
  "node -e \"const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.user.count().then(n=>{console.log(n);p.\$disconnect()}).catch(()=>console.log(0))\"" \
  2>/dev/null || echo "0")
USER_COUNT=$(echo "$USER_RES" | grep -o '[0-9]\+' | tail -1)
USER_COUNT=${USER_COUNT:-0}

if [[ "${USER_COUNT:-0}" -gt 0 ]]; then
  if ask_skip "Admin user already seeded ($USER_COUNT users found)"; then
    ok "Skipping seed"
  else
    docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" \
      run --rm api sh -c "npx --yes tsx@4 prisma/seed.ts"
    ok "Database re-seeded"
  fi
else
  info "Seeding admin user..."
  docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" \
    run --rm api sh -c "npx --yes tsx@4 prisma/seed.ts"
  ok "Admin user created"
fi

# Start all services
info "Starting all services..."
docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" up -d

info "Waiting for API to be ready (up to 30s)..."
for i in $(seq 1 10); do
  HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" \
    "http://localhost:3000/api/health" 2>/dev/null || echo "000")
  if [[ "$HTTP_CODE" == "200" ]]; then
    ok "API is healthy (http://localhost:3000)"
    break
  fi
  [[ $i -eq 10 ]] && warn "API not responding yet — check: docker compose logs api"
  sleep 3
done

# ════════════════════════════════════════════════════════════════════════════
# DONE
# ════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║   ✅  Open Agent CRM is running!                            ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}Services are running on localhost:${NC}"
echo -e "  ${CYAN}Dashboard  →  http://localhost:3001${NC}"
echo -e "  ${CYAN}API        →  http://localhost:3000/api${NC}"
echo -e "  ${CYAN}API Docs   →  http://localhost:3000/api/docs${NC}"
echo -e "  ${CYAN}Grafana    →  http://localhost:3002${NC}"
echo -e "  ${CYAN}MinIO UI   →  http://localhost:9001${NC}"
echo ""
echo -e "  ${BOLD}Useful commands:${NC}"
echo -e "  ${CYAN}docker compose -f $COMPOSE_FILE logs -f${NC}"
echo -e "  ${CYAN}docker compose -f $COMPOSE_FILE ps${NC}"
echo -e "  ${CYAN}docker compose -f $COMPOSE_FILE restart${NC}"
echo -e "  ${CYAN}docker compose -f $COMPOSE_FILE down${NC}"
echo ""

# ════════════════════════════════════════════════════════════════════════════
# PROXY SETUP INSTRUCTIONS
# ════════════════════════════════════════════════════════════════════════════
echo -e "${YELLOW}${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${YELLOW}${BOLD}║   ⚙  NEXT STEP: Set up your reverse proxy + SSL            ║${NC}"
echo -e "${YELLOW}${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  All services are on ${BOLD}localhost only${NC} (127.0.0.1)."
echo -e "  You need a reverse proxy to expose them to the internet."
echo -e "  Choose the one you already have — or install nginx:"
echo ""

echo -e "${BOLD}  ── Option 1: nginx ─────────────────────────────────────────────${NC}"
echo ""
echo -e "  ${BLUE}# Install nginx (if not already installed)${NC}"
echo -e "  ${CYAN}sudo apt install nginx -y${NC}"
echo ""
echo -e "  ${BLUE}# Create site config${NC}"
echo -e "  ${CYAN}sudo nano /etc/nginx/sites-available/openagentcrm${NC}"
echo ""
cat << 'NGINX_BLOCK'
  Paste this config:
  ─────────────────────────────────────────────────────────────
  server {
      listen 80;
      server_name YOUR_DOMAIN;

      # Dashboard
      location / {
          proxy_pass http://127.0.0.1:3001;
          proxy_set_header Host $host;
          proxy_set_header X-Real-IP $remote_addr;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
          proxy_set_header X-Forwarded-Proto $scheme;
      }

      # API + WebSocket
      location /api {
          proxy_pass http://127.0.0.1:3000;
          proxy_http_version 1.1;
          proxy_set_header Upgrade $http_upgrade;
          proxy_set_header Connection "upgrade";
          proxy_set_header Host $host;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
          proxy_set_header X-Forwarded-Proto $scheme;
      }

      # Grafana
      location /grafana {
          proxy_pass http://127.0.0.1:3002;
          proxy_set_header Host $host;
      }

      # MinIO media
      location /media {
          proxy_pass http://127.0.0.1:9000;
          proxy_set_header Host $host;
      }
  }
  ─────────────────────────────────────────────────────────────
NGINX_BLOCK
echo ""
echo -e "  ${BLUE}# Enable site and reload nginx${NC}"
echo -e "  ${CYAN}sudo ln -s /etc/nginx/sites-available/openagentcrm /etc/nginx/sites-enabled/${NC}"
echo -e "  ${CYAN}sudo nginx -t && sudo systemctl reload nginx${NC}"
echo ""
echo -e "  ${BLUE}# Add SSL with certbot (Let's Encrypt — free)${NC}"
echo -e "  ${CYAN}sudo apt install certbot python3-certbot-nginx -y${NC}"
echo -e "  ${CYAN}sudo certbot --nginx -d YOUR_DOMAIN${NC}"
echo ""

echo -e "${BOLD}  ── Option 2: Caddy ─────────────────────────────────────────────${NC}"
echo ""
echo -e "  ${BLUE}# Add to /etc/caddy/Caddyfile${NC}"
cat << 'CADDY_BLOCK'
  ─────────────────────────────────────────────────────────────
  YOUR_DOMAIN {
      reverse_proxy /api* localhost:3000
      reverse_proxy /grafana* localhost:3002
      reverse_proxy /media* localhost:9000
      reverse_proxy * localhost:3001
  }
  ─────────────────────────────────────────────────────────────
CADDY_BLOCK
echo ""
echo -e "  ${CYAN}sudo systemctl reload caddy${NC}"
echo -e "  ${BLUE}# Caddy handles SSL automatically — no certbot needed${NC}"
echo ""

echo -e "${BOLD}  ── After proxy setup ────────────────────────────────────────────${NC}"
echo ""
echo -e "  1. Edit ${CYAN}$INSTALL_DIR/.env${NC}"
echo -e "     Uncomment and set:"
echo -e "     ${CYAN}DOMAIN=YOUR_DOMAIN${NC}"
echo -e "     ${CYAN}API_PUBLIC_URL=https://YOUR_DOMAIN${NC}"
echo ""
echo -e "  2. Restart the dashboard to pick up the new API URL:"
echo -e "     ${CYAN}docker compose -f $COMPOSE_FILE restart dashboard${NC}"
echo ""
echo -e "  3. Open ${CYAN}https://YOUR_DOMAIN${NC} — log in and complete the setup wizard."
echo ""
echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════════════════${NC}"
echo ""

} # end main()

# Execute — wrapping in main() ensures the entire script is downloaded
# and parsed before any code runs (critical for curl|bash installs).
main "$@"
