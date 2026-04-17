#!/usr/bin/env bash
# AgenticCRM — In-Place Updater
# Triggered from the dashboard (Settings → System) or run manually.

INSTALL_DIR="${INSTALL_DIR:-/opt/agenticcrm}"
COMPOSE_FILE="$INSTALL_DIR/deploy/docker-compose.yml"
LOG_FILE="/tmp/agenticcrm-update.log"
PERSISTENT_LOG_DIR="$INSTALL_DIR/logs"

# Services that are built locally and need rollback protection
BUILT_SERVICES=(api dashboard worker whatsapp)
# All services that must be running after update (for verification)
REQUIRED_SERVICES=(api dashboard worker whatsapp postgres redis pgbouncer minio)

# ── ANSI ──────────────────────────────────────────────────────────────────────
R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'
C='\033[0;36m'; W='\033[1;37m'; DIM='\033[2m'; BOLD='\033[1m'; NC='\033[0m'

ts()   { date '+%Y-%m-%d %H:%M:%S'; }
info() { echo "[$(ts)] INFO  $*" | tee -a "$LOG_FILE"; }
warn() { echo "[$(ts)] WARN  $*" | tee -a "$LOG_FILE"; }
fail() { echo "[$(ts)] ERROR $*" | tee -a "$LOG_FILE"; exit 1; }
ok()   { echo "[$(ts)] OK    $*" | tee -a "$LOG_FILE"; }

# ── Spinner ───────────────────────────────────────────────────────────────────
_SPIN_PID=""
spinner_start() {
  local msg="$1"; local frames=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
  (local i=0; while true; do
    printf "\r  ${C}%s${NC}  ${DIM}%s${NC}" "${frames[$i]}" "$msg"
    i=$(( (i+1) % ${#frames[@]} )); sleep 0.08
  done) &
  _SPIN_PID=$!; disown "$_SPIN_PID" 2>/dev/null || true
}
spinner_stop() {
  [[ -n "$_SPIN_PID" ]] && { kill "$_SPIN_PID" 2>/dev/null || true; wait "$_SPIN_PID" 2>/dev/null || true; _SPIN_PID=""; printf "\r\033[K"; }
}
trap 'spinner_stop' EXIT

# ── Start ─────────────────────────────────────────────────────────────────────
# Persistent log (survives reboots and /tmp cleanup)
mkdir -p "$PERSISTENT_LOG_DIR" 2>/dev/null || true
PERSISTENT_LOG="$PERSISTENT_LOG_DIR/update-$(date +%Y%m%d-%H%M%S).log"
echo "" > "$LOG_FILE"
# Keep only the last 10 update logs
ls -1t "$PERSISTENT_LOG_DIR"/update-*.log 2>/dev/null | tail -n +11 | xargs -r rm -f 2>/dev/null || true

# Mirror all output to persistent log as well
exec > >(tee -a "$PERSISTENT_LOG") 2>&1

# ── Helpers: rollback + recovery ──────────────────────────────────────────────
tag_rollback_images() {
  # Before building, tag current working images as :rollback so we can restore on failure
  for svc in "${BUILT_SERVICES[@]}"; do
    local img="ghcr.io/sapheron/agentic-crm/${svc}:latest"
    if docker image inspect "$img" &>/dev/null; then
      docker tag "$img" "ghcr.io/sapheron/agentic-crm/${svc}:rollback" 2>/dev/null || true
    fi
  done
  info "Tagged current images as :rollback for recovery"
}

restore_rollback_images() {
  warn "Restoring rollback images..."
  for svc in "${BUILT_SERVICES[@]}"; do
    local rb="ghcr.io/sapheron/agentic-crm/${svc}:rollback"
    local latest="ghcr.io/sapheron/agentic-crm/${svc}:latest"
    if docker image inspect "$rb" &>/dev/null; then
      docker tag "$rb" "$latest" 2>/dev/null || true
      info "Restored $svc from rollback"
    fi
  done
  docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" up -d --remove-orphans 2>&1 | tail -20 >> "$LOG_FILE" || true
}

verify_all_containers_running() {
  # Returns 0 if all REQUIRED_SERVICES are running, 1 otherwise
  local missing=()
  for svc in "${REQUIRED_SERVICES[@]}"; do
    local status
    status=$(docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" ps --status running --services 2>/dev/null | grep -x "$svc" || echo "")
    if [ -z "$status" ]; then
      missing+=("$svc")
    fi
  done
  if [ ${#missing[@]} -gt 0 ]; then
    warn "Missing services: ${missing[*]}"
    return 1
  fi
  return 0
}

# ── Pre-flight: disk + memory checks ──────────────────────────────────────────
check_preflight() {
  # Require at least 3GB free disk (build + image storage)
  local free_kb
  free_kb=$(df -k "$INSTALL_DIR" 2>/dev/null | awk 'NR==2 {print $4}')
  local free_gb=$(( free_kb / 1024 / 1024 ))
  if [ "$free_gb" -lt 3 ]; then
    fail "Not enough disk space. Need at least 3GB free, have ${free_gb}GB. Run 'docker system prune -af' to free up space."
  fi
  info "Disk space OK: ${free_gb}GB free"

  # Require at least 512MB free memory (warning only)
  if command -v free &>/dev/null; then
    local avail_mb
    avail_mb=$(free -m 2>/dev/null | awk 'NR==2 {print $7}')
    if [ -n "$avail_mb" ] && [ "$avail_mb" -lt 512 ]; then
      warn "Low available memory: ${avail_mb}MB. Build may OOM-kill. Consider restarting or adding swap."
    fi
  fi
}

echo ""
echo -e "${W}${BOLD}"
echo "  ┌──────────────────────────────────────────────────────────┐"
echo "  │          _____ ______ _   _ _______ _____ _____          │"
echo "  │    /\\   / ____|  ____| \\ | |__   __|_   _/ ____|         │"
echo "  │   /  \\ | |  __| |__  |  \\| |  | |    | || |              │"
echo "  │  / /\\ \\| | |_ |  __| | . \` |  | |    | || |              │"
echo "  │ / ____ \\ |__| | |____| |\\  |  | |   _| || |____          │"
echo "  │/_/    \\_\\_____|______|_| \\_|  |_|  |_____\\_____|         │"
echo "  │                                                          │"
echo "  │            CRM  —  In-Place Updater                      │"
echo "  │            A Sapheron Project                             │"
echo "  │                                                          │"
echo "  └──────────────────────────────────────────────────────────┘"
echo -e "${NC}"

info "═══ AgenticCRM Update Started ═══"
info "Install directory: $INSTALL_DIR"
info "Persistent log: $PERSISTENT_LOG"

check_preflight

cd "$INSTALL_DIR" || fail "Cannot cd to $INSTALL_DIR"

git config --global --add safe.directory "$INSTALL_DIR" 2>/dev/null || true
git config --global --add safe.directory /host 2>/dev/null || true
# Fix permissions on entire install dir (runs as root via uid:0 in container)
chmod -R a+rw "$INSTALL_DIR" 2>/dev/null || true

# Verify docker compose is available
if ! docker compose version &>/dev/null; then
  fail "docker compose not available. Rebuild the API image: curl -fsSL https://agenticcrm.sapheron.com/install.sh | bash"
fi

# ── Auto-fix: ensure remote points to the correct repo ───────────────────────
CORRECT_REPO="https://github.com/Sapheron/AgenticCRM.git"
CURRENT_REMOTE=$(git remote get-url origin 2>/dev/null || echo "")
if [[ "$CURRENT_REMOTE" != "$CORRECT_REPO" && -n "$CURRENT_REMOTE" ]]; then
  info "Updating git remote: $CURRENT_REMOTE → $CORRECT_REPO"
  git remote set-url origin "$CORRECT_REPO"
fi

# ── Helper: read version from package.json (POSIX-compatible, no grep -P) ─────
read_version() {
  sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" 2>/dev/null | head -1
}

# ── Step 1: Current version ───────────────────────────────────────────────────
echo -e "\n  ${W}${BOLD}[1/6]${NC}  Reading current version..."
OLD_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
OLD_VERSION=$(read_version ./package.json)
OLD_VERSION=${OLD_VERSION:-unknown}
info "Current: v$OLD_VERSION ($OLD_HASH)"
echo -e "  ${DIM}Current version : v$OLD_VERSION ($OLD_HASH)${NC}"

# ── Step 2: Pull latest ───────────────────────────────────────────────────────
echo -e "\n  ${W}${BOLD}[2/6]${NC}  Pulling latest code..."
spinner_start "Fetching from origin/main..."

# Run git fetch WITHOUT piping through tee — pipes hide the exit code
FETCH_LOG=$(git fetch origin main 2>&1) || {
  spinner_stop
  echo "$FETCH_LOG" >> "$LOG_FILE"
  echo -e "  ${R}✖${NC}  git fetch failed:"
  echo "$FETCH_LOG" | tail -5
  fail "git fetch failed"
}
echo "$FETCH_LOG" >> "$LOG_FILE"

RESET_LOG=$(git reset --hard origin/main 2>&1) || {
  spinner_stop
  echo "$RESET_LOG" >> "$LOG_FILE"
  fail "git reset failed"
}
echo "$RESET_LOG" >> "$LOG_FILE"
spinner_stop

NEW_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
NEW_HASH_FULL=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
NEW_DATE=$(git log -1 --format=%cI 2>/dev/null || echo "unknown")
NEW_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
NEW_VERSION=$(read_version ./package.json)
NEW_VERSION=${NEW_VERSION:-1.0.0}

echo -e "  ${G}✔${NC}  Updated to v$NEW_VERSION ($NEW_HASH)"
info "Updated to: v$NEW_VERSION ($NEW_HASH)"

if [ "$OLD_HASH" = "$NEW_HASH" ]; then
  echo -e "  ${Y}⚠${NC}  Already up to date. Nothing to do."
  ok "Already up to date. Nothing to do."
  exit 0
fi

echo -e "  ${DIM}$OLD_HASH → $NEW_HASH  (v$OLD_VERSION → v$NEW_VERSION)${NC}"

# ── Step 3: Rebuild Docker images ─────────────────────────────────────────────
echo -e "\n  ${W}${BOLD}[3/6]${NC}  Rebuilding Docker images..."
if [ -f "$COMPOSE_FILE" ]; then
  export GIT_HASH="$NEW_HASH_FULL"
  export GIT_DATE="$NEW_DATE"
  export GIT_BRANCH="$NEW_BRANCH"
  export APP_VERSION="$NEW_VERSION"

  # Tag currently-working images as :rollback BEFORE rebuilding
  # If the new build breaks, we'll retag these back to :latest
  tag_rollback_images

  echo ""
  # Load .env so build args (DB passwords etc.) are available
  docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" build api dashboard worker whatsapp 2>&1 | \
    tee /tmp/agenticcrm-build.log | \
    while IFS= read -r line; do
      if echo "$line" | grep -qE '^\[.*\] (Building|Step |FROM |RUN |COPY |DONE |Successfully|CACHED)'; then
        printf "\r\033[K  ${DIM}%s${NC}\n" "$(echo "$line" | cut -c1-80)"
      elif echo "$line" | grep -qiE '^(Building|#[0-9]+ )'; then
        printf "\r\033[K  ${DIM}%s${NC}\n" "$(echo "$line" | cut -c1-80)"
      fi
    done

  # PIPESTATUS[0] can be unreliable — verify build succeeded by checking images exist
  BUILT_COUNT=$(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -c "agentic-crm" || echo "0")
  if [ "$BUILT_COUNT" -lt 4 ]; then
    tail -20 /tmp/agenticcrm-build.log | tee -a "$LOG_FILE"
    warn "Docker build failed — only $BUILT_COUNT/4 images found. Rollback images are still tagged — system will continue running the previous version."
    echo -e "  ${R}✖${NC}  Build failed. Previous version is still running."
    echo -e "  ${DIM}Logs: /tmp/agenticcrm-build.log and $PERSISTENT_LOG${NC}"
    exit 2
  fi
  ok "Docker images rebuilt"
  echo -e "  ${G}✔${NC}  Images rebuilt"
else
  warn "No docker-compose.yml found at $COMPOSE_FILE — skipping build"
fi

# ── Step 4: Migrations ────────────────────────────────────────────────────────
echo -e "\n  ${W}${BOLD}[4/6]${NC}  Running database migrations..."
if [ -f "$COMPOSE_FILE" ]; then
  # Run pre_push.sql first (idempotent backfills that prisma can't handle)
  PRE_PUSH="$INSTALL_DIR/packages/database/prisma/migrations/pre_push.sql"
  if [ -f "$PRE_PUSH" ]; then
    info "Running pre_push.sql..."
    docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" \
      exec -T postgres sh -c \
      "psql -U \"\${POSTGRES_USER:-crm}\" -d \"\${POSTGRES_DB:-wacrm}\" -v ON_ERROR_STOP=1" \
      < "$PRE_PUSH" >> "$LOG_FILE" 2>&1 && {
      ok "pre_push.sql applied"
      echo -e "  ${G}✔${NC}  Pre-push migrations applied"
    } || {
      warn "pre_push.sql had issues (check $LOG_FILE)"
    }
  fi

  info "Applying schema migrations..."
  MIGRATE_LOG=$(docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" run --rm api npx prisma migrate deploy \
    --schema=./node_modules/@wacrm/database/prisma/schema.prisma 2>&1) && {
    ok "Migrations applied"
    echo -e "  ${G}✔${NC}  Migrations applied"
  } || {
    echo "$MIGRATE_LOG" >> "$LOG_FILE"
    warn "Migration had issues (may be safe):"
    echo "$MIGRATE_LOG" | tail -5
  }
fi

# ── Step 5: Restart services ──────────────────────────────────────────────────
echo -e "\n  ${W}${BOLD}[5/6]${NC}  Restarting services..."
if [ -f "$COMPOSE_FILE" ]; then
  info "Bringing services up..."
  RESTART_LOG=$(docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" up -d --remove-orphans 2>&1) && {
    ok "Services restarted"
    echo -e "  ${G}✔${NC}  Services restarted"
  } || {
    echo "$RESTART_LOG" >> "$LOG_FILE"
    warn "Restart had issues:"
    echo "$RESTART_LOG" | tail -5
  }
  echo "$RESTART_LOG" >> "$LOG_FILE"
fi

# ── Step 5b: Auto-patch nginx timeouts (prevents 504 on AI chat) ─────────────
if command -v nginx &>/dev/null; then
  PATCHED=0
  for conf in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*; do
    [ -f "$conf" ] || continue
    # Only patch configs that proxy to our API port (3000)
    if grep -q "proxy_pass.*127.0.0.1:3000" "$conf" 2>/dev/null; then
      # Add proxy_read_timeout if missing in /api location block
      if ! grep -q "proxy_read_timeout" "$conf" 2>/dev/null; then
        # Insert proxy_read_timeout after proxy_pass lines pointing to :3000
        sed -i '/proxy_pass.*127.0.0.1:3000/a\        proxy_read_timeout 300s;\n        proxy_send_timeout 300s;' "$conf" 2>/dev/null && PATCHED=1
      fi
    fi
  done
  if [ "$PATCHED" -eq 1 ]; then
    nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null
    ok "Nginx timeouts patched (proxy_read_timeout 300s)"
    echo -e "  ${G}✔${NC}  Nginx config patched"
  fi
fi

# ── Step 6: Health check + verify all containers + rollback on failure ───────
echo -e "\n  ${W}${BOLD}[6/6]${NC}  Verifying all services..."
info "Waiting for API health check (up to 90s)..."

API_HEALTHY=0
for i in $(seq 1 90); do
  if curl -sf http://localhost:3000/api/health > /dev/null 2>&1; then
    API_HEALTHY=1
    break
  fi
  sleep 1
done

# Verify ALL required containers are actually running (not just API responding)
CONTAINERS_OK=1
if ! verify_all_containers_running; then
  CONTAINERS_OK=0
fi

if [ "$API_HEALTHY" -eq 1 ] && [ "$CONTAINERS_OK" -eq 1 ]; then
  ok "All services healthy"
  echo -e "  ${G}✔${NC}  API healthy + all containers running"
else
  # ── FAILURE RECOVERY ─────────────────────────────────────────────────────
  echo -e "  ${R}✖${NC}  Update verification failed — attempting auto-recovery"
  warn "API healthy: $API_HEALTHY | All containers running: $CONTAINERS_OK"

  # Dump logs for debugging before rollback
  info "Dumping recent logs from failed containers..."
  for svc in "${BUILT_SERVICES[@]}"; do
    echo "─── $svc logs (last 30 lines) ───" >> "$LOG_FILE"
    docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" logs --tail=30 "$svc" 2>&1 >> "$LOG_FILE" || true
  done

  # Attempt 1: just bring services up again (sometimes works for transient issues)
  info "Recovery attempt 1: docker compose up -d"
  docker compose -f "$COMPOSE_FILE" --env-file "$INSTALL_DIR/.env" up -d --remove-orphans 2>&1 | tail -5 >> "$LOG_FILE"
  sleep 10

  if curl -sf http://localhost:3000/api/health > /dev/null 2>&1 && verify_all_containers_running; then
    ok "Recovery attempt 1 succeeded"
    echo -e "  ${G}✔${NC}  Recovered without rollback"
  else
    # Attempt 2: full rollback to previous working images
    warn "Recovery attempt 1 failed — rolling back to previous version"
    echo -e "  ${Y}⚠${NC}  Rolling back to previous images..."
    restore_rollback_images
    sleep 15

    if curl -sf http://localhost:3000/api/health > /dev/null 2>&1 && verify_all_containers_running; then
      ok "Rollback succeeded — system restored to previous version"
      echo -e "  ${G}✔${NC}  Rolled back to v$OLD_VERSION successfully"
      echo -e "  ${Y}⚠${NC}  Update failed — review logs: $PERSISTENT_LOG"
      exit 2  # non-zero but distinguishable from fatal
    else
      fail "Rollback failed. System may need manual intervention. Logs: $PERSISTENT_LOG  |  Run: cd $INSTALL_DIR && docker compose -f deploy/docker-compose.yml up -d"
    fi
  fi
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${G}${BOLD}"
echo "  ┌─────────────────────────────────────────────────────┐"
echo "  │    ✔  Update complete                               │"
echo "  └─────────────────────────────────────────────────────┘"
echo -e "${NC}"
echo -e "  ${DIM}$OLD_HASH → $NEW_HASH  (v$OLD_VERSION → v$NEW_VERSION)${NC}"
echo -e "  ${DIM}Log: $LOG_FILE${NC}"
echo ""
info "═══ Update Complete: v$OLD_VERSION ($OLD_HASH) → v$NEW_VERSION ($NEW_HASH) ═══"
exit 0
