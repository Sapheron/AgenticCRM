#!/usr/bin/env bash
# AgenticCRM — In-Place Updater
# Triggered from the dashboard (Settings → System) or run manually.

INSTALL_DIR="${INSTALL_DIR:-/opt/agenticcrm}"
COMPOSE_FILE="$INSTALL_DIR/deploy/docker-compose.yml"
LOG_FILE="/tmp/agenticcrm-update.log"

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
echo "" > "$LOG_FILE"

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

cd "$INSTALL_DIR" || fail "Cannot cd to $INSTALL_DIR"

git config --global --add safe.directory "$INSTALL_DIR" 2>/dev/null || true
git config --global --add safe.directory /host 2>/dev/null || true

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

  echo ""
  docker compose -f "$COMPOSE_FILE" build api dashboard worker whatsapp 2>&1 | \
    tee /tmp/agenticcrm-build.log | \
    while IFS= read -r line; do
      if echo "$line" | grep -qE '^\[.*\] (Building|Step |FROM |RUN |COPY |DONE |Successfully|CACHED)'; then
        printf "\r\033[K  ${DIM}%s${NC}\n" "$(echo "$line" | cut -c1-80)"
      elif echo "$line" | grep -qiE '^(Building|#[0-9]+ )'; then
        printf "\r\033[K  ${DIM}%s${NC}\n" "$(echo "$line" | cut -c1-80)"
      fi
    done
  BUILD_EXIT=${PIPESTATUS[0]}

  if [ $BUILD_EXIT -ne 0 ]; then
    tail -20 /tmp/agenticcrm-build.log | tee -a "$LOG_FILE"
    fail "Docker build failed (see /tmp/agenticcrm-build.log)"
  fi
  ok "Docker images rebuilt"
  echo -e "  ${G}✔${NC}  Images rebuilt"
else
  warn "No docker-compose.yml found at $COMPOSE_FILE — skipping build"
fi

# ── Step 4: Migrations ────────────────────────────────────────────────────────
echo -e "\n  ${W}${BOLD}[4/6]${NC}  Running database migrations..."
if [ -f "$COMPOSE_FILE" ]; then
  spinner_start "Applying schema migrations..."
  docker compose -f "$COMPOSE_FILE" run --rm api npx prisma migrate deploy \
    --schema=./node_modules/@wacrm/database/prisma/schema.prisma 2>&1 | tee -a "$LOG_FILE" > /dev/null
  spinner_stop
  ok "Migrations applied"
  echo -e "  ${G}✔${NC}  Migrations applied"
fi

# ── Step 5: Restart services ──────────────────────────────────────────────────
echo -e "\n  ${W}${BOLD}[5/6]${NC}  Restarting services..."
if [ -f "$COMPOSE_FILE" ]; then
  spinner_start "Bringing services up..."
  docker compose -f "$COMPOSE_FILE" up -d --remove-orphans 2>&1 | tee -a "$LOG_FILE" > /dev/null
  spinner_stop
  ok "Services restarted"
  echo -e "  ${G}✔${NC}  Services restarted"
fi

# ── Step 6: Health check ──────────────────────────────────────────────────────
echo -e "\n  ${W}${BOLD}[6/6]${NC}  Health check..."
spinner_start "Waiting for API..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:3000/api/health > /dev/null 2>&1; then
    spinner_stop
    ok "API is healthy"
    echo -e "  ${G}✔${NC}  API is healthy"
    break
  fi
  if [ "$i" -eq 30 ]; then
    spinner_stop
    warn "API health check timed out after 30s — check: docker compose logs api"
  fi
  sleep 1
done

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
