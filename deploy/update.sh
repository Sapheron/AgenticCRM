#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║          Open Agent CRM — In-Place Updater                                 ║
# ║          Triggered from the dashboard or run manually.                     ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

INSTALL_DIR="${INSTALL_DIR:-/opt/openagentcrm}"
COMPOSE_FILE="$INSTALL_DIR/deploy/docker-compose.yml"
LOG_FILE="$INSTALL_DIR/deploy/update.log"

# ── Helpers ──────────────────────────────────────────────────────────────────
ts()   { date '+%Y-%m-%d %H:%M:%S'; }
info() { echo "[$(ts)] INFO  $*" | tee -a "$LOG_FILE"; }
warn() { echo "[$(ts)] WARN  $*" | tee -a "$LOG_FILE"; }
fail() { echo "[$(ts)] ERROR $*" | tee -a "$LOG_FILE"; exit 1; }
ok()   { echo "[$(ts)] OK    $*" | tee -a "$LOG_FILE"; }

# ── Start ────────────────────────────────────────────────────────────────────
echo "" > "$LOG_FILE"
info "═══ Open Agent CRM Update Started ═══"
info "Install directory: $INSTALL_DIR"

cd "$INSTALL_DIR" || fail "Cannot cd to $INSTALL_DIR"

# ── Step 1: Save current version ─────────────────────────────────────────────
OLD_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
info "Current version: $OLD_HASH"

# ── Step 2: Pull latest code ─────────────────────────────────────────────────
info "Pulling latest code from origin/main..."
git fetch origin main || fail "git fetch failed"
git reset --hard origin/main || fail "git reset failed"
NEW_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
info "Updated to: $NEW_HASH"

if [ "$OLD_HASH" = "$NEW_HASH" ]; then
  ok "Already up to date. Nothing to do."
  exit 0
fi

# ── Step 3: Rebuild Docker images ────────────────────────────────────────────
info "Rebuilding Docker images..."
if [ -f "$COMPOSE_FILE" ]; then
  docker compose -f "$COMPOSE_FILE" build --no-cache api dashboard worker whatsapp 2>&1 | tee -a "$LOG_FILE"
  if [ ${PIPESTATUS[0]} -ne 0 ]; then
    fail "Docker build failed"
  fi
  ok "Docker images rebuilt"
else
  warn "No docker-compose.yml found at $COMPOSE_FILE — skipping build"
fi

# ── Step 4: Run database migrations ──────────────────────────────────────────
info "Running database migrations..."
if [ -f "$COMPOSE_FILE" ]; then
  # Run migrations via the API container
  docker compose -f "$COMPOSE_FILE" run --rm api npx prisma migrate deploy --schema=./node_modules/@wacrm/database/prisma/schema.prisma 2>&1 | tee -a "$LOG_FILE"
  ok "Migrations applied"
fi

# ── Step 5: Restart services ────────────────────────────────────────────────
info "Restarting services..."
if [ -f "$COMPOSE_FILE" ]; then
  docker compose -f "$COMPOSE_FILE" up -d --remove-orphans 2>&1 | tee -a "$LOG_FILE"
  ok "Services restarted"
fi

# ── Step 6: Health check ────────────────────────────────────────────────────
info "Waiting for API health check..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:3000/api/health > /dev/null 2>&1; then
    ok "API is healthy"
    break
  fi
  if [ "$i" -eq 30 ]; then
    warn "API health check timed out after 30 seconds"
  fi
  sleep 1
done

# ── Done ─────────────────────────────────────────────────────────────────────
info "═══ Update Complete: $OLD_HASH → $NEW_HASH ═══"
exit 0
