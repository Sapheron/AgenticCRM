#!/bin/bash
set -euo pipefail

# ─── Colors ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

INSTALL_DIR="${INSTALL_DIR:-/opt/wacrm}"
REPO_URL="${REPO_URL:-https://github.com/yourorg/whatsapp-ai-crm}"
COMPOSE_FILE="$INSTALL_DIR/deploy/docker-compose.yml"
TOTAL_STEPS=8

# ─── Helpers ──────────────────────────────────────────────────────────────────
step()  { echo -e "\n${BOLD}${BLUE}[STEP $1/$TOTAL_STEPS]${NC} $2"; }
ok()    { echo -e "  ${GREEN}✅ $1${NC}"; }
warn()  { echo -e "  ${YELLOW}⚠  $1${NC}"; }
fail()  { echo -e "  ${RED}✗  $1${NC}"; exit 1; }
info()  { echo -e "  ${BLUE}ℹ  $1${NC}"; }

# Ask user if they want to skip a completed step
maybe_skip() {
  local reason="$1"
  ok "$reason"
  read -rp "  ⏭  Skip this step? [Y/n]: " choice
  [[ "${choice:-Y}" =~ ^[Yy]$ ]] && return 0 || return 1
}

# Generate a random hex string
rand_hex() { openssl rand -hex "${1:-32}"; }

# ─── STEP 1: OS Check ─────────────────────────────────────────────────────────
step 1 "Check operating system"
OS=$(uname -s)
if [[ "$OS" == "Linux" ]]; then
  if [[ -f /etc/os-release ]]; then
    DISTRO=$(. /etc/os-release && echo "$NAME $VERSION_ID")
    ok "Detected: $DISTRO"
  else
    warn "Linux detected but /etc/os-release not found"
  fi
elif [[ "$OS" == "Darwin" ]]; then
  ok "Detected: macOS $(sw_vers -productVersion) (dev mode)"
else
  fail "Unsupported OS: $OS. Please use Ubuntu 20.04+, Debian 11+, or macOS."
fi

# ─── STEP 2: Docker Check ─────────────────────────────────────────────────────
step 2 "Check Docker"
DOCKER_OK=true
if ! command -v docker &>/dev/null; then
  warn "Docker not found"
  DOCKER_OK=false
  if [[ "$OS" == "Linux" ]]; then
    info "Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    if command -v systemctl &>/dev/null; then
      systemctl enable docker --quiet
      systemctl start docker --quiet
    fi
    ok "Docker installed"
    DOCKER_OK=true
  else
    fail "Please install Docker Desktop from https://docker.com/products/docker-desktop"
  fi
fi

if [[ "$DOCKER_OK" == "true" ]]; then
  DOCKER_VER=$(docker --version | cut -d' ' -f3 | tr -d ',')
  ok "Docker $DOCKER_VER found"
fi

if ! docker compose version &>/dev/null 2>&1; then
  warn "Docker Compose plugin not found"
  if [[ "$OS" == "Linux" ]]; then
    apt-get install -y docker-compose-plugin 2>/dev/null || true
  else
    fail "Please update Docker Desktop to get the Compose plugin"
  fi
fi
COMPOSE_VER=$(docker compose version --short 2>/dev/null || echo "unknown")
ok "Docker Compose $COMPOSE_VER found"

# ─── STEP 3: Configuration ────────────────────────────────────────────────────
step 3 "Configuration"
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Clone or update repo
if [[ -d ".git" ]]; then
  if maybe_skip "Repo already cloned at $INSTALL_DIR"; then
    ok "Using existing repo"
  else
    info "Pulling latest changes..."
    git pull origin main
    ok "Repo updated"
  fi
else
  info "Cloning repo..."
  git clone "$REPO_URL" .
  ok "Repo cloned to $INSTALL_DIR"
fi

# .env setup
if [[ -f ".env" ]]; then
  if maybe_skip ".env file already exists"; then
    ok "Using existing .env"
  else
    collect_and_generate_env
  fi
else
  collect_and_generate_env
fi

collect_and_generate_env() {
  echo ""
  info "Let's configure your installation:"
  echo ""

  read -rp "  Domain (e.g. crm.company.com): " DOMAIN
  read -rp "  Admin email: " ADMIN_EMAIL
  read -rp "  Admin password (min 8 chars): " -s ADMIN_PASSWORD
  echo ""
  read -rp "  DB password: " -s DB_PASSWORD
  echo ""

  JWT_SECRET=$(rand_hex 32)
  ENCRYPTION_KEY=$(rand_hex 32)

  cat > .env << ENVEOF
# ─── APP ────────────────────────────────────────
NODE_ENV=production
DOMAIN=${DOMAIN}
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}

# ─── DATABASE ────────────────────────────────────
DATABASE_URL=postgresql://crm:${DB_PASSWORD}@pgbouncer:5432/wacrm
DIRECT_DATABASE_URL=postgresql://crm:${DB_PASSWORD}@postgres:5432/wacrm
DB_USER=crm
DB_PASSWORD=${DB_PASSWORD}
DB_NAME=wacrm

# ─── REDIS ────────────────────────────────────────
REDIS_URL=redis://redis:6379

# ─── JWT ──────────────────────────────────────────
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# ─── ENCRYPTION ───────────────────────────────────
ENCRYPTION_KEY=${ENCRYPTION_KEY}

# ─── MINIO ────────────────────────────────────────
MINIO_ENDPOINT=minio
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=$(rand_hex 16)
MINIO_BUCKET=wacrm-media

# ─── OBSERVABILITY ────────────────────────────────
GRAFANA_PASSWORD=$(rand_hex 12)
LOG_LEVEL=info

# ─── BACKUP ───────────────────────────────────────
BACKUP_RETENTION_DAYS=30
ENVEOF

  ok ".env created"
}

# ─── STEP 4: Pull images ──────────────────────────────────────────────────────
step 4 "Pull / build Docker images"
if maybe_skip "Images already pulled (skip to save time)"; then
  ok "Skipping image pull"
else
  docker compose -f "$COMPOSE_FILE" pull --quiet 2>/dev/null || true
  docker compose -f "$COMPOSE_FILE" build --quiet
  ok "Images ready"
fi

# ─── STEP 5: Start infrastructure ─────────────────────────────────────────────
step 5 "Start infrastructure services"

INFRA_RUNNING=$(docker compose -f "$COMPOSE_FILE" ps -q postgres redis minio pgbouncer 2>/dev/null | wc -l)
if [[ "$INFRA_RUNNING" -ge 4 ]]; then
  if maybe_skip "Infrastructure services already running"; then
    ok "Using running infrastructure"
  else
    docker compose -f "$COMPOSE_FILE" up -d postgres redis minio pgbouncer
  fi
else
  info "Starting postgres, redis, minio, pgbouncer..."
  docker compose -f "$COMPOSE_FILE" up -d postgres redis minio pgbouncer

  info "Waiting for services to be healthy..."
  sleep 5
  for svc in postgres redis; do
    for i in {1..20}; do
      STATUS=$(docker compose -f "$COMPOSE_FILE" ps --format json "$svc" 2>/dev/null | python3 -c "import sys,json; data=sys.stdin.read(); print(json.loads(data)[0].get('Health','') if data.strip().startswith('[') else json.loads(data).get('Health',''))" 2>/dev/null || echo "unknown")
      if [[ "$STATUS" == "healthy" ]]; then
        ok "$svc is healthy"
        break
      fi
      sleep 3
    done
  done
fi

# ─── STEP 6: Run migrations ───────────────────────────────────────────────────
step 6 "Run database migrations"

MIGRATION_STATUS=$(docker compose -f "$COMPOSE_FILE" run --rm api sh -c "cd packages/database && npx prisma migrate status --schema=prisma/schema.prisma 2>&1 | tail -1" 2>/dev/null || echo "error")

if echo "$MIGRATION_STATUS" | grep -q "Database schema is up to date"; then
  if maybe_skip "Migrations already up to date"; then
    ok "Migrations current"
  else
    docker compose -f "$COMPOSE_FILE" run --rm api sh -c "cd packages/database && npx prisma migrate deploy --schema=prisma/schema.prisma"
    ok "Migrations applied"
  fi
else
  info "Running migrations..."
  docker compose -f "$COMPOSE_FILE" run --rm api sh -c "cd packages/database && npx prisma migrate deploy --schema=prisma/schema.prisma"
  ok "Migrations applied"
fi

# ─── STEP 7: Seed database ────────────────────────────────────────────────────
step 7 "Seed database"

ADMIN_EXISTS=$(docker compose -f "$COMPOSE_FILE" run --rm api sh -c "cd packages/database && node -e \"const {prisma}=require('./src/client'); prisma.user.count().then(n=>process.exit(n>0?0:1)).catch(()=>process.exit(1))\"" 2>/dev/null && echo "yes" || echo "no")

if [[ "$ADMIN_EXISTS" == "yes" ]]; then
  if maybe_skip "Admin user already exists"; then
    ok "Skipping seed"
  else
    docker compose -f "$COMPOSE_FILE" run --rm api sh -c "cd packages/database && npx ts-node prisma/seed.ts"
    ok "Database seeded"
  fi
else
  info "Seeding database..."
  source .env 2>/dev/null || true
  docker compose -f "$COMPOSE_FILE" run --rm \
    -e ADMIN_EMAIL="${ADMIN_EMAIL}" \
    -e ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
    api sh -c "cd packages/database && npx ts-node prisma/seed.ts"
  ok "Database seeded"
fi

# ─── STEP 8: Start application ────────────────────────────────────────────────
step 8 "Start application services"

info "Starting api, whatsapp, worker, dashboard, traefik..."
docker compose -f "$COMPOSE_FILE" up -d

info "Waiting for application to be healthy..."
sleep 10

APP_OK=true
for svc in api dashboard; do
  STATUS=$(docker compose -f "$COMPOSE_FILE" ps --format "{{.Status}}" "$svc" 2>/dev/null || echo "unknown")
  if echo "$STATUS" | grep -qi "healthy\|up"; then
    ok "$svc is up"
  else
    warn "$svc may not be healthy yet (check: docker compose logs $svc)"
    APP_OK=false
  fi
done

# ─── DONE ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
if [[ "$APP_OK" == "true" ]]; then
  echo -e "${GREEN}${BOLD}✅  WhatsApp AI CRM is ready!${NC}"
else
  echo -e "${YELLOW}${BOLD}⚠   Setup complete but some services may need attention${NC}"
fi
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
DOMAIN_VAL=$(grep -E "^DOMAIN=" .env | cut -d= -f2 2>/dev/null || echo "localhost")
echo ""
echo -e "  Dashboard:  ${BLUE}https://${DOMAIN_VAL}${NC}"
echo -e "  API Docs:   ${BLUE}https://${DOMAIN_VAL}/api/docs${NC}"
echo -e "  Grafana:    ${BLUE}https://${DOMAIN_VAL}/grafana${NC}"
echo ""
echo -e "  ${YELLOW}Next step:${NC} Open the dashboard and complete the setup wizard"
echo -e "  ${YELLOW}(takes ~3 minutes to configure WhatsApp, AI, and payments)${NC}"
echo ""
echo -e "  Useful commands:"
echo -e "  ${BLUE}docker compose -f $COMPOSE_FILE logs -f api${NC}"
echo -e "  ${BLUE}docker compose -f $COMPOSE_FILE ps${NC}"
echo -e "  ${BLUE}docker compose -f $COMPOSE_FILE restart${NC}"
echo ""
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
