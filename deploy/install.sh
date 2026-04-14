#!/usr/bin/env bash
# AgenticCRM — One-Command Installer
# https://agenticcrm.sapheron.com
set -euo pipefail

main() {

# ── ANSI ──────────────────────────────────────────────────────────────────────
R='\033[0;31m'   # red
G='\033[0;32m'   # green
Y='\033[1;33m'   # yellow
B='\033[0;34m'   # blue
C='\033[0;36m'   # cyan
W='\033[1;37m'   # white
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# ── Config ────────────────────────────────────────────────────────────────────
INSTALL_DIR="${INSTALL_DIR:-/opt/agenticcrm}"
REPO_URL="${REPO_URL:-https://github.com/Sapheron/AgenticCRM.git}"
COMPOSE_FILE="$INSTALL_DIR/deploy/docker-compose.yml"
TOTAL_STEPS=7
CURRENT_STEP=0

# ── Spinner ───────────────────────────────────────────────────────────────────
_SPIN_PID=""
spinner_start() {
  local msg="$1"
  local frames=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
  (
    local i=0
    while true; do
      printf "\r  ${C}%s${NC}  ${DIM}%s${NC}" "${frames[$i]}" "$msg"
      i=$(( (i+1) % ${#frames[@]} ))
      sleep 0.08
    done
  ) &
  _SPIN_PID=$!
  disown "$_SPIN_PID" 2>/dev/null || true
}
spinner_stop() {
  if [[ -n "$_SPIN_PID" ]]; then
    kill "$_SPIN_PID" 2>/dev/null || true
    wait "$_SPIN_PID" 2>/dev/null || true
    _SPIN_PID=""
    printf "\r\033[K"
  fi
}
trap 'spinner_stop' EXIT

# ── Helpers ───────────────────────────────────────────────────────────────────
step() {
  CURRENT_STEP=$(( CURRENT_STEP + 1 ))
  local pct=$(( CURRENT_STEP * 100 / TOTAL_STEPS ))
  local filled=$(( CURRENT_STEP * 20 / TOTAL_STEPS ))
  local empty=$(( 20 - filled ))
  local bar=""
  for ((i=0;i<filled;i++)); do bar+="█"; done
  for ((i=0;i<empty;i++)); do bar+="░"; done
  echo ""
  echo -e "  ${DIM}┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄${NC}"
  echo -e "  ${W}${BOLD}STEP $CURRENT_STEP / $TOTAL_STEPS  —  $2${NC}  ${DIM}[$pct%]${NC}"
  echo -e "  ${C}${bar}${NC}"
}
ok()   { spinner_stop; echo -e "  ${G}✔${NC}  $1"; }
warn() { spinner_stop; echo -e "  ${Y}⚠${NC}  $1"; }
fail() { spinner_stop; echo -e "\n  ${R}✖  ERROR: $1${NC}\n"; exit 1; }
info() { echo -e "  ${DIM}→${NC}  $1"; }
rand_hex() { openssl rand -hex "${1:-32}"; }

ask_skip() {
  local msg="$1"
  ok "Already done: $msg"
  if [[ "${CI:-false}" == "true" ]] || [[ "${FORCE:-false}" == "true" ]]; then
    return 0
  fi
  while true; do
    read -rp "  $(echo -e "${Y}Skip this step?${NC}") [Y/n]: " choice < /dev/tty
    case "${choice:-Y}" in
      [Yy]*) return 0 ;;
      [Nn]*) return 1 ;;
      *) echo "  Please answer Y or n." ;;
    esac
  done
}

# ── Banner ────────────────────────────────────────────────────────────────────
clear
echo ""
echo -e "${W}${BOLD}"
echo "  ┌──────────────────────────────────────────────────────────┐"
echo "  │                                                          │"
echo "  │              _____ ______ _   _ _______ _____ _____      │"
echo "  │        /\\   / ____|  ____| \\ | |__   __|_   _/ ____|     │"
echo "  │       /  \\ | |  __| |__  |  \\| |  | |    | || |          │"
echo "  │      / /\\ \\| | |_ |  __| | . \` |  | |    | || |          │"
echo "  │     / ____ \\ |__| | |____| |\\  |  | |   _| || |____      │"
echo "  │    /_/    \\_\\_____|______|_| \\_|  |_|  |_____\\_____|     │"
echo "  │                                                          │"
echo "  │                          C  R  M                         │"
echo "  │                                                          │"
echo "  │                     A Sapheron Project                   │"
echo "  │                                                          │"
echo "  └──────────────────────────────────────────────────────────┘"
echo -e "${NC}"
echo -e "  ${DIM}From TechnoTaLim Platform and Services LLP${NC}"
echo ""
echo -e "  ${DIM}Install dir :${NC} ${W}$INSTALL_DIR${NC}"
echo -e "  ${DIM}Repository  :${NC} ${W}$REPO_URL${NC}"
echo -e "  ${DIM}Platform    :${NC} ${W}$(uname -s) / $(uname -m)${NC}"
echo ""
echo -e "  ${Y}Note: SSL + reverse proxy are NOT configured automatically.${NC}"
echo -e "  ${Y}      Instructions will be shown at the end.${NC}"
echo ""

# ════════════════════════════════════════════════════════════════════════════
# STEP 1 — OS CHECK
# ════════════════════════════════════════════════════════════════════════════
step 1 "Operating system check"

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
    warn "For production, use Ubuntu 22.04+ or Debian 12+ on a VPS"
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
    spinner_start "Installing Docker..."
    curl -fsSL https://get.docker.com | sh > /dev/null 2>&1
    spinner_stop
    if command -v systemctl &>/dev/null; then
      systemctl enable --now docker > /dev/null 2>&1
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
    apt-get install -y docker-compose-plugin > /dev/null 2>&1 || \
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
step 3 "Download code"

if [[ -d "$INSTALL_DIR/.git" ]]; then
  # Auto-fix: ensure remote points to the correct repo
  CURRENT_REMOTE=$(git -C "$INSTALL_DIR" remote get-url origin 2>/dev/null || echo "")
  if [[ "$CURRENT_REMOTE" != "$REPO_URL" && -n "$CURRENT_REMOTE" ]]; then
    git -C "$INSTALL_DIR" remote set-url origin "$REPO_URL"
    info "Updated git remote → $REPO_URL"
  fi
  if ask_skip "Code already at $INSTALL_DIR"; then
    ok "Using existing code"
  else
    spinner_start "Pulling latest changes..."
    git -C "$INSTALL_DIR" pull origin main > /dev/null 2>&1
    spinner_stop
    ok "Code updated"
  fi
else
  spinner_start "Cloning repository..."
  git clone "$REPO_URL" "$INSTALL_DIR" > /dev/null 2>&1
  spinner_stop
  ok "Code cloned to $INSTALL_DIR"
fi

cd "$INSTALL_DIR"

# Make install dir writable by all — the API container runs as uid 1001 (nestjs)
# and needs to write to .git/ AND source files during in-app updates.
chmod -R a+rw "$INSTALL_DIR" 2>/dev/null || true

# ════════════════════════════════════════════════════════════════════════════
# STEP 4 — ENVIRONMENT CONFIG
# ════════════════════════════════════════════════════════════════════════════
step 4 "Environment configuration"

write_env() {
  echo ""
  echo -e "  ${W}${BOLD}Configure your installation${NC}"
  echo -e "  ${DIM}Press Enter to use defaults shown in brackets${NC}"
  echo ""

  read -rp "  $(echo -e "${C}Company name${NC}") (default: My Company): " COMPANY_NAME < /dev/tty
  COMPANY_NAME="${COMPANY_NAME:-My Company}"

  read -rp "  $(echo -e "${C}Admin email${NC}"): " ADMIN_EMAIL < /dev/tty
  [[ -z "$ADMIN_EMAIL" ]] && fail "Admin email is required"

  while true; do
    read -rsp "  $(echo -e "${C}Admin password${NC}") (min 8 chars): " ADMIN_PASSWORD < /dev/tty
    echo ""
    [[ ${#ADMIN_PASSWORD} -ge 8 ]] && break
    warn "Password must be at least 8 characters"
  done

  read -rsp "  $(echo -e "${C}Database password${NC}") (Enter to auto-generate): " DB_PASSWORD < /dev/tty
  echo ""
  [[ -z "$DB_PASSWORD" ]] && DB_PASSWORD=$(rand_hex 16) && info "Database password auto-generated"

  MINIO_SECRET=$(rand_hex 16)
  JWT_SECRET=$(rand_hex 32)
  REFRESH_TOKEN_SECRET=$(rand_hex 32)
  ENCRYPTION_KEY=$(rand_hex 32)
  GRAFANA_PASSWORD=$(rand_hex 12)

  cat > "$INSTALL_DIR/.env" << ENVEOF
# ── AgenticCRM — Environment ─────────────────────────────────────────────
# Generated by installer on $(date -u '+%Y-%m-%d %H:%M UTC')
# A Sapheron Project · TechnoTaLim Platform and Services LLP
#
# AI provider keys and payment gateway keys are configured from the dashboard.
# Set DOMAIN and API_PUBLIC_URL after you configure your reverse proxy.

# ── App ──────────────────────────────────────────────────────────────────────
NODE_ENV=production
DOMAIN=localhost
COMPANY_NAME=${COMPANY_NAME}
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

# ── Redis ────────────────────────────────────────────────────────────────────
REDIS_URL=redis://redis:6379

# ── JWT ──────────────────────────────────────────────────────────────────────
JWT_SECRET=${JWT_SECRET}
REFRESH_TOKEN_SECRET=${REFRESH_TOKEN_SECRET}
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d

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
  echo -e "  ${Y}${BOLD}┌─ Save these credentials ──────────────────────────────────┐${NC}"
  echo -e "  ${Y}│${NC}  Company        : ${W}${COMPANY_NAME}${NC}"
  echo -e "  ${Y}│${NC}  Admin email    : ${W}${ADMIN_EMAIL}${NC}"
  echo -e "  ${Y}│${NC}  Admin password : ${W}${ADMIN_PASSWORD}${NC}"
  echo -e "  ${Y}│${NC}  Grafana        : ${W}${GRAFANA_PASSWORD}${NC}"
  echo -e "  ${Y}└───────────────────────────────────────────────────────────┘${NC}"
}

if [[ -f "$INSTALL_DIR/.env" ]]; then
  if ask_skip ".env already configured"; then
    check_and_append() {
      local key=$1; local value=$2
      if ! grep -q "^$key=" "$INSTALL_DIR/.env"; then
        echo "$key=$value" >> "$INSTALL_DIR/.env"
        info "Added missing key: $key"
      fi
    }
    check_and_append "DATABASE_URL"        "postgresql://crm:changeme@pgbouncer:5432/wacrm"
    check_and_append "DIRECT_DATABASE_URL" "postgresql://crm:changeme@postgres:5432/wacrm"
    check_and_append "REDIS_URL"           "redis://redis:6379"
    check_and_append "JWT_SECRET"          "$(rand_hex 32)"
    check_and_append "REFRESH_TOKEN_SECRET" "$(rand_hex 32)"
    check_and_append "ENCRYPTION_KEY"      "$(rand_hex 32)"
    check_and_append "JWT_EXPIRES_IN"      "7d"
    check_and_append "JWT_REFRESH_EXPIRES_IN" "30d"
    check_and_append "MINIO_ACCESS_KEY"    "minioadmin"
    check_and_append "MINIO_SECRET_KEY"    "$(rand_hex 16)"
    check_and_append "API_PUBLIC_URL"      "http://localhost:3000"
    check_and_append "LOG_LEVEL"           "info"
    check_and_append "COMPANY_NAME"        "My Company"

    if grep -qE '^JWT_EXPIRES_IN=(15m|1h|24h|1d)$' "$INSTALL_DIR/.env" 2>/dev/null; then
      sed -i 's/^JWT_EXPIRES_IN=.*/JWT_EXPIRES_IN=7d/' "$INSTALL_DIR/.env"
      info "Bumped JWT_EXPIRES_IN to 7d"
    fi
    if grep -qE '^JWT_REFRESH_EXPIRES_IN=(7d|14d)$' "$INSTALL_DIR/.env" 2>/dev/null; then
      sed -i 's/^JWT_REFRESH_EXPIRES_IN=.*/JWT_REFRESH_EXPIRES_IN=30d/' "$INSTALL_DIR/.env"
      info "Bumped JWT_REFRESH_EXPIRES_IN to 30d"
    fi
    if grep -q "pgbouncer:6432" "$INSTALL_DIR/.env" 2>/dev/null; then
      sed -i 's/pgbouncer:6432/pgbouncer:5432/g' "$INSTALL_DIR/.env"
      info "Fixed DATABASE_URL port (6432 → 5432)"
    fi
  else
    write_env
  fi
else
  write_env
fi

# ════════════════════════════════════════════════════════════════════════════
# STEP 5 — DOCKER IMAGES
# ════════════════════════════════════════════════════════════════════════════
step 5 "Build Docker images"

export GIT_HASH=$(git -C "$INSTALL_DIR" rev-parse HEAD 2>/dev/null || echo "unknown")
export GIT_DATE=$(git -C "$INSTALL_DIR" log -1 --format=%cI 2>/dev/null || echo "unknown")
export GIT_BRANCH=$(git -C "$INSTALL_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
export APP_VERSION=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$INSTALL_DIR/package.json" 2>/dev/null | head -1)
export APP_VERSION=${APP_VERSION:-1.0.0}
export INSTALL_DIR="$INSTALL_DIR"

IMAGES_EXIST=$(docker images --format "{{.Repository}}" 2>/dev/null | grep -c "agentic-crm" || true)

build_images() {
  local cache_flag="$1"
  echo ""
  docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" build $cache_flag 2>&1 | \
    tee /tmp/agenticcrm-build.log | \
    while IFS= read -r line; do
      # Show service build start/finish and Docker step lines
      if echo "$line" | grep -qE '^\[.*\] (Building|Step |FROM |RUN |COPY |DONE |Successfully|CACHED)'; then
        printf "\r\033[K  ${DIM}%s${NC}\n" "$(echo "$line" | cut -c1-80)"
      elif echo "$line" | grep -qiE '^(Building|#[0-9]+ )'; then
        printf "\r\033[K  ${DIM}%s${NC}\n" "$(echo "$line" | cut -c1-80)"
      fi
    done
  return ${PIPESTATUS[0]}
}

if [[ "$IMAGES_EXIST" -gt 0 ]]; then
  if ask_skip "Images already built ($IMAGES_EXIST found)"; then
    ok "Using cached images"
  else
    info "Rebuilding images (using cache for unchanged layers)..."
    if build_images ""; then
      ok "Images rebuilt"
    else
      fail "Docker build failed — check /tmp/agenticcrm-build.log"
    fi
  fi
else
  info "Building images — first build takes a few minutes..."
  if build_images ""; then
    ok "Images built  ${DIM}(log: /tmp/agenticcrm-build.log)${NC}"
  else
    fail "Docker build failed — check /tmp/agenticcrm-build.log"
  fi
fi

# ════════════════════════════════════════════════════════════════════════════
# STEP 6 — START INFRASTRUCTURE
# ════════════════════════════════════════════════════════════════════════════
step 6 "Start infrastructure"

INFRA_RUNNING=$(docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" \
  ps -q postgres redis minio pgbouncer 2>/dev/null | wc -l | tr -d ' ')

PG_HAS_VECTOR=0
if [[ "$INFRA_RUNNING" -ge 1 ]]; then
  if docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" \
    exec -T postgres sh -c "psql -U \"\${POSTGRES_USER:-crm}\" -d \"\${POSTGRES_DB:-wacrm}\" -tAc \"SELECT 1 FROM pg_extension WHERE extname='vector'\"" 2>/dev/null | grep -q '^1$'; then
    PG_HAS_VECTOR=1
  fi
fi

if [[ "$INFRA_RUNNING" -ge 4 && "$PG_HAS_VECTOR" -eq 1 ]]; then
  if ask_skip "Infrastructure already running ($INFRA_RUNNING containers, pgvector ready)"; then
    ok "Using running infrastructure"
  else
    spinner_start "Restarting infrastructure containers..."
    docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" up -d postgres redis minio pgbouncer > /dev/null 2>&1
    spinner_stop
    ok "Infrastructure restarted"
  fi
else
  if [[ "$INFRA_RUNNING" -ge 1 && "$PG_HAS_VECTOR" -eq 0 ]]; then
    warn "Postgres is missing pgvector — recreating with pgvector/pgvector:pg16 image"
    info "(Data volume is preserved — only the container is replaced)"
    docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" pull postgres > /dev/null 2>&1 || true
    docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" up -d --force-recreate postgres > /dev/null 2>&1
  else
    spinner_start "Starting postgres, redis, minio, pgbouncer..."
    docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" up -d postgres redis minio pgbouncer > /dev/null 2>&1
    spinner_stop
  fi

  spinner_start "Waiting for health checks..."
  for svc in postgres redis; do
    for i in $(seq 1 20); do
      HEALTH=$(docker inspect \
        "$(docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" ps -q "$svc" 2>/dev/null)" \
        --format '{{.State.Health.Status}}' 2>/dev/null || echo "starting")
      if [[ "$HEALTH" == "healthy" ]]; then
        spinner_stop; ok "$svc  ${G}healthy${NC}"; spinner_start "Waiting for remaining services..."
        break
      fi
      [[ $i -eq 20 ]] && { spinner_stop; warn "$svc health check timed out"; }
      sleep 3
    done
  done
  spinner_stop

  docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" up -d redis minio pgbouncer > /dev/null 2>&1
fi

spinner_start "Enabling pgvector extension..."
docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" \
  exec -T postgres sh -c \
  "psql -U \"\${POSTGRES_USER:-crm}\" -d \"\${POSTGRES_DB:-wacrm}\" -c 'CREATE EXTENSION IF NOT EXISTS vector;'" \
  > /dev/null 2>&1 \
  && { spinner_stop; ok "pgvector extension ready"; } \
  || { spinner_stop; fail "Could not enable pgvector. Check postgres is using pgvector/pgvector:pg16 image."; }

# ════════════════════════════════════════════════════════════════════════════
# STEP 7 — DATABASE + SEED + START
# ════════════════════════════════════════════════════════════════════════════
step 7 "Database, seed & launch"

spinner_start "Applying pre-push SQL migrations..."
docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" \
  exec -T postgres sh -c \
  "psql -U \"\${POSTGRES_USER:-crm}\" -d \"\${POSTGRES_DB:-wacrm}\" -v ON_ERROR_STOP=1" \
  < "$INSTALL_DIR/packages/database/prisma/migrations/pre_push.sql" \
  > /dev/null 2>&1 \
  && { spinner_stop; ok "Pre-push migrations applied"; } \
  || { spinner_stop; warn "Pre-push migration had warnings (may be safe)"; }

info "Pushing database schema..."
if docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" \
  run --rm api sh -c \
  "prisma db push --accept-data-loss --schema=packages/database/prisma/schema.prisma --url=\$DIRECT_DATABASE_URL" \
  2>&1 | tee -a /tmp/agenticcrm-schema.log | tail -5; then
  ok "Database schema pushed"
else
  warn "Schema push had issues — check /tmp/agenticcrm-schema.log"
fi

info "Applying pgvector memory migration..."
if docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" \
  exec -T postgres sh -c \
  "psql -U \"\${POSTGRES_USER:-crm}\" -d \"\${POSTGRES_DB:-wacrm}\" -v ON_ERROR_STOP=1" \
  < "$INSTALL_DIR/packages/database/prisma/migrations/manual_pgvector.sql" \
  2>&1 | tail -3; then
  ok "pgvector memory migration applied"
else
  warn "pgvector migration failed — memory system may not work"
fi

source "$INSTALL_DIR/.env" 2>/dev/null || true

USER_RES=$(docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" \
  run --rm api sh -c \
  "NODE_PATH=/app/node_modules:/app/packages/database/node_modules:/app/apps/api/node_modules node -e \"const{Client}=require('pg');const c=new Client({connectionString:process.env.DIRECT_DATABASE_URL||process.env.DATABASE_URL});c.connect().then(()=>c.query('SELECT count(*)::int AS n FROM \\\"User\\\"')).then(r=>{console.log(r.rows[0].n);c.end()}).catch(()=>{console.log(0);process.exit(0)})\"" \
  2>/dev/null || echo "0")
USER_COUNT=$(echo "$USER_RES" | grep -o '[0-9]\+' | tail -1)
USER_COUNT=${USER_COUNT:-0}

SEED_TMP=$(mktemp /tmp/agentcrm-seed-XXXXXX.js)
chmod 644 "$SEED_TMP"
cat > "$SEED_TMP" << 'SEEDEOF'
const { Client } = require("pg");
const bcrypt = require("bcryptjs");
const { randomUUID } = require("crypto");
const db = new Client({ connectionString: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL });
const email = process.env.ADMIN_EMAIL || "admin@example.com";
const pwd = process.env.ADMIN_PASSWORD || "changeme123";
const companyName = process.env.COMPANY_NAME || "My Company";
const slug = companyName.toLowerCase().replace(/[^a-z0-9]/g, "-");
const ALL_PERMISSIONS = [
  "ai_chat","memory","contacts","leads","deals","tasks","products",
  "broadcasts","templates","sequences","campaigns","forms",
  "quotes","invoices","payments","tickets","kb","workflows",
  "analytics","reports","documents","integrations","settings","team","whatsapp"
];
(async () => {
  await db.connect();
  let res = await db.query('SELECT id FROM "Company" WHERE slug=$1', [slug]);
  let companyId;
  if (res.rows.length > 0) {
    companyId = res.rows[0].id;
    console.log("Using existing company:", companyId);
  } else {
    companyId = randomUUID();
    await db.query(
      'INSERT INTO "Company" (id,name,slug,email,timezone,"isActive","setupDone","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())',
      [companyId, companyName, slug, email, "UTC", true, false]
    );
    console.log("Created company:", companyId);
  }
  res = await db.query('SELECT id FROM "User" WHERE "companyId"=$1 AND email=$2', [companyId, email]);
  if (res.rows.length === 0) {
    const hash = await bcrypt.hash(pwd, 12);
    await db.query(
      'INSERT INTO "User" (id,"companyId",email,"passwordHash","firstName","lastName",role,permissions,"isActive","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())',
      [randomUUID(), companyId, email, hash, "Admin", "User", "ADMIN", ALL_PERMISSIONS, true]
    );
    console.log("Admin user created:", email);
  } else {
    console.log("Admin user already exists:", email);
  }
  res = await db.query('SELECT id FROM "AiConfig" WHERE "companyId"=$1', [companyId]);
  if (res.rows.length === 0) {
    await db.query(
      'INSERT INTO "AiConfig" (id,"companyId","autoReplyEnabled","toolCallingEnabled","updatedAt") VALUES ($1,$2,$3,$4,NOW())',
      [randomUUID(), companyId, false, true]
    );
  }
  res = await db.query('SELECT id FROM "PaymentConfig" WHERE "companyId"=$1', [companyId]);
  if (res.rows.length === 0) {
    await db.query(
      'INSERT INTO "PaymentConfig" (id,"companyId","updatedAt") VALUES ($1,$2,NOW())',
      [randomUUID(), companyId]
    );
  }
  console.log("Seed complete");
})().finally(() => db.end());
SEEDEOF

PERM_TMP=$(mktemp /tmp/agentcrm-perm-XXXXXX.js)
chmod 644 "$PERM_TMP"
cat > "$PERM_TMP" << 'PERMEOF'
const { Client } = require("pg");
const db = new Client({ connectionString: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL });
const ALL_PERMISSIONS = [
  "ai_chat","memory","contacts","leads","deals","tasks","products",
  "broadcasts","templates","sequences","campaigns","forms",
  "quotes","invoices","payments","tickets","kb","workflows",
  "analytics","reports","documents","integrations","settings","team","whatsapp"
];
(async () => {
  await db.connect();
  const res = await db.query(
    `UPDATE "User" SET permissions = $1 WHERE role IN ('ADMIN', 'SUPER_ADMIN') AND (permissions IS NULL OR array_length(permissions, 1) = 0 OR array_length(permissions, 1) < 25)`,
    [ALL_PERMISSIONS]
  );
  console.log("Admin permissions fixed:", res.rowCount, "users updated");
  await db.end();
})();
PERMEOF

info "Ensuring admin permissions..."
if docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" \
  run --rm \
  -v "$PERM_TMP:/tmp/perm-fix.js:ro" \
  api sh -c "NODE_PATH=/app/node_modules:/app/packages/database/node_modules:/app/apps/api/node_modules node /tmp/perm-fix.js" \
  2>&1 | tail -3; then
  ok "Admin permissions ensured"
else
  warn "Permissions fix had issues (may already be set)"
fi

if [[ "${USER_COUNT:-0}" -gt 0 ]]; then
  if ask_skip "Admin user already seeded ($USER_COUNT users found)"; then
    ok "Skipping seed"
  else
    info "Re-seeding admin user..."
    if docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" \
      run --rm \
      -v "$SEED_TMP:/tmp/seed.js:ro" \
      api sh -c "NODE_PATH=/app/node_modules:/app/packages/database/node_modules:/app/apps/api/node_modules node /tmp/seed.js" \
      2>&1 | tail -3; then
      ok "Database re-seeded"
    else
      warn "Seed had issues"
    fi
  fi
else
  info "Creating admin user..."
  if docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" \
    run --rm \
    -v "$SEED_TMP:/tmp/seed.js:ro" \
    api sh -c "NODE_PATH=/app/node_modules:/app/packages/database/node_modules:/app/apps/api/node_modules node /tmp/seed.js" \
    2>&1 | tail -3; then
    ok "Admin user created"
  else
    warn "Seed had issues — check manually"
  fi
fi

rm -f "$SEED_TMP" "$PERM_TMP"

info "Starting all services..."
docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" up -d 2>&1 | tail -15
ok "All services started"

info "Waiting for API health check..."
for i in $(seq 1 10); do
  HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" "http://localhost:3000/api/health" 2>/dev/null || echo "000")
  if [[ "$HTTP_CODE" == "200" ]]; then
    ok "API is healthy"
    break
  fi
  [[ $i -eq 10 ]] && warn "API not responding yet — run: docker compose logs api"
  sleep 3
done

# ════════════════════════════════════════════════════════════════════════════
# DONE
# ════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${G}${BOLD}"
echo "  ┌─────────────────────────────────────────────────────┐"
echo "  │                                                     │"
echo "  │        ✔  AgenticCRM is live!                       │"
echo "  │                                                     │"
echo "  └─────────────────────────────────────────────────────┘"
echo -e "${NC}"
echo -e "  ${DIM}Services running on localhost:${NC}"
echo ""
echo -e "  ${W}Dashboard${NC}  →  ${C}http://localhost:3001${NC}"
echo -e "  ${W}API      ${NC}  →  ${C}http://localhost:3000/api${NC}"
echo -e "  ${W}Grafana  ${NC}  →  ${C}http://localhost:3002${NC}"
echo -e "  ${W}MinIO UI ${NC}  →  ${C}http://localhost:9001${NC}"
echo ""
echo -e "  ${DIM}Useful commands:${NC}"
echo -e "  ${DIM}  docker compose -f $COMPOSE_FILE logs -f${NC}"
echo -e "  ${DIM}  docker compose -f $COMPOSE_FILE ps${NC}"
echo -e "  ${DIM}  docker compose -f $COMPOSE_FILE restart${NC}"
echo -e "  ${DIM}  docker compose -f $COMPOSE_FILE down${NC}"
echo ""

# ── Proxy setup guide ─────────────────────────────────────────────────────────
echo -e "${Y}${BOLD}"
echo "  ┌─────────────────────────────────────────────────────┐"
echo "  │    ⚙  Next step: reverse proxy + SSL               │"
echo "  └─────────────────────────────────────────────────────┘"
echo -e "${NC}"
echo -e "  All ports are bound to ${W}127.0.0.1 only${NC}."
echo -e "  You need a reverse proxy to serve them to the internet."
echo ""
echo -e "${W}  Option 1 — nginx${NC}"
echo ""
echo -e "  ${DIM}sudo apt install nginx -y${NC}"
echo -e "  ${DIM}sudo nano /etc/nginx/sites-available/agenticcrm${NC}"
echo ""
cat << 'NGINX_BLOCK'
  server {
      listen 80;
      server_name YOUR_DOMAIN;
      location / {
          proxy_pass http://127.0.0.1:3001;
          proxy_set_header Host $host;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
          proxy_set_header X-Forwarded-Proto $scheme;
      }
      location /api {
          proxy_pass http://127.0.0.1:3000;
          proxy_http_version 1.1;
          proxy_set_header Upgrade $http_upgrade;
          proxy_set_header Connection "upgrade";
          proxy_set_header Host $host;
          proxy_set_header X-Forwarded-Proto $scheme;
          proxy_read_timeout 300s;
          proxy_send_timeout 300s;
      }
      location /socket.io {
          proxy_pass http://127.0.0.1:3000;
          proxy_http_version 1.1;
          proxy_set_header Upgrade $http_upgrade;
          proxy_set_header Connection "upgrade";
          proxy_read_timeout 300s;
      }
      location /grafana { proxy_pass http://127.0.0.1:3002; }
      location /media   { proxy_pass http://127.0.0.1:9000; }
  }
NGINX_BLOCK
echo ""
echo -e "  ${DIM}sudo ln -s /etc/nginx/sites-available/agenticcrm /etc/nginx/sites-enabled/${NC}"
echo -e "  ${DIM}sudo nginx -t && sudo systemctl reload nginx${NC}"
echo -e "  ${DIM}sudo apt install certbot python3-certbot-nginx -y${NC}"
echo -e "  ${DIM}sudo certbot --nginx -d YOUR_DOMAIN${NC}"
echo ""
echo -e "${W}  Option 2 — Caddy (auto SSL)${NC}"
echo ""
echo -e "  ${DIM}YOUR_DOMAIN {${NC}"
echo -e "  ${DIM}    reverse_proxy /api*       localhost:3000${NC}"
echo -e "  ${DIM}    reverse_proxy /socket.io* localhost:3000${NC}"
echo -e "  ${DIM}    reverse_proxy /grafana*   localhost:3002${NC}"
echo -e "  ${DIM}    reverse_proxy /media*     localhost:9000${NC}"
echo -e "  ${DIM}    reverse_proxy *           localhost:3001${NC}"
echo -e "  ${DIM}}${NC}"
echo ""
echo -e "  ${W}After proxy:${NC} edit ${C}$INSTALL_DIR/.env${NC} and set:"
echo -e "  ${DIM}  DOMAIN=YOUR_DOMAIN${NC}"
echo -e "  ${DIM}  API_PUBLIC_URL=https://YOUR_DOMAIN${NC}"
echo -e "  Then: ${DIM}docker compose -f $COMPOSE_FILE restart dashboard${NC}"
echo ""
echo -e "  ${DIM}A Sapheron Project  ·  TechnoTaLim Platform and Services LLP${NC}"
echo -e "  ${DIM}https://agenticcrm.sapheron.com${NC}"
echo ""

} # end main()

main "$@"
